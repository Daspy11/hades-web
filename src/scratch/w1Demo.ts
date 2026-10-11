/**
 * Scratch demo of the webits core on the in-page loopback engine (open the app with `?demo=w1`).
 *
 * Modelled on the front page of the original `demo-webit` (its `choiceButton`, `demoMenu` and
 * `demoMenuButton` are reproduced here), without the ArrowDialog parts:
 *
 *  * a counter webit updated from the "server" side with `webitIn` when a button is clicked;
 *  * the demo's right-click popup menu (jQuery UI menu, with a sub-menu);
 *  * a button opening the global icon menu (`getIconChoice`) and showing the chosen icon;
 *  * two buttons merged with `unionTStates`, and a button box removed with `deleteWebit`;
 *  * a status line showing the last message logged with `elmerLog`.
 */
import * as J from "@/lib/Data/Aeson";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { atomically, atomicallySync, readTChan } from "@/lib/Control/Concurrent/STM";
import { Nothing } from "@/lib/Data/Maybe";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { mapTState1, unionTStates } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import {
  deleteWebit,
  elmerDaemon,
  elmerLog,
  elmerScotty,
  elmerStatic,
  getIconChoice,
  iconHtml,
  jsNoOp,
  jsValue,
  logToStderr,
  makeWebit,
  makeWebitContainer,
  makeWebStatic,
  setWebitHtml,
  showWebit,
  webitEvent,
  WebitClass_Webit,
  WebitClass_WebitContainer,
  WebitClass_WebitItem,
  WebitClass_WebStatic,
  WebitItem,
  type ElmerEnv,
  type Webit,
} from "@/banana-ui/webits/src/Network/Webits";
import { mkWebitMenu, popupMenuOn, WebitClass_WebitMenu } from "@/banana-ui/webits/src/Network/Webits/Menu";
import { getIconData, mergeIconGroups } from "@/banana-ui/webits/src/Network/Webits/Icons";

/** demo-webit `Menu.demoMenu`. */
const demoMenu: Menu<number> = Menu([
  [
    menuItem("Ten", 10),
    subMenu(
      "Tens",
      Menu([[menuItem("Eleven", 11), menuItem("Twelve", 12), menuItem("Thirteen", 13), menuItem("Fourteen", 14)]]),
    ),
    menuItem("Twenty", 20),
  ],
  [menuItem("Thirty", 30), menuItem("Fourty", 40)],
]);

/** demo-webit `Menu.demoMenuButton` (logs with `elmerLog` instead of `putStrLn`). */
function demoMenuButton(env: ElmerEnv): WebitItem {
  const menu = mkWebitMenu(env, demoMenu);
  elmerDaemon(WebitClass_WebitMenu, env, menu, async (env1) => {
    const v = await atomically(() => readTChan(menu.webitMenuOutput));
    elmerLog(env1, "NOTICE", "Menu option " + String(v) + " clicked.");
  });
  const buttonContents = () => H.with_(H.button("Right-click Menu"), HA.type_("button"));
  const btn = makeWebit(J.textJ, env, buttonContents, () => jsNoOp, "Menu");
  popupMenuOn(WebitClass_Webit, env, btn, "OnRightClick", menu);
  return WebitItem(WebitClass_Webit, btn);
}

/** demo-webit `Main.choiceButton`. */
function choiceButton(
  env: ElmerEnv,
  /** Text to display. */
  display: string,
): Webit<string> {
  const buttonContents = (wId: string) =>
    H.with_(H.button(H.text(display)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.textJ, wId, display))));
  return makeWebit(J.textJ, env, buttonContents, () => jsNoOp, display);
}

/** A webit displaying text, updated with `webitIn`. */
function textDisplay(env: ElmerEnv, cls: string, initial: string): Webit<string> {
  return makeWebit(J.textJ, env, () => H.with_(H.span(initial), HA.class_(cls)), (t, rv) => setWebitHtml(H.with_(H.span(t), HA.class_(cls)), rv), initial);
}

