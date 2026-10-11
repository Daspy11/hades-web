import { describe, expect, it } from "vitest";
import * as MP from "./Megaparsec";
import type { Parser } from "./Megaparsec";

function run<A>(p: Parser<A>, input: string): A {
  const r = MP.parse(p, "", input);
  if (r.tag === "Left") throw new Error(MP.errorBundlePretty(r.value));
  return r.value;
}

function errText<A>(p: Parser<A>, input: string): string {
  const r = MP.parse(p, "", input);
  if (r.tag === "Right") throw new Error("Expected a parse failure on " + JSON.stringify(input));
  return MP.parseErrorTextPretty(r.value.bundleErrors[0]);
}

function errOffset<A>(p: Parser<A>, input: string): number {
  const r = MP.parse(p, "", input);
  if (r.tag === "Right") throw new Error("Expected a parse failure");
  return MP.errorOffset(r.value.bundleErrors[0]);
}

describe("primitives", () => {
  it("char and eof", () => {
    expect(run(MP.seqL(MP.char("a"), MP.eof), "a")).toBe("a");
    expect(errText(MP.char("a"), "b")).toBe("unexpected 'b'\nexpecting 'a'\n");
    expect(errText(MP.char("a"), "")).toBe("unexpected end of input\nexpecting 'a'\n");
    expect(errText(MP.seqL(MP.char("a"), MP.eof), "ab")).toBe("unexpected 'b'\nexpecting end of input\n");
  });

  it("string is atomic and reports the chunk", () => {
    expect(run(MP.string("foo"), "foo")).toBe("foo");
    expect(errText(MP.string("foo"), "fob")).toBe("unexpected \"fob\"\nexpecting \"foo\"\n");
    expect(errText(MP.string("foo"), "fo")).toBe("unexpected \"fo\"\nexpecting \"foo\"\n");
    expect(errOffset(MP.string("foo"), "fob")).toBe(0);
    // Atomic, so the alternative is tried.
    expect(run(MP.alt(MP.string("ab"), MP.string("ac")), "ac")).toBe("ac");
  });

  it("pretty characters", () => {
    expect(errText(MP.char("a"), " ")).toBe("unexpected space\nexpecting 'a'\n");
    expect(errText(MP.char("a"), "\n")).toBe("unexpected newline\nexpecting 'a'\n");
    expect(errText(MP.char("a"), "\t")).toBe("unexpected tab\nexpecting 'a'\n");
    expect(errText(MP.string("ab"), "a\n")).toBe("unexpected \"a<newline>\"\nexpecting \"ab\"\n");
  });

  it("satisfy-based parsers have labels", () => {
    expect(errText(MP.letterChar, "1")).toBe("unexpected '1'\nexpecting letter\n");
    expect(errText(MP.digitChar, "x")).toBe("unexpected 'x'\nexpecting digit\n");
    expect(errText(MP.alphaNumChar, "_")).toBe("unexpected '_'\nexpecting alphanumeric character\n");
    expect(errText(MP.oneOf("+-"), "x")).toBe("unexpected 'x'\n");
  });

  it("fail and customFailure", () => {
    expect(errText(MP.fail("boom"), "abc")).toBe("boom\n");
    expect(errText(MP.customFailure("custom"), "abc")).toBe("custom\n");
    const p: Parser<never> = (st) => {
      MP.string("ab")(st);
      return MP.fail("after")(st);
    };
    expect(errOffset(p, "abc")).toBe(2);
  });
});

