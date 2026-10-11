// Ported from hades/test/Test/AutoMonad/Exceptions.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Test the AutoT monad transformer, including exception handling.
 *
 * TypeScript port
 * ---------------
 * * The inner monad `TestMonad` (`ExceptT Message (State Integer)`) follows PORTING.md §7.1: the
 *   `State Integer` layer is a `StateCell<Integer>` passed first to the machine's generator
 *   functions (`lift get` / `lift (put x)` read and write `m.state`), and the `ExceptT Message`
 *   layer is the `TestMonadError` exception thrown by `throwError`. `runTestMonad(m, act, v1)` is
 *   `runState (runExceptT (runTestMonad act)) v1`.
 * * `TestMachine a` (`AutoT Integer Text AutoException TestMonad a`) is `AutoT<Integer, Text, A>`,
 *   a generator; the Haskell exception type of this module is called `AutoException` as in the
 *   Haskell, so the wrapper class of "Hades.Abstract.AutoMonad" is imported as `AutoTException`.
 * * A Haskell `AutoS i o e m` is an action in the inner monad which runs the machine up to its next
 *   @yield@, whereas a TypeScript `AutoS` is a machine that has already run up to its yield. The
 *   local `AutoSH` type (a thunk returning an `AutoS`) restores the Haskell timing, so that the
 *   inner-monad effects happen inside `runTestMonad`, and `runAutoS` is the Haskell field accessor.
 * * The HUnit `Test` is `autoMonadTest`, a list of labelled assertions; vitest runs each one, and
 *   `runAutoMonadTests` (used by the Haskell test driver) is kept and checked too.
 * * The "StateStream" suite at the end is an addition: the same machine and sequences driven
 *   through `startStream` / `applyInput` / `applyThrow`, which is the API the rest of HADES uses.
 */
import { describe, expect, it, vi } from "vitest";
import type { StateCell } from "@/lib/Control/Lens";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Just, type Maybe } from "@/lib/Data/Maybe";
import * as T from "@/lib/Data/Text";
import { showInt } from "@/lib/Prelude";
import {
  AutoException as AutoTException, applyInput, applyThrow, catchAutoT, startMachine, startStream,
  streamState, throwAutoT,
  type AutoS, type AutoT, type StreamNext,
} from "@/hades/src/Hades/Abstract/AutoMonad";

type Integer = number;
type Text = T.Text;

/** HUnit `Assertion`. */
type Assertion = () => void;

/** HUnit `Test`: here a `TestList` of `TestCase`s, each labelled for vitest. */
type Test = readonly (readonly [string, Assertion])[];

/**
 * Run the tests (HUnit `runTestTT`), print the counts and return @True@ if there were no errors
 * or failures.
 */
function runAutoMonadTests(): boolean {
  let errors = 0, failures = 0;
  for (const [, assertion] of autoMonadTest) {
    try {
      assertion();
    } catch (err) {
      if (err instanceof Error && err.name === "AssertionError") failures++;
      else errors++;
    }
  }
  const n = autoMonadTest.length;
  console.log("Cases: " + n + "  Tried: " + n + "  Errors: " + errors + "  Failures: " + failures);
  return errors === 0 && failures === 0;
}

const autoMonadTest: Test = [
  ["AutoMonad normal termination",
    () => runTest("AutoMonad normal termination", (m) => testMachine(m, 57), testCaseNormal)],
  ["AutoMonad exception",
    () => runTest("AutoMonad exception", (m) => testMachine(m, 57), testCaseUncaught)],
];

/** Exception messages. */
type Message = string;

/** Exceptions in the AutoT monad */
type AutoException =
  | { readonly tag: "LimitExceeded"; readonly _0: Integer }
  | { readonly tag: "OtherFailure"; readonly _0: Message };

function LimitExceeded(_0: Integer): AutoException {
  return { tag: "LimitExceeded", _0 };
}
function OtherFailure(_0: Message): AutoException {
  return { tag: "OtherFailure", _0 };
}

/** Derived `showsPrec` for an `Integer`: negative numbers are bracketed above precedence 6. */
function showsPrecInteger(d: number, n: Integer): string {
  return d > 6 && n < 0 ? "(" + showInt(n) + ")" : showInt(n);
}

