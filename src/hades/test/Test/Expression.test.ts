// Ported from hades/test/Test/Expression.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Tests of the expression language in "Model.Reflection.Parser".
 *
 * The HUnit test list `runExpressionTests` becomes the vitest suites below ("Good cases" and
 * "Bad cases"). The randomized suite at the end is an addition: deterministic property tests
 * driven by a seeded PRNG.
 */
import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as MP from "@/lib/Text/Megaparsec";
import { Right } from "@/lib/Data/Either";
import { fromGregorian } from "@/lib/Data/Time";
import { evaluate, topExpr, ShowErrorComponent_Text, type FunctionTable } from "@/hades/src/Model/Reflection/Parser";
import {
  BuiltInDef, Field, migrateField, type BuiltInType, type FieldId, type FieldTable,
} from "@/hades/src/Model/Reflection/Types";
import {
  ExtBool, ExtDate, ExtInt, ExtNone, ExtReal, ExtText, type ExtValue, type ExtensionValues,
} from "@/hades/src/Model/Reflection/Values";

const testEnv: ExtensionValues = M.fromList(([
  ["TestString", ExtText("The quick, brown fox jumped over the lazy dog.")],
  ["The Answer", ExtInt(42)],
  ["n", ExtInt(5)],
  ["Flag", ExtBool(true)],
  ["False flag", ExtBool(false)],
  ["X", ExtReal(45.125)], // Chosen for exact binary representation.
  ["Y", ExtReal(2.125)],
  ["TheDay", ExtDate(fromGregorian(2018, 11, 30))],
  ["Christmas", ExtDate(fromGregorian(2018, 12, 25))],
  ["Find", ExtInt(4)], // Same name as a function.
] as [string, ExtValue][]).map(([k, v]) => [migrateField(k), v] as [FieldId, ExtValue]));

/** Set of known identifiers. All keys in "testEnv" plus \"NoValue\". */
const knownFields: FieldTable = M.fromList(([
  ["TestString", "ModelText"],
  ["The Answer", "ModelInt"],
  ["n", "ModelInt"],
  ["Flag", "ModelBool"],
  ["False flag", "ModelBool"],
  ["X", "ModelReal"],
  ["Y", "ModelReal"],
  ["TheDay", "ModelDate"],
  ["Christmas", "ModelDate"],
  ["Find", "ModelInt"],
  ["NoValue", "ModelText"],
] as [string, BuiltInType][]).map(genField));

function genField([n, t]: [string, BuiltInType]): [FieldId, Field] {
  const fid = migrateField(n);
  return [fid, Field(false, fid, n, "One", BuiltInDef(t))];
}