describe("alternatives and backtracking", () => {
  const ab: Parser<string> = (st) => {
    MP.char("a")(st);
    return MP.char("b")(st);
  };
  const ac: Parser<string> = (st) => {
    MP.char("a")(st);
    return MP.char("c")(st);
  };

  it("does not backtrack after consuming input", () => {
    expect(errText(MP.alt(ab, ac), "ac")).toBe("unexpected 'c'\nexpecting 'b'\n");
    expect(errOffset(MP.alt(ab, ac), "ac")).toBe(1);
  });

  it("backtracks through try", () => {
    expect(run(MP.alt(MP.try_(ab), ac), "ac")).toBe("c");
  });

  it("merges errors at the same offset", () => {
    expect(errText(MP.alt(MP.char("a"), MP.char("b"), MP.char("c")), "d"))
      .toBe("unexpected 'd'\nexpecting 'a', 'b', or 'c'\n");
  });

  it("prefers the longest match through try", () => {
    const p = MP.alt(MP.try_(ab), MP.char("x"));
    expect(errText(p, "ad")).toBe("unexpected 'd'\nexpecting 'b'\n");
    expect(errOffset(p, "ad")).toBe(1);
  });

  it("choice of nothing fails with an unknown error", () => {
    expect(errText(MP.choice([]), "a")).toBe("unknown parse error\n");
  });

  it("label replaces expected items only for empty failures", () => {
    expect(errText(MP.label("thing", MP.char("a")), "b")).toBe("unexpected 'b'\nexpecting thing\n");
    expect(errText(MP.label("thing", ab), "ax")).toBe("unexpected 'x'\nexpecting 'b'\n");
    expect(errText(MP.hidden(MP.char("a")), "b")).toBe("unexpected 'b'\n");
  });

  it("lookAhead does not consume", () => {
    const p: Parser<[string, string]> = (st) => {
      const x = MP.lookAhead(MP.string("ab"))(st);
      const y = MP.string("abc")(st);
      return [x, y];
    };
    expect(run(p, "abc")).toEqual(["ab", "abc"]);
  });

  it("notFollowedBy", () => {
    const kw: Parser<string> = (st) => {
      const s = MP.string("let")(st);
      MP.notFollowedBy(MP.alphaNumChar)(st);
      return s;
    };
    expect(run(kw, "let")).toBe("let");
    expect(errText(kw, "lets")).toBe("unexpected 's'\n");
  });
});

describe("hints", () => {
  it("many adds the expected items of its last failure", () => {
    const p: Parser<string[]> = (st) => {
      const xs = MP.many(MP.char("a"))(st);
      MP.char("b")(st);
      return xs;
    };
    expect(run(p, "aab")).toEqual(["a", "a"]);
    expect(errText(p, "aac")).toBe("unexpected 'c'\nexpecting 'a' or 'b'\n");
    expect(errText(MP.seqL(MP.many(MP.char("a")), MP.eof), "aab"))
      .toBe("unexpected 'b'\nexpecting 'a' or end of input\n");
  });

  it("space leaves a white space hint", () => {
    const p = MP.seqL(MP.seqR(MP.space, MP.Lex.decimal), MP.seqR(MP.space, MP.eof));
    expect(run(p, "  12  ")).toBe(12);
    expect(errText(p, "  12x")).toBe("unexpected 'x'\nexpecting digit, end of input, or white space\n");
    expect(errText(p, "  12 x")).toBe("unexpected 'x'\nexpecting end of input or white space\n");
  });

  it("hints are not used after backtracking", () => {
    const ab: Parser<string> = (st) => {
      MP.char("a")(st);
      return MP.char("b")(st);
    };
    const p = MP.seqL(MP.option("none", MP.try_(ab)), MP.char("x"));
    expect(errText(p, "ay")).toBe("unexpected 'a'\nexpecting 'x'\n");
    expect(errText(p, "y")).toBe("unexpected 'y'\nexpecting 'a' or 'x'\n");
  });
});

describe("combinators", () => {
  const num = MP.Lex.lexeme(MP.space, MP.Lex.decimal);
  const comma = MP.Lex.symbol(MP.space, ",");

  it("sepBy, between and friends", () => {
    const list = MP.between(MP.Lex.symbol(MP.space, "["), MP.Lex.symbol(MP.space, "]"), MP.sepBy(num, comma));
    expect(run(list, "[1, 2 ,3]")).toEqual([1, 2, 3]);
    expect(run(list, "[]")).toEqual([]);
    expect(errText(list, "[1, ]")).toBe("unexpected ']'\nexpecting integer or white space\n");
    expect(run(MP.sepEndBy(num, comma), "1,2,")).toEqual([1, 2]);
    expect(run(MP.endBy(num, comma), "1,2,")).toEqual([1, 2]);
    expect(run(MP.count(3, MP.anySingle), "abcd")).toEqual(["a", "b", "c"]);
    expect(run(MP.count_(1, 3, MP.char("a")), "aaaa")).toEqual(["a", "a", "a"]);
    expect(run(MP.some(MP.digitChar), "12a")).toEqual(["1", "2"]);
    expect(run(MP.optional(MP.char("a")), "b")).toEqual({ tag: "Nothing" });
  });

  it("manyTill", () => {
    const p: Parser<string> = (st) => {
      MP.char("\"")(st);
      return MP.manyTill(MP.Lex.charLiteral, MP.char("\""))(st).join("");
    };
    expect(run(p, "\"ab\\\"c\\n\"")).toBe("ab\"c\n");
    expect(errText(p, "\"ab")).toBe("unexpected end of input\nexpecting '\"' or literal character\n");
  });

  it("many refuses parsers that accept the empty string", () => {
    expect(() => MP.parse(MP.many(MP.space), "", "abc")).toThrow();
  });
});