/** Derived `showsPrec` for "AutoException". */
function showsPrec_AutoException(d: number, e: AutoException): string {
  const s = e.tag === "LimitExceeded"
    ? "LimitExceeded " + showsPrecInteger(11, e._0)
    : "OtherFailure " + T.showText(e._0);
  return d > 10 ? "(" + s + ")" : s;
}

/** Derived `instance Show AutoException`. */
function show_AutoException(e: AutoException): string {
  return showsPrec_AutoException(0, e);
}

/** `show` of an `Either AutoException Integer`. */
function show_Either(x: Either<AutoException, Integer>): string {
  return x.tag === "Left"
    ? "Left " + showsPrec_AutoException(11, x.value)
    : "Right " + showsPrecInteger(11, x.value);
}

/**
 * An underlying monad that supports exceptions (with a different type).
 *
 * TypeScript: this is the `State Integer` layer, a mutable cell. The `ExceptT Message` layer is
 * the "TestMonadError" exception.
 */
type TestMonad = StateCell<Integer>;

/** An exception in the `ExceptT Message` layer of "TestMonad". */
class TestMonadError extends Error {
  constructor(readonly msg: Message) {
    super(msg);
    this.name = "TestMonadError";
  }
}

/** `throwError` (`MonadError String TestMonad`). */
function throwError(msg: Message): never {
  throw new TestMonadError(msg);
}

/** `runState (runExceptT $ runTestMonad act) v1` */
function runTestMonad<A>(m: TestMonad, act: () => A, v1: Integer): [Either<Message, A>, Integer] {
  m.state = v1;
  try {
    const a = act();
    return [Right(a), m.state];
  } catch (err) {
    if (err instanceof TestMonadError) return [Left(err.msg), m.state];
    throw err;
  }
}

type TestMachine<A> = AutoT<Integer, Text, A>;

/**
 * Repeatedly prompts for two numbers and emits their total plus the running total. Throws an
 * AutoT exception if an input is greater than 20, and an ExceptT exception if the running total
 * exceeds 100.
 */
function* testMachine(m: TestMonad, t: Integer): TestMachine<never> {
  function* getParameter(msg: Maybe<Text>, n: Integer): TestMachine<Integer> {
    return yield* catchAutoT<Text, Integer, AutoException, Integer>(
      (function* (): TestMachine<Integer> {
        const x: Integer = yield (msg.tag === "Just"
          ? msg.value + "Parameter " + showInt(n) + ":"
          : "Parameter " + showInt(n) + ":");
        if (x > 20) throwAutoT<AutoException>(LimitExceeded(x));
        return x;
      })(),
      function* (e: AutoException): TestMachine<Integer> {
        m.state = 0; // lift $ put 0
        return yield* getParameter(Just("Exception " + show_AutoException(e) + ". Try again.  "), n);
      },
    );
  }

  return yield* catchAutoT<Text, never, AutoException, Integer>(
    (function* (): TestMachine<never> {
      const total = m.state; // lift get
      const msg = "Last total = " + showInt(t) +
        ". Running total = " + showInt(total) + ".  ";
      const p1 = yield* getParameter(Just(msg), 1);
      const p2 = yield* getParameter(Just("Got " + showInt(p1) + ".  "), 2);
      const newTotal = total + p1 + p2;
      if (newTotal > 100) throwError("Total limit exceeded: " + showInt(newTotal)); // lift $ throwError
      m.state = newTotal; // lift $ put newTotal
      return yield* testMachine(m, p1 + p2);
    })(),
    function* (e: AutoException): TestMachine<never> {
      m.state = 0; // lift $ put 0
      return throwError("Exception caught by catchAutoT: " + show_AutoException(e));
    },
  );
}

/**
 * The Haskell `AutoS Integer Text AutoException TestMonad`: an inner-monad action that runs the
 * machine up to its next yield.
 */
type AutoSH = () => AutoS<Integer, Text, AutoException>;

