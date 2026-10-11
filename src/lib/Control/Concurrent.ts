/**
 * Haskell `Control.Concurrent` (and the thread parts of `GHC.Conc`) for a single-threaded
 * JavaScript page.
 *
 * Mapping
 * -------
 * | Haskell                     | TypeScript                                                  |
 * |-----------------------------|-------------------------------------------------------------|
 * | `forkIO act`                | `forkIO(() => act)`: starts `act` in a microtask             |
 * | `forever act` (in a thread) | `forever(() => act)`: an async loop, returns `Promise<never>` |
 * | `killThread t`              | `killThread(t)`                                             |
 * | `threadDelay us`            | `await threadDelay(us)` (microseconds, as in Haskell)       |
 * | `labelThread t s`           | `labelThread(t, s)`                                         |
 * | `myThreadId`                | `myThreadId()`                                              |
 * | `ThreadKilled` exception    | `ThreadKilled` (an `Error` subclass)                        |
 *
 * A "thread" is an asynchronous JavaScript computation. Its blocking points (`atomically` from
 * `Control/Concurrent/STM`, `threadDelay`) are `await`s, so threads interleave at those points
 * only.
 *
 * Killing threads
 * ---------------
 * GHC delivers `ThreadKilled` asynchronously wherever the thread is. Here a thread can only be
 * interrupted where it blocks. JavaScript has no thread-local storage that survives an `await`,
 * so the thread a blocking call belongs to is found from `currentThread`, which is set while
 * the *synchronous* part of a thread step runs: the start of the thread (`forkIO`) and the start
 * of each iteration of `forever`. A blocking call made in that synchronous part (typically the
 * `atomically` at the head of a daemon loop) is registered with the thread, and `killThread`
 * aborts it with a `ThreadKilled` rejection. `forever` stops at the next iteration of a killed
 * thread. Blocking calls made after an `await` inside an iteration are not interruptible; they
 * complete normally and the loop then stops. `killThread` of the calling thread does not throw
 * synchronously (as it would in GHC); the thread stops at its next blocking point.
 */

/** A handle to a thread created by `forkIO`. */
export class ThreadId {
  private static counter = 0;
  /** Serial number (GHC prints thread ids as `ThreadId 42`). */
  readonly serial: number = ++ThreadId.counter;
  /** Label set with `labelThread`. */
  label: string | null = null;
  /** @internal Set by `killThread`. */
  killed = false;
  /** @internal The blocking operation the thread is waiting in, if it can be interrupted. */
  blockedOn: { cancel(): void } | null = null;

  toString(): string {
    return this.label === null ? `ThreadId ${this.serial}` : `ThreadId ${this.serial} (${this.label})`;
  }
}

/** The exception raised in a thread by `killThread`. */
export class ThreadKilled extends Error {
  constructor() {
    super("thread killed");
    this.name = "ThreadKilled";
  }
}

/** The thread of the main program (code not started by `forkIO`). */
const mainThread = new ThreadId();
mainThread.label = "main";

let current: ThreadId | null = null;

/**
 * @internal The thread whose synchronous step is running, or `null` (main program, or after an
 * `await` inside a thread). Used by blocking operations to register themselves for `killThread`.
 */
export function currentThread(): ThreadId | null {
  return current;
}

/** @internal Run `f` synchronously with `currentThread()` set to `t`. */
export function withThread<A>(t: ThreadId | null, f: () => A): A {
  const prev = current;
  current = t;
  try {
    return f();
  } finally {
    current = prev;
  }
}

/** `myThreadId`. Outside the synchronous step of a forked thread this is the main thread. */
export function myThreadId(): ThreadId {
  return current ?? mainThread;
}

/** GHC's default handler for uncaught exceptions in forked threads: report them. */
function reportUncaught(t: ThreadId, e: unknown): void {
  if (e instanceof ThreadKilled) return;
  console.error(`${t}: uncaught exception:`, e);
}

/**
 * `forkIO`: run the action as a new thread. It starts in a microtask, so the caller carries on
 * first (as with GHC, there is no guarantee about which runs first). Uncaught exceptions other
 * than `ThreadKilled` are reported on the console.
 */
export function forkIO(act: () => void | Promise<void>): ThreadId {
  const t = new ThreadId();
  queueMicrotask(() => {
    if (t.killed) return;
    let p: void | Promise<void>;
    try {
      p = withThread(t, act);
    } catch (e) {
      reportUncaught(t, e);
      return;
    }
    if (p instanceof Promise) p.catch((e) => reportUncaught(t, e));
  });
  return t;
}

/** `killThread`: stop the thread at its current (interruptible) or next blocking point. */
export function killThread(t: ThreadId): void {
  if (t.killed) return;
  t.killed = true;
  const b = t.blockedOn;
  t.blockedOn = null;
  if (b) b.cancel();
}

/** `labelThread` from GHC.Conc. */
export function labelThread(t: ThreadId, label: string): void {
  t.label = label;
}

/** Number of iterations `forever` runs before yielding to the event loop (see `forever`). */
const FOREVER_YIELD_EVERY = 1000;

/**
 * `forever act`: repeat the action until it throws. Each iteration starts with
 * `currentThread()` set to the thread that called `forever`, so a blocking call at the start of
 * the iteration can be interrupted by `killThread`; a killed thread stops before its next
 * iteration with `ThreadKilled`.
 *
 * Web: a GHC thread that loops without blocking is pre-empted by the scheduler. A JavaScript loop
 * of microtasks would starve the page, so `forever` yields to the event loop every
 * `FOREVER_YIELD_EVERY` iterations.
 */
export async function forever(act: () => void | Promise<void>): Promise<never> {
  const t = current;
  for (let n = 1; ; n++) {
    if (t?.killed) throw new ThreadKilled();
    await withThread(t, act);
    if (n % FOREVER_YIELD_EVERY === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * `threadDelay us`: wait for the given number of microseconds. Interruptible by `killThread`
 * when called in the synchronous step of a thread.
 */
export function threadDelay(us: number): Promise<void> {
  const t = current;
  if (t?.killed) return Promise.reject(new ThreadKilled());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (t && t.blockedOn === blocker) t.blockedOn = null;
      resolve();
    }, Math.max(0, us / 1000));
    const blocker = {
      cancel() {
        clearTimeout(timer);
        reject(new ThreadKilled());
      },
    };
    if (t) t.blockedOn = blocker;
  });
}

/** `yield`: let other threads run. */
export function yield_(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