async function demoPage(env: ElmerEnv): Promise<void> {
  logToStderr(env);
  const top = env.elmerTop;
  const heading = makeWebStatic(
    env,
    H.mconcat_Html([H.h2("Webits on the loopback engine"), H.p("The controls are webits; their behaviour runs in Elmer daemons in this page.")]),
  );
  showWebit(WebitClass_WebStatic, env, top, heading);

  // Status line: the last log message.
  const status = textDisplay(env, "demo-status", "Status: nothing has happened yet.");
  const logLine = (env1: ElmerEnv, msg: string): void => {
    elmerLog(env1, "NOTICE", msg);
    atomicallySync(() => status.webitIn("Status: " + msg));
  };

  // Counter: the server side updates it with webitIn.
  const row1 = makeWebitContainer(env, "demo-row");
  const clickBtn = choiceButton(env, "Click me");
  const counter = textDisplay(env, "demo-counter", "Clicks: 0");
  showWebit(WebitClass_Webit, env, row1, clickBtn);
  showWebit(WebitClass_Webit, env, row1, counter);
  showWebit(WebitClass_WebitContainer, env, top, row1);
  let clicks = 0;
  elmerDaemon(WebitClass_Webit, env, clickBtn, async (env1) => {
    await atomically(() => clickBtn.webitState.tStateEvent());
    clicks++;
    atomicallySync(() => counter.webitIn("Clicks: " + String(clicks)));
    logLine(env1, "Button clicked " + String(clicks) + " times.");
  });

  // The demo's popup menu.
  const row2 = makeWebitContainer(env, "demo-row");
  const menuBtn = demoMenuButton(env);
  showWebit(WebitClass_WebitItem, env, row2, menuBtn);
  showWebit(WebitClass_WebitContainer, env, top, row2);

  // The global icon menu.
  const row3 = makeWebitContainer(env, "demo-row");
  const iconBtn = choiceButton(env, "Choose icon");
  const iconShow = makeWebit(
    J.textJ,
    env,
    () => H.span("(no icon)"),
    (nm, rv) => setWebitHtml(nm === "" ? H.span("(no icon)") : H.span(iconHtml("icon-inline", nm, Nothing), " " + nm), rv),
    "",
  );
  showWebit(WebitClass_Webit, env, row3, iconBtn);
  showWebit(WebitClass_Webit, env, row3, iconShow);
  showWebit(WebitClass_WebitContainer, env, top, row3);
  elmerDaemon(WebitClass_Webit, env, iconBtn, async (env1) => {
    await atomically(() => iconBtn.webitState.tStateEvent());
    const current = atomicallySync(() => iconShow.webitState.tStateBehaviour());
    const r = await getIconChoice(env1, current);
    if (r.tag === "Just") atomicallySync(() => iconShow.webitIn(r.value));
    logLine(env1, r.tag === "Just" ? "Icon chosen: " + r.value : "Icon menu cancelled.");
  });

  // Two buttons merged with unionTStates, in a box that can be deleted.
  const btnBox = makeWebitContainer(env, "demo-row");
  const left = choiceButton(env, "Left");
  const right = choiceButton(env, "Right");
  const deleteBtn = choiceButton(env, "Delete this row");
  for (const b of [left, right, deleteBtn]) showWebit(WebitClass_Webit, env, btnBox, b);
  showWebit(WebitClass_WebitContainer, env, top, btnBox);
  // The event tag says which button fired; the value is the button's label.
  const sides = unionTStates("", [
    mapTState1(() => "L", left.webitState),
    mapTState1(() => "R", right.webitState),
  ]);
  elmerDaemon(WebitClass_WebitContainer, env, btnBox, async (env1) => {
    const [side, label] = await atomically(() => sides.tStateEvent());
    logLine(env1, "Union of Left and Right: event " + side + " (" + label + ")");
  });
  elmerDaemon(WebitClass_Webit, env, deleteBtn, async (env1) => {
    await atomically(() => deleteBtn.webitState.tStateEvent());
    logLine(env1, "Deleted the Left/Right row.");
    await deleteWebit(WebitClass_WebitContainer, env1, btnBox);
  });

  showWebit(WebitClass_Webit, env, top, status);
}

/** demo-webit `Main.appHeader`, plus a little layout for the demo rows. */
const appHeader: H.Html = H.head(
  H.title("Demo Webits"),
  H.with_(H.link(), HA.rel("shortcut icon"), HA.type_("image/x-icon"), HA.href("/favicon.ico")),
  H.style(H.preEscapedText(".demo-row { margin: 8px 0; } .demo-row > * { display: inline-block; margin-right: 12px; } .demo-status { color: #333; }")),
);

export async function main(): Promise<void> {
  const icons = mergeIconGroups(getIconData("/src/hades/share/hicolor/48x48"));
  elmerStatic(icons);
  await elmerScotty("/", appHeader, icons, demoPage);
}