describe("lexer", () => {
  it("decimal and float", () => {
    expect(run(MP.Lex.decimal, "0042")).toBe(42);
    expect(run(MP.Lex.float, "1.5")).toBe(1.5);
    expect(run(MP.Lex.float, "1.5e3")).toBe(1500);
    expect(run(MP.Lex.float, "2E-2")).toBe(0.02);
    expect(run(MP.Lex.float, "4.2")).toBe(4.2);
    expect(run(MP.Lex.float, "20.2")).toBe(20.2);
    expect(errText(MP.Lex.float, "12")).toBe("unexpected end of input\nexpecting '.', 'E', 'e', or digit\n");
    expect(errText(MP.Lex.decimal, "x")).toBe("unexpected 'x'\nexpecting integer\n");
  });

  it("signed", () => {
    const p = MP.Lex.signed(MP.space, MP.Lex.decimal);
    expect(run(p, "-12")).toBe(-12);
    expect(run(p, "+ 12")).toBe(12);
    expect(run(p, "12")).toBe(12);
  });

  it("charLiteral escapes", () => {
    const lit = (s: string) => run(MP.Lex.charLiteral, s);
    expect(lit("a")).toBe("a");
    expect(lit("\\n")).toBe("\n");
    expect(lit("\\t")).toBe("\t");
    expect(lit("\\\\")).toBe("\\");
    expect(lit("\\\"")).toBe("\"");
    expect(lit("\\65")).toBe("A");
    expect(lit("\\x41")).toBe("A");
    expect(lit("\\o101")).toBe("A");
    expect(lit("\\^A")).toBe("\x01");
    expect(lit("\\SOH")).toBe("\x01");
    expect(lit("\\SO")).toBe("\x0e");
    expect(lit("\\DEL")).toBe("\x7f");
    expect(errText(MP.Lex.charLiteral, "\\q")).toBe("unexpected '\\'\nexpecting literal character\n");
    expect(errText(MP.Lex.charLiteral, "")).toBe("unexpected end of input\nexpecting literal character\n");
  });
});

describe("error bundles", () => {
  it("renders the offending line", () => {
    const r = MP.parse(MP.seqL(MP.string("foo"), MP.eof), "", "foo bar");
    expect(r.tag).toBe("Left");
    if (r.tag === "Left") {
      expect(MP.errorBundlePretty(r.value)).toBe(
        "1:4:\n  |\n1 | foo bar\n  |    ^\nunexpected space\nexpecting end of input\n");
    }
  });

  it("renders a source name, later lines and chunk widths", () => {
    const p: Parser<string> = (st) => {
      MP.string("ab\n")(st);
      return MP.string("xyz")(st);
    };
    const r = MP.parse(p, "file.txt", "ab\nxyw");
    if (r.tag !== "Left") throw new Error("expected failure");
    expect(MP.errorBundlePretty(r.value)).toBe(
      "file.txt:2:1:\n  |\n2 | xyw\n  | ^^^\nunexpected \"xyw\"\nexpecting \"xyz\"\n");
  });

  it("renders an empty line", () => {
    const r = MP.parse(MP.char("a"), "", "");
    if (r.tag !== "Left") throw new Error("expected failure");
    expect(MP.errorBundlePretty(r.value)).toBe(
      "1:1:\n  |\n1 | <empty line>\n  | ^\nunexpected end of input\nexpecting 'a'\n");
  });

  it("uses an error component dictionary", () => {
    const r = MP.parse<never, { code: number }>(MP.customFailure({ code: 7 }), "", "x");
    if (r.tag !== "Left") throw new Error("expected failure");
    const dict: MP.ShowErrorComponent<{ code: number }> = { showErrorComponent: (e) => "code " + e.code };
    expect(MP.parseErrorTextPretty(dict, r.value.bundleErrors[0])).toBe("code 7\n");
    expect(MP.parseErrorPretty(dict, r.value.bundleErrors[0])).toBe("offset=0:\ncode 7\n");
  });
});