/** Haskell `runAutoS`: run the action, returning the output and the two continuations. */
function runAutoS(autoS: AutoSH): [Text, (i: Integer) => AutoSH, (e: AutoException) => AutoSH] {
  const s = autoS();
  const resume = (r: IteratorResult<Text, never>): AutoS<Integer, Text, AutoException> => {
    if (r.done) throw new Error("Can't happen: AutoT terminated.");
    return { gen: s.gen, last: r.value };
  };
  return [
    s.last,
    (i) => () => resume(s.gen.next(i)),
    (e) => () => {
      try {
        return resume(s.gen.throw(new AutoTException(e)));
      } catch (err) {
        // The default exception handler of "startMachine".
        if (err instanceof AutoTException) {
          throw new Error("Uncaught exception in AutoT: " + show_AutoException(err.exception as AutoException));
        }
        throw err;
      }
    },
  ];
}

/** A test case is a list of expected yields and cooresponding inputs. */
interface TestSequence {
  /** The expected "yield" value and the input to provide in return. */
  readonly testSteps: readonly (readonly [Text, Either<AutoException, Integer>])[];
  /** The final expected "yield" value, or an expected exception from the inner monad. */
  readonly testFinalYield: Either<Message, Text>;
}

/**
 * Run a test on a list of inputs and/or exceptions, and print the output for inspection in the
 * form of a @TestSequence@.
 */
function demoTest(machine: (m: TestMonad) => TestMachine<never>, steps: readonly Either<AutoException, Integer>[]): void {
  const m: TestMonad = { state: 0 };
  const m1: AutoSH = () => startMachine<Integer, Text, AutoException>(machine(m));
  const runSteps = (v1: Integer, autoS: AutoSH, inputs: readonly Either<AutoException, Integer>[]): void => {
    const [r, v2] = runTestMonad(m, () => runAutoS(autoS), v1);
    if (r.tag === "Left") {
      console.log("      ]\n      testFinalYield = Left " + T.showText(r.value));
      return;
    }
    const [out, inF, exceptF] = r.value;
    if (inputs.length === 0) {
      console.log("      ]\n      testFinalYield = Right " + T.showText(out) + "\n   }");
      return;
    }
    const [input1, ...rest] = inputs;
    console.log("            (" + T.showText(out) + ", " + show_Either(input1) + "),");
    runSteps(v2, input1.tag === "Left" ? exceptF(input1.value) : inF(input1.value), rest);
  };
  console.log("TestSequence {\n      testSteps = [");
  runSteps(0, m1, steps);
}

/** HUnit `assertEqual`: the message, the expected value, then the actual value. */
function assertEqual<A>(name: string, expected: A, actual: A): void {
  expect(actual, name).toEqual(expected);
}

/** Run a test on a @TestSequence@. Report and fail on any discrepancies. */
function runTest(name: string, machine: (m: TestMonad) => TestMachine<never>, steps: TestSequence): void {
  const m: TestMonad = { state: 0 };
  const m1: AutoSH = () => startMachine<Integer, Text, AutoException>(machine(m));
  const expected: Either<Message, Text>[] = [
    ...steps.testSteps.map(([o]) => Right<Text, Message>(o)),
    steps.testFinalYield,
  ];
  const runSteps = (
    v1: Integer,
    autoS: AutoSH,
    inputs: readonly Either<AutoException, Integer>[],
  ): Either<Message, Text>[] => {
    const [r, v2] = runTestMonad(m, () => runAutoS(autoS), v1);
    if (r.tag === "Left") return [Left(r.value)];
    const [out, inF, exceptF] = r.value;
    if (inputs.length === 0) return [Right(out)];
    const [input1, ...rest] = inputs;
    return [Right(out), ...runSteps(v2, input1.tag === "Left" ? exceptF(input1.value) : inF(input1.value), rest)];
  };
  const results = runSteps(0, m1, steps.testSteps.map(([, i]) => i));
  assertEqual(name, expected, results);
}

