// Ported from hades/src/Model/Reflection/Parser.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The HADES expression language: parsing and evaluation of expressions over extension values.
 *
 * TypeScript port
 * ---------------
 * * Parsers are `Parser<A>` values from `@/lib/Text/Megaparsec` (direct-style functions over a
 *   mutable parse state, see that module). Run them with `MP.parse(topExpr(funcs, fields), "", txt)`.
 * * The orphan `instance ShowErrorComponent Text` is `ShowErrorComponent_Text`.
 * * `Function e` is an uncurried function `(argVals, extensionValues, env) => Either<Text, ExtValue>`
 *   (the `Vector ExtValue` is an array).
 * * The `Either Text` monad inside the built-in functions is written with a local exception
 *   (`unwrap`/`eitherDo`); the exported API returns `Either` as in Haskell.
 * * `notNone` takes its last argument as a thunk, because the Haskell version relies on
 *   laziness ("only evaluate v if ...").
 * * Integers are JavaScript numbers; integer results are normalised so that they are never `-0`.
 */
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as MP from "@/lib/Text/Megaparsec";
import { Left, Right, bindEither, mapRight, traverseEither, type Either } from "@/lib/Data/Either";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { absurd, div, round } from "@/lib/Prelude";
import { preview } from "@/lib/Control/Lens";
import {
  addDays, addGregorianMonthsClip, diffDays, today, toGregorian, toWeekDate, type Day,
} from "@/lib/Data/Time";
import { fieldsByName, type Field, type FieldName, type FieldTable, type FieldId as FieldIdT } from "./Types";
import {
  ExtBool, ExtDate, ExtInt, ExtNone, ExtReal, ExtText, compare_ExtValue, displayValue, eq_ExtValue,
  valueTypeName, type ExtValue, type ExtensionValues,
} from "./Values";
import { datePrism, shortDate } from "@/banana-ui/base/Reactive/Banana/Common";

/** Haskell `type Parser = Parsec Text Text`. */
type Parser<A> = MP.Parser<A>;

/** Orphan instance. Too bad. (`instance ShowErrorComponent Text`) */
export const ShowErrorComponent_Text: MP.ShowErrorComponent<T.Text> = {
  showErrorComponent: (t: T.Text) => T.unpack(t),
};

/** Local version of lexeme. */
function lexeme<A>(p: Parser<A>): Parser<A> {
  return MP.Lex.lexeme(MP.space, p);
}

/** Operator. */
export type Opr =
  | "PlusOp" | "MinusOp" | "TimesOp" | "DivOp"
  | "EqualOp" | "NotEqualOp"
  | "LessOp" | "LessEqOp" | "GreaterOp" | "GreaterEqOp"
  | "AndOp" | "OrOp" | "NotOp"
  | "ConcatOp";
export const oprValues: readonly Opr[] = [
  "PlusOp", "MinusOp", "TimesOp", "DivOp",
  "EqualOp", "NotEqualOp",
  "LessOp", "LessEqOp", "GreaterOp", "GreaterEqOp",
  "AndOp", "OrOp", "NotOp",
  "ConcatOp",
];

/** `instance Show Opr` */
export function show_Opr(o: Opr): string {
  return T.unpack(operatorName(o));
}

function operatorName(v: Opr): T.Text {
  return fromMaybe("?", L.lookup(v, opList.map(([x, y]) => [y, x] as const)));
}

/** Parse an operator. */
const operator: Parser<Opr> = MP.label("operator", lexeme((st) => {
  const opChars = "+=-*/<>&|!";
  const opStr = T.pack(MP.some(MP.oneOf(opChars))(st).join(""));
  const r = L.lookup(opStr, opList);
  if (r.tag === "Just") return r.value;
  return MP.customFailure("Unrecognised operator " + opStr)(st);
}));

/** The list of operators and their text representations. */
const opList: readonly (readonly [T.Text, Opr])[] = [
  ["+", "PlusOp"], ["-", "MinusOp"], ["*", "TimesOp"], ["/", "DivOp"],
  ["=", "EqualOp"], ["!=", "NotEqualOp"],
  ["<", "LessOp"], ["<=", "LessEqOp"], [">", "GreaterOp"], [">=", "GreaterEqOp"],
  ["&", "AndOp"], ["|", "OrOp"], ["!", "NotOp"],
  ["++", "ConcatOp"],
];

