/**
 * Haskell `Control.Concurrent.STM` (the `stm` package: `TVar`, `TChan`, `TQueue`, `TMVar`) for a
 * single-threaded JavaScript page.
 *
 * Mapping
 * -------
 * | Haskell                        | TypeScript                                                |
 * |--------------------------------|-----------------------------------------------------------|
 * | `STM a` (a first-class value)  | `STM<A>` = `() => A`, a function run inside a transaction |
 * | `do` in `STM`                  | direct-style code: `const x = readTVar(v); writeTVar(w, x)` |
 * | `atomically act`               | `await atomically(() => ...)` (may block)                  |
 * | `atomically act` (never blocks)| `atomicallySync(() => ...)` (throws if it would `retry`)   |
 * | `retry`, `check b`             | `retry()`, `check(b)` (throw a private signal)             |
 * | `a \`orElse\` b`               | `orElse(a, b)` with `a`, `b` thunks; returns the result    |
 * | `throwSTM e`, `catchSTM a h`   | `throwSTM(e)`, `catchSTM(a, h)`                            |
 * | `newTVarIO`, `readTVarIO`, ... | same names, synchronous                                   |
 * | `modifyTVar'`                  | `modifyTVar_`                                             |
 *
 * Semantics
 * ---------
 * JavaScript runs one thing at a time, so a transaction (a synchronous function) can never be
 * interleaved with another: it is atomic by construction. What remains of STM is
 *
 *  * **rollback**: writes are buffered in a transaction log and only committed when the
 *    transaction finishes. A transaction that calls `retry()` or throws has no effect.
 *    `orElse(a, b)` runs `a` in a nested log; if `a` retries its writes are discarded and `b`
 *    runs instead.
 *  * **blocking**: when a transaction retries, `atomically` waits until one of the `TVar`s it
 *    read has been written by another transaction, then runs it again. The wake-up is a promise
 *    resolution, so the re-run happens in a later microtask, never inside the committing
 *    transaction.
 *
 * STM operations called outside any transaction run as a transaction of their own
 * (`readTVar` outside a transaction is `readTVarIO`, and so on); `retry()` outside a transaction
 * throws `BlockedIndefinitelyOnSTM`. Nested `atomically` is an error, as in GHC.
 *
 * `TChan` and `TQueue` are linked lists of `TVar`s exactly as in the `stm` package, so they get
 * rollback, blocking and `dupTChan` broadcast semantics from the `TVar` layer.
 *
 * Blocking calls register with the calling thread (see `Control/Concurrent`) so that
 * `killThread` can abort them with `ThreadKilled`.
 */
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { currentThread, ThreadKilled, type ThreadId } from "@/lib/Control/Concurrent";

/** A first-class STM action. Run it inside a transaction (`atomically`, `orElse`, ...). */
export type STM<A> = () => A;

// ---------------------------------------------------------------------------------------------
// Transactions

/** A blocked transaction waiting for one of the variables it read to change. */
class Waiter {
  constructor(
    readonly vars: readonly TVar<any>[],
    private readonly wake: () => void,
  ) {}
  /** Remove this waiter from all its variables. */
  detach(): void {
    for (const v of this.vars) v.waiters.delete(this);
  }
  fire(): void {
    this.detach();
    this.wake();
  }
}

/** Shared mutable memory. */
export class TVar<A> {
  /** @internal The committed value. */
  value: A;
  /** @internal Transactions blocked until this variable is written. */
  readonly waiters = new Set<Waiter>();
  /** @internal */
  constructor(a: A) {
    this.value = a;
  }
}

/** A transaction log: buffered writes and the set of variables read. */
class TLog {
  readonly writes = new Map<TVar<any>, any>();
  readonly reads = new Set<TVar<any>>();
  constructor(readonly parent: TLog | null) {}
}

/** The transaction being run, or `null` outside transactions. */
let current: TLog | null = null;

/** The value thrown by `retry()`. */
const RETRY: unique symbol = Symbol("STM.retry");

/** GHC's `BlockedIndefinitelyOnSTM`: a transaction retried where it can never be woken. */
export class BlockedIndefinitelyOnSTM extends Error {
  constructor(msg = "thread blocked indefinitely in an STM transaction") {
    super(msg);
    this.name = "BlockedIndefinitelyOnSTM";
  }
}

type Outcome<A> = { readonly done: true; readonly value: A } | { readonly done: false; readonly reads: Set<TVar<any>> };

