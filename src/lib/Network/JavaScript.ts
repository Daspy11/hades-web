/**
 * Haskell `Network.JavaScript` (the `javascript-bridge` package, version 0.2.0) with an in-page
 * "loopback" engine.
 *
 * The original is a remote monad over a web socket: the Haskell server sends JavaScript text to
 * the browser, which evaluates it, keeps "remote values" in the array `jsb.rs`, and sends events
 * back with `jsb.event(v)`. In the single page application the "server" runs in the same page,
 * so the `Engine` evaluates the JavaScript text directly and `jsb.event` writes into the
 * engine's event channel. The JavaScript text that Haskell code builds is unchanged: remote
 * values are still `jsb.rs[n]`, events are still sent with `jsb.event(...)`.
 *
 * Mapping
 * -------
 * | Haskell                                  | TypeScript                                        |
 * |------------------------------------------|---------------------------------------------------|
 * | `newtype JavaScript = JavaScript Text`   | `JavaScript` = `string` (erased newtype)           |
 * | `RemoteValue a`                          | `RemoteValue<A>` (`{ _0: n }`, phantom `A`)        |
 * | `var rv`                                 | `var_(rv)` (`var` is reserved)                     |
 * | `value v` (ToJSON)                       | `value(J.Value)`; convert with a codec first       |
 * | `RemoteMonad a`, `Packet a`              | `RemoteMonad<A>` = `(f: Command & Procedure) => A`  |
 * | `do { rv <- constructor js; command c }` | `(f) => { const rv = constructor(js)(f); command(c)(f); return rv; }` |
 * | `return x` / `m1 >> m2` / `mapM_`        | `pureRemote(x)` / `seqRemote(m1, m2)` / `seqRemote(...ms)` |
 * | `send eng m`                             | `send(eng, m)`, synchronous                        |
 * | `procedure js :: f a` (FromJSON a)       | `procedure(codecOrParser, js)`                     |
 * | `delete rv`                              | `delete_(rv)` (also exported as `delete`)          |
 * | `start k` (WAI middleware)               | `start(k)`: creates the loopback engine, runs `k`  |
 *
 * Loopback evaluation
 * -------------------
 * `send` runs the remote monad directly: each command, constructor and procedure is evaluated as
 * it is reached (the original batched them into packets; in a single page that only changes
 * performance). Each statement runs in a function scope of its own via `new Function`, as the
 * original evaluated each packet in `(function(){...})()`. As in the original, a JavaScript
 * exception in a command is not reported to the sender: it is logged on the console and the
 * rest of the computation's statements are skipped. A procedure (or a statement after a failed
 * one in a computation that contains a procedure) raises `JavaScriptException`. Procedure results
 * go through JSON, as they did over the socket. Procedures returning Promises are not supported
 * by the synchronous `send`.
 *
 * Only one engine can be live in a page, because the client side lives in the global `jsb`.
 *
 * Ported from javascript-bridge 0.2.0, Copyright (c) 2016-2019, The University of Kansas
 * (BSD-3-Clause).
 */
import * as J from "@/lib/Data/Aeson";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { getCurrentTime, type UTCTime } from "@/lib/Data/Time";
import { atomically, atomicallySync, newTChanIO, readTChan, writeTChan, type STM } from "@/lib/Control/Concurrent/STM";
import { forever, forkIO, type ThreadId } from "@/lib/Control/Concurrent";

// ---------------------------------------------------------------------------------------------
// JavaScript text

/** JavaScript source text. (`newtype JavaScript = JavaScript Text`, erased.) */
export type JavaScript = string;

/** A local handle on a value kept in the page (`jsb.rs[n]`). */
export interface RemoteValue<A> {
  readonly _0: number;
  /** Phantom type of the remote value. */
  readonly _phantom?: A;
}
export function RemoteValue<A>(_0: number): RemoteValue<A> {
  return { _0 };
}

