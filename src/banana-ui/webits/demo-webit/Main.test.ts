/**
 * Tests of the demo-webit program: the forest editor dialog's labels and menus, and the front
 * page (`choicePage`), the dialogs and the clickable image driven on the loopback engine with
 * jQuery, jQuery UI, Fancytree and AppendGrid loaded into the test DOM (as in
 * `Network/Webits/ArrowDialog.test.ts`).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as M from "@/lib/Data/Map";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { set } from "@/lib/Control/Lens";
import { atomically, atomicallySync, newTChanIO, readTChan, writeTChan } from "@/lib/Control/Concurrent/STM";
import { start } from "@/lib/Network/JavaScript";
import { Node, type Forest } from "@/lib/Data/Tree";
import { newTStateIO, pure_TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import { makeElmerEnv, showWebit, WebitClass_Webit, type ElmerEnv } from "@/banana-ui/webits/src/Network/Webits";
import { getIconData, scottyIcons } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { mkWebitPopupSelect } from "@/banana-ui/webits/src/Network/Webits/ArrowDialog";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { appHeader, choiceButton, choicePage, demoForestEditor, demoImageAction, drawForest, scottyUrl } from "./Main";
import { demoDialog } from "./Dialog";
import { demoBool, demoDefault, demoForest, type DemoData } from "./Types";
import type { Model } from "./Matrix";
import * as H from "@/lib/Text/Blaze/Html5";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
async function flush(n = 10): Promise<void> {
  for (let k = 0; k < n; k++) await settle();
}

const menuLabels = (m: Menu<any>): string[][] => m._0.map((xs) => xs.map((i) => i.menuLabel));

describe("drawForest", () => {
  // Expected values are the output of GHC's Data.Tree.drawForest (containers 0.6).
  it("is unlines . map drawTree, with drawTree = unlines . draw", () => {
    expect(drawForest([])).toBe("");
    expect(drawForest([Node("a", [])])).toBe("a\n\n");
    expect(drawForest([Node("a", [Node("b", []), Node("c", [Node("d", [])])]), Node("e", [])])).toBe(
      "a\n|\n+- b\n|\n`- c\n   |\n   `- d\n\ne\n\n",
    );
  });
  it("splits labels with lines", () => {
    expect(drawForest([Node("", [Node("x\n", [])])])).toBe("|\n`- x\n\n");
    expect(drawForest([Node("p\nq", [])])).toBe("p\nq\n\n");
  });
});

describe("demoForestEditor", () => {
  const g = demoForestEditor.dialogGadget as any;
  it("is a forest editor dialog that edits items with the demo dialog", () => {
    expect(demoForestEditor.dialogTitle).toBe("Demo Dialog");
    expect(demoForestEditor.dialogButtons.tag).toBe("OkApplyButton");
    expect(g.tag).toBe("ForestEditor");
    expect(g._3.tag).toBe("Just");
    expect(g._3.value(demoForest, demoDefault)).toEqual(Just(demoDialog));
  });

  it("labels nodes with the original's operator precedence", () => {
    expect(g._0(demoForest, demoDefault)).toBe(demoDefault._demoText + " (N)");
    expect(g._0(demoForest, set(demoBool, true, demoDefault))).toBe(demoDefault._demoText + " (Y");
    expect(g._2(demoDefault)).toBe(false);
    expect(g._2(set(demoBool, true, demoDefault))).toBe(true);
  });

  it("offers menus by item kind", () => {
    expect(menuLabels(g._1(Nothing))).toEqual([["Add leaf", "Add node"]]);
    expect(menuLabels(g._1(Just(set(demoBool, true, demoDefault))))).toEqual([
      ["Add leaf", "Add node"],
      ["New node before", "New node after"],
      ["Delete"],
    ]);
    expect(menuLabels(g._1(Just(demoDefault)))).toEqual([["New node before", "New node after"], ["Delete"]]);
    const addNode = g._1(Nothing)._0[0][1].menuValue;
    expect(addNode.tag).toBe("Right");
    expect(addNode.value.tag).toBe("TreeAddIn");
    expect(addNode.value._0._demoBool).toBe(true);
  });
});

describe("appHeader and routes", () => {
  it("has the page title and favicon link", () => {
    expect(H.renderHtml(appHeader)).toBe(
      '<head><title>Demo Webits</title><link rel="shortcut icon" type="image/x-icon" href="/favicon.ico"></head>',
    );
  });
  it("passes unknown URLs through", () => {
    expect(scottyUrl("nothing-here.png")).toBe("nothing-here.png");
  });
});

describe("the demo-webit page", () => {
  let env: ElmerEnv;
  beforeAll(async () => {
    const load = (rel: string) => new Function(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")).call(globalThis);
    load("../JQuery/external/jquery/jquery.js");
    load("../JQuery/jquery-ui.min.js");
    load("../JS/fancytree/jquery.fancytree-all.min.js");
    load("../JS/AppendGrid.js");
    load("../JS/arrowDialog.js");
    document.body.innerHTML = '<div id="main"></div>';
    const icons = getIconData("/src/lib/GI/Gtk/icons");
    scottyIcons(icons);
    await start(async (eng) => {
      env = await makeElmerEnv("main", icons, eng);
    });
    // jsdom runs inline event handlers in its own global object; give it the same jsb and jQuery.
    (document as any).__jsb = (globalThis as any).jsb;
    (document as any).__jq = (globalThis as any).jQuery;
    const s = document.createElement("script");
    s.textContent = "window.jsb = document.__jsb; window.$ = window.jQuery = document.__jq;";
    document.head.appendChild(s);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buttons = (): string[] => [...document.querySelectorAll("#main button")].map((b) => b.textContent ?? "");
  const dialogs = (title: string): Element[] =>
    [...document.querySelectorAll(".ui-dialog")].filter((d) => d.querySelector(".ui-dialog-title")?.textContent === title);

  it("choice buttons send their label when clicked", async () => {
    const btn = choiceButton(env, "Press me");
    showWebit(WebitClass_Webit, env, env.elmerTop, btn);
    const next = atomically(() => btn.webitState.tStateEvent());
    const el = [...document.querySelectorAll("#main button")].find((b) => b.textContent === "Press me") as HTMLButtonElement;
    expect(el.getAttribute("type")).toBe("button");
    el.click();
    expect(await next).toEqual([null, "Press me"]);
    el.parentElement!.remove();
  });

  it("the front page opens the demo dialog and logs its result", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const [modelState, modelWriter] = newTStateIO<boolean, Model>(M.empty());
    void choicePage(env, modelState, modelWriter, []);
    await flush();
    expect(buttons()).toEqual(["Dialog Demo", "Matrix Demo", "Right-click Menu", "Forest Editor Demo", "Clickable Image Demo"]);
    // The right-click menu is in the page, hidden.
    expect([...document.querySelectorAll("ul.popup-menu li > div")].map((d) => d.textContent)).toEqual([
      "Ten", "Tens", "Eleven", "Twelve", "Thirteen", "Fourteen", "Twenty", "Thirty", "Fourty",
    ]);
    ([...document.querySelectorAll("#main button")].find((b) => b.textContent === "Dialog Demo") as HTMLButtonElement).click();
    await flush(20);
    // The button box is deleted and the dialog is open.
    expect(buttons().filter((b) => b.endsWith("Demo"))).toEqual([]);
    const [dlg] = dialogs("Demo Dialog");
    expect(dlg).toBeDefined();
    const labels = [...dlg.querySelectorAll("td")].map((td) => td.textContent).filter((t) => t?.endsWith(":"));
    expect(labels).toEqual(["Demo Text:", "Demo Number:", "Demo Choice:", "Demo Boolean:", "Demo Date:", "Demo Icon:", "Demo Colour:", "Demo Set:"]);
    expect(dlg.textContent).toContain("The secret code is: Bar5");
    // Increment the number, then OK.
    ([...dlg.querySelectorAll("button")].find((b) => b.textContent === "Increment") as HTMLButtonElement).click();
    await flush(20);
    expect(dlg.textContent).toContain("The secret code is: Bar6");
    (dlg.querySelector("button[id$=_ok]") as HTMLButtonElement).click();
    await flush(20);
    const logged = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("Dialog output = "));
    expect(logged).toBeDefined();
    expect(logged).toContain("Dialog output = DemoData {\n   demoText: ");
    expect(logged).toContain("   demoNum: 6\n");
  });

  it("the forest editor dialog returns the edited forest", async () => {
    const trigger = newTChanIO<readonly [null, Forest<DemoData>]>();
    const out = mkWebitPopupSelect(env, pure_TState<boolean, typeof demoForest>(demoForest), constantDialog(demoForestEditor), () => readTChan(trigger));
    const forest: Forest<DemoData> = [
      Node({ ...demoDefault, _demoText: "top", _demoBool: true }, [Node({ ...demoDefault, _demoText: "leaf" }, [])]),
    ];
    atomicallySync(() => writeTChan(trigger, [null, forest]));
    await flush(20);
    const dlg = dialogs("Demo Dialog").at(-1)!;
    const tree = (globalThis as any).$.ui.fancytree.getTree(dlg.querySelector(".forest-editor"));
    const titles: string[] = [];
    tree.visit((n: any) => {
      titles.push(n.title);
    });
    expect(titles).toEqual(["top (Y", "leaf (N)"]);
    const next = atomically(() => readTChan(out));
    (dlg.querySelector("button[id$=_ok]") as HTMLButtonElement).click();
    const [, r] = await next;
    expect(r.tag).toBe("Just");
    if (r.tag === "Just") expect(r.value.map((t) => [t.rootLabel._demoText, t.subForest.map((s) => s.rootLabel._demoText)])).toEqual([["top", ["leaf"]]]);
  });

  it("the clickable image reports click coordinates", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    demoImageAction(env);
    await flush();
    expect(log).toHaveBeenCalledWith("Got Image Demo click.");
    const img = [...document.querySelectorAll("#main img")].at(-1) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("image.jpg");
    const ev = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(ev, "offsetX", { value: 12 });
    Object.defineProperty(ev, "offsetY", { value: 34.4 });
    img.dispatchEvent(ev);
    await flush(20);
    expect(log).toHaveBeenCalledWith("Image clicked at (True,GadgetData {_gdOk = True, _gdValue = (12,34)})");
  });
});
