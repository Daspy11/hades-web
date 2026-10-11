import { describe, expect, it } from "vitest";
import {
  atomically,
  atomicallySync,
  BlockedIndefinitelyOnSTM,
  catchSTM,
  check,
  dupTChan,
  flushTQueue,
  isEmptyTChan,
  newBroadcastTChanIO,
  newEmptyTMVarIO,
  newTChanIO,
  newTQueueIO,
  newTVarIO,
  orElse,
  putTMVar,
  readTChan,
  readTMVar,
  readTQueue,
  readTVar,
  readTVarIO,
  retry,
  takeTMVar,
  tryReadTChan,
  unGetTChan,
  writeTChan,
  writeTQueue,
  writeTVar,
} from "./STM";
import { forever, forkIO, killThread, ThreadKilled } from "../Concurrent";

/** Let pending microtasks and timers run. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("STM", () => {
  it("commits writes when the transaction succeeds", () => {
    const v = newTVarIO(1);
    const r = atomicallySync(() => {
      writeTVar(v, readTVar(v) + 1);
      return readTVar(v); // reads its own write
    });
    expect(r).toBe(2);
    expect(readTVarIO(v)).toBe(2);
  });

  it("discards writes when the transaction retries or throws", () => {
    const v = newTVarIO(1);
    expect(() =>
      atomicallySync(() => {
        writeTVar(v, 5);
        retry();
      }),
    ).toThrow(BlockedIndefinitelyOnSTM);
    expect(readTVarIO(v)).toBe(1);
    expect(() =>
      atomicallySync(() => {
        writeTVar(v, 6);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(readTVarIO(v)).toBe(1);
  });

  it("orElse runs the alternative and discards the first branch's writes", () => {
    const v = newTVarIO("start");
    const r = atomicallySync(() =>
      orElse(
        () => {
          writeTVar(v, "first");
          return retry();
        },
        () => readTVar(v) + "/second",
      ),
    );
    expect(r).toBe("start/second");
    expect(readTVarIO(v)).toBe("start");
    const r2 = atomicallySync(() =>
      orElse(
        () => {
          writeTVar(v, "kept");
          return 1;
        },
        () => 2,
      ),
    );
    expect(r2).toBe(1);
    expect(readTVarIO(v)).toBe("kept");
  });

  it("catchSTM discards the writes of the failed action", () => {
    const v = newTVarIO(0);
    const r = atomicallySync(() =>
      catchSTM(
        () => {
          writeTVar(v, 1);
          throw new Error("x");
        },
        (e) => (e as Error).message,
      ),
    );
    expect(r).toBe("x");
    expect(readTVarIO(v)).toBe(0);
  });

  it("atomically blocks until a variable it read changes", async () => {
    const v = newTVarIO(0);
    const log: number[] = [];
    const p = atomically(() => {
      const x = readTVar(v);
      check(x >= 2);
      return x;
    }).then((x) => log.push(x));
    await settle();
    expect(log).toEqual([]);
    atomicallySync(() => writeTVar(v, 1));
    await settle();
    expect(log).toEqual([]);
    writeTVar(v, 3); // outside a transaction: commits at once
    await p;
    expect(log).toEqual([3]);
  });

  it("TChan is FIFO, and a broadcast channel delivers to every duplicate", async () => {
    const c = newTChanIO<number>();
    writeTChan(c, 1);
    writeTChan(c, 2);
    expect(atomicallySync(() => readTChan(c))).toBe(1);
    unGetTChan(c, 0);
    expect(atomicallySync(() => [readTChan(c), readTChan(c)])).toEqual([0, 2]);
    expect(isEmptyTChan(c)).toBe(true);
    expect(tryReadTChan(c).tag).toBe("Nothing");

    const b = newBroadcastTChanIO<string>();
    expect(() => atomicallySync(() => readTChan(b))).toThrow(/newBroadcastTChan/);
    const r1 = atomicallySync(() => dupTChan(b));
    const r2 = atomicallySync(() => dupTChan(b));
    const got = atomically(() => readTChan(r2));
    writeTChan(b, "a");
    expect(await got).toBe("a");
    expect(atomicallySync(() => readTChan(r1))).toBe("a");
    const r3 = atomicallySync(() => dupTChan(b)); // sees only later items
    expect(tryReadTChan(r3).tag).toBe("Nothing");
  });

  it("TQueue and TMVar", async () => {
    const q = newTQueueIO<number>();
    writeTQueue(q, 1);
    writeTQueue(q, 2);
    writeTQueue(q, 3);
    expect(readTQueue(q)).toBe(1);
    expect(flushTQueue(q)).toEqual([2, 3]);
    const m = newEmptyTMVarIO<string>();
    const taken = atomically(() => takeTMVar(m));
    putTMVar(m, "x");
    expect(await taken).toBe("x");
    putTMVar(m, "y");
    expect(readTMVar(m)).toBe("y");
  });

  it("killThread interrupts a thread blocked in atomically", async () => {
    const c = newTChanIO<number>();
    const seen: number[] = [];
    let exitedWith: unknown = null;
    const t = forkIO(async () => {
      try {
        await forever(async () => {
          seen.push(await atomically(() => readTChan(c)));
        });
      } catch (e) {
        exitedWith = e;
      }
    });
    await settle();
    writeTChan(c, 1);
    await settle();
    expect(seen).toEqual([1]);
    killThread(t);
    await settle();
    expect(exitedWith).toBeInstanceOf(ThreadKilled);
    writeTChan(c, 2);
    await settle();
    expect(seen).toEqual([1]);
    // The item was not consumed by the dead thread.
    expect(atomicallySync(() => readTChan(c))).toBe(2);
  });
});