/** Haskell `var`: the JavaScript text for a remote value. Can be used as an assignment target. */
export function var_<A>(rv: RemoteValue<A>): JavaScript {
  return "jsb.rs[" + String(rv._0) + "]";
}

/** Generate a JavaScript value (JSON encoding). */
export function value(v: J.Value): JavaScript {
  return J.encode(v);
}

/** Generate a JavaScript number. */
export function number(d: number): JavaScript {
  return value(J.doubleJ.toJSON(d));
}

/** Generate a (quoted) JavaScript string. */
export function string(t: string): JavaScript {
  return value(t);
}

/** Generate a function call. */
export function call(fn: JavaScript, args: readonly JavaScript[]): JavaScript {
  return fn + "(" + args.join(",") + ")";
}

/** Send an event back to Haskell. */
export function event(v: J.Value): JavaScript {
  return call("jsb.event", [value(v)]);
}

// ---------------------------------------------------------------------------------------------
// Remote monads

/** The class `Command f`: remote computations that can issue commands and constructors. */
export interface Command {
  internalCommand(js: JavaScript): null;
  internalConstructor<A>(js: JavaScript): RemoteValue<A>;
}

/** The class `Procedure f`: remote computations that can return values. */
export interface Procedure {
  internalProcedure(js: JavaScript): J.Value;
}

/**
 * The remote monad. A computation receives the statement interpreter of the `send` that runs it
 * and issues statements by applying primitives to it.
 */
export type RemoteMonad<A> = (f: Command & Procedure) => A;

/** The remote applicative packet. (Same representation as `RemoteMonad` here.) */
export type Packet<A> = RemoteMonad<A>;

/** `return x` in the remote monad. */
export function pureRemote<A>(a: A): RemoteMonad<A> {
  return () => a;
}

/** `m >>= k` in the remote monad. */
export function bindRemote<A, B>(m: RemoteMonad<A>, k: (a: A) => RemoteMonad<B>): RemoteMonad<B> {
  return (f) => k(m(f))(f);
}

/** `fmap` for the remote monad. */
export function fmapRemote<A, B>(g: (a: A) => B, m: RemoteMonad<A>): RemoteMonad<B> {
  return (f) => g(m(f));
}

/** `m1 >> m2 >> ...` (and `mapM_`/`sequence_`) for remote computations. */
export function seqRemote(...ms: readonly RemoteMonad<unknown>[]): RemoteMonad<null> {
  return (f) => {
    for (const m of ms) m(f);
    return null;
  };
}

/**
 * `command` statement to execute in JavaScript. ';' is not needed as a terminator.
 * Should never throw an exception, which may be reported to console.log.
 */
export function command(js: JavaScript): RemoteMonad<null> {
  return (f) => f.internalCommand(js);
}

/**
 * `constructor` expression to execute in JavaScript. The value is not returned to Haskell.
 * Instead, a handle is returned, that can be used to access the remote value. Examples of remote
 * values include objects that can not be serialized, or values that are too large to serialize.
 */
export function constructor<A>(js: JavaScript): RemoteMonad<RemoteValue<A>> {
  return (f) => f.internalConstructor<A>(js);
}

/**
 * `procedure` expression to execute in JavaScript. Any exception is returned to the `send` as a
 * `JavaScriptException`. The result is decoded with the given codec or parser.
 */
export function procedure<A>(p: J.Parser<A> | J.FromJSON<A>, js: JavaScript): RemoteMonad<A> {
  const parse: J.Parser<A> = typeof p === "function" ? p : (v) => p.parseJSON(v);
  return (f) => parse(f.internalProcedure(js));
}

/** `delete` a remote value. */
export function delete_<A>(rv: RemoteValue<A>): RemoteMonad<null> {
  return command("delete " + var_(rv));
}
export { delete_ as delete };

/** `localize` brings a remote value into Haskell. */
export function localize<A>(rv: RemoteValue<A>): RemoteMonad<J.Value> {
  return procedure(J.valueJ, var_(rv));
}

