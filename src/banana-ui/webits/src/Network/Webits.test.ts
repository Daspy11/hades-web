/**
 * Integration tests of the loopback engine and the webits core, with the real jQuery and jQuery UI
 * loaded into the test DOM.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { atomically, atomicallySync, readTChan } from "@/lib/Control/Concurrent/STM";
import { start } from "@/lib/Network/JavaScript";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  addWebitChannel,
  deleteWebit,
  elmerSend,
  getIconChoice,
  jsNoOp,
  jsValue,
  makeElmerEnv,
  makeWebit,
  makeWebitContainer,
  makeWebStatic,
  showWebit,
  webitEvent,
  webitEventData,
  WebitClass_Webit,
  WebitClass_WebitContainer,
  WebitClass_WebStatic,
  hideWebit,
  elmerStaticUrl,
  type ElmerEnv,
} from "./Webits";
import { getDataFileName } from "@/lib/System/Paths";
import { mkWebitMenu, popupMenuOn } from "./Webits/Menu";
import { IconData, IconGroup, iconFromUrl, iconUrl, scottyIcons } from "./Webits/Icons";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

function loadClassicScript(rel: string): void {
  const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  new Function(src).call(globalThis);
}

let env: ElmerEnv;
const icons = [
  IconGroup(
    "Actions",
    M.fromList([
      ["go-up", IconData("/src/lib/GI/Gtk/icons/Adwaita/go-up-symbolic.svg", "IconSvg")],
      ["go-down", IconData("/src/lib/GI/Gtk/icons/Adwaita/go-down-symbolic.svg", "IconSvg")],
    ]),
  ),
];

beforeAll(async () => {
  loadClassicScript("../../JQuery/external/jquery/jquery.js");
  loadClassicScript("../../JQuery/jquery-ui.min.js");
  loadClassicScript("../../JS/arrowDialog.js");
  document.body.innerHTML = '<div id="main"></div>';
  scottyIcons(icons);
  await start(async (eng) => {
    env = await makeElmerEnv("main", icons, eng);
  });
  // jsdom runs inline event handlers (onclick="jsb.event(...)") in its own global object, not in
  // the test's `globalThis`; give that global the same `jsb` and jQuery.
  (document as any).__jsb = (globalThis as any).jsb;
  (document as any).__jq = (globalThis as any).jQuery;
  const s = document.createElement("script");
  s.textContent = "window.jsb = document.__jsb; window.$ = window.jQuery = document.__jq;";
  document.head.appendChild(s);
});

/** A button webit sending its label, as in the demo's `choiceButton`. */
function choiceButton(display: string) {
  return makeWebit(
    J.textJ,
    env,
    (wId) => H.with_(H.button(H.text(display)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.textJ, wId, display)))),
    () => jsNoOp,
    display,
  );
}

