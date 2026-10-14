/**
 * Tests of `Network.Webits.ArrowDialog`: the JSON instances and `TState` helpers, and the gadget
 * interpreter on the loopback engine with the real jQuery, jQuery UI and AppendGrid loaded into
 * the test DOM (as in `Network/Webits.test.ts`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { _1, _2, _Left, _Right, lens, type Lens } from "@/lib/Control/Lens";
import { readInt, showInt } from "@/lib/Prelude";
import { atomically, atomicallySync, newTChanIO, readTChan, writeTChan } from "@/lib/Control/Concurrent/STM";
import { start } from "@/lib/Network/JavaScript";
import { GadgetData } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  Dialog,
  OkButton,
  PrismaticGadget,
  accum,
  arr,
  buttonBar,
  clickableSingle,
  cond,
  exec,
  forestEditor,
  forestTable,
  form,
  focusing,
  gPipe,
  optional,
  radio,
  simpleCombo,
  validate,
  simpleTextBox,
  table,
  tickBox,
  treeSelector,
  typedTextBox,
  unionTab,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Lens1, TreeAddIn, TreeDelete, constantDialog } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { EditBool, EditEntry, TableAdd, TableDelete, mkField } from "@/banana-ui/base/Reactive/Banana/Table";
import { textPrismDouble } from "@/banana-ui/base/Reactive/Banana/Common";
import { newTStateIO, pure_TState, type TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import { makeElmerEnv, showWebit, WebitClass_WebitItem, type ElmerEnv } from "../Webits";
import { IconData, IconGroup, scottyIcons } from "./Icons";
import {
  FancyTree,
  FtIcon,
  FtIconDefault,
  FtIconNone,
  FromJSON_FTSelection,
  FromJSON_TreeMoveMode,
  ToJSON_FancyTree,
  cleanOutput,
  createDialog,
  ftDefault,
  fmap_GadgetOut,
  liftA2_GadgetOut,
  mergeGadgetData,
  mkWebitPopupSelect,
  pure_GadgetOut,
  qualifyOutput,
  renderGadget,
  showOpr,
  show_FTSelection,
  type GadgetOut,
} from "./ArrowDialog";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
async function flush(n = 6): Promise<void> {
  for (let k = 0; k < n; k++) await settle();
}

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
  loadClassicScript("../../../JQuery/external/jquery/jquery.js");
  loadClassicScript("../../../JQuery/jquery-ui.min.js");
  loadClassicScript("../../../JS/fancytree/jquery.fancytree-all.min.js");
  loadClassicScript("../../../JS/AppendGrid.js");
  loadClassicScript("../../../JS/arrowDialog.js");
  document.body.innerHTML = '<div id="main"></div>';
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

const behaviour = <A>(ts: TState<boolean, A>): A => atomicallySync(() => ts.tStateBehaviour());

/** Render a gadget into the top container, returning its output and the DOM element of its views. */
function render<I, O>(input: TState<boolean, GadgetData<I>>, g: import("@/banana-ui/base/Reactive/Banana/GadgetPrimitives").Gadget<any, any, I, O>, e: TState<boolean, any> = pure_TState(null)): [GadgetOut<any, O>, HTMLElement] {
  const out = renderGadget(env, e, input, g);
  const holder = document.createElement("div");
  document.getElementById("main")!.appendChild(holder);
  for (const w of out.gadgetView) showWebit(WebitClass_WebitItem, env, env.elmerTop, w);
  for (const w of out.gadgetView) holder.appendChild(document.getElementById(WebitClass_WebitItem.webitId(w))!);
  return [out, holder];
}

function setValue(el: Element, v: string, ev = "change"): void {
  (el as HTMLInputElement).value = v;
  el.dispatchEvent(new Event(ev));
}