/** `remote` sends a local value to JavaScript. */
export function remote<A>(v: J.Value): RemoteMonad<RemoteValue<A>> {
  return constructor<A>(value(v));
}

// ---------------------------------------------------------------------------------------------
// Sending

/** An exception raised in JavaScript, reported to `send`. */
export class JavaScriptException extends Error {
  constructor(readonly _0: J.Value) {
    super("JavaScriptException " + J.encode(_0));
    this.name = "JavaScriptException";
  }
}

/** Convert a thrown JavaScript value to JSON, as `JSON.stringify` did over the socket. */
function errorValue(err: unknown): J.Value {
  if (err instanceof Error) return { name: err.name, message: err.message };
  try {
    const s = JSON.stringify(err);
    return s === undefined ? null : (JSON.parse(s) as J.Value);
  } catch {
    return String(err);
  }
}

/** `send` with all JavaScript exceptions caught and returned. */
export function sendE<A>(e: Engine, m: RemoteMonad<A>): Either<J.Value, A> {
  let failure: { err: unknown } | null = null;
  const fail = (err: unknown): void => {
    // As in the original client, an exception in a command is reported on the console.
    console.error("JavaScript error in pushed code:", err);
    failure = { err };
  };
  const interp: Command & Procedure = {
    internalCommand(js) {
      if (failure !== null) return null;
      try {
        e.sendJavaScript(js + ";");
      } catch (err) {
        fail(err);
      }
      return null;
    },
    internalConstructor<B>(js: JavaScript): RemoteValue<B> {
      const rv = RemoteValue<B>(e.genNonce());
      if (failure !== null) return rv;
      try {
        e.sendJavaScript(var_(rv) + "=" + js + ";");
      } catch (err) {
        fail(err);
      }
      return rv;
    },
    internalProcedure(js) {
      e.genNonce();
      if (failure !== null) throw new JavaScriptException(errorValue(failure.err));
      let r: unknown;
      try {
        r = e.evalJavaScript(js);
      } catch (err) {
        fail(err);
        throw new JavaScriptException(errorValue(err));
      }
      if (r instanceof Promise) throw new JavaScriptException("procedure returned a Promise; not supported by the loopback send");
      const s = JSON.stringify(r);
      return s === undefined ? null : (JSON.parse(s) as J.Value);
    },
  };
  try {
    return Right(m(interp));
  } catch (err) {
    if (err instanceof JavaScriptException) return Left(err._0);
    throw err;
  }
}

/**
 * `send` a remote monad for execution on a JavaScript engine. Throws `JavaScriptException` if a
 * procedure fails.
 */
export function send<A>(e: Engine, m: RemoteMonad<A>): A {
  const r = sendE(e, m);
  if (r.tag === "Left") throw new JavaScriptException(r.value);
  return r.value;
}

/** Send an (applicative) `Packet`. */
export function sendA<A>(e: Engine, p: Packet<A>): A {
  return send(e, p);
}

// ---------------------------------------------------------------------------------------------
// Engines and events

/** An `Engine` is a handle to a specific JavaScript engine (here: this page). */
export interface Engine {
  /** Send text to the JS engine (here: evaluate it as statements). */
  readonly sendJavaScript: (js: JavaScript) => void;
  /** Nonce generator (also numbers the remote values). */
  readonly genNonce: () => number;
  /** Reply mailbox for replies sent with `jsb.reply`/`jsb.error`. */
  readonly replyBox: (n: number) => Promise<Either<J.Value, J.Value[]>>;
  /** The events sent by `jsb.event`, with their arrival time. */
  readonly eventChan: STM<[J.Value, UTCTime]>;
  /** Loopback only: evaluate an expression and return its (raw JavaScript) value. */
  readonly evalJavaScript: (js: JavaScript) => unknown;
}

/** An application: the WAI type of the original. In the page it is just the startup action. */
export type Application = (eng: Engine) => void | Promise<void>;

