// Ported from banana-ui/webits/src/Network/Webits.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Webits are a composable dynamic GUI for web applications. Javascript is pushed to the
 * client, from where it returns events via web sockets. Each Webit has a UUID which is used to route
 * event data to the appropriate TChan.
 *
 * When a new client connects, use "Network.JavsScript.start" to get an "Engine". Pass this to
 * "makeElmerEnv" to get a @TVar@ holding the local state for that client. Then call "runElmer" with
 * an action to create the initial state of the GUI on the client.
 *
 * __WARNING:__ Do not use recursive @do@ notation (@mdo@) with Webits; it seems to cause threading
 * to fail.
 *
 * TypeScript port: representation choices
 * =======================================
 *
 * Server and client in one page
 * -----------------------------
 * The original server pushed JavaScript text over a web socket. Here the "server" code runs in
 * the same page as its client: `@/lib/Network/JavaScript` provides a loopback `Engine` that
 * evaluates the pushed JavaScript with `new Function`, keeps remote values in `jsb.rs` and
 * delivers `jsb.event(...)` calls from the pushed code into the engine's event channel, where the
 * command pipe thread of `makeElmerEnv` routes them to the webits exactly as before. All the
 * JavaScript text is built as in the original, so `jQuery`, jQuery UI, Fancytree, AppendGrid and
 * `JS/arrowDialog.js` are loaded into the page (by `elmerScotty`) as the original page did.
 *
 * Monads and concurrency
 * ----------------------
 * * `Elmer a` (`ReaderT ElmerEnv IO`) is an explicit `env: ElmerEnv` parameter. A first-class
 *   `Elmer a` value (an argument of `runElmer`, `forkElmer`, `elmerDaemon`, a finaliser) is
 *   `Elmer<A>` = `(env: ElmerEnv) => A | Promise<A>`. Functions returning `Elmer a` take
 *   `env` after their dictionaries and before the Haskell arguments, and are synchronous unless
 *   they can block (`getIconChoice`, `deleteWebit`, `runElmer`, `makeElmerEnv`, `elmerScotty`
 *   return Promises). `ask`/`asks f` are `env`/`env.f`; `local f act` is `act({...env, ...})`.
 * * STM is `@/lib/Control/Concurrent/STM`: an `STM a` value is a function `() => A` run in a
 *   transaction; `liftIO $ atomically act` is `await atomically(() => ...)` where the
 *   transaction can `retry`, and `atomicallySync(() => ...)` where it cannot.
 * * Threads (`forkIO`, `forever`, `killThread`, `threadDelay`) are `@/lib/Control/Concurrent`:
 *   async loops. `elmerDaemon` threads are killed when their owner webit is finalised.
 * * `TState` is `Control/Concurrent/TState` (`tStateEvent`, `tStateBehaviour`, `tStateDup` are
 *   STM functions).
 *
 * Classes and data
 * ----------------
 * * `WebitClass` is a dictionary interface; instances are `WebitClass_WebitItem`,
 *   `WebitClass_WebitContainer`, `WebitClass_WebStatic`, `WebitClass_Webit` (and
 *   `WebitClass_WebitMenu` in `Webits/Menu`). Constrained functions take the dictionary first:
 *   `showWebit(WebitClass_Webit, env, top, btn)`.
 * * `WebitItem` (an existential) packs the dictionary with the value: `WebitItem(cls, w)`.
 * * `ToJSON`/`FromJSON` constraints are codecs (`J.JSONCodec<A>`, `J.ToJSON<A>`,
 *   `J.FromJSON<A>`), passed first: `makeWebit(J.textJ, env, html, update, "x")`,
 *   `addWebitChannel(J.boolJ, WebitClass_Webit, env, w)`, `webitEvent(J.unitJ, wId, null)`.
 *   `()` is `null` (encoded as `[]` by `J.unitJ`, as aeson does).
 * * `Eq a` is the structural `equals` of `@/lib/Data/Ord`.
 * * `Html` is `@/lib/Text/Blaze/Html5` (blaze-html); `JavaScript` is a `string`;
 *   `RemoteValue Html` is `RemoteValue<Html>` and `var` is `var_`.
 * * Curried function arguments are uncurried: `makeWebit`'s update function is
 *   `(a, rv, wId) => JavaScript`; the `webitIn` field is `(a: A) => void` (an STM action).
 * * `HasCallStack` is dropped, except that `elmerLog` records its caller's location (best effort,
 *   from the JavaScript stack) for `logLine`.
 * * `liftIO` (re-exported by the Haskell module) has no TypeScript counterpart: IO actions are
 *   called directly.
 * * `elmerStatic` and `elmerScotty` (Scotty routes) act at once: `elmerStatic` registers the icons,
 *   `elmerScotty` loads the client libraries and mounts the page's @main@ element into a DOM
 *   container (default `document.body`), then runs the GUI. See their comments.
 */
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as U from "@/lib/Data/UUID";
import * as Tr from "@/lib/Data/Tree";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { newIORef, readIORef, modifyIORef, type IORef } from "@/lib/Prelude";
import {
  atomically,
  atomicallySync,
  BlockedIndefinitelyOnSTM,
  dupTChan,
  inTx,
  modifyTVar,
  newBroadcastTChanIO,
  newTQueueIO,
  newTVarIO,
  orElse,
  readTChan,
  readTQueue,
  readTVar,
  stateTVar,
  throwSTM,
  tryReadTChan,
  writeTChan,
  writeTQueue,
  writeTVar,
  type TChan,
  type TQueue,
  type TVar,
} from "@/lib/Control/Concurrent/STM";
import { forever, forkIO, killThread, labelThread, threadDelay, ThreadKilled } from "@/lib/Control/Concurrent";
import {
  call,
  command,
  constructor,
  delete_ as jsDelete,
  JavaScriptException,
  readEventChan,
  send,
  start,
  string as jsString,
  value,
  var_,
  event,
  type Engine,
  type JavaScript,
  type RemoteValue,
} from "@/lib/Network/JavaScript";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { getDataFileName } from "@/lib/System/Paths";
import { uuidStreamIO } from "@/banana-ui/base/Data/UUID/Generate";
import type { TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import { iconUrl, scottyIcons, IconGroup, type IconName } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { standardHeader } from "@/banana-ui/webits/src/Network/Webits/StyleSheets";

export type { IconName } from "@/banana-ui/webits/src/Network/Webits/Icons";
export type { Html } from "@/lib/Text/Blaze/Html5";
type Html = H.Html;

export type WebitId = U.UUID;

/** Private type: wrap a value up with a UUID */
interface WebitEvent<A> {
  readonly _0: WebitId;
  readonly _1: A;
}
function WebitEvent<A>(_0: WebitId, _1: A): WebitEvent<A> {
  return { _0, _1 };
}

/** `instance ToJSON (WebitEvent a)`, `instance FromJSON (WebitEvent a)` */
function JSON_WebitEvent<A>(c: J.JSONCodec<A>): J.JSONCodec<WebitEvent<A>> {
  return J.codec(
    (e) => J.object([["d", J.uuidJ.toJSON(e._0)], ["v", c.toJSON(e._1)]]),
    (v) => J.withObject("Webit Event", (o) => WebitEvent(J.field(o, "d", J.uuidJ), J.field(o, "v", c)), v),
  );
}

// ---------------------------------------------------------------------------------------------
// Logging

/**
 * Logging priority.
 *
 * * `DEBUG`: Debug messages
 * * `INFO`: Information
 * * `NOTICE`: Normal runtime conditions
 * * `WARNING`: General Warnings
 * * `ERROR`: General Errors
 * * `CRITICAL`: Severe situations
 * * `ALERT`: Take immediate action
 * * `EMERGENCY`: System is unusable
 */
export type Priority = "DEBUG" | "INFO" | "NOTICE" | "WARNING" | "ERROR" | "CRITICAL" | "ALERT" | "EMERGENCY";
/** `[minBound .. maxBound] :: [Priority]` */
export const priorityValues: readonly Priority[] = ["DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "ALERT", "EMERGENCY"];

/** `GHC.Stack.SrcLoc` (the fields used here). */
export interface SrcLoc {
  readonly srcLocModule: string;
  readonly srcLocStartLine: number;
}

/** `GHC.Stack.CallStack`: the call sites, innermost first, with the name of the called function. */
export type CallStack = readonly (readonly [string, SrcLoc])[];

/** `emptyCallStack`: what `callStack` gives in a function without `HasCallStack`. */
export const emptyCallStack: CallStack = [];

/** Module name of a JavaScript source URL: the path below the package's `src/`, or the file name. */
function moduleOfUrl(url: string): string {
  const path = url.replace(/[?#].*$/, "").replace(/\.[tj]sx?$/, "");
  const parts = path.split("/src/");
  const rel = parts.length > 2 ? parts[parts.length - 1] : path.slice(path.lastIndexOf("/") + 1);
  return rel.split("/").join(".");
}

/**
 * The `callStack` of a function `fn` with a `HasCallStack` constraint: one entry, the call of
 * `fn`, located (best effort) from the JavaScript stack. `depth` is the number of stack frames
 * between the caller of `fn` and this function.
 */
function callStackOf(fn: string, depth: number): CallStack {
  const frames = (new Error().stack ?? "").split("\n").filter((l) => /:\d+:\d+\)?\s*$/.test(l));
  const frame = frames[depth];
  if (frame === undefined) return emptyCallStack;
  const m = /(?:\(|@|at\s+)?((?:[a-z]+:\/\/|\/)[^\s()]*?):(\d+):(\d+)\)?\s*$/.exec(frame);
  if (m === null) return emptyCallStack;
  return [[fn, { srcLocModule: moduleOfUrl(m[1]), srcLocStartLine: parseInt(m[2], 10) }]];
}

/** Log message format. */
export interface LogItem {
  readonly logPriority: Priority;
  readonly logLocation: CallStack;
  readonly logMessage: string;
}
export function LogItem(logPriority: Priority, logLocation: CallStack, logMessage: string): LogItem {
  return { logPriority, logLocation, logMessage };
}

/** `deriving (Show)` for LogItem. */
export function show_LogItem(item: LogItem): string {
  return `LogItem {logPriority = ${item.logPriority}, logLocation = ${JSON.stringify(item.logLocation)}, logMessage = ${JSON.stringify(item.logMessage)}}`;
}

/** One-line representation of a log item. */
export function logLine(item: LogItem): string {
  const loc = item.logLocation[0];
  const locStr = loc !== undefined ? loc[1].srcLocModule + "." + loc[0] + ":" + String(loc[1].srcLocStartLine) : "(unknown location)";
  return item.logPriority + " " + locStr + ": " + item.logMessage;
}

/**
 * Channel the log to Standard Error.
 *
 * Web: the browser console. Messages below `WARNING` go to `console.info`, `WARNING` to
 * `console.warn` and the rest to `console.error`.
 */
export function logToStderr(env: ElmerEnv): void {
  forkElmer(env, (env1) =>
    forever(async () => {
      const q = env1.elmerLogQ;
      const msg = await atomically(() => readTQueue(q));
      const line = logLine(msg);
      const level = priorityValues.indexOf(msg.logPriority);
      if (level < priorityValues.indexOf("WARNING")) console.info(line);
      else if (msg.logPriority === "WARNING") console.warn(line);
      else console.error(line);
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Exceptions

/**
 * Exceptions inside Elmer actions.
 *
 * * `ElmerDecodeError`: JSON received was not what was expected.
 * * `ElmerUnknownWebit`: Received a @WebitId@ that does not exist.
 * * `ElmerExhaustedIds`: The supposedly infinite list of WebitIds was exhausted.
 */
type ElmerException =
  | { readonly tag: "ElmerDecodeError"; readonly _0: J.Value; readonly _1: string }
  | { readonly tag: "ElmerUnknownWebit"; readonly _0: WebitId }
  | { readonly tag: "ElmerExhaustedIds" };
function ElmerDecodeError(_0: J.Value, _1: string): ElmerException {
  return { tag: "ElmerDecodeError", _0, _1 };
}
function ElmerUnknownWebit(_0: WebitId): ElmerException {
  return { tag: "ElmerUnknownWebit", _0 };
}
const ElmerExhaustedIds: ElmerException = { tag: "ElmerExhaustedIds" };

/** `instance Show ElmerException` */
function show_ElmerException(e: ElmerException): string {
  switch (e.tag) {
    case "ElmerDecodeError":
      return "Could not decode JSON from client: " + e._1 + " in " + J.encode(e._0);
    case "ElmerUnknownWebit":
      return "Event from unknown Webit: " + e._0;
    case "ElmerExhaustedIds":
      return "Ran out of unique IDs. This is supposed to be impossible.";
  }
}

/** `instance Exception ElmerException`: the thrown form of an `ElmerException`. */
class ElmerExceptionError extends Error {
  constructor(readonly exception: ElmerException) {
    super(show_ElmerException(exception));
    this.name = "ElmerException";
  }
}

/** Haskell `show` of an exception, for log messages. */
function showException(e: unknown): string {
  if (e instanceof ElmerExceptionError) return show_ElmerException(e.exception);
  if (e instanceof ThreadKilled) return "thread killed";
  if (e instanceof Error) return e.name === "Error" ? e.message : e.name + ": " + e.message;
  return String(e);
}

/**
 * True for the exceptions that correspond to Haskell's `ErrorCall` (`error`, failed patterns,
 * JavaScript run-time errors), as opposed to thread control and bridge exceptions.
 */
function isErrorCall(e: unknown): e is Error {
  return (
    e instanceof Error &&
    !(e instanceof ThreadKilled) &&
    !(e instanceof ElmerExceptionError) &&
    !(e instanceof JavaScriptException) &&
    !(e instanceof BlockedIndefinitelyOnSTM)
  );
}

// ---------------------------------------------------------------------------------------------
// The Elmer monad

/**
 * The internal environment of the Webit GUI shown on a web browser.
 *
 * When a Webit is updated the resulting Javascript command is sent via the @elmerSend@ function.
 * This avoids the risk of race conditions between updates to the internal state of the Webit and the
 * update to the visible state in the web browser.
 *
 * There is no problem using @send@ in other contexts.
 */
export interface ElmerEnv {
  readonly elmerEngine: Engine;
  /**
   * Top level container into which GUI components should be inserted. Always part of
   * the DOM.
   */
  readonly elmerTop: WebitContainer;
  /** Bottom of the visibility stack, representing the HTML page where this is happening. */
  readonly elmerBase: WebitContainer;
  /** Javascript commands which are sent to the @Engine@ from within a transaction. (STM.) */
  readonly elmerSendJS: (js: JavaScript) => void;
  /**
   * An infinite list of random UUIDs available from inside transactions. (Not exported by the
   * Haskell module.)
   */
  readonly elmerIds: TVar<Iterator<WebitId>>;
  /**
   * Actions to take when receiving events. The value is passed to each function until
   * one of them returns True. (STM functions. Not exported by the Haskell module.)
   */
  readonly elmerRoutes: TVar<M.Map<WebitId, readonly ((v: J.Value) => boolean)[]>>;
  /** Logging queue. */
  readonly elmerLogQ: TQueue<LogItem>;
  /**
   * Global icon menu. This is a fixed menu, and building it is expensive. So it makes
   * sense to do it once and make it available here. The @TChan@ carries clicks from the
   * dialog buttons: @True@ for OK, @False@ for cancel.
   */
  readonly elmerIconMenu: readonly [Webit<IconName>, TChan<boolean>];
  /** Z index of current container. */
  readonly elmerZ: number;
}
// Design Note: elmerIconMenu MUST remain non-strict. See makeElmerEnv.

/** The `ElmerEnv` constructor (not exported by the Haskell module). */
function ElmerEnv(
  elmerEngine: Engine,
  elmerTop: WebitContainer,
  elmerBase: WebitContainer,
  elmerSendJS: (js: JavaScript) => void,
  elmerIds: TVar<Iterator<WebitId>>,
  elmerRoutes: TVar<M.Map<WebitId, readonly ((v: J.Value) => boolean)[]>>,
  elmerLogQ: TQueue<LogItem>,
  elmerIconMenu: () => readonly [Webit<IconName>, TChan<boolean>],
  elmerZ: number,
): ElmerEnv {
  // elmerIconMenu is passed as a thunk to keep it non-strict.
  return {
    elmerEngine,
    elmerTop,
    elmerBase,
    elmerSendJS,
    elmerIds,
    elmerRoutes,
    elmerLogQ,
    get elmerIconMenu() {
      return elmerIconMenu();
    },
    elmerZ,
  };
}

export function elmerSend(env: ElmerEnv, js: JavaScript): void {
  const s = env.elmerSendJS;
  atomicallySync(() => s(js));
}

/**
 * Create an initial state for the Elmer monad, including a thread which serialises Webit
 * updates via "elmerSend".
 */
export async function makeElmerEnv(
  /** Identity of the top-level container in the HTML document shown on the browser. */
  topName: string,
  iconData: readonly IconGroup[],
  eng: Engine,
): Promise<ElmerEnv> {
  const sendElmerCommand = (pipe: TQueue<JavaScript>): (() => void) => {
    const js = readTQueue(pipe);
    return () => {
      send(eng, command(js)); // Returns an IO action
    };
  };
  const offerList = (fs: readonly ((v: J.Value) => boolean)[], v: J.Value): void => {
    for (const f of fs) if (f(v)) return;
    throwSTM(new ElmerExceptionError(ElmerDecodeError(v, "Client value not accepted")));
  };
  const receiveElmerEvent = (routes: TVar<M.Map<WebitId, readonly ((v: J.Value) => boolean)[]>>): (() => void) => {
    const [ev] = readEventChan(eng);
    console.debug("Elmer event received: " + J.encode(ev)); // traceM
    const r = J.parseEither(JSON_WebitEvent(J.valueJ).parseJSON, ev);
    if (r.tag === "Left") return throwSTM(new ElmerExceptionError(ElmerDecodeError(ev, r.value)));
    const { _0: d, _1: v } = r.value;
    const rt = readTVar(routes);
    const fs = M.lookup(d, rt);
    if (fs.tag === "Nothing") return throwSTM(new ElmerExceptionError(ElmerUnknownWebit(d)));
    offerList(fs.value, v);
    return () => {};
  };
  const iconDialogJS = (mId: WebitId): JavaScript =>
    "$(" + webitSelector(mId) + ")" +
    ".dialog({" +
    "modal:true," +
    "autoOpen:false," +
    "width:700," +
    "buttons:{'Ok':function (){" +
    webitEventData(mId, "true") + ";" +
    "$(this).dialog('close');" +
    "}}," +
    "close:function () {" +
    webitEventData(mId, "false") + ";" +
    "$(this).dialog('close');" +
    "}" +
    "})" +
    ".tabs();";

  const pipe = newTQueueIO<JavaScript>();
  const logQ = newTQueueIO<LogItem>();
  const ids = newTVarIO<Iterator<WebitId>>(uuidStreamIO());
  const top = send(eng, constructor<Html>("document" + "." + call("getElementById", [jsString(topName)])));
  const topParent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  // Delete the top element on the client once the server forgets it.
  const topChildren = newTVarIO<readonly WebitItem[]>([]);
  const final = newIORef<Elmer<void>>(() => {});
  // Construct a temporary ElmerEnv and bootstrap the Icon menu webit with it.
  const routes1 = newTVarIO<M.Map<WebitId, readonly ((v: J.Value) => boolean)[]>>(M.empty());
  const baseContainer = WebitContainer(top, U.nil, topParent, topChildren, final);
  const env1 = ElmerEnv(
    eng,
    baseContainer,
    baseContainer,
    (js) => writeTQueue(pipe, js),
    ids,
    routes1,
    logQ,
    () => {
      // Safe because this is the value we are going to construct.
      throw new Error("makeElmerEnv: elmerIconMenu used while the icon menu is being built");
    },
    0,
  );
  const [iconMenuWebit, iconMenuClicks, routes] = await runElmer(
    env1,
    (env): [Webit<IconName>, TChan<boolean>, TVar<M.Map<WebitId, readonly ((v: J.Value) => boolean)[]>>] => {
      const [w, c] = createIconMenu(env, iconData);
      showWebit(WebitClass_Webit, env, baseContainer, w);
      const r = env.elmerRoutes; // Need to capture the iconMenu routing.
      return [w, c, r];
    },
  );
  const threadId = forkIO(() =>
    forever(async () => {
      const io = await atomically(() =>
        orElse(
          () => sendElmerCommand(pipe),
          () => receiveElmerEvent(routes),
        ),
      );
      io();
    }),
  );
  labelThread(threadId, "makeElmerEnv command pipe");
  send(eng, command(iconDialogJS(WebitClass_Webit.webitId(iconMenuWebit))));
  const iconMenu: readonly [Webit<IconName>, TChan<boolean>] = [iconMenuWebit, iconMenuClicks];
  return ElmerEnv(
    eng,
    baseContainer,
    baseContainer,
    (js) => writeTQueue(pipe, js),
    ids,
    routes,
    logQ,
    () => iconMenu,
    0,
  );
}

/**
 * Create a menu of icons in a tabbed UI, with one tab for each icon group.
 *
 * This should not be called in user code. Every invocation reads the icons from disk, and also
 * causes the client browser to download the full set. Instead you should access the pre-loaded
 * value stored in 'elmerIconMenu'.
 */
function createIconMenu(env: ElmerEnv, iconsData: readonly IconGroup[]): [Webit<IconName>, TChan<boolean>] {
  const locateIcon = (grps: readonly IconGroup[], icon: IconName): Maybe<[number, number]> => {
    // Maybe monad
    const gn = L.findIndex((g: IconGroup) => M.member(icon, g.iconGroupContents), grps);
    if (gn.tag === "Nothing") return Nothing;
    const g = M.keys(grps[gn.value].iconGroupContents);
    const n = L.elemIndex(icon, g);
    if (n.tag === "Nothing") return Nothing;
    return Just([gn.value, n.value]);
  };
  const updateIcon = (groups: readonly IconGroup[], icon: IconName, _rv: RemoteValue<Html>, wId1: WebitId): JavaScript => {
    const unhighlight = "$(" + webitSelector(wId1) + " + ' img.icon-display').removeAttr('style');";
    const loc = locateIcon(groups, icon);
    if (loc.tag === "Nothing") return unhighlight;
    const [gn, n] = loc.value;
    return (
      "{" + unhighlight +
      "$(" + webitSelector1(wId1, "_" + String(gn)) + " + ' img')" +
      ".eq(" + String(n) + ")" +
      ".css('border-color','#cc6600');" +
      "$(" + webitSelector(wId1) + ").tabs ('option', 'active', " + value(gn) + ");" +
      "}"
    );
  };
  const tabs = (names: readonly string[], contents1: readonly Html[], wId: WebitId): Html =>
    H.mconcat_Html([
      H.ul(...names.map((txt, n) => H.li(H.with_(H.a(H.text(txt)), HA.href(H.stringValue("#" + wId + "_" + String(n))))))),
      ...contents1.map((c, n) => H.with_(H.div(c), HA.id(H.stringValue(wId + "_" + String(n))))),
    ]);
  const groupHtml = (grp: IconGroup): [string, (wId: WebitId) => Html] => [
    grp.iconGroupName,
    (wId) => H.mconcat_Html(M.keys(grp.iconGroupContents).map((nm) => iconPic(wId, nm))),
  ];

  const groups: readonly IconGroup[] = iconsData.length === 0 ? [IconGroup("No icons available", M.empty())] : iconsData;
  // Ensure 'groups' is not empty.
  const [names, contents1] = L.unzip(groups.map(groupHtml));
  const result = makeWebit<IconName>(
    J.textJ,
    env,
    (wId) => tabs(names, contents1.map((f) => f(wId)), wId),
    (icon, rv, wId1) => updateIcon(groups, icon, rv, wId1),
    "no-icon",
  );
  const selection = atomicallySync(() => result.webitState.tStateDup());
  elmerDaemon(WebitClass_Webit, env, result, async (env1) => {
    const clickedIcon = (await atomically(() => selection.tStateEvent()))[1];
    elmerSend(env1, updateIcon(groups, clickedIcon, WebitClass_Webit.webitHandle(result), WebitClass_Webit.webitId(result)));
  });
  const clickChan = addWebitChannel(J.boolJ, WebitClass_Webit, env, result);
  return [result, clickChan];
}

/**
 * Monad for managing and updating Webbits.
 *
 * Elmer actions can be run in multiple threads and associated with multiple different clients.
 * The environment associated with a single client is the @ElmerEnv@, which is made
 * available via this monad.
 *
 * <https://en.wikipedia.org/wiki/Elmer_Fudd>
 *
 * (TypeScript: a first-class Elmer action, see the module header.)
 */
export type Elmer<A> = (env: ElmerEnv) => A | Promise<A>;

export async function runElmer<A>(env: ElmerEnv, action: Elmer<A>): Promise<A> {
  return await action(env);
}

/** Similar to "forkIO", but for @Elmer@. */
export function forkElmer(env: ElmerEnv, act: Elmer<void>): void {
  const s = env;
  forkIO(() => runElmer(s, act));
}

export function elmerLog(env: ElmerEnv, pri: Priority, msg: string): void {
  const loc = callStackOf("elmerLog", 2);
  const logQ = env.elmerLogQ;
  atomicallySync(() => writeTQueue(logQ, LogItem(pri, loc, msg)));
}

/** (STM.) */
export function elmerLogSTM(s: ElmerEnv, pri: Priority, msg: string): void {
  writeTQueue(s.elmerLogQ, LogItem(pri, emptyCallStack, msg));
}

export function elmerLogIO(s: ElmerEnv, pri: Priority, msg: string): void {
  atomicallySync(() => elmerLogSTM(s, pri, msg));
}

/**
 * Run an Elmer action 'forever' in a separate thread. If the action throws an exception
 * then the exception is logged (currently just to stderr). If the exception was an 'ErrorCall' or
 * an 'ElmerException' then the action is restarted after waiting for 1 second.
 *
 * Each daemon is tied to a webit. When the webit is finalised the daemon will be killed.
 *
 * (TypeScript: JavaScript run-time errors count as `ErrorCall`.)
 */
export function elmerDaemon<W>(cls: WebitClass<W>, env: ElmerEnv, owner: W, action: Elmer<void>): void {
  const s = env;
  const sec = 1000000; // 1 second in microseconds.
  const hError = async (e: Error): Promise<void> => {
    const loc = (e.stack ?? "").split("\n").find((l) => /:\d+:\d+\)?\s*$/.test(l))?.trim() ?? "";
    atomicallySync(() => writeTQueue(s.elmerLogQ, LogItem("ERROR", emptyCallStack, loc + ": " + e.message)));
    await threadDelay(sec);
  };
  const hElmer = async (e: ElmerExceptionError): Promise<void> => {
    elmerLogIO(s, "ERROR", show_ElmerException(e.exception));
    await threadDelay(sec);
  };
  const reportExit = (e: unknown): never => {
    elmerLogIO(s, "INFO", "Daemon thread exited: " + showException(e));
    throw e;
  };
  const thread = forkIO(async () => {
    try {
      await forever(async () => {
        try {
          await runElmer(s, action);
        } catch (e) {
          if (e instanceof ElmerExceptionError) await hElmer(e);
          else if (isErrorCall(e)) await hError(e);
          else throw e;
        }
      });
    } catch (e) {
      reportExit(e);
    }
  });
  labelThread(thread, cls.webitId(owner));
  cls.webitAddFinaliser(env, owner, () => killThread(thread));
  // Kill the thread once the owner is finalised.
}

/** Load a classic script into the page, resolving when it has run (or failed to load). */
function loadScript(src: string, timeoutMs = 15000): Promise<void> {
  return new Promise<void>((resolve) => {
    const s = document.createElement("script");
    let finished = false;
    const done = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!ok) console.warn("elmerScotty: could not load " + src);
      resolve();
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    s.onload = () => done(true);
    s.onerror = () => done(false);
    s.src = src;
    s.async = false;
    document.head.appendChild(s);
  });
}

/** Add a stylesheet link to the page. */
function loadStylesheet(href: string): void {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

/**
 * Put rendered @head@ markup into the page: a nested @head@ is unwrapped, @title@ sets the
 * document title, scripts are loaded and run in order, and other elements are appended to the
 * page's @head@.
 */
async function injectHead(html: string): Promise<void> {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const place = async (nodes: readonly Node[]): Promise<void> => {
    for (const n of nodes) {
      if (!(n instanceof Element)) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === "head") await place([...n.childNodes]);
      else if (tag === "title") document.title = n.textContent ?? "";
      else if (tag === "script") {
        const src = n.getAttribute("src");
        if (src !== null) await loadScript(src);
        else {
          const s = document.createElement("script");
          s.textContent = n.textContent;
          document.head.appendChild(s);
        }
      } else document.head.appendChild(document.importNode(n, true));
    }
  };
  await place([...tpl.content.childNodes]);
}

/**
 * Serve the static files. The application may serve several
 * 'elmerScotty' instances, but it should have exactly one @elmerStatic@.
 *
 * The files served are:
 *
 *    * The FavIcon.
 *
 *    * The icons specified in the argument, under the @/icon@ folder.
 *
 *    * Project data files (using 'getDataFileName') under the @/assets@ folder. The content type
 *      is set using the file suffix for Text, JavaScript, CSS, HTML, PDF, PNG, SVG and JPEG files.
 *
 * Web: there is no server. The icons are registered for `iconUrl` and the favicon is set (see
 * `scottyIcons`); the data files are bundled by Vite and found with `getDataFileName("webits", ...)`.
 */
export function elmerStatic(iconGroups: readonly IconGroup[]): void {
  scottyIcons(iconGroups);
}

/** Scotty's `RoutePattern`: the path of a page. */
export type RoutePattern = string;

/**
 * Run an Elmer action as a Scotty web page, and then wait for events. Events are routed to
 * the Webits that trigger them.
 *
 * Typically the return value will be a "TVar", "TChan" or similar STM communication primitive.
 *
 * Web: the page is this page. `elmerScotty` does what loading the original page did: it puts
 * @htmlHead@ and the client libraries (jQuery, jQuery UI and its theme, Fancytree from its CDN,
 * AppendGrid, @JS/arrowDialog.js@) and the standard stylesheet into the document head, creates
 * the @main@ @div@ in `container` (default `document.body`), installs the client side of the
 * JavaScript bridge with `jsb.debug` on, and then runs `action` against a fresh `ElmerEnv`. The
 * `route` is not used: a single page application has one page. AppendGrid is loaded from the
 * bundled UMD build @JS/AppendGrid.js@ as a global, because the module build @AppendGrid-dev.js@
 * that the original imported into its page script cannot be served unbundled.
 */
export async function elmerScotty(
  /** The name of the page that will load this application. */
  route: RoutePattern,
  /** HTML to go in the @<head>@ tag of the page. */
  htmlHead: Html,
  /** Icons required by the GUI. */
  iconData: readonly IconGroup[],
  /** The initial configuration of the GUI. */
  action: Elmer<void>,
  /** Web: the DOM element that the page body is mounted into. */
  container: HTMLElement = document.body,
): Promise<void> {
  void route;
  const mainName = "main";
  const app = async (eng: Engine): Promise<void> => {
    const env = await makeElmerEnv(mainName, iconData, eng);
    await runElmer(env, action);
  };
  // baseServer: the page.
  await injectHead(H.renderHtml(htmlHead));
  // Import bundled Fancytree core, jQuery and associated CSS.
  loadStylesheet("https://cdn.jsdelivr.net/npm/jquery.fancytree@2.38/dist/skin-win8/ui.fancytree.min.css");
  await import("@/banana-ui/webits/JQuery/jquery-ui.min.css");
  await loadScript(getDataFileName("webits", "JQuery/external/jquery/jquery.js"));
  await loadScript(getDataFileName("webits", "JQuery/jquery-ui.min.js"));
  await loadScript("https://cdn.jsdelivr.net/npm/jquery.fancytree@2.38/dist/jquery.fancytree-all.min.js");
  // H.script ! HA.type_ "module" ! HA.src "/assets/JS/AppendGrid-dev.js" $ ""
  await loadScript(getDataFileName("webits", "JS/AppendGrid.js"));
  await loadScript(getDataFileName("webits", "JS/arrowDialog.js"));
  await injectHead(H.renderHtml(standardHeader));
  // The page script: window.jsb = {ws: ...}; jsb.debug=true;
  (globalThis as unknown as { jsb: { debug: boolean } }).jsb = { debug: true };
  const main = document.createElement("div");
  main.id = mainName;
  container.appendChild(main);
  // middleware $ start app
  await start(app);
}

/** Get the next ID. */
export function newWebitId(env: ElmerEnv): WebitId {
  const tv = env.elmerIds;
  return atomicallySync(() =>
    stateTVar(tv, (it): [WebitId, Iterator<WebitId>] => {
      const r = it.next();
      if (r.done) throw new ElmerExceptionError(ElmerExhaustedIds); // Can't happen.
      return [r.value, it];
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Webits

/** Things that can appear inside WebitContainers. */
export interface WebitClass<A> {
  /** The remote representation of this Webit in the browser. */
  webitHandle(a: A): RemoteValue<Html>;
  /** The unique ID of this Webit. */
  webitId(a: A): WebitId;
  /** The current parent (if any) of this Webit. */
  webitParent(a: A): TVar<Maybe<WebitContainer>>;
  /** The children (if any) of this Webit. (STM.) */
  webitChildren(a: A): readonly WebitItem[];
  /** Run any finalisers. (Elmer.) */
  webitFinalise(env: ElmerEnv, a: A): Promise<void>;
  /** Add an extra action to be run on deletion of this Webit. (Elmer.) */
  webitAddFinaliser(env: ElmerEnv, a: A, act: Elmer<void>): void;
}

/** Webits and containers stored in a single supertype. (`forall w . WebitClass w => WebitItem w`) */
export interface WebitItem {
  readonly _cls: WebitClass<any>;
  readonly _0: any;
}
export function WebitItem<W>(cls: WebitClass<W>, w: W): WebitItem {
  return { _cls: cls, _0: w };
}

export const WebitClass_WebitItem: WebitClass<WebitItem> = {
  webitHandle: (w) => w._cls.webitHandle(w._0),
  webitId: (w) => w._cls.webitId(w._0),
  webitParent: (w) => w._cls.webitParent(w._0),
  webitChildren: (w) => w._cls.webitChildren(w._0),
  webitFinalise: (env, w) => w._cls.webitFinalise(env, w._0),
  webitAddFinaliser: (env, w, act) => w._cls.webitAddFinaliser(env, w._0, act),
};

/** The tree of Webits currently below the argument. (STM.) */
export function webitTree(w: WebitItem): Tr.Tree<WebitItem> {
  return inTx(() => {
    const cs = WebitClass_WebitItem.webitChildren(w).map(webitTree);
    return Tr.Node(w, cs);
  });
}

/** `f >> act` for finalisers. */
function andThen(f: Elmer<void>, act: Elmer<void>): Elmer<void> {
  return async (env) => {
    await f(env);
    await act(env);
  };
}

/**
 * A container in the remote DOM into which Webits can be inserted. The @Eq@ instance only
 * compares IDs.
 */
export interface WebitContainer {
  readonly webitContainerHandle: RemoteValue<Html>;
  readonly webitContainerId: WebitId;
  readonly webitContainerParent: TVar<Maybe<WebitContainer>>;
  readonly webitContainerChildren: TVar<readonly WebitItem[]>;
  readonly webitContainerFinal: IORef<Elmer<void>>;
}
export function WebitContainer(
  webitContainerHandle: RemoteValue<Html>,
  webitContainerId: WebitId,
  webitContainerParent: TVar<Maybe<WebitContainer>>,
  webitContainerChildren: TVar<readonly WebitItem[]>,
  webitContainerFinal: IORef<Elmer<void>>,
): WebitContainer {
  return { webitContainerHandle, webitContainerId, webitContainerParent, webitContainerChildren, webitContainerFinal };
}

export const WebitClass_WebitContainer: WebitClass<WebitContainer> = {
  webitHandle: (c) => c.webitContainerHandle,
  webitId: (c) => c.webitContainerId,
  webitParent: (c) => c.webitContainerParent,
  webitChildren: (c) => readTVar(c.webitContainerChildren),
  webitFinalise: async (env, c) => {
    await readIORef(c.webitContainerFinal)(env);
  },
  webitAddFinaliser: (_env, w, act) => modifyIORef(w.webitContainerFinal, (f) => andThen(f, act)),
};

/** Create a new container for Webits. The container is initially empty and has no parents. */
export function makeWebitContainer(
  env: ElmerEnv,
  /** CSS class name for @div@ */
  className: string,
): WebitContainer {
  const eng = env.elmerEngine;
  const uuid = newWebitId(env);
  const final = newIORef<Elmer<void>>(() => {});
  const parent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  const childs = newTVarIO<readonly WebitItem[]>([]);
  const rv = send(eng, (f) => {
    const rv1 = constructor<Html>(call("document.createElement", [value("div")]))(f);
    command(var_(rv1) + "." + call("setAttribute", [value("id"), value(U.toText(uuid))]))(f);
    command(var_(rv1) + "." + call("setAttribute", [value("class"), value(className)]))(f);
    return rv1;
  });
  return WebitContainer(rv, uuid, parent, childs, final);
}

/**
 * Create a new container with arbitrary HTML. The container is initially empty and has no
 * parents.
 */
export function makeWebitContainer1(
  env: ElmerEnv,
  /** HTML tag. */
  tagName: string,
  /** Attributes and values. @id@ will be ignored. */
  attrs: readonly (readonly [string, string])[],
): WebitContainer {
  const eng = env.elmerEngine;
  const uuid = newWebitId(env);
  const final = newIORef<Elmer<void>>(() => {});
  const parent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  const childs = newTVarIO<readonly WebitItem[]>([]);
  const rv = send(eng, (f) => {
    const rv1 = constructor<Html>(call("document.createElement", [value(tagName)]))(f);
    for (const [attr, val] of attrs) {
      command(var_(rv1) + "." + call("setAttribute", [value(attr), value(val)]))(f);
    }
    command(var_(rv1) + "." + call("setAttribute", [value("id"), value(U.toText(uuid))]))(f);
    return rv1;
  });
  return WebitContainer(rv, uuid, parent, childs, final);
}

/**
 * Add a new channel for the Webbit to send events through. Events which do not
 * match the @TVChan@ are silently ignored. Multiple channels can receive each event.
 */
export function addWebitChannel<A, W>(fromJ: J.FromJSON<A>, cls: WebitClass<W>, env: ElmerEnv, w: W): TChan<A> {
  return addWebitChannelWith(cls, env, (v) => fromJ.parseJSON(v), w);
}

/** Add a new channel for the Webbit, where the output type does not have a 'FromJSON' instance. */
export function addWebitChannelWith<A, W>(cls: WebitClass<W>, env: ElmerEnv, p: J.Parser<A>, c: W): TChan<A> {
  const s = env;
  const events = newBroadcastTChanIO<A>();
  const eventAction = (x: J.Value): boolean => {
    const r = J.parseEither(p, x);
    if (r.tag === "Right") {
      writeTChan(events, r.value);
      return true;
    }
    return false;
  };
  return atomicallySync(() => {
    modifyTVar(s.elmerRoutes, (m) => M.insertWith((n, o) => [...n, ...o], cls.webitId(c), [eventAction], m));
    return dupTChan(events);
  });
}

/** Return any pending items on the channel. Never retries. (STM.) */
export function flushTChan<A>(c: TChan<A>): A[] {
  return inTx(() => {
    const r: A[] = [];
    for (;;) {
      const x = tryReadTChan(c);
      if (x.tag === "Nothing") return r;
      r.push(x.value);
    }
  });
}

/** A GUI element constructed from static HTML. */
export interface WebStatic {
  readonly webStaticHandle: RemoteValue<Html>;
  readonly webStaticId: WebitId;
  readonly webStaticParent: TVar<Maybe<WebitContainer>>;
  readonly webStaticFinal: IORef<Elmer<void>>;
}
export function WebStatic(
  webStaticHandle: RemoteValue<Html>,
  webStaticId: WebitId,
  webStaticParent: TVar<Maybe<WebitContainer>>,
  webStaticFinal: IORef<Elmer<void>>,
): WebStatic {
  return { webStaticHandle, webStaticId, webStaticParent, webStaticFinal };
}

export const WebitClass_WebStatic: WebitClass<WebStatic> = {
  webitHandle: (w) => w.webStaticHandle,
  webitId: (w) => w.webStaticId,
  webitParent: (w) => w.webStaticParent,
  webitChildren: () => [],
  webitFinalise: async (env, w) => {
    await readIORef(w.webStaticFinal)(env);
  },
  webitAddFinaliser: (_env, w, act) => modifyIORef(w.webStaticFinal, (f) => andThen(f, act)),
};

/** Construct a static fragment of a Webit inside a @div@. */
export function makeWebStatic(env: ElmerEnv, fragment: Html): WebStatic {
  const eng = env.elmerEngine;
  const uuid = newWebitId(env);
  const final = newIORef<Elmer<void>>(() => {});
  const rv = send(eng, (f) => {
    const rv1 = constructor<Html>(call("document.createElement", [value("div")]))(f);
    command(var_(rv1) + "." + call("setAttribute", [value("id"), value(U.toText(uuid))]))(f);
    command(var_(rv1) + ".innerHTML=" + value(H.renderHtml(fragment)))(f);
    return rv1;
  });
  const parent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  return WebStatic(rv, uuid, parent, final);
}

/** A GUI element that can appear in a web page. */
export interface Webit<A> {
  /**
   * The remote representation of this Webit in the browser. Points to a @<div>@ which
   * has the @id@ and the HTML as its contents.
   */
  readonly webitHandle1: RemoteValue<Html>;
  /**
   * Call this to update the Webit with new data. No-op if the new data equals the current.
   * This will not trigger an event on the @webitState@ but will update the behaviour. (STM.)
   */
  readonly webitIn: (a: A) => void;
  /**
   * Client event data from the Webit will appear on this channel. Data from @webitIn@
   * will update the behaviour but not trigger an event.
   */
  readonly webitState: TState<null, A>;
  /** The current input value of this Webit. */
  readonly _webitCurrent: TVar<A>;
  /** The unique ID of this Webit. */
  readonly webitId1: WebitId;
  /** The parent (if any) of this Webit. */
  readonly webitParent1: TVar<Maybe<WebitContainer>>;
  readonly webitFinal: IORef<Elmer<void>>;
}
export function Webit<A>(
  webitHandle1: RemoteValue<Html>,
  webitIn: (a: A) => void,
  webitState: TState<null, A>,
  _webitCurrent: TVar<A>,
  webitId1: WebitId,
  webitParent1: TVar<Maybe<WebitContainer>>,
  webitFinal: IORef<Elmer<void>>,
): Webit<A> {
  return { webitHandle1, webitIn, webitState, _webitCurrent, webitId1, webitParent1, webitFinal };
}

export const WebitClass_Webit: WebitClass<Webit<any>> = {
  webitHandle: (w) => w.webitHandle1,
  webitId: (w) => w.webitId1,
  webitParent: (w) => w.webitParent1,
  webitChildren: () => [],
  webitFinalise: async (env, w) => {
    await readIORef(w.webitFinal)(env);
  },
  webitAddFinaliser: (_env, w, act) => modifyIORef(w.webitFinal, (f) => andThen(f, act)),
};

/**
 * Send the HTML to the engine and prepare to receive inputs and outputs. The HTML will
 * automatically be wrapped in a @<div>@ identified by the @WebitId@.
 *
 * Many webits can just ignore their ID unless there is other JavaScript that is going to refer to
 * them.
 *
 * Events sent from within the HTML must be wrapped in an outer JSON object with the fields @id@ for
 * the @WebitId@ and @value@ for the event data. This allows the event to be routed to the correct
 * TChan. The "webitEvent" function does this automatically.
 */
export function makeWebit<A>(
  codec: J.JSONCodec<A>,
  env: ElmerEnv,
  /** The HTML to display this webit. */
  fragment: (wId: WebitId) => Html,
  /** The remote update action for new values. This must not trigger an output event. */
  inputF: (a: A, rv: RemoteValue<Html>, wId: WebitId) => JavaScript,
  /** The initial value to display. */
  initial: A,
): Webit<A> {
  const s = env;
  const uuid = newWebitId(env);
  const eng = env.elmerEngine;
  const sendJS = env.elmerSendJS;
  const final = newIORef<Elmer<void>>(() => {});
  const currentVal = newTVarIO(initial); // The latest value sent to the Webit.
  const events = newBroadcastTChanIO<[null, A]>(); // Event values sent by the Webit.
  const eventsOut = atomicallySync(() => dupTChan(events));
  const rv = send(eng, constructor<Html>(call("document.createElement", [value("div")])));
  send(eng, (f) => {
    command(var_(rv) + "." + call("setAttribute", [value("id"), value(U.toText(uuid))]))(f);
    const v = H.renderHtml(fragment(uuid));
    command(var_(rv) + ".innerHTML=" + value(v))(f);
    command(inputF(initial, rv, uuid))(f);
    return null;
  });
  const sendAction = (x: A): void =>
    inTx(() => {
      const old = readTVar(currentVal);
      if (!equals(old, x)) {
        writeTVar(currentVal, x);
        sendJS(inputF(x, rv, uuid));
      }
    });
  const eventAction = (x: J.Value): boolean => {
    const r = J.parseEither((v) => codec.parseJSON(v), x);
    if (r.tag === "Right") {
      writeTChan(events, [null, r.value]);
      writeTVar(currentVal, r.value);
      return true;
    }
    return false;
  };
  const tState: TState<null, A> = {
    tStateBehaviour: () => readTVar(currentVal),
    tStateEvent: () => readTChan(eventsOut),
    tStateDup: () => {
      const newEvents = dupTChan(events);
      return {
        tStateBehaviour: tState.tStateBehaviour,
        tStateEvent: () => readTChan(newEvents),
        tStateDup: tState.tStateDup,
      };
    },
  };
  const parent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  atomicallySync(() => modifyTVar(s.elmerRoutes, (m) => M.insert(uuid, [eventAction], m)));
  // uuid is fresh and unique, so we know that elmerRoutes does not contain it.
  return Webit(rv, sendAction, tState, currentVal, uuid, parent, final);
}

/** Display a clickable icon. */
export function iconPic(wId: WebitId, v: IconName): Html {
  return iconHtml("icon-display", v, Just(wId));
}

/** HTML for an icon. */
export function iconHtml(
  /** Stye name. Typically @icon-inline@ or @icon-display@. */
  sty: string,
  /** Icon name to display. */
  nm: IconName,
  /** On click an 'IconClick' will be sent to this Webit. */
  wId: Maybe<WebitId>,
): Html {
  return H.with_(
    H.img(),
    HA.alt(H.textValue(nm)),
    HA.src(H.textValue(iconUrl(nm))),
    HA.onclick(
      jsValue(wId.tag === "Just" ? webitEventData(wId.value, "this.src.substring(this.src.lastIndexOf('/')+1)") : jsNoOp),
    ),
    HA.class_(H.textValue(sty)),
  );
}

/**
 * Display the icon menu and return the icon selected by the user, or @Nothing@ if
 * the user clicks @Cancel@. The argument is the icon initially shown as selected.
 */
export async function getIconChoice(env: ElmerEnv, initial: IconName): Promise<Maybe<IconName>> {
  const [menu, menuClosed] = env.elmerIconMenu;
  atomicallySync(() => {
    flushTChan(menuClosed); // OK click causes multiple events, so flush stale ones.
    menu.webitIn(initial);
  });
  elmerSend(env, "$(" + webitSelector(WebitClass_Webit.webitId(menu)) + ").dialog('open')");
  return atomically(() => {
    const okFlag = readTChan(menuClosed);
    return okFlag ? Just(menu.webitState.tStateBehaviour()) : Nothing;
  });
}

/** Send an event to the Webbit from the remote client. */
export function webitEvent<V>(toJ: J.ToJSON<V>, w: WebitId, v: V): JavaScript {
  return event(JSON_WebitEvent<V>({ toJSON: toJ.toJSON, parseJSON: () => J.fail("webitEvent: no parser") }).toJSON(WebitEvent(w, v)));
}

/** Replace the HTML in the webit. */
export function setWebitHtml(html1: Html, w: RemoteValue<Html>): JavaScript {
  return var_(w) + ".innerHTML=" + value(H.renderHtml(html1));
}

/**
 * Remove a Webit from the remote client and delete any event handlers. Recursively applied
 * to all current children. Using a Webit after deletion is an error.
 */
export async function deleteWebit<A>(cls: WebitClass<A>, env: ElmerEnv, w: A): Promise<void> {
  const e = env;
  await cls.webitFinalise(e, w);
  send(e.elmerEngine, command(var_(cls.webitHandle(w)) + ".remove()"));
  const targets = atomicallySync(() => {
    const targets1 = Tr.flatten(webitTree(WebitItem(cls, w)));
    for (const w1 of targets1) {
      modifyTVar(e.elmerRoutes, (m) => M.delete_(WebitClass_WebitItem.webitId(w1), m));
    }
    return targets1;
  });
  for (const w1 of targets) {
    send(e.elmerEngine, jsDelete(WebitClass_WebitItem.webitHandle(w1)));
    await WebitClass_WebitItem.webitFinalise(e, w1);
  }
}

/**
 * Append a Webit to the container.
 *
 * This does not let the same Webit appear in multiple places. If you add a Webit twice it will
 * disappear from the first location.
 */
export function showWebit<A>(cls: WebitClass<A>, env: ElmerEnv, c: WebitContainer, w: A): void {
  const e = env;
  send(e.elmerEngine, command(var_(WebitClass_WebitContainer.webitHandle(c)) + "." + call("appendChild", [var_(cls.webitHandle(w))])));
  atomicallySync(() => {
    unparent(cls, w);
    modifyTVar(c.webitContainerChildren, (cs) => [...cs, WebitItem(cls, w)]);
    writeTVar(cls.webitParent(w), Just(c));
  });
}

/** Remove a Webit from the remote DOM. */
export function hideWebit<A>(cls: WebitClass<A>, env: ElmerEnv, w: A): void {
  const e = env;
  atomicallySync(() => {
    e.elmerSendJS(var_(cls.webitHandle(w)) + ".remove()");
    unparent(cls, w);
  });
}

/** Set the value of the named attribute of the webit. */
export function setAttribute<A, B>(cls: WebitClass<A>, toJ: J.ToJSON<B>, item: A, attr: string, val: B): JavaScript {
  return call(var_(cls.webitHandle(item)) + ".setAttribute", [value(attr), value(toJ.toJSON(val))]);
}

/** Delete the named attribute from the webit. */
export function deleteAttribute<A>(cls: WebitClass<A>, item: A, attr: string): JavaScript {
  return call(var_(cls.webitHandle(item)) + ".removeAttribute", [value(attr)]) + ";";
}

/**
 * Add a CSS class to a webit. No-op if the webit already has this class. The
 * text must be a legal CSS class name. This is not checked.
 */
export function addClass<A>(cls: WebitClass<A>, item: A, nm: string): JavaScript {
  return call(var_(cls.webitHandle(item)) + ".classList.add", [value(nm)]) + ";";
}

/** Remove a CSS class from a webit. No-op if the webit does not have the class. */
export function removeClass<A>(cls: WebitClass<A>, item: A, nm: string): JavaScript {
  return call(var_(cls.webitHandle(item)) + ".classList.remove", [value(nm)]) + ";";
}

export const jsNoOp: JavaScript = "";

export function htmlValue(h: Html): JavaScript {
  return value(H.renderHtml(h));
}

/** Useful for events in 'Html' values. */
export function jsValue(js: JavaScript): H.AttributeValue {
  return H.lazyTextValue(js);
}

/** Private function to remove a Webit from the STM tree. (STM.) */
function unparent<A>(cls: WebitClass<A>, w: A): void {
  const p = readTVar(cls.webitParent(w));
  if (p.tag === "Just") {
    modifyTVar(p.value.webitContainerChildren, (cs) =>
      L.deleteBy(
        (a: WebitItem, b: WebitItem) => WebitClass_WebitItem.webitId(a) === WebitClass_WebitItem.webitId(b),
        WebitItem(cls, w),
        cs,
      ),
    );
  }
  writeTVar(cls.webitParent(w), Nothing);
}

/** Generates a JQuery selector for the @WebitId@. */
export function webitSelector(wId: WebitId): JavaScript {
  return '"#' + wId + '"';
}

/** Generates a JQuery selector for the WebitId with a suffix. */
export function webitSelector1(wId: WebitId, suf: string): JavaScript {
  return '"#' + wId + suf + '"';
}

/** Assemble a Webit event. The JavaScript argument will be the value sent to the Webit. */
export function webitEventData(wId: WebitId, js: JavaScript): JavaScript {
  return call("jsb.event", ["{d:" + value(wId) + ",v:" + js + "}"]) + ";";
}