describe("FancyTree JSON", () => {
  it("leaves out blank and Nothing fields", () => {
    expect(ToJSON_FancyTree.toJSON(ftDefault("3", "Three"))).toEqual({ title: "Three", key: "3" });
    const t: FancyTree = {
      ...ftDefault("1", "One"),
      ftToolTip: Just("tip"),
      ftIcon: Just(FtIconNone),
      ftCheckBox: Just(false),
      ftExpanded: true,
      ftExtraClasses: "x",
      ftLazy: true,
      ftSelected: true,
      ftType: "t",
      ftUnselectable: true,
      ftChildren: Just([{ ...ftDefault("2", "Two"), ftIcon: Just(FtIcon("icon.png")) }, { ...ftDefault("4", "Four"), ftIcon: Just(FtIconDefault) }]),
    };
    expect(J.encode(ToJSON_FancyTree.toJSON(t))).toBe(
      '{"title":"One","key":"1","tooltip":"tip","icon":false,"checkbox":false,"expanded":true,"extraClasses":"x","lazy":true,' +
        '"selected":true,"type":"t","unselectable":true,"children":[{"title":"Two","key":"2","icon":"icon.png"},{"title":"Four","key":"4","icon":true}]}',
    );
  });
  it("parses move modes and selections", () => {
    expect(J.parseEither(FromJSON_TreeMoveMode.parseJSON, "over")).toEqual(Right("MoveOver"));
    expect(J.parseEither(FromJSON_TreeMoveMode.parseJSON, "under")).toEqual(Left('Unrecognised move mode: "under"'));
    expect(J.parseEither(FromJSON_TreeMoveMode.parseJSON, 3)).toEqual(Left("Expected move mode: Number 3.0"));
    const sel = J.parseEither(FromJSON_FTSelection.parseJSON, { k: "12", s: true });
    expect(sel.tag === "Right" && show_FTSelection(sel.value)).toBe("FTSelection {ftsKey = 12, ftsSelected = True}");
    // `read` is lazy: an unreadable key parses, and fails only when the key is used.
    const bad = J.parseEither(FromJSON_FTSelection.parseJSON, { k: "x", s: false });
    expect(bad.tag).toBe("Right");
    if (bad.tag === "Right") {
      expect(bad.value.ftsSelected).toBe(false);
      expect(() => bad.value.ftsKey).toThrow("Prelude.read: no parse");
    }
    expect(J.parseEither(FromJSON_FTSelection.parseJSON, { k: 12, s: true }).tag).toBe("Left");
  });
  it("showOpr", () => {
    expect(showOpr((x: number) => "n" + String(x), TreeAddIn(3))).toBe('TreeAddIn "n3"');
    expect(showOpr((x: number) => String(x), TreeDelete)).toBe("TreeDelete");
  });
});

describe("GadgetOut and TState helpers", () => {
  it("pure, fmap and liftA2", () => {
    const [ts, w] = newTStateIO<boolean, GadgetData<number>>(GadgetData(true, 2));
    const o: GadgetOut<never, number> = { ...pure_GadgetOut<never, number>(0), gadgetOutput: ts };
    const sum = liftA2_GadgetOut((a: number, b: number) => a + b, fmap_GadgetOut((x: number) => x * 10, o), pure_GadgetOut(1));
    expect(behaviour(sum.gadgetOutput)).toEqual(GadgetData(true, 21));
    w(true, GadgetData(false, 3));
    expect(behaviour(sum.gadgetOutput)).toEqual(GadgetData(false, 31));
    expect(behaviour(qualifyOutput(false, pure_GadgetOut(5)).gadgetOutput)).toEqual(GadgetData(false, 5));
  });
  it("mergeGadgetData passes on changes and ANDs the validity", async () => {
    const [a, wa] = newTStateIO<boolean, GadgetData<number>>(GadgetData(true, 1));
    const [b, wb] = newTStateIO<boolean, GadgetData<number>>(GadgetData(false, 1));
    const m = mergeGadgetData(a, b);
    expect(behaviour(m)).toEqual(GadgetData(false, 1));
    const ev = atomically(() => m.tStateEvent());
    wb(true, GadgetData(true, 5));
    expect(await ev).toEqual([true, GadgetData(true, 5)]);
    wa(false, GadgetData(true, 7));
    await flush();
    expect(behaviour(m)).toEqual(GadgetData(true, 7));
  });
  it("cleanOutput drops invalid events", async () => {
    const [a, wa] = newTStateIO<boolean, GadgetData<number>>(GadgetData(false, 0));
    const c = cleanOutput(env, a);
    expect(behaviour(c)).toEqual(GadgetData(false, 0)); // The initial value may be invalid.
    wa(true, GadgetData(false, 1));
    await flush();
    expect(behaviour(c)).toEqual(GadgetData(false, 0));
    wa(true, GadgetData(true, 2));
    await flush();
    expect(behaviour(c)).toEqual(GadgetData(true, 2));
  });
});

