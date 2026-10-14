// Ported from banana-ui/webits/demo-webit/Main.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The @demo-webit@ program: a web server whose front page offers a dialog demo, a matrix
 * (forest table) demo, a right-click menu, a forest editor demo and a clickable image.
 *
 * TypeScript port
 * ---------------
 * * Web: there is no web server. `main` mounts the page into this document (open the app with
 *   @?demo-webit@): `elmerStatic` registers the icons, the program's own Scotty routes
 *   (@\/image.jpg@ and the 404 handler) are registered with the local `get` and `notFound`, and
 *   `elmerScotty` loads the client libraries and runs `choicePage` on the in-page JavaScript
 *   engine (porting-notes/w1.md). The port number is not used; the URL printed at start-up is the
 *   page's own.
 * * Web: the icon directories of the original (@\/usr\/share\/icons\/Adwaita\/scalable@ and
 *   @48x48@) are replaced by the Adwaita icons bundled with the toolkit (`/src/lib/GI/Gtk/icons`,
 *   one group \"Adwaita\"); no 48x48 Adwaita icons are bundled.
 * * An @Elmer@ action takes the `ElmerEnv` first; actions that block or never return
 *   (`choicePage`, the matrix demo) are async. `putStrLn` writes to the browser console and
 *   `traceM` uses `console.debug`.
 * * QuickCheck's `generate` comes from `@/lib/Test/QuickCheck`.
 * * The Haskell module exports only `main`; the other definitions are exported here for tests.
 */
import * as J from "@/lib/Data/Aeson";
import * as T from "@/lib/Data/Text";
import * as QC from "@/lib/Test/QuickCheck";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { drawForest, fmapTree, type Forest } from "@/lib/Data/Tree";
import { set, view } from "@/lib/Control/Lens";
import { showBool, showInt } from "@/lib/Prelude";
import { atomically, atomicallySync, dupTChan, newTChanIO, orElse, readTChan, writeTChan } from "@/lib/Control/Concurrent/STM";
import { forever } from "@/lib/Control/Concurrent";
import { getDataFileName } from "@/lib/System/Paths";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { newTStateIO, pure_TState, type TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import {
  deleteWebit,
  elmerDaemon,
  elmerLog,
  elmerScotty,
  elmerStatic,
  elmerStaticUrl,
  jsNoOp,
  jsValue,
  logToStderr,
  makeWebit,
  makeWebitContainer,
  showWebit,
  webitEvent,
  WebitClass_Webit,
  WebitClass_WebitContainer,
  WebitClass_WebitItem,
  type Elmer,
  type ElmerEnv,
  type Webit,
} from "@/banana-ui/webits/src/Network/Webits";
import { mkWebitPopupSelect, renderGadget } from "@/banana-ui/webits/src/Network/Webits/ArrowDialog";
import { getIconData, mergeIconGroups } from "@/banana-ui/webits/src/Network/Webits/Icons";
import {
  Dialog,
  OkApplyButton,
  TreeAddAfter,
  TreeAddBefore,
  TreeAddIn,
  TreeDelete,
  constantDialog,
  forestEditor,
  image,
  type Dialog_,
  type TreeOper,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { GadgetData } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { demoDialog } from "./Dialog";
import { arbitraryMatrix, demoMatrixAction, type MatrixItems, type Model } from "./Matrix";
import { demoMenuButton } from "./Menu";
import { Arbitrary_DemoData, demoBool, demoDefault, demoForest, demoText, prettyDemo, type DemoData } from "./Types";

/** The environment of the demo dialogs: the forest offered by the tree selector. */
type DemoForest = Forest<readonly [T.Text, Maybe<T.Text>, Maybe<number>]>;


// ---------------------------------------------------------------------------------------------
// Web: the program's own Scotty routes.

/** Web: the routes registered with `get`: path → handler giving the URL of the response. */
const scottyRoutes = new Map<string, () => string>();

/** Web: the handler registered with `notFound`, given a description of the request. */
let scottyNotFound: (rq: string) => void = () => {};

/** Web: Scotty's `get` for this program's routes. The handler returns the URL of the file to send. */
function get(path: string, action: () => string): void {
  scottyRoutes.set(path, action);
}

/** Web: Scotty's `notFound`. */
function notFound(action: (rq: string) => void): void {
  scottyNotFound = action;
}

/**
 * Web: what the browser gets for a URL used in the page, which the original served at @/@:
 * a route of this program (`get`) gives the URL of the file its handler sends, the static
 * routes of `elmerStatic` are resolved by `elmerStaticUrl`, and anything else is reported to the
 * `notFound` handler (and fails to load).
 */
export function scottyUrl(url: string): string {
  const path = "/" + url.replace(/^(\.\/|\/)/, "");
  const route = scottyRoutes.get(path);
  if (route !== undefined) return route();
  const u = elmerStaticUrl(url);
  if (u === url) scottyNotFound("Request {requestMethod = \"GET\", rawPathInfo = " + T.showText(path) + "}");
  return u;
}


// ---------------------------------------------------------------------------------------------

/** Run a test web server */
export async function main(): Promise<void> {
  // Web: the page's own URL instead of "http://localhost:3000/".
  console.log(typeof location !== "undefined" ? location.href : "http://localhost:3000/");
  // Web: the bundled Adwaita icons stand in for /usr/share/icons/Adwaita/scalable; no 48x48
  // Adwaita icons are bundled (/usr/share/icons/Adwaita/48x48).
  const icons1 = getIconData("/src/lib/GI/Gtk/icons");
  const icons2: ReturnType<typeof getIconData> = [];
  const [initialModel, matrixKeys] = QC.generate(arbitraryMatrix(10));
  const [modelState, modelWriter] = newTStateIO<boolean, Model>(initialModel);
  const icons = mergeIconGroups([...icons1, ...icons2]);
  // scotty 3000 $ do
  //   elmerStatic icons
  //   elmerScotty "/" appHeader icons $ choicePage modelState modelWriter matrixKeys
  //   get "/image.jpg" $ do ...
  //   notFound $ do ...
  // Web: the routes are registered before the page is mounted (elmerScotty runs the page at once
  // and only returns when choicePage does).
  elmerStatic(icons);
  get("/image.jpg", () => {
    const fn = getDataFileName("webits", "Testcard_F.jpg");
    console.log("GET image: fn = " + fn);
    // setHeader "Content-Type" "image/jpeg"; file fn
    return fn;
  });
  notFound((rq) => {
    console.log("Scotty 404: " + rq);
    // status $ mkStatus 404 "Scotty can't find that."
  });
  await elmerScotty("/", appHeader, icons, (env) => choicePage(env, modelState, modelWriter, matrixKeys));
}


export const appHeader: H.Html = H.head(
  H.title("Demo Webits"),
  H.with_(H.link(), HA.rel("shortcut icon"), HA.type_("image/x-icon"), HA.href("/favicon.ico")),
);


/** (Elmer. Returns only after a button other than \"Matrix Demo\" was clicked, and then never.) */
export async function choicePage(
  env: ElmerEnv,
  modelState: TState<boolean, Model>,
  modelWriter: (b: boolean, m: Model) => void,
  matrix: MatrixItems,
): Promise<void> {
  logToStderr(env);
  const top = env.elmerTop;
  const btnBox = makeWebitContainer(env, "");
  const dialogBtn = choiceButton(env, "Dialog Demo");
  showWebit(WebitClass_Webit, env, btnBox, dialogBtn);
  const matrixBtn = choiceButton(env, "Matrix Demo");
  showWebit(WebitClass_Webit, env, btnBox, matrixBtn);
  const menuBtn = demoMenuButton(env); // Has its own event handler; not needed below.
  showWebit(WebitClass_WebitItem, env, btnBox, menuBtn);
  const forestBtn = choiceButton(env, "Forest Editor Demo");
  showWebit(WebitClass_Webit, env, btnBox, forestBtn);
  const imageBtn = choiceButton(env, "Clickable Image Demo");
  showWebit(WebitClass_Webit, env, btnBox, imageBtn);
  showWebit(WebitClass_WebitContainer, env, top, btnBox);
  // Set up dialog popup demo.
  const dialogTrigger = newTChanIO<readonly [null, DemoData]>();
  const demoDialogOut = mkWebitPopupSelect(
    env,
    pure_TState<boolean, DemoForest>(demoForest),
    constantDialog(demoDialog),
    () => readTChan(dialogTrigger),
  );
  const d1 = atomicallySync(() => dupTChan(demoDialogOut));
  // Set up forest editing popup demo.
  const forestTrigger = newTChanIO<readonly [null, Forest<DemoData>]>();
  const demoForestData: Forest<DemoData> = QC.generate(QC.resize(5, QC.Arbitrary_Forest(Arbitrary_DemoData).arbitrary));
  const demoForestOut = mkWebitPopupSelect(
    env,
    pure_TState<boolean, DemoForest>(demoForest),
    constantDialog(demoForestEditor),
    () => readTChan(forestTrigger),
  );
  const f1 = atomicallySync(() => dupTChan(demoForestOut));
  // Respond to buttons
  // join $ liftIO $ atomically $ (...) `orElse` (...) `orElse` (...) `orElse` (...)
  const next = await atomically((): Elmer<void> =>
    orElse(
      () =>
        orElse(
          () =>
            orElse(
              () => {
                const [, txt] = dialogBtn.webitState.tStateEvent();
                console.debug("Dialog button clicked: " + T.showText(txt)); // traceM
                writeTChan(dialogTrigger, [null, demoDefault]);
                return (env1) => deleteWebit(WebitClass_WebitContainer, env1, btnBox);
              },
              () => {
                const [, txt] = matrixBtn.webitState.tStateEvent();
                console.debug("Matrix button clicked: " + T.showText(txt)); // traceM
                return async (env1) => {
                  await deleteWebit(WebitClass_WebitContainer, env1, btnBox);
                  await demoMatrixAction(env1, modelState, modelWriter, matrix);
                };
              },
            ),
          () => {
            const [, txt] = forestBtn.webitState.tStateEvent();
            console.debug("Forest button clicked: " + T.showText(txt)); // traceM
            writeTChan(forestTrigger, [null, demoForestData]);
            return (env1) => deleteWebit(WebitClass_WebitContainer, env1, btnBox);
          },
        ),
      () => {
        const [, txt] = imageBtn.webitState.tStateEvent();
        console.debug("Got click on " + T.showText(txt)); // traceM
        return (env1) => demoImageAction(env1);
      },
    ),
  );
  await next(env);
  elmerDaemon(WebitClass_WebitContainer, env, top, async (env1) => {
    const [, r] = await atomically(() => readTChan(d1));
    elmerLog(env1, "NOTICE", "Dialog output = " + (r.tag === "Just" ? prettyDemo(r.value) : "Nothing"));
  });
  await forever(async () => {
    const [, r] = await atomically(() => readTChan(f1));
    const tr: Maybe<string> =
      r.tag === "Just" ? Just(drawForest(r.value.map((t) => fmapTree((d: DemoData) => T.unpack(view(demoText, d)), t)))) : Nothing;
    elmerLog(env, "NOTICE", "Forest edit output = \n" + T.pack(fromMaybe("Nothing", tr)));
  });
}


/** (Elmer.) */
export function choiceButton(
  env: ElmerEnv,
  /** Text to display. */
  display: T.Text,
): Webit<T.Text> {
  const buttonContents = (wId: string): H.Html =>
    H.with_(
      H.button(H.text(display)),
      HA.type_("button"),
      HA.onclick(jsValue(webitEvent(J.textJ, wId, display))),
    );
  return makeWebit(J.textJ, env, buttonContents, () => jsNoOp, display);
}


export const demoForestEditor: Dialog_<DemoForest, any, Forest<DemoData>> = (() => {
  // Faithful: the label is "<text> (Y" or "<text> (N)": the "else" branch takes the ")".
  const demoLabel = (_e: DemoForest, x: DemoData): T.Text => view(demoText, x) + " (" + (view(demoBool, x) ? "Y" : "N" + ")");
  const demoMenus = (m: Maybe<DemoData>): Menu<TreeOper<DemoData>> => {
    if (m.tag === "Nothing") {
      return Menu([[
        menuItem("Add leaf", TreeAddIn(demoDefault)),
        menuItem("Add node", TreeAddIn(set(demoBool, true, demoDefault))),
      ]]);
    }
    const x = m.value;
    return view(demoBool, x)
      ? Menu([
          [
            menuItem("Add leaf", TreeAddIn(demoDefault)),
            menuItem("Add node", TreeAddIn(set(demoBool, true, demoDefault))),
          ],
          [
            menuItem("New node before", TreeAddBefore(set(demoBool, true, demoDefault))),
            menuItem("New node after", TreeAddAfter(set(demoBool, true, demoDefault))),
          ],
          [menuItem<TreeOper<DemoData>>("Delete", TreeDelete)],
        ])
      : Menu([
          [
            menuItem("New node before", TreeAddBefore(set(demoBool, true, demoDefault))),
            menuItem("New node after", TreeAddAfter(set(demoBool, true, demoDefault))),
          ],
          [menuItem<TreeOper<DemoData>>("Delete", TreeDelete)],
        ]);
  };
  return Dialog(
    "Demo Dialog",
    OkApplyButton,
    forestEditor(demoLabel, demoMenus, (x: DemoData) => view(demoBool, x), Just(constantDialog(demoDialog))),
  );
})();


/** (Elmer.) */
export function demoImageAction(env: ElmerEnv): void {
  console.log("Got Image Demo click."); // putStrLn
  const top = env.elmerTop;
  // Web: "image.jpg" is resolved through this program's routes (the original page was at "/").
  const gOut = renderGadget(
    env,
    pure_TState<boolean, null>(null),
    pure_TState<boolean, GadgetData<[number, number]>>(GadgetData(true, [0, 0])),
    image(scottyUrl("image.jpg")),
  );
  for (const w of gOut.gadgetView) showWebit(WebitClass_WebitItem, env, top, w);
  if (gOut.gadgetView.length === 0) throw new Error("Prelude.head: empty list");
  elmerDaemon(WebitClass_WebitItem, env, gOut.gadgetView[0], async () => {
    const click = await atomically(() => gOut.gadgetOutput.tStateEvent());
    console.log("Image clicked at " + showClick(click)); // putStrLn
  });
}

/** `show :: (Bool, GadgetData (Int, Int)) -> String` (derived instances). */
function showClick([b, gd]: readonly [boolean, GadgetData<[number, number]>]): string {
  const [x, y] = gd._gdValue;
  return "(" + showBool(b) + ",GadgetData {_gdOk = " + showBool(gd._gdOk) + ", _gdValue = (" + showInt(x) + "," + showInt(y) + ")})";
}