const testCaseNormal: TestSequence = {
  testSteps: [
    ["Last total = 57. Running total = 0.  Parameter 1:", Right(3)],
    ["Got 3.  Parameter 2:", Right(5)],
    ["Last total = 8. Running total = 8.  Parameter 1:", Right(7)],
    ["Got 7.  Parameter 2:", Left(OtherFailure("input exception"))],
    ["Exception OtherFailure \"input exception\". Try again.  Parameter 2:", Right(24)],
    ["Exception LimitExceeded 24. Try again.  Parameter 2:", Right(4)],
    ["Last total = 11. Running total = 19.  Parameter 1:", Right(7)],
    ["Got 7.  Parameter 2:", Right(13)],
  ],
  testFinalYield: Right("Last total = 20. Running total = 39.  Parameter 1:"),
};

const testCaseUncaught: TestSequence = {
  testSteps: [
    ["Last total = 57. Running total = 0.  Parameter 1:", Right(3)],
    ["Got 3.  Parameter 2:", Right(5)],
    ["Last total = 8. Running total = 8.  Parameter 1:", Right(7)],
    ["Got 7.  Parameter 2:", Left(OtherFailure("input exception"))],
    ["Exception OtherFailure \"input exception\". Try again.  Parameter 2:", Right(24)],
    ["Exception LimitExceeded 24. Try again.  Parameter 2:", Right(4)],
    ["Last total = 11. Running total = 19.  Parameter 1:", Right(7)],
    ["Got 7.  Parameter 2:", Right(13)],
    ["Last total = 20. Running total = 39.  Parameter 1:", Right(20)],
    ["Got 20.  Parameter 2:", Right(20)],
    ["Last total = 40. Running total = 79.  Parameter 1:", Right(20)],
    ["Got 20.  Parameter 2:", Right(20)],
  ],
  testFinalYield: Left("Total limit exceeded: 119"),
};

// ---------------------------------------------------------------------------------------------
// vitest

describe("AutoMonad tests", () => {
  for (const [label, assertion] of autoMonadTest) it(label, assertion);

  it("runAutoMonadTests reports success", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(runAutoMonadTests()).toBe(true);
      expect(log).toHaveBeenCalledWith("Cases: 2  Tried: 2  Errors: 0  Failures: 0");
    } finally {
      log.mockRestore();
    }
  });

  it("runTest fails on a discrepancy", () => {
    const wrong: TestSequence = { ...testCaseNormal, testFinalYield: Right("Wibble") };
    expect(() => runTest("wrong", (m) => testMachine(m, 57), wrong)).toThrow(/wrong/);
  });

  it("demoTest prints a TestSequence", () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((s: string) => { lines.push(s); });
    try {
      demoTest((m) => testMachine(m, 57), [Right(3), Left(OtherFailure("x")), Right(-4), Right(30), Right(1)]);
    } finally {
      log.mockRestore();
    }
    expect(lines).toEqual([
      "TestSequence {\n      testSteps = [",
      "            (\"Last total = 57. Running total = 0.  Parameter 1:\", Right 3),",
      "            (\"Got 3.  Parameter 2:\", Left (OtherFailure \"x\")),",
      "            (\"Exception OtherFailure \\\"x\\\". Try again.  Parameter 2:\", Right (-4)),",
      "            (\"Last total = -1. Running total = -1.  Parameter 1:\", Right 30),",
      "            (\"Exception LimitExceeded 30. Try again.  Parameter 1:\", Right 1),",
      "      ]\n      testFinalYield = Right \"Got 1.  Parameter 2:\"\n   }",
    ]);
  });

  it("demoTest reports an inner-monad exception", () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((s: string) => { lines.push(s); });
    try {
      demoTest((m) => testMachine(m, 0), [Right(20), Right(20), Right(20), Right(20), Right(20), Right(20)]);
    } finally {
      log.mockRestore();
    }
    expect(lines[lines.length - 1]).toBe("      ]\n      testFinalYield = Left \"Total limit exceeded: 120\"");
  });
});

// ---------------------------------------------------------------------------------------------
// Additional checks: the same machine driven as a "StateStream".

/**
 * Drive the test machine with `startStream` / `applyInput` / `applyThrow`. The stream state is
 * the "TestMonad" state. Exceptions from the `ExceptT` layer propagate out of `applyInput`.
 */