describe("renderGadget", () => {
  it("text boxes parse, validate and follow their input", async () => {
    const [inp, w] = newTStateIO<boolean, GadgetData<number>>(GadgetData(true, 5));
    const [out, el] = render(inp, typedTextBox<any, any, number>(showInt, readInt));
    const box = el.querySelector("input")!;
    expect(box.value).toBe("5");
    setValue(box, "12");
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 12));
    setValue(box, "twelve");
    await flush();
    expect(behaviour(out.gadgetOutput)._gdOk).toBe(false);
    expect(box.classList.contains("invalid")).toBe(true);
    w(false, GadgetData(true, 42));
    await flush();
    expect(box.value).toBe("42");
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 42));
    expect(box.classList.contains("invalid")).toBe(false);
  });

  it("accumulates form edits", async () => {
    type P = readonly [number, boolean];
    const [inp] = newTStateIO<boolean, GadgetData<P>>(GadgetData(true, [1, false] as const));
    const g = accum(
      form<any, any, P>("Vertical", [
        ["Number", focusing(_1<number, boolean>(), typedTextBox<any, any, number>(showInt, readInt))],
        ["Flag", focusing(_2<number, boolean>(), tickBox())],
      ]),
    );
    const [out, el] = render(inp, g);
    expect([...el.querySelectorAll("td")].map((td) => td.textContent).filter((t) => t !== "")).toEqual(["Number", "Flag"]);
    setValue(el.querySelector("input[type=text]")!, "8");
    await flush();
    const tick = el.querySelector("input[type=checkbox]") as HTMLInputElement;
    tick.checked = true;
    tick.dispatchEvent(new Event("input"));
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, [8, true]));
  });

  it("button bars apply their functions", async () => {
    const [inp] = newTStateIO<boolean, GadgetData<number>>(GadgetData(true, 1));
    const [out, el] = render(inp, accum(buttonBar<any, any, number>([["Up", (x) => x + 1], ["Down", (x) => x - 1]])));
    const [up, down] = [...el.querySelectorAll("button")] as HTMLButtonElement[];
    up.click();
    await flush();
    up.click();
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 3));
    down.click();
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 2));
  });

  it("optional text boxes treat blank as Nothing, combos select values", async () => {
    const [inp] = newTStateIO<boolean, GadgetData<Maybe<string>>>(GadgetData(true, Just("abc")));
    const [out, el] = render(inp, optional("", simpleTextBox()));
    const box = el.querySelector("input")!;
    expect(box.value).toBe("abc");
    setValue(box, "");
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, Nothing));
    const [inp2] = newTStateIO<boolean, GadgetData<string>>(GadgetData(true, "b"));
    const [out2, el2] = render(inp2, simpleCombo(["a", "b", "c"]));
    const sel = el2.querySelector("select")!;
    expect(sel.value).toBe("1");
    sel.selectedIndex = 2;
    sel.dispatchEvent(new Event("input"));
    await flush();
    expect(behaviour(out2.gadgetOutput)).toEqual(GadgetData(true, "c"));
  });

  it("cond shows the gadget for the matching prism", async () => {
    const [inp, w] = newTStateIO<boolean, GadgetData<Either<number, string>>>(GadgetData(true, Left(3)));
    const g = cond<any, any, Either<number, string>, Either<number, string>>([
      PrismaticGadget(0, _Left<number, string>(), typedTextBox<any, any, number>(showInt, readInt)),
      PrismaticGadget("", _Right<number, string>(), simpleTextBox()),
    ]);
    const [out, el] = render(inp, g);
    await flush();
    const boxes = () => [...el.querySelectorAll("input")].map((i) => [i.value, (i.parentElement as HTMLElement).hidden] as const);
    expect(boxes()).toEqual([["3", false], ["", true]]);
    w(false, GadgetData(true, Right("hello")));
    await flush();
    expect(boxes()).toEqual([["3", true], ["hello", false]]);
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, Right("hello")));
  });

  it("exec rebuilds its gadget when the argument changes", async () => {
    const [inp, w] = newTStateIO<boolean, GadgetData<[boolean, number]>>(GadgetData(true, [false, 1]));
    const g = exec((b: boolean) => (b ? gPipe(typedTextBox<any, any, number>(showInt, readInt), arr((n: number) => n * 2)) : arr((n: number) => n)));
    const [out, el] = render(inp, g);
    expect(el.querySelector("input")).toBeNull();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 1));
    w(false, GadgetData(true, [true, 4]));
    await flush(10);
    expect(el.querySelector("input")!.value).toBe("4");
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 8));
  });

  it("tree selectors select keys of the forest", async () => {
    type Item = readonly [string, Maybe<string>, Maybe<number>];
    const item = (t: string, tip: Maybe<string>, k: Maybe<number>): Item => [t, tip, k];
    const forest: Forest<Item> = [Node(item("Root", Nothing, Nothing), [Node(item("One", Just("tip"), Just(1)), []), Node(item("Two", Nothing, Just(2)), [])])];
    const [inp] = newTStateIO<boolean, GadgetData<S.Set<number>>>(GadgetData(true, S.fromList([2])));
    const [out] = render(inp, treeSelector((_e: unknown) => forest));
    await flush();
    const tree = (globalThis as any).$.ui.fancytree.getTree(document.getElementById(WebitClass_WebitItem.webitId(out.gadgetView[0])));
    const keys: string[] = [];
    tree.visit((n: any) => {
      keys.push(n.key + ":" + n.title + ":" + String(n.isSelected()));
    });
    expect(keys).toEqual(["1:Root:false", "2:One:false", "3:Two:true"]);
    tree.getNodeByKey("2").setSelected(true);
    await flush();
    expect(S.toList(behaviour(out.gadgetOutput)._gdValue)).toEqual([1, 2]);
  });

  it("tables load rows and accept edits and row operations", async () => {
    interface R { readonly b: boolean; readonly n: number }
    const bL: Lens<R, boolean> = lens((r) => r.b, (r, v) => ({ ...r, b: v }));
    const nL: Lens<R, number> = lens((r) => r.n, (r, v) => ({ ...r, n: v }));
    const rows: readonly R[] = [{ b: true, n: 1 }, { b: false, n: 2 }];
    const [inp] = newTStateIO<boolean, GadgetData<readonly R[]>>(GadgetData(true, rows));
    const g = table<any, any, R>(
      [TableAdd("new", { b: false, n: 0 }), TableDelete],
      [mkField("B", bL, Nothing, EditBool, Nothing), mkField("N", nL, Nothing, EditEntry(textPrismDouble), Nothing)],
      Nothing,
    );
    const out = renderGadget(env, pure_TState(null), inp, g);
    for (const w of out.gadgetView) showWebit(WebitClass_WebitItem, env, env.elmerTop, w);
    (await import("@/lib/Network/JavaScript")).send(env.elmerEngine, out.gadgetDomCode);
    await flush();
    const tbl = document.getElementById(WebitClass_WebitItem.webitId(out.gadgetView[0]))!;
    const texts = () => [...tbl.querySelectorAll("input[type=text]")].map((i) => (i as HTMLInputElement).value);
    expect(texts()).toEqual(["1.0", "2.0"]);
    setValue(tbl.querySelectorAll("input[type=text]")[1], "5.5");
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, [{ b: true, n: 1 }, { b: false, n: 5.5 }]));
    // Append a row with the button: the default row is added.
    const append = [...tbl.querySelectorAll("button")].find((b) => b.title === "Append Row") as HTMLButtonElement | undefined;
    if (append !== undefined) {
      append.click();
      await flush();
      expect(behaviour(out.gadgetOutput)._gdValue).toEqual([{ b: true, n: 1 }, { b: false, n: 5.5 }, { b: false, n: 0 }]);
    }
  });

  it("tables with clicks consume a click on a missing row (Haskell's lazy (!!) fails later)", async () => {
    interface R { readonly b: boolean; readonly n: number }
    const nL: Lens<R, number> = lens((r) => r.n, (r, v) => ({ ...r, n: v }));
    const rows: readonly R[] = [{ b: true, n: 1 }, { b: false, n: 2 }];
    const [inp] = newTStateIO<boolean, GadgetData<readonly R[]>>(GadgetData(true, rows));
    const sel = constantDialog(
      Dialog<any, any, R, R>("Row popup", OkButton, accum(focusing(nL, typedTextBox<any, any, number>(showInt, readInt)))),
    );
    const g = table<any, any, R>([], [mkField("N", nL, Nothing, EditEntry(textPrismDouble), Nothing)], Just(sel));
    const out = renderGadget(env, pure_TState(null), inp, g);
    for (const w of out.gadgetView) showWebit(WebitClass_WebitItem, env, env.elmerTop, w);
    (await import("@/lib/Network/JavaScript")).send(env.elmerEngine, out.gadgetDomCode);
    await flush();
    const tableId = WebitClass_WebitItem.webitId(out.gadgetView[0]);
    const popups = () => [...document.querySelectorAll(".ui-dialog")].filter((d) => d.querySelector(".ui-dialog-title")!.textContent === "Row popup");
    (globalThis as any).jsb.event({ d: tableId, v: 7 });
    await flush(10);
    expect(popups()).toHaveLength(0);
    // The popup daemon fails and restarts after 1 s; the bad click has been consumed, so the next
    // click opens a dialog on its row.
    await new Promise((r) => setTimeout(r, 1200));
    (globalThis as any).jsb.event({ d: tableId, v: 1 });
    await flush(10);
    expect(popups()).toHaveLength(1);
    expect((popups()[0].querySelector("input") as HTMLInputElement).value).toBe("2");
  });

  it("createDialog sends the value on OK", async () => {
    const d = Dialog<any, any, number, number>("Number", OkButton, typedTextBox<any, any, number>(showInt, readInt));
    const [form1, outChan] = createDialog(env, pure_TState(null), ["key", 3, d]);
    await flush();
    const formEl = document.getElementById(form1.webitContainerId)!;
    // jQuery UI moves the form's title attribute into the dialog's title bar.
    expect(formEl.closest(".ui-dialog")!.querySelector(".ui-dialog-title")!.textContent).toBe("Number");
    setValue(formEl.querySelector("input")!, "9");
    await flush();
    const next = atomically(() => readTChan(outChan));
    (document.getElementById(form1.webitContainerId + "_ok") as HTMLButtonElement).click();
    expect(await next).toEqual(["key", Just(9)]);
  });

  it("union tabs switch pages on a click and when the input changes", async () => {
    const [inp, w] = newTStateIO<boolean, GadgetData<Either<number, string>>>(GadgetData(true, Right("x")));
    const g = unionTab<any, any, Either<number, string>, Either<number, string>>([
      ["Num", PrismaticGadget(0, _Left<number, string>(), typedTextBox<any, any, number>(showInt, readInt))],
      ["Text", PrismaticGadget("", _Right<number, string>(), simpleTextBox())],
    ]);
    const [out, el] = render(inp, g);
    await flush();
    const pages = () => [...el.querySelectorAll(".tab-body > div")].map((d) => [(d.querySelector("input") as HTMLInputElement).value, (d as HTMLElement).hidden]);
    expect(pages()).toEqual([["0", true], ["x", false]]);
    // Faithful: every tab button keeps the "active" class it got when it was created.
    expect([...el.querySelectorAll(".tab-header > div")].map((d) => d.className)).toEqual([" active", " active"]);
    (el.querySelector(".tab-header button") as HTMLButtonElement).click();
    await flush();
    expect(pages()).toEqual([["0", false], ["x", true]]);
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, Left(0)));
    w(false, GadgetData(true, Right("y")));
    await flush(10);
    expect(pages()).toEqual([["0", true], ["y", false]]);
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, Right("y")));
  });

  it("radio buttons and clickable lists", async () => {
    const [inp] = newTStateIO<boolean, GadgetData<string>>(GadgetData(true, "b"));
    const [out, el] = render(inp, radio<any, any, string>(() => [["A", "a"], ["B", "b"], ["C", "c"]]));
    const radios = [...el.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(el.textContent).toBe("ABC");
    radios[2].click();
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, "c"));
    const [inp2] = newTStateIO<boolean, GadgetData<readonly number[]>>(GadgetData(true, [1, 2, 3]));
    const [out2, el2] = render(inp2, clickableSingle((n: number) => "#" + String(n)));
    expect(el2.textContent).toBe("#1, #2, #3");
    expect(behaviour(out2.gadgetOutput)).toEqual(GadgetData(true, Nothing));
    (el2.querySelectorAll("span")[1] as HTMLElement).click();
    await flush();
    expect(behaviour(out2.gadgetOutput)).toEqual(GadgetData(true, Just(2)));
    el2.querySelectorAll("span")[2].dispatchEvent(new MouseEvent("dblclick"));
    await flush();
    expect(behaviour(out2.gadgetOutput)).toEqual(GadgetData(true, Nothing)); // No double click action.
  });

  it("forest tables send keyed updates", async () => {
    interface St { readonly x: number; readonly y: number; readonly z: number }
    const xL: Lens<St, number> = lens((s) => s.x, (s, v) => ({ ...s, x: v }));
    const yL: Lens<St, number> = lens((s) => s.y, (s, v) => ({ ...s, y: v }));
    const zL: Lens<St, number> = lens((s) => s.z, (s, v) => ({ ...s, z: v }));
    const numBox = focusing(lens((n: number) => n, (_n: number, v: number) => v), typedTextBox<any, any, number>(showInt, readInt));
    const item = (k: string, l: Lens<St, number>): readonly [string, Lens1<St, number>] => [k, Lens1(l)];
    const forest: Forest<readonly [string, Lens1<St, number>]> = [Node(item("x", xL), [Node(item("y", yL), []), Node(item("z", zL), [])])];
    const g = forestTable<any, any, string, St, number>(
      [
        ["Ignored", [["Top", numBox]]],
        ["Group", [["Sub", numBox], ["Again", numBox]]],
      ],
      () => forest,
    );
    const st0: St = { x: 1, y: 2, z: 3 };
    const [inp] = newTStateIO<boolean, GadgetData<St>>(GadgetData(true, st0));
    const [out, el] = render(inp, g);
    const tbl = el.querySelector("table.matrix")!;
    expect([...tbl.querySelectorAll("thead tr")].map((r) => [...r.children].map((c) => c.textContent + (c.getAttribute("rowspan") ?? "") + (c.getAttribute("colspan") ?? "")))).toEqual([
      ["Top2", "Group2"],
      ["Sub", "Again"],
    ]);
    const rows = [...tbl.querySelectorAll("tbody > tr")];
    expect(rows.map((r) => [...r.querySelectorAll("input")].map((i) => i.value))).toEqual([["1", "2", "2"], ["3", "3"]]);
    expect(rows[0].querySelector("td")!.getAttribute("rowspan")).toBe("2");
    const next = atomically(() => out.gadgetEvents());
    setValue(rows[1].querySelectorAll("input")[0], "7");
    const ev = await next;
    expect(ev.tag).toBe("Right");
    if (ev.tag === "Right") {
      expect(ev.value[0]).toBe("z");
      expect(ev.value[1](0)).toBe(7);
    }
    await flush();
    expect(behaviour(out.gadgetOutput)._gdValue(st0)).toEqual({ x: 1, y: 2, z: 7 });
  });

  it("forest editors follow menu operations and drag and drop", async () => {
    const forest: Forest<string> = [Node("a", [Node("b", [])]), Node("c", [])];
    const g = forestEditor<any, any, string>(
      (_e, s) => s.toUpperCase(),
      (m) => (m.tag === "Nothing" ? Menu([[menuItem("Add", TreeAddIn("top"))]]) : Menu([[menuItem("Add", TreeAddIn("new"))], [menuItem("Delete", TreeDelete)]])),
      (s) => s !== "b",
      Nothing,
    );
    const [inp] = newTStateIO<boolean, GadgetData<Forest<string>>>(GadgetData(true, forest));
    const [out, el] = render(inp, g);
    await flush();
    const holder = el.querySelector(".forest-editor") as HTMLElement;
    const tree = (globalThis as any).$.ui.fancytree.getTree(holder);
    const nodes = () => {
      const r: string[] = [];
      tree.visit((n: any) => {
        r.push(n.key + ":" + n.title);
      });
      return r;
    };
    expect(nodes()).toEqual(["1:A", "2:B", "3:C"]);
    const draw = (f: Forest<string>): string => f.map((t: Tree<string>) => t.rootLabel + (t.subForest.length > 0 ? "[" + draw(t.subForest) + "]" : "")).join(",");
    const menuOf = (key: string): HTMLElement => document.getElementById(tree.getNodeByKey(key).data.menu)!;
    const clickItem = (menu: HTMLElement, label: string) =>
      ([...menu.querySelectorAll("li > div")].find((d) => d.textContent === label) as HTMLElement).click();
    clickItem(menuOf("3"), "Add");
    await flush(10);
    expect(draw(behaviour(out.gadgetOutput)._gdValue)).toBe("a[b],c[new]");
    expect(nodes()).toEqual(["1:A", "2:B", "3:C", "4:NEW"]);
    clickItem(menuOf("1"), "Delete");
    await flush(10);
    expect(draw(behaviour(out.gadgetOutput)._gdValue)).toBe("c[new]");
    expect(nodes()).toEqual(["3:C", "4:NEW"]);
    // Drag and drop sends the whole rearranged tree of keys.
    const wId = WebitClass_WebitItem.webitId(out.gadgetView[0]);
    (globalThis as any).jsb.event({ d: wId, v: [["4", []], ["3", []]] });
    await flush(10);
    expect(draw(behaviour(out.gadgetOutput)._gdValue)).toBe("new,c");
  });

  it("popup selectors open a dialog per trigger", async () => {
    const trigger = newTChanIO<readonly [string, number]>();
    const sel = constantDialog(Dialog<any, any, number, number>("Popup", OkButton, typedTextBox<any, any, number>(showInt, readInt)));
    const results = mkWebitPopupSelect(env, pure_TState(null), sel, () => readTChan(trigger));
    atomicallySync(() => writeTChan(trigger, ["k1", 4] as const));
    await flush(10);
    const dlg = [...document.querySelectorAll(".ui-dialog")].find((d) => d.querySelector(".ui-dialog-title")!.textContent === "Popup")!;
    const box = dlg.querySelector("input") as HTMLInputElement;
    expect(box.value).toBe("4");
    setValue(box, "11");
    await flush();
    const next = atomically(() => readTChan(results));
    (dlg.querySelector("button[id$=_ok]") as HTMLButtonElement).click();
    expect(await next).toEqual(["k1", Just(11)]);
  });

  it("validate marks its views (with the original's inverted class)", async () => {
    const [inp] = newTStateIO<boolean, GadgetData<number>>(GadgetData(true, 5));
    const [out, el] = render(inp, validate((n: number) => n < 10, typedTextBox<any, any, number>(showInt, readInt)));
    const view = el.firstElementChild as HTMLElement;
    await flush();
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(true, 5));
    expect(view.classList.contains("invalid")).toBe(true); // Faithful: "invalid" while valid.
    setValue(el.querySelector("input")!, "50");
    await flush();
    expect(view.classList.contains("invalid")).toBe(false);
    expect(behaviour(out.gadgetOutput)).toEqual(GadgetData(false, 50));
  });
});