// ---------------------------------------------------------------------------------------------
// Expression parsers

type E =
  | { tag: "Num"; n: number }
  | { tag: "Neg"; e: E }
  | { tag: "Bin"; op: string; l: E; r: E };

const sc = MP.space;
const sym = (s: string) => MP.Lex.symbol(sc, s);

function exprParser(): Parser<E> {
  const term: Parser<E> = MP.alt<E>(
    MP.between(sym("("), sym(")"), (st) => expr(st)),
    MP.mapP((n: number) => ({ tag: "Num", n }) as E, MP.Lex.lexeme(sc, MP.Lex.decimal)),
  );
  const bin = (op: string) => MP.constP((l: E, r: E): E => ({ tag: "Bin", op, l, r }), sym(op));
  const expr: Parser<E> = MP.makeExprParser(term, [
    [MP.Prefix(MP.constP((e: E): E => ({ tag: "Neg", e }), sym("-")))],
    [MP.InfixR(bin("^"))],
    [MP.InfixL(bin("*")), MP.InfixL(bin("/"))],
    [MP.InfixL(bin("+")), MP.InfixL(bin("-"))],
    [MP.InfixN(bin("=="))],
  ]);
  return MP.seqL(MP.seqR(sc, expr), MP.eof);
}

function show(e: E): string {
  switch (e.tag) {
    case "Num": return String(e.n);
    case "Neg": return "(-" + show(e.e) + ")";
    case "Bin": return "(" + show(e.l) + e.op + show(e.r) + ")";
  }
}

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

describe("makeExprParser", () => {
  const p = exprParser();

  it("handles precedence and associativity", () => {
    expect(show(run(p, "1 + 2 * 3"))).toBe("(1+(2*3))");
    expect(show(run(p, "1 - 2 - 3"))).toBe("((1-2)-3)");
    expect(show(run(p, "2 ^ 3 ^ 2"))).toBe("(2^(3^2))");
    expect(show(run(p, "-1 * (2 + 3)"))).toBe("((-1)*(2+3))");
    expect(show(run(p, "1 + 2 == 3"))).toBe("((1+2)==3)");
  });

  it("reports operators as hints", () => {
    expect(errText(p, "1 2")).toBe("unexpected '2'\nexpecting \"==\", '*', '+', '-', '/', '^', end of input, or white space\n");
    expect(errText(p, "1 +")).toBe("unexpected end of input\nexpecting '(', '-', integer, or white space\n");
  });

  it("does not chain non-associative operators", () => {
    expect(errOffset(p, "1 == 2 == 3")).toBe(7);
  });

  it("parses long left-associative chains", () => {
    const n = 5000;
    const src = Array.from({ length: n }, (_, i) => String(i)).join(" + ");
    let e = run(p, src);
    let depth = 0;
    while (e.tag === "Bin") {
      e = e.l;
      depth++;
    }
    expect(depth).toBe(n - 1);
  });

  it("round-trips random expressions", () => {
    const rnd = mulberry32(12345);
    const gen = (d: number): E => {
      const k = rnd();
      if (d <= 0 || k < 0.3) return { tag: "Num", n: Math.floor(rnd() * 1000) };
      if (k < 0.4) {
        const inner = gen(d - 1);
        return { tag: "Neg", e: inner.tag === "Neg" ? { tag: "Num", n: 1 } : inner };
      }
      const ops = ["^", "*", "/", "+", "-", "=="];
      return { tag: "Bin", op: ops[Math.floor(rnd() * ops.length)], l: gen(d - 1), r: gen(d - 1) };
    };
    // Fully parenthesised rendering with random spacing; the parse must give back the same tree.
    const render = (e: E): string => {
      const sp = () => " ".repeat(Math.floor(rnd() * 3));
      switch (e.tag) {
        case "Num": return String(e.n);
        case "Neg": return "-" + sp() + "(" + sp() + render(e.e) + sp() + ")";
        case "Bin": return "(" + sp() + render(e.l) + sp() + ")" + sp() + e.op + sp() + "(" + sp() + render(e.r) + sp() + ")";
      }
    };
    const strip = (e: E): E => e; // Parentheses are not represented in the tree.
    for (let i = 0; i < 300; i++) {
      const e = gen(5);
      expect(show(run(p, render(e)))).toBe(show(strip(e)));
    }
  });
});