export type FunctionName = T.Text;

/**
 * The vector of argument values to the function, the entity field values (including built-in
 * values) and an application-specific environment.
 * Returns either an error message or the result value.
 */
export type Function<E> = (argVals: readonly ExtValue[], vs: ExtensionValues, env: E) => Either<T.Text, ExtValue>;

/** Handy lookup table */
export type FunctionTable<E> = M.Map<FunctionName, Function<E>>;

/** Check the number of arguments. */
export function arity(nm: FunctionName, argVals: readonly ExtValue[], n: number): Either<T.Text, null> {
  return argVals.length !== n
    ? Left(nm + " takes " + String(n) + " arguments, not " + String(argVals.length) + ".")
    : Right(null);
}

/** Get one of the arguments. */
export function getArg(nm: FunctionName, argVals: readonly ExtValue[], n: number): Either<T.Text, ExtValue> {
  return n >= argVals.length ? Left("Not enough arguments for " + nm) : Right(argVals[n]);
}

/**
 * Only evaluate v if the numbered arguments are not ExtNone. Otherwise return ExtNone.
 * (The Haskell argument is lazy, so here it is a thunk.)
 */
export function notNone(
  nm: FunctionName, argVals: readonly ExtValue[], ns: readonly number[], v: () => Either<T.Text, ExtValue>,
): Either<T.Text, ExtValue> {
  const args = traverseEither((n: number) => getArg(nm, argVals, n), ns);
  if (args.tag === "Left") return args;
  return args.value.some((a) => eq_ExtValue(a, ExtNone)) ? Right(ExtNone) : v();
}

/** Evaluate a value as an Integer */
function asInt(v: ExtValue): Either<T.Text, number> {
  if (v.tag === "ExtInt") return Right(v._0);
  if (v.tag === "ExtReal") return Right(round(v._0));
  return Left("Not a number: " + T.take(20, displayValue(v)));
}

/** Evaluate a value as a boolean. */
function asBool(v: ExtValue): Either<T.Text, boolean> {
  if (v.tag === "ExtBool") return Right(v._0);
  return Left("Not a boolean: " + T.take(20, displayValue(v)));
}

/** Extract date as (y, m, d) triple. */
function asDate(v: ExtValue): Either<T.Text, [number, number, number]> {
  if (v.tag === "ExtDate") return Right(toGregorian(v._0));
  return Left("Not a date: " + T.take(20, displayValue(v)));
}

/** The date as a Day. */
function asDay(v: ExtValue): Either<T.Text, Day> {
  if (v.tag === "ExtDate") return Right(v._0);
  return Left("Not a date: " + T.take(20, displayValue(v)));
}

/** Extract date as (y, w, d) triple. */
function asDateW(v: ExtValue): Either<T.Text, [number, number, number]> {
  if (v.tag === "ExtDate") return Right(toWeekDate(v._0));
  return Left("Not a date: " + T.take(20, displayValue(v)));
}

// The `Either Text` monad used in the built-in functions: `unwrap` is `<-`, `eitherDo` runs a block.
class EvalFailure {
  constructor(readonly msg: T.Text) {}
}
function unwrap<A>(e: Either<T.Text, A>): A {
  if (e.tag === "Left") throw new EvalFailure(e.value);
  return e.value;
}
function eitherDo(f: () => ExtValue): Either<T.Text, ExtValue> {
  try {
    return Right(f());
  } catch (x) {
    if (x instanceof EvalFailure) return Left(x.msg);
    throw x;
  }
}

/** An `ExtInt` result. Haskell `Integer` has no negative zero. */
function intValue(n: number): ExtValue {
  return ExtInt(n === 0 ? 0 : n);
}