/** Run a transaction once. Commits and returns `done` on success. */
function runTx<A>(stm: STM<A>): Outcome<A> {
  if (current !== null) throw new Error("Control.Concurrent.STM.atomically was nested");
  const log = new TLog(null);
  current = log;
  let value: A;
  try {
    value = stm();
  } catch (e) {
    current = null;
    if (e === RETRY) return { done: false, reads: log.reads };
    throw e;
  }
  current = null;
  commit(log);
  return { done: true, value };
}

function commit(log: TLog): void {
  const toWake = new Set<Waiter>();
  for (const [tv, v] of log.writes) {
    tv.value = v;
    for (const w of tv.waiters) toWake.add(w);
  }
  for (const w of toWake) w.fire();
}

/** Wait until one of the variables is written. Interruptible by `killThread(thread)`. */
function waitFor(reads: Set<TVar<any>>, thread: ThreadId | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const vars = [...reads];
    const w = new Waiter(vars, () => {
      if (thread && thread.blockedOn === blocker) thread.blockedOn = null;
      resolve();
    });
    const blocker = {
      cancel() {
        w.detach();
        reject(new ThreadKilled());
      },
    };
    // With an empty read set the transaction can never be woken (GHC would eventually throw
    // BlockedIndefinitelyOnSTM); the promise then simply never settles.
    for (const v of vars) v.waiters.add(w);
    if (thread) thread.blockedOn = blocker;
  });
}

/**
 * `atomically`: run the transaction, blocking (asynchronously) while it retries. Exceptions
 * thrown by the transaction propagate (rejecting the promise) and discard its writes.
 */
export async function atomically<A>(stm: STM<A>): Promise<A> {
  const thread = currentThread();
  for (;;) {
    if (thread?.killed) throw new ThreadKilled();
    const r = runTx(stm);
    if (r.done) return r.value;
    await waitFor(r.reads, thread);
  }
}

/**
 * `atomically` for a transaction that does not block: runs it now and returns its result.
 * Throws `BlockedIndefinitelyOnSTM` (without effects) if the transaction calls `retry`.
 */
export function atomicallySync<A>(stm: STM<A>): A {
  const r = runTx(stm);
  if (r.done) return r.value;
  throw new BlockedIndefinitelyOnSTM("atomicallySync: the transaction would block (retry)");
}

/** Run an STM operation in the current transaction, or as its own transaction. */
function inTx<A>(f: () => A): A {
  return current === null ? atomicallySync(f) : f();
}

/** `retry`: abandon the transaction and run it again when a variable it read changes. */
export function retry(): never {
  if (current === null) throw new BlockedIndefinitelyOnSTM("retry outside a transaction");
  throw RETRY;
}

/** `check b = if b then return () else retry`. */
export function check(b: boolean): void {
  if (!b) retry();
}

/** `orElse a b`: run `a`; if it retries, discard its effects and run `b`. */
export function orElse<A>(a: STM<A>, b: STM<A>): A {
  const parent = current;
  if (parent === null) return atomicallySync(() => orElse(a, b));
  const child = new TLog(parent);
  current = child;
  let result: A;
  try {
    result = a();
  } catch (e) {
    current = parent;
    for (const r of child.reads) parent.reads.add(r);
    if (e === RETRY) return b();
    throw e;
  }
  current = parent;
  for (const r of child.reads) parent.reads.add(r);
  for (const [k, v] of child.writes) parent.writes.set(k, v);
  return result;
}

/** `throwSTM`. */
export function throwSTM(e: unknown): never {
  throw e;
}

/**
 * `catchSTM act handler`: run `act`; if it throws, discard its writes and run the handler.
 * `retry` is not caught.
 */
export function catchSTM<A>(act: STM<A>, handler: (e: unknown) => A): A {
  const parent = current;
  if (parent === null) return atomicallySync(() => catchSTM(act, handler));
  const child = new TLog(parent);
  current = child;
  let result: A;
  try {
    result = act();
  } catch (e) {
    current = parent;
    for (const r of child.reads) parent.reads.add(r);
    if (e === RETRY) throw e;
    return handler(e);
  }
  current = parent;
  for (const r of child.reads) parent.reads.add(r);
  for (const [k, v] of child.writes) parent.writes.set(k, v);
  return result;
}

// ---------------------------------------------------------------------------------------------
// TVar

export function newTVar<A>(a: A): TVar<A> {
  return new TVar(a);
}
export function newTVarIO<A>(a: A): TVar<A> {
  return new TVar(a);
}

export function readTVar<A>(tv: TVar<A>): A {
  const log = current;
  if (log === null) return tv.value;
  log.reads.add(tv);
  for (let l: TLog | null = log; l !== null; l = l.parent) {
    if (l.writes.has(tv)) return l.writes.get(tv) as A;
  }
  return tv.value;
}
export function readTVarIO<A>(tv: TVar<A>): A {
  return tv.value;
}