describe("Webits on the loopback engine", () => {
  it("shows webits in the top container", () => {
    const box = makeWebitContainer(env, "box");
    const btn = choiceButton("Press me");
    showWebit(WebitClass_Webit, env, box, btn);
    showWebit(WebitClass_WebitContainer, env, env.elmerTop, box);
    const main = document.getElementById("main")!;
    const div = main.querySelector(".box")!;
    expect(div.id).toBe(box.webitContainerId);
    expect(div.querySelector("button")!.textContent).toBe("Press me");
    const st = makeWebStatic(env, H.p("static"));
    showWebit(WebitClass_WebStatic, env, box, st);
    expect(div.lastElementChild!.textContent).toBe("static");
    hideWebit(WebitClass_WebStatic, env, st);
  });

  it("routes client events to the webit's TState", async () => {
    const btn = choiceButton("Click");
    showWebit(WebitClass_Webit, env, env.elmerTop, btn);
    const ev = atomically(() => btn.webitState.tStateEvent());
    (document.getElementById(btn.webitId1)!.querySelector("button") as HTMLButtonElement).click();
    expect(await ev).toEqual([null, "Click"]);
  });

  it("pushes updates with webitIn through the command pipe", async () => {
    const w = makeWebit(
      J.intJ,
      env,
      () => H.span("?"),
      (n, rv) => `jsb.rs[${rv._0}].firstChild.textContent=${n};`,
      1,
    );
    showWebit(WebitClass_Webit, env, env.elmerTop, w);
    const span = document.getElementById(w.webitId1)!.firstElementChild!;
    expect(span.textContent).toBe("1");
    atomicallySync(() => w.webitIn(42));
    await settle();
    expect(span.textContent).toBe("42");
    expect(atomicallySync(w.webitState.tStateBehaviour)).toBe(42);
  });

  it("addWebitChannel receives the events that parse", async () => {
    const w = makeWebit(J.textJ, env, (wId) => H.span(""), () => jsNoOp, "");
    const ch = addWebitChannel(J.boolJ, WebitClass_Webit, env, w);
    const next = atomically(() => readTChan(ch));
    elmerSend(env, webitEventData(w.webitId1, "true"));
    expect(await next).toBe(true);
  });

  it("deleteWebit removes the element and its routes", async () => {
    const w = choiceButton("Gone");
    showWebit(WebitClass_Webit, env, env.elmerTop, w);
    expect(document.getElementById(w.webitId1)).not.toBeNull();
    await deleteWebit(WebitClass_Webit, env, w);
    expect(document.getElementById(w.webitId1)).toBeNull();
    expect(M.member(w.webitId1, atomicallySync(() => env.elmerRoutes.value))).toBe(false);
  });

  it("menus send the chosen item's value", async () => {
    const menu = mkWebitMenu(env, Menu([[menuItem("Ten", 10), subMenu("Tens", Menu([[menuItem("Eleven", 11)]]))], [menuItem("Thirty", 30)]]));
    await settle();
    const ul = document.getElementById(menu.webitMenuDisplay.webitContainerId)!;
    expect(ul.classList.contains("ui-menu")).toBe(true);
    const items = [...ul.querySelectorAll("div")].map((d) => d.textContent);
    expect(items).toEqual(["Ten", "Tens", "Eleven", "Thirty"]);
    const next = atomically(() => readTChan(menu.webitMenuOutput));
    ([...ul.querySelectorAll("div")].find((d) => d.textContent === "Eleven") as HTMLElement).click();
    expect(await next).toBe(11);
    const btn = choiceButton("Menu");
    showWebit(WebitClass_Webit, env, env.elmerTop, btn);
    popupMenuOn(WebitClass_Webit, env, btn, "OnRightClick", menu);
    await settle();
  });

  it("elmerStaticUrl resolves the routes of the original static server", () => {
    expect(elmerStaticUrl("/favicon.ico")).toBe(getDataFileName("webits", "JS/favicon.ico"));
    expect(elmerStaticUrl("assets/JQuery/jquery-ui.min.css")).toBe(getDataFileName("webits", "JQuery/jquery-ui.min.css"));
    // Some JS files are requested without a suffix.
    expect(elmerStaticUrl("/assets/JS/arrowDialog")).toBe(getDataFileName("webits", "JS/arrowDialog.js"));
    expect(elmerStaticUrl("/icons/go-up")).toBe(iconUrl("go-up"));
    for (const u of ["/icons/no-such-icon", "/assets/nothing.js", "//cdn.example.org/x.js", "https://example.org/a.css", "page.html"]) {
      expect(elmerStaticUrl(u)).toBe(u);
    }
  });

  it("getIconChoice opens the icon dialog and returns the clicked icon", async () => {
    expect(iconFromUrl(iconUrl("go-up"))).toBe("go-up");
    const choice = getIconChoice(env, "go-down");
    await settle();
    const [menuWebit] = env.elmerIconMenu;
    const dlg = document.getElementById(menuWebit.webitId1)!;
    const imgs = [...dlg.querySelectorAll("img")];
    expect(imgs.map((i) => i.alt)).toEqual(["go-down", "go-up"]);
    // The initial icon is highlighted.
    expect(imgs[0].style.borderColor).not.toBe("");
    imgs[1].click();
    await settle();
    expect(imgs[1].style.borderColor).not.toBe("");
    const ok = [...document.querySelectorAll(".ui-dialog-buttonpane button")].find((b) => b.textContent === "Ok") as HTMLElement;
    ok.click();
    const r = await choice;
    expect(r).toEqual({ tag: "Just", value: "go-up" });
  });
});