const goodCases: [ExtValue, string][] = [
  [ExtNone, "NoValue"],
  [ExtNone, "NoValue + 4"],
  [ExtInt(-42), "-[The Answer]"],
  [ExtBool(true), "[The Answer]=42"],
  [ExtText("Foo"), "\"Foo\""],
  [ExtInt(4), "Find"],
  [ExtDate(fromGregorian(2018, 4, 5)), "'5 April 2018'"],
  [ExtInt(42), "[The Answer] "],
  [ExtInt(47), "[The Answer] + n"],
  [ExtReal(3.125), "X-[The Answer]"],
  [ExtReal(39.875), "[The Answer] - [Y]"],
  [ExtInt(210), "[The Answer] * n"],
  [ExtInt(8), "[The Answer] / n"],
  [ExtInt(214), "4 + [The Answer] * n"],
  [ExtInt(230), "(4 + [The Answer]) * n"],
  [ExtReal(21.235294117647058), "X / Y"],
  [ExtBool(true), "X > Y"],
  [ExtBool(false), "X > Y & X < Y"],
  [ExtInt(25), "Christmas - [TheDay]"],
  [ExtText("Foo! The quick, brown fox jumped over the lazy dog. Bark!"),
    "\"Foo! \" ++ TestString ++ \" Bark!\""],
  [ExtDate(fromGregorian(2018, 12, 3)), "TheDay + 3"],
  [ExtDate(fromGregorian(2018, 12, 20)), "Christmas - 5"],
  [ExtText("The"), "Strip ( \"  The   \"  )"],
  [ExtText("42 wibble"), "Strip([The Answer] ++ \" wibble  \n\n\t\")"],
  [ExtInt(46), "Characters(TestString)"],
  [ExtInt(9), "  Words ( TestString) "],
  [ExtInt(0), "Find(\"The\", TestString)"],
  [ExtInt(4), "Find(\"quick\", TestString)"],
  [ExtInt(-1), "Find(\"wibble\", TestString)"],
  [ExtText("quick"), "Mid(TestString, 4, 2+3)"],
  [ExtText(".1"), "Mid(X, 2, 2)"],
  [ExtText("The "), "Left ( TestString, 4)"],
  [ExtText("dog."), "Right (TestString, 4)"],
  [ExtText("brown fox"), "MidWords(TestString, 2, 2)"],
  [ExtText("The quick,"), "LeftWords (TestString, 2)"],
  [ExtText("lazy dog."), "RightWords (TestString, 2)"],
  [ExtInt(2), "If (2>3, 5, 2)"],
  [ExtInt(5), "If (Flag, 5, 2)"],
  [ExtInt(45), "Round(X)"],
  [ExtText("THE QUICK,"), "Upper (LeftWords (TestString, 2))"],
  [ExtText("the quick,"), "Lower (LeftWords (TestString, 2))"],
  [ExtInt(4), "Min (43, 52, 4, 23, 8)"],
  [ExtReal(45.125), "Max (4.2, 5, 8, X, Y, 20.2)"],
  [ExtNone, "Min ()"],
  [ExtNone, "Max ()"],
  [ExtNone, "Min (NoValue, NoValue)"],
  [ExtInt(23), "Max (NoValue, 23, NoValue, 4)"],
  [ExtText("wibble"), "Max (\"foo\", \"bar\", \"wibble\", \"baz\")"],
  [ExtDate(fromGregorian(2018, 11, 30)), "Min (TheDay, Christmas)"],
  [ExtInt(25), "Day(Christmas)"],
  [ExtInt(12), "Month(Christmas)"],
  [ExtNone, "Month(NoValue)"],
  [ExtInt(2018), "Year(Christmas)"],
  [ExtInt(48), "Week(TheDay)"],
  [ExtInt(5), "Weekday(TheDay)"],
  [ExtDate(fromGregorian(2019, 1, 25)), "AddMonth (Christmas, 1)"],
  [ExtDate(fromGregorian(2019, 2, 28)), "AddMonth (TheDay, 3)"],
  [ExtText("Friday"), "DayName(TheDay)"],
  [ExtText("November"), "MonthName (TheDay)"],
];

/** Expressions that should yield an error. */
const badCases: string[] = [
  "TestString + 1", // Type mismatch.
  "[The Answer] = \"42\"", // Type mismatch.
  "Find(TestString)", // Too few arguments.
  "Left(TestString,3,4,5)", // Too many arguments.
  "Left(TestString,TheDay,4)", // Not a number.
  "If (TestString, 4, 5)", // Not a boolean.
  "Day (TestString)", // Not a date.
  "-TestString", // Illegal unary operation.
  "4 / 0", // Integer division by zero.
];

const noFunctions: FunctionTable<null> = M.empty();

/** Check that the expression in the text returns the @ExtValue@. */
function doGoodCase([v, e1]: [ExtValue, string]): void {
  const r = MP.parse(topExpr(noFunctions, knownFields), "", e1);
  if (r.tag === "Left") {
    expect.fail("Parse failed: " + MP.errorBundlePretty(ShowErrorComponent_Text, r.value));
  } else {
    expect(evaluate(r.value, testEnv, null), e1).toEqual(Right(v));
  }
}

/** Check that the expression returns an error. We don't care about the exact message. */
function doBadCase(e1: string): void {
  const r = MP.parse(topExpr(noFunctions, knownFields), "", e1);
  if (r.tag === "Left") {
    expect.fail("Parse failed: " + MP.errorBundlePretty(ShowErrorComponent_Text, r.value));
  } else {
    const v = evaluate(r.value, testEnv, null);
    if (v.tag === "Right") {
      expect.fail("Bad case " + JSON.stringify(e1) + " returned a value of " + JSON.stringify(v.value));
    }
  }
}

describe("Expression tests", () => {
  describe("Good cases", () => {
    it.each(goodCases)("%# evaluates to %o", (v, e1) => doGoodCase([v, e1]));
  });
  describe("Bad cases", () => {
    it.each(badCases)("%s yields an error", (e1) => doBadCase(e1));
  });
});

// ---------------------------------------------------------------------------------------------
// Additional checks: parse errors and randomized properties.