export function writeTVar<A>(tv: TVar<A>, a: A): void {
  if (current === null) {
    atomicallySync(() => writeTVar(tv, a));
    return;
  }
  current.writes.set(tv, a);
}

export function modifyTVar<A>(tv: TVar<A>, f: (a: A) => A): void {
  inTx(() => writeTVar(tv, f(readTVar(tv))));
}
/** `modifyTVar'` (strict; the same here). */
export const modifyTVar_ = modifyTVar;

export function stateTVar<S, A>(tv: TVar<S>, f: (s: S) => [A, S]): A {
  return inTx(() => {
    const [a, s] = f(readTVar(tv));
    writeTVar(tv, s);
    return a;
  });
}

export function swapTVar<A>(tv: TVar<A>, a: A): A {
  return inTx(() => {
    const old = readTVar(tv);
    writeTVar(tv, a);
    return old;
  });
}

// ---------------------------------------------------------------------------------------------
// TChan (a port of Control.Concurrent.STM.TChan)

type TList<A> = { readonly tag: "TNil" } | { readonly tag: "TCons"; readonly head: A; readonly tail: TVarList<A> };
type TVarList<A> = TVar<TList<A>>;
const TNil: TList<never> = { tag: "TNil" };

/** An unbounded FIFO channel. */
export class TChan<A> {
  /** @internal */
  constructor(
    readonly read: TVar<TVarList<A>>,
    readonly write: TVar<TVarList<A>>,
  ) {}
}

export function newTChan<A>(): TChan<A> {
  const hole: TVarList<A> = new TVar<TList<A>>(TNil);
  return new TChan(new TVar(hole), new TVar(hole));
}
export const newTChanIO = newTChan;

/**
 * A write-only channel: reading it is an error. Readers must use `dupTChan`. Items written to it
 * can be garbage collected once every duplicate has read them.
 */
export function newBroadcastTChan<A>(): TChan<A> {
  const writeHole: TVarList<A> = new TVar<TList<A>>(TNil);
  const poison: TVarList<A> = new BroadcastReadEnd<A>();
  return new TChan(new TVar(poison), new TVar(writeHole));
}
export const newBroadcastTChanIO = newBroadcastTChan;

/** The read end of a broadcast channel: reading it is an error, as in the stm package. */
class BroadcastReadEnd<A> extends TVar<TList<A>> {
  constructor() {
    super(TNil);
  }
}

function readEnd<A>(c: TChan<A>): TVarList<A> {
  const listhead = readTVar(c.read);
  if (listhead instanceof BroadcastReadEnd) {
    throw new Error("reading from a TChan created by newBroadcastTChan; use dupTChan first");
  }
  return listhead;
}

export function writeTChan<A>(c: TChan<A>, a: A): void {
  inTx(() => {
    const listend = readTVar(c.write);
    const newListend: TVarList<A> = new TVar<TList<A>>(TNil);
    writeTVar(listend, { tag: "TCons", head: a, tail: newListend });
    writeTVar(c.write, newListend);
  });
}

export function readTChan<A>(c: TChan<A>): A {
  return inTx(() => {
    const listhead = readEnd(c);
    const head = readTVar(listhead);
    if (head.tag === "TNil") return retry();
    writeTVar(c.read, head.tail);
    return head.head;
  });
}

export function tryReadTChan<A>(c: TChan<A>): Maybe<A> {
  return inTx(() => {
    const listhead = readEnd(c);
    const head = readTVar(listhead);
    if (head.tag === "TNil") return Nothing;
    writeTVar(c.read, head.tail);
    return Just(head.head);
  });
}

export function peekTChan<A>(c: TChan<A>): A {
  return inTx(() => {
    const head = readTVar(readEnd(c));
    if (head.tag === "TNil") return retry();
    return head.head;
  });
}

export function tryPeekTChan<A>(c: TChan<A>): Maybe<A> {
  return inTx(() => {
    const head = readTVar(readEnd(c));
    return head.tag === "TNil" ? Nothing : Just(head.head);
  });
}

/** A new reader of the channel, starting empty: it sees everything written from now on. */
export function dupTChan<A>(c: TChan<A>): TChan<A> {
  return inTx(() => {
    const hole = readTVar(c.write);
    return new TChan(new TVar(hole), c.write);
  });
}

/** A new reader of the channel which starts with the same unread items as the argument. */
export function cloneTChan<A>(c: TChan<A>): TChan<A> {
  return inTx(() => {
    const readpos = readTVar(c.read);
    return new TChan(new TVar(readpos), c.write);
  });
}

