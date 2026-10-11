import { describe, expect, it } from "vitest";
import {
  ap_TState,
  filterTStateChanges,
  filterTStateMaybe,
  fmap_TState,
  liftA2_TState,
  mapTState1,
  newTStateIO,
  pure_TState,
  tStateDupIO,
  unionTStates,
  type TState,
} from "./TState";
import { atomically, atomicallySync, BlockedIndefinitelyOnSTM, orElse } from "@/lib/Control/Concurrent/STM";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** The pending event, if any, without blocking. */
function pollEvent<A, B>(ts: TState<A, B>): [A, B] | null {
  return atomicallySync(() => orElse<[A, B] | null>(ts.tStateEvent, () => null));
}

describe("TState", () => {
  it("newTState: behaviour, events and the writer", async () => {
    const [ts, writer] = newTStateIO<string, number>(0);
    expect(atomicallySync(ts.tStateBehaviour)).toBe(0);
    expect(pollEvent(ts)).toBeNull();
    const next = atomically(ts.tStateEvent);
    writer("a", 1);
    expect(await next).toEqual(["a", 1]);
    expect(atomicallySync(ts.tStateBehaviour)).toBe(1);
  });

  it("drops all but the last of several queued events", () => {
    const [ts, writer] = newTStateIO<string, number>(0);
    atomicallySync(() => {
      writer("a", 1);
      writer("b", 2);
    });
    writer("c", 3);
    expect(pollEvent(ts)).toEqual(["c", 3]);
    expect(pollEvent(ts)).toBeNull();
  });

  it("a duplicate sees later events independently", () => {
    const [ts, writer] = newTStateIO<null, number>(0);
    writer(null, 1);
    const d = tStateDupIO(ts);
    expect(pollEvent(d)).toBeNull(); // only events after the dup
    writer(null, 2);
    expect(pollEvent(d)).toEqual([null, 2]);
    expect(pollEvent(ts)).toEqual([null, 2]);
    expect(atomicallySync(d.tStateBehaviour)).toBe(2);
  });

  it("pure never has events; its dup is itself", () => {
    const p = pure_TState<null, number>(7);
    expect(atomicallySync(p.tStateBehaviour)).toBe(7);
    expect(() => atomicallySync(p.tStateEvent)).toThrow(BlockedIndefinitelyOnSTM);
    expect(atomicallySync(p.tStateDup)).toBe(p);
  });

  it("fmap, <*> and mapTState1", () => {
    const [x, wx] = newTStateIO<string, number>(1);
    const [y, wy] = newTStateIO<string, number>(10);
    const sum = liftA2_TState((a: number, b: number) => a + b, x, y);
    expect(atomicallySync(sum.tStateBehaviour)).toBe(11);
    wy("y", 20);
    expect(pollEvent(sum)).toEqual(["y", 21]);
    wx("x", 2);
    expect(pollEvent(sum)).toEqual(["x", 22]);
    const shown = mapTState1((s: string) => s.length, fmap_TState((n: number) => `n=${n}`, x));
    wx("xyz", 5);
    expect(pollEvent(shown)).toEqual([3, "n=5"]);
    const applied = ap_TState(pure_TState<string, (n: number) => number>((n) => n * 2), y);
    wy("w", 4);
    expect(pollEvent(applied)).toEqual(["w", 8]);
  });

  it("filterTStateMaybe passes on Just values only", async () => {
    const [s, w] = newTStateIO<null, Maybe<number>>(Nothing);
    const f = filterTStateMaybe(-1, s);
    expect(atomicallySync(f.tStateBehaviour)).toBe(-1);
    await settle();
    w(null, Just(3));
    await settle();
    expect(pollEvent(f)).toEqual([null, 3]);
    w(null, Nothing);
    await settle();
    expect(pollEvent(f)).toBeNull();
    expect(atomicallySync(f.tStateBehaviour)).toBe(3);
  });

  it("filterTStateChanges drops events equal to the current value", async () => {
    const [s, w] = newTStateIO<null, number[]>([1]);
    const f = filterTStateChanges(s);
    await settle();
    w(null, [1]);
    await settle();
    expect(pollEvent(f)).toBeNull();
    w(null, [2]);
    await settle();
    expect(pollEvent(f)).toEqual([null, [2]]);
  });

  it("unionTStates merges event streams", async () => {
    const [a, wa] = newTStateIO<string, number>(0);
    const [b, wb] = newTStateIO<string, number>(0);
    const u = unionTStates(-1, [a, b]);
    const d = tStateDupIO(u);
    await settle();
    wb("b", 2);
    await settle();
    expect(pollEvent(d)).toEqual(["b", 2]);
    wa("a", 1);
    await settle();
    expect(pollEvent(d)).toEqual(["a", 1]);
    expect(atomicallySync(u.tStateBehaviour)).toBe(1);
  });
});