/** The client side of the bridge: the global `jsb` object. */
interface JsbGlobal {
  rs: unknown[];
  debug?: boolean;
  event(ev: unknown): void;
  error(n: number, err: unknown): void;
  reply(n: number, obj: unknown[]): void;
  [k: string]: unknown;
}

/** Round-trip a value through JSON, as the web socket did. `undefined` if not representable. */
function viaJson(v: unknown): J.Value | undefined {
  const s = JSON.stringify(v);
  return s === undefined ? undefined : (JSON.parse(s) as J.Value);
}

/**
 * This creates the loopback engine for this page, installs the client side of the bridge (the
 * global `jsb`, as the original `bootstrap` did) and calls the callback with the engine.
 *
 * Web: the original was WAI middleware accepting web socket connections, calling the callback
 * once per client. The page is the only client here.
 */
export function start(kE: (eng: Engine) => void | Promise<void>): Promise<void> {
  const eng = makeLoopbackEngine();
  return Promise.resolve().then(() => kE(eng));
}

function makeLoopbackEngine(): Engine {
  let nonce = 0;
  const eventQueue = newTChanIO<[J.Value, UTCTime]>();
  const replies = new Map<number, Either<J.Value, J.Value[]>>();
  const replyWaiters = new Map<number, (r: Either<J.Value, J.Value[]>) => void>();
  const deliver = (n: number, r: Either<J.Value, J.Value[]>): void => {
    const w = replyWaiters.get(n);
    if (w) {
      replyWaiters.delete(n);
      w(r);
    } else replies.set(n, r);
  };
  const g = globalThis as unknown as { jsb?: JsbGlobal };
  const old = g.jsb;
  const jsb: JsbGlobal = {
    ...(old ?? {}),
    rs: [],
    // jsb.event: the client sends an event to the server.
    event(ev: unknown): void {
      if (jsb.debug) console.log("event", { event: ev });
      const msg = viaJson({ event: ev });
      if (msg === undefined || msg === null || typeof msg !== "object" || Array.isArray(msg) || !("event" in msg)) {
        console.log("bad (non JSON) reply from JavaScript", msg);
        return;
      }
      atomicallySync(() => writeTChan(eventQueue, [msg.event, getCurrentTime()]));
    },
    error(n: number, err: unknown): void {
      if (jsb.debug) console.log("send", { id: n, error: err });
      deliver(n, Left(viaJson(err) ?? null));
      throw err;
    },
    reply(n: number, obj: unknown[]): void {
      Promise.all(obj)
        .then((o) => {
          if (jsb.debug) console.log("reply", { id: n, result: o });
          deliver(n, Right((viaJson(o) ?? []) as J.Value[]));
        })
        .catch((err) => jsb.error(n, err));
    },
  };
  g.jsb = jsb;
  return {
    sendJavaScript: (js) => {
      if (jsb.debug) console.log("eval", js);
      new Function(js)();
    },
    evalJavaScript: (js) => {
      if (jsb.debug) console.log("eval", js);
      return new Function("return (" + js + ");")();
    },
    genNonce: () => nonce++,
    replyBox: (n) => {
      const r = replies.get(n);
      if (r !== undefined) {
        replies.delete(n);
        return Promise.resolve(r);
      }
      return new Promise((resolve) => replyWaiters.set(n, resolve));
    },
    eventChan: () => readTChan(eventQueue),
  };
}

/**
 * Add a listener for events. There can be many. Non-blocking.
 *
 * From JavaScript, you can call `jsb.event(..)` to send values to this listener. Any valid JSON
 * value can be sent.
 */
export function addListener(e: Engine, k: (v: J.Value) => void | Promise<void>): ThreadId {
  return forkIO(() =>
    forever(async () => {
      await k(await listen(e));
    }),
  );
}

/** `listen` for the next event. Blocking. */
export async function listen(e: Engine): Promise<J.Value> {
  return (await atomically(() => readEventChan(e)))[0];
}

/** `readEventChan` uses STM to read the next event. */
export function readEventChan(e: Engine): [J.Value, UTCTime] {
  return e.eventChan();
}