/** Put an item back at the read end of the channel. */
export function unGetTChan<A>(c: TChan<A>, a: A): void {
  inTx(() => {
    const listhead = readEnd(c);
    const newhead: TVarList<A> = new TVar<TList<A>>({ tag: "TCons", head: a, tail: listhead });
    writeTVar(c.read, newhead);
  });
}

export function isEmptyTChan<A>(c: TChan<A>): boolean {
  return inTx(() => readTVar(readEnd(c)).tag === "TNil");
}

// ---------------------------------------------------------------------------------------------
// TQueue: a FIFO queue without broadcast. Same semantics as a TChan.

export class TQueue<A> {
  /** @internal */
  constructor(readonly chan: TChan<A>) {}
}

export function newTQueue<A>(): TQueue<A> {
  return new TQueue(newTChan<A>());
}
export const newTQueueIO = newTQueue;

export function writeTQueue<A>(q: TQueue<A>, a: A): void {
  writeTChan(q.chan, a);
}
export function readTQueue<A>(q: TQueue<A>): A {
  return readTChan(q.chan);
}
export function tryReadTQueue<A>(q: TQueue<A>): Maybe<A> {
  return tryReadTChan(q.chan);
}
/** Remove and return everything in the queue. Never retries. */
export function flushTQueue<A>(q: TQueue<A>): A[] {
  return inTx(() => {
    const r: A[] = [];
    for (;;) {
      const x = tryReadTChan(q.chan);
      if (x.tag === "Nothing") return r;
      r.push(x.value);
    }
  });
}
export function peekTQueue<A>(q: TQueue<A>): A {
  return peekTChan(q.chan);
}
export function tryPeekTQueue<A>(q: TQueue<A>): Maybe<A> {
  return tryPeekTChan(q.chan);
}
export function unGetTQueue<A>(q: TQueue<A>, a: A): void {
  unGetTChan(q.chan, a);
}
export function isEmptyTQueue<A>(q: TQueue<A>): boolean {
  return isEmptyTChan(q.chan);
}

// ---------------------------------------------------------------------------------------------
// TMVar

/** `newtype TMVar a = TMVar (TVar (Maybe a))` */
export class TMVar<A> {
  /** @internal */
  constructor(readonly tvar: TVar<Maybe<A>>) {}
}

export function newTMVar<A>(a: A): TMVar<A> {
  return new TMVar(new TVar(Just(a)));
}
export const newTMVarIO = newTMVar;
export function newEmptyTMVar<A>(): TMVar<A> {
  return new TMVar<A>(new TVar<Maybe<A>>(Nothing));
}
export const newEmptyTMVarIO = newEmptyTMVar;

export function takeTMVar<A>(t: TMVar<A>): A {
  return inTx(() => {
    const m = readTVar(t.tvar);
    if (m.tag === "Nothing") return retry();
    writeTVar(t.tvar, Nothing);
    return m.value;
  });
}
export function tryTakeTMVar<A>(t: TMVar<A>): Maybe<A> {
  return inTx(() => {
    const m = readTVar(t.tvar);
    if (m.tag === "Just") writeTVar(t.tvar, Nothing);
    return m;
  });
}
export function putTMVar<A>(t: TMVar<A>, a: A): void {
  inTx(() => {
    if (readTVar(t.tvar).tag === "Just") retry();
    writeTVar(t.tvar, Just(a));
  });
}
export function tryPutTMVar<A>(t: TMVar<A>, a: A): boolean {
  return inTx(() => {
    if (readTVar(t.tvar).tag === "Just") return false;
    writeTVar(t.tvar, Just(a));
    return true;
  });
}
export function readTMVar<A>(t: TMVar<A>): A {
  return inTx(() => {
    const m = readTVar(t.tvar);
    if (m.tag === "Nothing") return retry();
    return m.value;
  });
}
export function tryReadTMVar<A>(t: TMVar<A>): Maybe<A> {
  return inTx(() => readTVar(t.tvar));
}
export function swapTMVar<A>(t: TMVar<A>, a: A): A {
  return inTx(() => {
    const old = takeTMVar(t);
    putTMVar(t, a);
    return old;
  });
}
/** Non-blocking write of a new value, replacing any old one. */
export function writeTMVar<A>(t: TMVar<A>, a: A): void {
  writeTVar(t.tvar, Just(a));
}
export function isEmptyTMVar<A>(t: TMVar<A>): boolean {
  return inTx(() => readTVar(t.tvar).tag === "Nothing");
}
