/**
 * Scratch demo of the webits core on the in-page loopback engine (open the app with `?demo=w1`).
 *
 * A small Elmer program: a static heading, a counter webit driven by a button, a right-click
 * popup menu whose choices are shown in a label, and a button that opens the global icon menu
 * (`getIconChoice`) and shows the chosen icon.
 */
import * as J from "@/lib/Data/Aeson";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { atomically, atomicallySync, readTChan } from "@/lib/Control/Concurrent/STM";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
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
  WebitClass_WebStatic,
  type ElmerEnv,
} from "@/banana-ui/webits/src/Network/Webits";
import { mkWebitMenu, popupMenuOn } from "@/banana-ui/webits/src/Network/Webits/Menu";
import { getIconData, mergeIconGroups } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { Nothing } from "@/lib/Data/Maybe";

function button(env: ElmerEnv, label: string) {
  return makeWebit(
    J.textJ,
    env,
    (wId) => H.with_(H.button(H.text(label)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.textJ, wId, label)))),
    () => jsNoOp,
    label,
  );
}

async function demoPage(env: ElmerEnv): Promise<void> {
  logToStderr(env);
  const top = env.elmerTop;
  const heading = makeWebStatic(env, H.mconcat_Html([H.h2("Webits on the loopback engine"), H.p("Each control below is a webit driven by Elmer daemons.")]));
  showWebit(WebitClass_WebStatic, env, top, heading);

  const row = makeWebitContainer(env, "demo-row");
  showWebit(WebitClass_WebitContainer, env, top, row);

  // A counter webit, updated by the server side with webitIn.
  const counter = makeWebit(
    J.intJ,
    env,
    () => H.with_(H.span("0"), HA.class_("counter")),
    (n, rv) => `jsb.rs[${rv._0}].firstChild.textContent = "Clicks: " + ${n};`,
    0,
  );
  const clickBtn = button(env, "Click me");
  showWebit(WebitClass_Webit, env, row, clickBtn);
  showWebit(WebitClass_Webit, env, row, counter);
  elmerDaemon(WebitClass_Webit, env, clickBtn, async (env1) => {
    await atomically(() => clickBtn.webitState.tStateEvent());
    const n = atomicallySync(() => counter.webitState.tStateBehaviour()) + 1;
    atomicallySync(() => counter.webitIn(n));
    elmerLog(env1, "NOTICE", `Button clicked ${n} times`);
  });

  // A popup menu on a button.
  const menu = mkWebitMenu(
    env,
    Menu([[menuItem("Ten", 10), subMenu("Tens", Menu([[menuItem("Eleven", 11), menuItem("Twelve", 12)]])), menuItem("Twenty", 20)], [menuItem("Thirty", 30)]]),
  );
  const menuBtn = makeWebit(J.textJ, env, () => H.with_(H.button("Right-click Menu"), HA.type_("button")), () => jsNoOp, "Menu");
  popupMenuOn(WebitClass_Webit, env, menuBtn, "OnRightClick", menu);
  const chosen = makeWebit(J.textJ, env, () => H.span(""), (t, rv) => setWebitHtml(H.span(t === "" ? "No menu choice yet" : t), rv), "");
  const row2 = makeWebitContainer(env, "demo-row");
  showWebit(WebitClass_WebitContainer, env, top, row2);
  showWebit(WebitClass_Webit, env, row2, menuBtn);
  showWebit(WebitClass_Webit, env, row2, chosen);
  elmerDaemon(WebitClass_Webit, env, chosen, async (env1) => {
    const v = await atomically(() => readTChan(menu.webitMenuOutput));
    atomicallySync(() => chosen.webitIn(`Menu choice: ${v}`));
    elmerLog(env1, "NOTICE", `Menu option ${v} clicked.`);
  });

  // The global icon menu.
  const iconBtn = button(env, "Choose icon");
  const iconShow = makeWebit(J.textJ, env, () => H.span(""), (nm, rv) => setWebitHtml(nm === "" ? H.span("(none)") : iconHtml("icon-display", nm, Nothing), rv), "");
  const row3 = makeWebitContainer(env, "demo-row");
  showWebit(WebitClass_WebitContainer, env, top, row3);
  showWebit(WebitClass_Webit, env, row3, iconBtn);
  showWebit(WebitClass_Webit, env, row3, iconShow);
  elmerDaemon(WebitClass_Webit, env, iconBtn, async (env1) => {
    await atomically(() => iconBtn.webitState.tStateEvent());
    const current = atomicallySync(() => iconShow.webitState.tStateBehaviour());
    const r = await getIconChoice(env1, current);
    if (r.tag === "Just") atomicallySync(() => iconShow.webitIn(r.value));
  });
}

export async function main(): Promise<void> {
  const icons = mergeIconGroups(getIconData("/src/hades/share/hicolor/48x48"));
  elmerStatic(icons);
  const appHeader = H.head(H.title("Demo Webits"), H.style(H.preEscapedText(".demo-row { margin: 8px 0; } .demo-row > * { display: inline-block; margin-right: 12px; }")));
  await elmerScotty("/", appHeader, icons, demoPage);
}