function runStream(steps: TestSequence): [Either<Message, Text>[], Integer[]] {
  const outs: Either<Message, Text>[] = [];
  const states: Integer[] = [];
  try {
    let [out, nxt] = startStream<Integer, Text, AutoException, Integer>((st) => testMachine(st, 57), 0);
    for (const [, input] of steps.testSteps) {
      outs.push(Right(out));
      states.push(streamState(nxt));
      const r: [Text, StreamNext<Integer, Text, AutoException, Integer>] =
        input.tag === "Left" ? applyThrow(nxt, input.value) : applyInput(nxt, input.value);
      [out, nxt] = r;
    }
    outs.push(Right(out));
    states.push(streamState(nxt));
  } catch (err) {
    if (!(err instanceof TestMonadError)) throw err;
    outs.push(Left(err.msg));
  }
  return [outs, states];
}

describe("StateStream with exceptions", () => {
  it.each([
    ["normal termination", testCaseNormal],
    ["inner-monad exception", testCaseUncaught],
  ] as const)("%s", (_label, steps) => {
    const [outs] = runStream(steps);
    expect(outs).toEqual([...steps.testSteps.map(([o]) => Right(o)), steps.testFinalYield]);
  });

  it("threads the state, including the resets in the exception handler", () => {
    const [, states] = runStream(testCaseNormal);
    // State after each yield: the running total, reset to 0 by each caught exception.
    expect(states).toEqual([0, 0, 8, 8, 0, 0, 19, 19, 39]);
  });

  it("applyThrow with no handler is an error", () => {
    function* noHandler(_st: StateCell<null>): Generator<Text, never, Integer> {
      for (;;) yield "Input:";
    }
    const [out, nxt] = startStream<Integer, Text, AutoException, null>(noHandler, null);
    expect(out).toBe("Input:");
    expect(applyInput(nxt, 1)[0]).toBe("Input:");
    expect(() => applyThrow(nxt, LimitExceeded(1))).toThrow(/Uncaught exception in AutoT/);
  });

  it("catchAutoT does not catch inner-monad exceptions or JavaScript errors", () => {
    function* machine(_st: StateCell<null>): Generator<Text, never, Integer> {
      return yield* catchAutoT<Text, never, AutoException, Integer>(
        (function* (): Generator<Text, never, Integer> {
          for (;;) {
            const x: Integer = yield "Input:";
            if (x === 1) throwError("inner");
            if (x === 2) throw new RangeError("js");
          }
        })(),
        function* (_e: AutoException): Generator<Text, never, Integer> {
          for (;;) yield "Handled";
        },
      );
    }
    const start = () => startStream<Integer, Text, AutoException, null>(machine, null)[1];
    expect(() => applyInput(start(), 1)).toThrow(TestMonadError);
    expect(() => applyInput(start(), 2)).toThrow(RangeError);
    expect(applyThrow(start(), OtherFailure("x"))[0]).toBe("Handled");
  });

  it("catchAutoT handlers are lexically scoped", () => {
    // Note: the Haskell "catchAutoT" runs its protected action as @act eh2 k@, so the
    // continuation after a normal return still has the catchAutoT handler installed: in
    // Haskell the exception thrown at "b" below would be caught by the stale handler (giving
    // x = 0 and yielding "b" again). The generator port uses try/catch, so the handler only
    // covers the protected action. Nothing in HADES throws AutoT exceptions outside these tests,
    // and the Haskell test sequences above behave identically under both semantics.
    function* machine(_st: StateCell<null>): Generator<Text, never, Integer> {
      return yield* catchAutoT<Text, never, AutoException, Integer>(
        (function* (): Generator<Text, never, Integer> {
          const x = yield* catchAutoT<Text, Integer, AutoException, Integer>(
            (function* (): Generator<Text, Integer, Integer> { return yield "a"; })(),
            function* (_e: AutoException): Generator<Text, Integer, Integer> { return 0; },
          );
          for (;;) yield "b" + showInt(x);
        })(),
        function* (_e: AutoException): Generator<Text, never, Integer> {
          for (;;) yield "outer";
        },
      );
    }
    const [, nxt] = startStream<Integer, Text, AutoException, null>(machine, null);
    expect(applyInput(nxt, 5)[0]).toBe("b5");
    expect(applyThrow(nxt, OtherFailure("x"))[0]).toBe("outer");
  });
});