function parseError(e1: string): string {
  const r = MP.parse(topExpr(noFunctions, knownFields), "", e1);
  if (r.tag === "Right") throw new Error("Expected a parse error for " + e1);
  return MP.parseErrorTextPretty(ShowErrorComponent_Text, r.value.bundleErrors[0]);
}

describe("Parse errors", () => {
  it("reports unknown names and functions", () => {
    expect(parseError("Wibble")).toBe("Unknown value name: Wibble\n");
    expect(parseError("[Wibble wobble]")).toBe("Unknown value name: [Wibble wobble]\n");
    expect(parseError("Wibble(3)")).toBe("Not a valid function name: Wibble\n");
  });

  it("reports bad dates and misplaced operators", () => {
    expect(parseError("'31 February 2018'")).toBe("Unreadable date: '31 February 2018'\n");
    // The operator parsers are wrapped in "try", so the custom error is backtracked over.
    expect(parseError("4 +- 3")).toBe("unexpected '+'\nexpecting end of input or white space\n");
  });

  it("lists the expected items", () => {
    expect(parseError("4 5")).toBe(
      "unexpected '5'\nexpecting !=, &, *, +, ++, -, /, <, <=, =, >, >=, end of input, white space, or |\n");
    expect(parseError("")).toBe(
      "unexpected end of input\nexpecting !, '(', -, date, long name, name, number, string, or white space\n");
    expect(parseError("\"abc")).toBe(
      "unexpected end of input\nexpecting '\"' or literal character\n");
  });
});

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Randomized properties", () => {
  const evalText = (txt: string): ExtValue => {
    const r = MP.parse(topExpr(noFunctions, knownFields), "", txt);
    if (r.tag === "Left") throw new Error(MP.errorBundlePretty(ShowErrorComponent_Text, r.value));
    const v = evaluate(r.value, testEnv, null);
    if (v.tag === "Left") throw new Error(txt + ": " + v.value);
    return v.value;
  };

  it("integer arithmetic follows the usual precedence rules", () => {
    const rnd = mulberry32(20190101);
    const int = (k: number) => Math.floor(rnd() * k);
    for (let i = 0; i < 200; i++) {
      const xs = Array.from({ length: 2 + int(5) }, () => 1 + int(50));
      const ops = xs.slice(1).map(() => ["+", "-", "*"][int(3)]);
      let txt = String(xs[0]);
      ops.forEach((op, j) => {
        txt += " ".repeat(int(3)) + op + " ".repeat(int(3)) + String(xs[j + 1]);
      });
      // Reference: JavaScript has the same precedence for these operators.
      const expected = Function('"use strict"; return (' + txt + ");")() as number;
      expect(evalText(txt), txt).toEqual(ExtInt(expected));
    }
  });

  it("comparisons agree with the reference ordering", () => {
    const rnd = mulberry32(42);
    const ops: [string, (a: number, b: number) => boolean][] = [
      ["<", (a, b) => a < b], ["<=", (a, b) => a <= b], [">", (a, b) => a > b],
      [">=", (a, b) => a >= b], ["=", (a, b) => a === b], ["!=", (a, b) => a !== b],
    ];
    for (let i = 0; i < 200; i++) {
      const a = Math.floor(rnd() * 10), b = Math.floor(rnd() * 10);
      const [op, f] = ops[Math.floor(rnd() * ops.length)];
      const txt = `${a} ${op} ${b}`;
      expect(evalText(txt), txt).toEqual(ExtBool(f(a, b)));
      expect(evalText(`!(${txt})`), txt).toEqual(ExtBool(!f(a, b)));
    }
  });

  it("text functions agree with direct computation", () => {
    const rnd = mulberry32(7);
    const s = "The quick, brown fox jumped over the lazy dog.";
    const cps = Array.from(s);
    for (let i = 0; i < 100; i++) {
      const start = Math.floor(rnd() * 60) - 10, cnt = Math.floor(rnd() * 20);
      const st2 = start < 0 ? cps.length + start : start;
      const expected = cps.slice(Math.max(0, st2)).slice(0, cnt).join("");
      const txt = start < 0 ? `Mid(TestString, 0 - ${-start}, ${cnt})` : `Mid(TestString, ${start}, ${cnt})`;
      expect(evalText(txt), txt).toEqual(ExtText(expected));
      expect(evalText(`Left(TestString, ${cnt})`)).toEqual(ExtText(cps.slice(0, cnt).join("")));
    }
  });
});