const dayNames: readonly T.Text[] = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday", "Sunday"];
const monthNames: readonly T.Text[] = ["", "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** Functions provided for all expression evaluators. */
const builtInFunctions: FunctionTable<any> = M.fromList<FunctionName, Function<any>>([
  ["Characters", (argVals) => eitherDo(() => {
    unwrap(arity("Characters", argVals, 1));
    return intValue(T.length(displayValue(unwrap(getArg("Characters", argVals, 0)))));
  })],
  ["Words", (argVals) => eitherDo(() => {
    unwrap(arity("Words", argVals, 1));
    return intValue(T.words(displayValue(unwrap(getArg("Words", argVals, 0)))).length);
  })],
  ["Strip", (argVals) => eitherDo(() => {
    unwrap(arity("Strip", argVals, 1));
    return ExtText(T.strip(displayValue(unwrap(getArg("Strip", argVals, 0)))));
  })],
  ["Find", (argVals) => eitherDo(() => {
    unwrap(arity("Find", argVals, 2));
    const key = displayValue(unwrap(getArg("Find", argVals, 0)));
    const str = displayValue(unwrap(getArg("Find", argVals, 1)));
    const [t1, t2] = T.breakOn(key, str);
    return intValue(T.length(t2) > 0
      ? T.length(t1)
      : -1); // Not found.
  })],
  ["Mid", (argVals) => eitherDo(() => {
    unwrap(arity("Mid", argVals, 3));
    return unwrap(notNone("Mid", argVals, [1, 2], () => eitherDo(() => {
      const str = Array.from(T.unpack(displayValue(unwrap(getArg("Mid", argVals, 0)))));
      const start = unwrap(bindEither(getArg("Mid", argVals, 1), asInt));
      const cnt = unwrap(bindEither(getArg("Mid", argVals, 2), asInt));
      return ExtText(T.pack(midList(start, cnt, str).join("")));
    })));
  })],
  ["Left", (argVals) => eitherDo(() => {
    unwrap(arity("Left", argVals, 2));
    return unwrap(notNone("Left", argVals, [1], () => eitherDo(() => {
      const str = displayValue(unwrap(getArg("Left", argVals, 0)));
      const cnt = unwrap(bindEither(getArg("Left", argVals, 1), asInt));
      return ExtText(T.take(cnt, str));
    })));
  })],
  ["Right", (argVals) => eitherDo(() => {
    unwrap(arity("Right", argVals, 2));
    return unwrap(notNone("Right", argVals, [1], () => eitherDo(() => {
      const str = displayValue(unwrap(getArg("Right", argVals, 0)));
      const cnt = unwrap(bindEither(getArg("Right", argVals, 1), asInt));
      return ExtText(T.takeEnd(cnt, str));
    })));
  })],
  ["MidWords", (argVals) => eitherDo(() => {
    unwrap(arity("MidWords", argVals, 3));
    return unwrap(notNone("MidWords", argVals, [1, 2], () => eitherDo(() => {
      const strs = T.words(displayValue(unwrap(getArg("MidWords", argVals, 0))));
      const start = unwrap(bindEither(getArg("MidWords", argVals, 1), asInt));
      const cnt = unwrap(bindEither(getArg("MidWords", argVals, 2), asInt));
      return ExtText(T.unwords(midList(start, cnt, strs)));
    })));
  })],
  ["LeftWords", (argVals) => eitherDo(() => {
    unwrap(arity("LeftWords", argVals, 2));
    return unwrap(notNone("LeftWords", argVals, [1], () => eitherDo(() => {
      const strs = T.words(displayValue(unwrap(getArg("LeftWords", argVals, 0))));
      const cnt = unwrap(bindEither(getArg("LeftWords", argVals, 1), asInt));
      return ExtText(T.unwords(L.take(cnt, strs)));
    })));
  })],
  ["RightWords", (argVals) => eitherDo(() => {
    unwrap(arity("RightWords", argVals, 2));
    return unwrap(notNone("RightWords", argVals, [1], () => eitherDo(() => {
      const strs = T.words(displayValue(unwrap(getArg("RightWords", argVals, 0))));
      const cnt = unwrap(bindEither(getArg("RightWords", argVals, 1), asInt));
      return ExtText(cnt < 1
        ? ""
        : T.unwords(midList(-cnt, Number.MAX_SAFE_INTEGER, strs)));  // maxBound
    })));
  })],
  ["If", (argVals) => eitherDo(() => {
    unwrap(arity("If", argVals, 3));
    return unwrap(notNone("If", argVals, [0], () => eitherDo(() => {
      const b = unwrap(bindEither(getArg("If", argVals, 0), asBool));
      const tVal = unwrap(getArg("If", argVals, 1));
      const fVal = unwrap(getArg("If", argVals, 2));
      return b ? tVal : fVal;
    })));
  })],
  ["Round", (argVals) => eitherDo(() => {
    unwrap(arity("Round", argVals, 1));
    return unwrap(notNone("Round", argVals, [0], () =>
      mapRight(intValue, bindEither(getArg("Round", argVals, 0), asInt))));
  })],
  ["Upper", (argVals) => eitherDo(() => {
    unwrap(arity("Upper", argVals, 1));
    return unwrap(notNone("Upper", argVals, [0], () =>
      mapRight((v: ExtValue) => ExtText(T.toUpper(displayValue(v))), getArg("Upper", argVals, 0))));
  })],
  ["Lower", (argVals) => eitherDo(() => {
    unwrap(arity("Lower", argVals, 1));
    return unwrap(notNone("Lower", argVals, [0], () =>
      mapRight((v: ExtValue) => ExtText(T.toLower(displayValue(v))), getArg("Lower", argVals, 0))));
  })],
  ["Min", (argVals) => {
    const xs = argVals.filter((v) => !eq_ExtValue(v, ExtNone));
    return xs.length === 0 ? Right(ExtNone) : Right(L.minimumBy(compare_ExtValue, xs));
  }],
  ["Max", (argVals) => {
    const xs = argVals.filter((v) => !eq_ExtValue(v, ExtNone));
    return xs.length === 0 ? Right(ExtNone) : Right(L.maximumBy(compare_ExtValue, xs));
  }],
  ["Day", (argVals) => eitherDo(() => {
    unwrap(arity("Day", argVals, 1));
    return unwrap(notNone("Day", argVals, [0], () => eitherDo(() => {
      const [, , d] = unwrap(bindEither(getArg("Day", argVals, 0), asDate));
      return intValue(d);
    })));
  })],
  ["Month", (argVals) => eitherDo(() => {
    unwrap(arity("Month", argVals, 1));
    return unwrap(notNone("Month", argVals, [0], () => eitherDo(() => {
      const [, m] = unwrap(bindEither(getArg("Month", argVals, 0), asDate));
      return intValue(m);
    })));
  })],
  ["Year", (argVals) => eitherDo(() => {
    unwrap(arity("Year", argVals, 1));
    return unwrap(notNone("Year", argVals, [0], () => eitherDo(() => {
      const [y] = unwrap(bindEither(getArg("Year", argVals, 0), asDate));
      return intValue(y);
    })));
  })],
  ["Week", (argVals) => eitherDo(() => {
    unwrap(arity("Week", argVals, 1));
    return unwrap(notNone("Week", argVals, [0], () => eitherDo(() => {
      const [, w] = unwrap(bindEither(getArg("Week", argVals, 0), asDateW));
      return intValue(w);
    })));
  })],
  ["Weekday", (argVals) => eitherDo(() => {
    unwrap(arity("Weekday", argVals, 1));
    return unwrap(notNone("Weekday", argVals, [0], () => eitherDo(() => {
      const [, , d] = unwrap(bindEither(getArg("Weekday", argVals, 0), asDateW));
      return intValue(d);
    })));
  })],
  ["DayName", (argVals) => eitherDo(() => {
    unwrap(arity("DayName", argVals, 1));
    return unwrap(notNone("DayName", argVals, [0], () => eitherDo(() => {
      const [, , d] = unwrap(bindEither(getArg("DayName", argVals, 0), asDateW));
      return ExtText(dayNames[d]); // Safe because d must be in range 1-7.
    })));
  })],
  ["MonthName", (argVals) => eitherDo(() => {
    unwrap(arity("MonthName", argVals, 1));
    return unwrap(notNone("MonthName", argVals, [0], () => eitherDo(() => {
      const [, m] = unwrap(bindEither(getArg("MonthName", argVals, 0), asDate));
      return ExtText(monthNames[m]); // Safe because m must be in range 1-12.
    })));
  })],
  ["AddMonth", (argVals) => eitherDo(() => {
    unwrap(arity("AddMonth", argVals, 2));
    return unwrap(notNone("AddMonth", argVals, [0, 1], () => eitherDo(() => {
      const d = unwrap(bindEither(getArg("AddMonth", argVals, 0), asDay));
      const i = unwrap(bindEither(getArg("AddMonth", argVals, 1), asInt));
      return ExtDate(addGregorianMonthsClip(i, d));
    })));
  })],
  ["Today", (argVals) => eitherDo(() => {
    unwrap(arity("Today", argVals, 0));
    // The Haskell version uses unsafePerformIO, assuming the current date does not change.
    // Here the local date is read on each call.
    return ExtDate(today());
  })],
]);

/** Filter predicate expressions. */
export type Expr<E> =
  | { readonly tag: "FieldId"; readonly _0: FieldIdT }
  | { readonly tag: "Application"; readonly _0: Function<E>; readonly _1: readonly Expr<E>[] }
  | { readonly tag: "BinaryOp"; readonly _0: Opr; readonly _1: Expr<E>; readonly _2: Expr<E> }
  | { readonly tag: "UnaryOp"; readonly _0: Opr; readonly _1: Expr<E> }
  | { readonly tag: "ValueLit"; readonly _0: ExtValue };
export function FieldId<E = any>(_0: FieldIdT): Expr<E> {
  return { tag: "FieldId", _0 };
}
export function Application<E>(_0: Function<E>, _1: readonly Expr<E>[]): Expr<E> {
  return { tag: "Application", _0, _1 };
}
export function BinaryOp<E>(_0: Opr, _1: Expr<E>, _2: Expr<E>): Expr<E> {
  return { tag: "BinaryOp", _0, _1, _2 };
}
export function UnaryOp<E>(_0: Opr, _1: Expr<E>): Expr<E> {
  return { tag: "UnaryOp", _0, _1 };
}
export function ValueLit<E = any>(_0: ExtValue): Expr<E> {
  return { tag: "ValueLit", _0 };
}

/**
 * Top level filter expression. This includes leading and trailing spaces and an EOF.
 * The function table has the built-in functions added automatically. Built-in functions can be
 * overridden by functions of the same name, but this is not a good idea.
 *
 * @param ftable Known identifiers for extension values.
 */
export function topExpr<E>(funcs: FunctionTable<E>, ftable: FieldTable): Parser<Expr<E>> {
  return (st) => {
    MP.space(st);
    const r = expr<E>(M.union(funcs, builtInFunctions), fieldsByName(ftable))(st);
    MP.space(st);
    MP.eof(st);
    return r;
  };
}

/**
 * Expression parser. Note that the top level caller should also allow for
 * leading spaces. So something like @space >> expr@
 */
function expr<E>(funcs: FunctionTable<E>, ftable: M.Map<FieldName, Field>): Parser<Expr<E>> {
  // A sequence of letters could be an identifier or function name or Boolean.
  const term1: Parser<Expr<E>> = (st) => {
    const ident = MP.label("name", lexeme((st1) => {
      const c1 = MP.letterChar(st1);
      const cs = MP.many(MP.alt(MP.alphaNumChar, MP.char("_")))(st1);
      return T.pack([c1, ...cs].join(""));
    }))(st);
    const isFunc = MP.lookAhead(MP.alt(
      MP.try_(MP.constP(true, lexeme(MP.char("(")))),
      MP.pure(false),
    ))(st);
    if (isFunc) {
      return MP.label("function arguments", (st1): Expr<E> => {
        lexeme(MP.char("("))(st1);
        const f = M.lookup(ident, funcs);
        if (f.tag === "Nothing") return MP.fail("Not a valid function name: " + T.unpack(ident))(st1);
        const es = MP.sepBy(expr(funcs, ftable), lexeme(MP.char(",")))(st1);
        lexeme(MP.char(")"))(st1);
        return Application(f.value, es);
      })(st);
    }
    const v = booleanName(ident);
    if (v.tag === "Just") return v.value;
    const f = M.lookup(ident, ftable);
    if (f.tag === "Just") return FieldId(f.value.fieldId);
    return MP.fail("Unknown value name: " + T.unpack(ident))(st);
  };
  const parExp: Parser<Expr<E>> = (st) => {
    lexeme(MP.char("("))(st);
    const e = expr(funcs, ftable)(st);
    lexeme(MP.char(")"))(st);
    return e;
  };
  const term: Parser<Expr<E>> = MP.alt(
    term1,
    longIdent<E>(ftable),
    parExp,
    dateLit<E>(),
    stringLit<E>(),
    numberLit<E>(),
  );
  const theOp = (opr1: Opr): Parser<Opr> => MP.label(show_Opr(opr1), MP.try_((st) => {
    const opr2 = operator(st);
    if (opr1 === opr2) return opr2;
    return MP.fail("Not the right operator: expected " + show_Opr(opr1) + " got " + show_Opr(opr2))(st);
  }));
  const unaryOp = (opr1: Opr): MP.Operator<Expr<E>> =>
    MP.Prefix(MP.constP((x: Expr<E>) => UnaryOp(opr1, x), theOp(opr1)));
  const infixOp = (opr1: Opr): MP.Operator<Expr<E>> =>
    MP.InfixL(MP.constP((x: Expr<E>, y: Expr<E>) => BinaryOp(opr1, x, y), theOp(opr1)));
  const opTable: MP.Operator<Expr<E>>[][] = [
    [unaryOp("MinusOp")],
    [infixOp("TimesOp"), infixOp("DivOp")],
    [infixOp("PlusOp"), infixOp("MinusOp")],
    [infixOp("ConcatOp")],
    [infixOp("LessOp"), infixOp("LessEqOp"), infixOp("GreaterOp"), infixOp("GreaterEqOp")],
    [infixOp("EqualOp"), infixOp("NotEqualOp")],
    [unaryOp("NotOp")],
    [infixOp("AndOp")],
    [infixOp("OrOp")],
  ];
  const booleanName = (s: T.Text): Maybe<Expr<E>> => {
    switch (s) {
      case "Yes": return Just(ValueLit<E>(ExtBool(true)));
      case "No": return Just(ValueLit<E>(ExtBool(false)));
      case "True": return Just(ValueLit<E>(ExtBool(true)));
      case "False": return Just(ValueLit<E>(ExtBool(false)));
      default: return Nothing;
    }
  };
  return MP.makeExprParser(term, opTable);
}

/**
 * Parse a field name. A field name can either be a single word or several words in square
 * brackets, such as "[Foo bar]". The bracketed form can also include special characters except
 * for a close square bracket.
 */
function longIdent<E>(ftable: M.Map<FieldName, Field>): Parser<Expr<E>> {
  return MP.label("long name", lexeme((st): Expr<E> => {
    MP.char("[")(st);
    const str = MP.many(MP.anySingleBut("]"))(st).join("");
    MP.char("]")(st);
    const txt = T.pack(str);
    const f = M.lookup(txt, ftable);
    if (f.tag === "Just") return FieldId(f.value.fieldId);
    return MP.fail("Unknown value name: [" + str + "]")(st);
  }));
}

/** Literal date. A date is enclosed in single quotes. E.g. @'2 June 2005'@.  See "datePrism". */
function dateLit<E>(): Parser<Expr<E>> {
  return MP.label("date", lexeme((st): Expr<E> => {
    MP.char("'")(st);
    const str = MP.many(MP.alt(MP.alphaNumChar, MP.char("/"), MP.char(" ")))(st).join("");
    MP.char("'")(st);
    const d = preview(datePrism(shortDate), T.pack(str)); // Format ignored because we only read the date.
    if (d.tag === "Just") return ValueLit(ExtDate(d.value));
    return MP.customFailure("Unreadable date: '" + T.pack(str) + "'")(st);
  }));
}

/**
 * Literal strings are enclosed in double quotes. Within the string quotes and backslashes
 * are escaped. E.g. @\"This string contains \\\"foo\\\".\"@
 */
function stringLit<E>(): Parser<Expr<E>> {
  return MP.label("string", lexeme((st) => {
    MP.char("\"")(st);
    const cs = MP.manyTill(MP.Lex.charLiteral, MP.char("\""))(st);
    return ValueLit<E>(ExtText(T.pack(cs.join(""))));
  }));
}

/** Numeric literals are either integers or floats. */
function numberLit<E>(): Parser<Expr<E>> {
  return MP.label("number", MP.alt(
    MP.try_(MP.mapP((r: number) => ValueLit<E>(ExtReal(r)), lexeme(MP.Lex.float))),
    MP.mapP((i: number) => ValueLit<E>(ExtInt(i)), lexeme(MP.Lex.decimal)),
  ));
}

/** Evaluate an expression in the context of an entity. */
export function evaluate<E>(ex: Expr<E>, vs: ExtensionValues, e: E): Either<T.Text, ExtValue> {
  switch (ex.tag) {
    case "FieldId": return Right(fromMaybe(ExtNone, M.lookup(ex._0, vs)));
    case "Application": return evaluateFunction(ex._0, ex._1, vs, e);
    case "ValueLit": return Right(ex._0);
    case "UnaryOp": return evaluateUnaryOp(ex._0, ex._1, vs, e);
    case "BinaryOp": return evaluateBinaryOp(ex._0, ex._1, ex._2, vs, e);
    default: return absurd(ex);
  }
}

/** Apply a function to an evaluated list of arguments. */
function evaluateFunction<E>(
  func: Function<E>, exprs: readonly Expr<E>[], vs: ExtensionValues, env: E,
): Either<T.Text, ExtValue> {
  const argVals = traverseEither((args: Expr<E>) => evaluate(args, vs, env), exprs);
  if (argVals.tag === "Left") return argVals;
  return func(argVals.value, vs, env);
}

/** Take the middle items from a list. Negative start counts from the end. */
function midList<A>(start1: number, cnt: number, xs: readonly A[]): A[] {
  const start2 = start1 < 0 ? xs.length + start1 : start1;
  return L.take(cnt, L.drop(start2, xs));
}

/** Evaluate a unary operator and its argument. */
function evaluateUnaryOp<E>(opr: Opr, expr1: Expr<E>, vs: ExtensionValues, e: E): Either<T.Text, ExtValue> {
  const r = evaluate(expr1, vs, e);
  if (r.tag === "Left") return r;
  const v = r.value;
  if (opr === "MinusOp" && v.tag === "ExtInt") return Right(intValue(-v._0));
  if (opr === "MinusOp" && v.tag === "ExtReal") return Right(ExtReal(-v._0));
  if (opr === "NotOp" && v.tag === "ExtBool") return Right(ExtBool(!v._0));
  return Left("Illegal operation: " + operatorName(opr) + " " + valueTypeName(v));
}

/**
 * The cases of `evaluateBinaryOp` for specific operator and value types, in the Haskell order.
 * Returns `null` when none of them applies.
 */
function binaryCase(opr: Opr, v1b: ExtValue, v2b: ExtValue): Either<T.Text, ExtValue> | null {
  const cf = T.toCaseFold;
  switch (opr) {
    case "PlusOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(intValue(v1b._0 + v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtReal(v1b._0 + v2b._0));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtInt") return Right(ExtDate(addDays(v2b._0, v1b._0)));
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtDate") return Right(ExtDate(addDays(v1b._0, v2b._0)));
      return null;
    case "MinusOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(intValue(v1b._0 - v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtReal(v1b._0 - v2b._0));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(intValue(diffDays(v1b._0, v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtInt") return Right(ExtDate(addDays(-v2b._0, v1b._0)));
      return null;
    case "TimesOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(intValue(v1b._0 * v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtReal(v1b._0 * v2b._0));
      return null;
    case "DivOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") {
        return v2b._0 === 0 ? Left("Division by zero") : Right(intValue(div(v1b._0, v2b._0)));
      }
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtReal(v1b._0 / v2b._0));
      return null;
    case "EqualOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(ExtBool(v1b._0 === v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtBool(v1b._0 === v2b._0));
      if (v1b.tag === "ExtText" && v2b.tag === "ExtText") return Right(ExtBool(cf(v1b._0) === cf(v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(ExtBool(v1b._0 === v2b._0));
      return null;
    case "NotEqualOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(ExtBool(v1b._0 !== v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtBool(v1b._0 !== v2b._0));
      if (v1b.tag === "ExtText" && v2b.tag === "ExtText") return Right(ExtBool(cf(v1b._0) !== cf(v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(ExtBool(v1b._0 !== v2b._0));
      return null;
    case "LessOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(ExtBool(v1b._0 < v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtBool(v1b._0 < v2b._0));
      if (v1b.tag === "ExtText" && v2b.tag === "ExtText") return Right(ExtBool(cf(v1b._0) < cf(v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(ExtBool(v1b._0 < v2b._0));
      return null;
    case "LessEqOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(ExtBool(v1b._0 <= v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtBool(v1b._0 <= v2b._0));
      if (v1b.tag === "ExtText" && v2b.tag === "ExtText") return Right(ExtBool(cf(v1b._0) <= cf(v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(ExtBool(v1b._0 <= v2b._0));
      return null;
    case "GreaterOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(ExtBool(v1b._0 > v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtBool(v1b._0 > v2b._0));
      if (v1b.tag === "ExtText" && v2b.tag === "ExtText") return Right(ExtBool(cf(v1b._0) > cf(v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(ExtBool(v1b._0 > v2b._0));
      return null;
    case "GreaterEqOp":
      if (v1b.tag === "ExtInt" && v2b.tag === "ExtInt") return Right(ExtBool(v1b._0 >= v2b._0));
      if (v1b.tag === "ExtReal" && v2b.tag === "ExtReal") return Right(ExtBool(v1b._0 >= v2b._0));
      if (v1b.tag === "ExtText" && v2b.tag === "ExtText") return Right(ExtBool(cf(v1b._0) >= cf(v2b._0)));
      if (v1b.tag === "ExtDate" && v2b.tag === "ExtDate") return Right(ExtBool(v1b._0 >= v2b._0));
      return null;
    case "AndOp":
      if (v1b.tag === "ExtBool" && v2b.tag === "ExtBool") return Right(ExtBool(v1b._0 && v2b._0));
      return null;
    case "OrOp":
      if (v1b.tag === "ExtBool" && v2b.tag === "ExtBool") return Right(ExtBool(v1b._0 || v2b._0));
      return null;
    case "NotOp":
    case "ConcatOp":
      return null;
    default:
      return absurd(opr);
  }
}

/** Evaluate a binary operator with its two arguments. */
function evaluateBinaryOp<E>(
  opr: Opr, expr1: Expr<E>, expr2: Expr<E>, vs: ExtensionValues, e: E,
): Either<T.Text, ExtValue> {
  const v1 = evaluate(expr1, vs, e);
  const v2 = evaluate(expr2, vs, e);
  // (Left msg, Right _) -> Left msg; (Right _, Left msg) -> Left msg;
  // (Left msg1, Left msg2) -> Left $ msg1 <> ", " <> msg2
  if (v1.tag === "Left") return v2.tag === "Left" ? Left(v1.value + ", " + v2.value) : v1;
  if (v2.tag === "Left") return v2;
  const v1a = v1.value, v2a = v2.value;
  const [v1b, v2b] = promoteBinary(v1a, v2a);
  const r = binaryCase(opr, v1b, v2b);
  if (r !== null) return r;
  if (opr === "ConcatOp") return Right(ExtText(displayValue(v1a) + displayValue(v2a)));
  if (v1b.tag === "ExtNone") return Right(ExtNone);
  if (v2b.tag === "ExtNone") return Right(ExtNone);
  return Left("Illegal operation: " +
    valueTypeName(v1a) + " " +
    operatorName(opr) + " " +
    valueTypeName(v2a));
}

function promoteBinary(x: ExtValue, y: ExtValue): [ExtValue, ExtValue] {
  if (x.tag === "ExtInt" && y.tag === "ExtReal") return [ExtReal(x._0), y];
  if (x.tag === "ExtReal" && y.tag === "ExtInt") return [x, ExtReal(y._0)];
  return [x, y];
}
