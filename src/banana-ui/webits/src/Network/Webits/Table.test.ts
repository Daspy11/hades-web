/** Tests of the pure parts of `Network.Webits.Table`. */
import { describe, expect, it } from "vitest";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import * as M from "@/lib/Data/Map";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { lens, preview, review, type Lens } from "@/lib/Control/Lens";
import { RemoteValue } from "@/lib/Network/JavaScript";
import * as H from "@/lib/Text/Blaze/Html5";
import { fromGregorian } from "@/lib/Data/Time";
import { textPrismDouble, type Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  EditBool,
  EditColour,
  EditDate,
  EditEntry,
  EditFixed,
  EditIcon,
  EditNote,
  Opt,
  TableField,
  enumField,
  mkField,
} from "@/banana-ui/base/Reactive/Banana/Table";
import { IconData, IconGroup, scottyIcons } from "./Icons";
import {
  FromJSON_TableIconClick,
  FromJSON_TableRowOp,
  TableIconClick,
  TableRowDelete,
  TableRowInsert,
  TableRowSwap,
  applyTableRowOp,
  columnId,
  fieldToColumn,
  jsSendChange,
  nullIsNothing,
  show_TableIconClick,
  tableIcon,
  updateDecorations,
  type WebitTable,
} from "./Table";

interface Row {
  readonly flag: boolean;
  readonly num: number;
  readonly icon: string;
  readonly colour: Colour;
}
const flag: Lens<Row, boolean> = lens((r) => r.flag, (r, v) => ({ ...r, flag: v }));
const num: Lens<Row, number> = lens((r) => r.num, (r, v) => ({ ...r, num: v }));
const iconL: Lens<Row, string> = lens((r) => r.icon, (r, v) => ({ ...r, icon: v }));
const colourL: Lens<Row, Colour> = lens((r) => r.colour, (r, v) => ({ ...r, colour: v }));
const row0: Row = { flag: true, num: 2.5, icon: "go-up", colour: C.sRGB24(255, 0, 0) };
const grid = RemoteValue<WebitTable<Row>>(7);
const wId = "11111111-2222-3333-4444-555555555555";

describe("applyTableRowOp", () => {
  const xs = ["a", "b", "c", "d"];
  it("inserts the default, or ignores the insertion without one", () => {
    expect(applyTableRowOp(Just("x"), TableRowInsert(1), xs)).toEqual(["a", "x", "b", "c", "d"]);
    expect(applyTableRowOp(Just("x"), TableRowInsert(4), xs)).toEqual(["a", "b", "c", "d", "x"]);
    expect(applyTableRowOp(Just("x"), TableRowInsert(9), xs)).toEqual(["a", "b", "c", "d", "x"]);
    expect(applyTableRowOp(Just("x"), TableRowInsert(-2), xs)).toEqual(["x", "a", "b", "c", "d"]);
    expect(applyTableRowOp(Nothing, TableRowInsert(1), xs)).toEqual(xs);
  });
  it("deletes", () => {
    expect(applyTableRowOp(Nothing, TableRowDelete(0), xs)).toEqual(["b", "c", "d"]);
    expect(applyTableRowOp(Nothing, TableRowDelete(3), xs)).toEqual(["a", "b", "c"]);
    expect(applyTableRowOp(Nothing, TableRowDelete(4), xs)).toEqual(xs);
  });
  it("swaps with the successor", () => {
    expect(applyTableRowOp(Nothing, TableRowSwap(1), xs)).toEqual(["a", "c", "b", "d"]);
    expect(applyTableRowOp(Nothing, TableRowSwap(3), xs)).toEqual(xs);
  });
});

describe("JSON", () => {
  it("parses row operations", () => {
    expect(J.parseEither(FromJSON_TableRowOp.parseJSON, { op: "insert", n: 2 })).toEqual({ tag: "Right", value: TableRowInsert(2) });
    expect(J.parseEither(FromJSON_TableRowOp.parseJSON, { op: "delete" })).toEqual({ tag: "Right", value: TableRowDelete(0) });
    expect(J.parseEither(FromJSON_TableRowOp.parseJSON, { op: "swap", n: 1 })).toEqual({ tag: "Right", value: TableRowSwap(1) });
    const bad = J.parseEither(FromJSON_TableRowOp.parseJSON, { op: "spin", n: 1 });
    expect(bad.tag).toBe("Left");
    expect(bad.tag === "Left" && bad.value).toContain('Unrecognised table op: "spin"');
    // A whole-table edit (an array) is not a row operation.
    expect(J.parseEither(FromJSON_TableRowOp.parseJSON, [{ col0: true }]).tag).toBe("Left");
  });
  it("parses icon clicks, keeping the icon name of the URL", () => {
    const r = J.parseEither(FromJSON_TableIconClick.parseJSON, { src: "http://localhost/x/y.svg#/icons/go-up", col: "col2", idx: 3 });
    expect(r).toEqual({ tag: "Right", value: TableIconClick("go-up", "col2", 3) });
    expect(show_TableIconClick(TableIconClick("go-up", "col2", 3))).toBe(
      'TableIconClick {tableIconSrc = "go-up", tableIconColumn = "col2", tableIconIndex = 3}',
    );
  });
  it("names the columns", () => {
    expect(columnId(0)).toBe("col0");
    expect(columnId(12)).toBe("col12");
  });
  it("treats null as Nothing", () => {
    const p = nullIsNothing(J._Bool());
    expect(preview(p, null)).toEqual(Just(Nothing));
    expect(preview(p, true)).toEqual(Just(Just(true)));
    expect(preview(p, "true")).toEqual(Nothing);
    expect(review(p, Nothing)).toBe(null);
    expect(review(p, Just(false))).toBe(false);
  });
});

describe("fieldToColumn", () => {
  const getSet = <A>(tf: TableField<Row, A>) => {
    const [js, getter, setter] = fieldToColumn(wId, false, grid, 1, tf);
    return { js, getter, setter };
  };
  it("builds a custom AppendGrid column", () => {
    const { js } = getSet(TableField("Number", num, Nothing, EditEntry(textPrismDouble), Nothing));
    expect(js.startsWith('{name:"col1",display:"Number",type:"custom",customBuilder:function (parent, idPrefix, name, uniqueIndex) {')).toBe(true);
    expect(js).toContain("return document.getElementById(controlId).value;");
    expect(js).toContain("document.getElementById(controlId).value=v;");
    expect(js).toContain("let n=parent.childNodes[0];");
    const { js: jsBool } = getSet(TableField("Flag", flag, Just((b: boolean) => (b ? "a" : "b")), EditBool, Nothing));
    expect(jsBool).toContain("let n=parent.childNodes[1];"); // After the decoration icon.
    expect(jsBool).toContain(".checked;");
  });
  it("converts booleans", () => {
    const { getter, setter } = getSet(TableField("Flag", flag, Nothing, EditBool, Nothing));
    expect(getter(row0)).toBe(true);
    expect(setter(false)(row0)).toEqual({ ...row0, flag: false });
    expect(setter("x")(row0)).toEqual(row0);
  });
  it("converts text entries through the prism", () => {
    const { getter, setter } = getSet(TableField("Number", num, Nothing, EditEntry(textPrismDouble), Nothing));
    expect(getter(row0)).toBe("2.5");
    expect(setter("7.0")(row0)).toEqual({ ...row0, num: 7 });
    expect(setter("seven")(row0)).toEqual(row0);
  });
  it("converts enumerations to indices (and ignores the browser's string values)", () => {
    const { getter, setter } = getSet(TableField("Icon", iconL, Nothing, enumField(["go-up", "go-down"]), Nothing));
    expect(getter(row0)).toBe(0);
    expect(setter(1)(row0)).toEqual({ ...row0, icon: "go-down" });
    expect(setter(1.7)(row0)).toEqual({ ...row0, icon: "go-down" });
    expect(setter("1")(row0)).toEqual(row0);
    expect(setter(5)(row0)).toEqual(row0);
  });
  it("converts colours and dates", () => {
    const { getter, setter } = getSet(TableField("Colour", colourL, Nothing, EditColour, Nothing));
    expect(getter(row0)).toBe("#ff0000");
    expect(setter("#00ff00")(row0).colour).toEqual(C.sRGB24(0, 255, 0));
    interface D { readonly d: string }
    const dl: Lens<D, string> = lens((r) => r.d, (r, v) => ({ ...r, d: v }));
    const [, g2, s2] = fieldToColumn(wId, false, RemoteValue<WebitTable<D>>(1), 0, TableField("Date", dl, Nothing, EditDate("%-d/%-m/%Y"), Nothing));
    expect(g2({ d: fromGregorian(2021, 8, 1) })).toBe("2021-08-01");
    expect(s2("2022-03-04")({ d: "" })).toEqual({ d: "2022-03-04" });
  });
  it("handles optional fields", () => {
    interface O { readonly o: import("@/lib/Data/Maybe").Maybe<number>; readonly b: import("@/lib/Data/Maybe").Maybe<boolean> }
    const ol: Lens<O, import("@/lib/Data/Maybe").Maybe<number>> = lens((r) => r.o, (r, v) => ({ ...r, o: v }));
    const bl: Lens<O, import("@/lib/Data/Maybe").Maybe<boolean>> = lens((r) => r.b, (r, v) => ({ ...r, b: v }));
    const g = RemoteValue<WebitTable<O>>(1);
    const [, getO, setO] = fieldToColumn(wId, false, g, 0, TableField("O", ol, Nothing, Opt(EditEntry(textPrismDouble)), Nothing));
    expect(getO({ o: Nothing, b: Nothing })).toBe("");
    expect(getO({ o: Just(3), b: Nothing })).toBe("3.0");
    expect(setO("")({ o: Just(3), b: Nothing }).o).toEqual(Nothing);
    expect(setO("4.5")({ o: Nothing, b: Nothing }).o).toEqual(Just(4.5));
    const [jsB, getB, setB] = fieldToColumn(wId, false, g, 1, TableField("B", bl, Nothing, Opt(EditBool), Nothing));
    expect(jsB).toContain('<option value=\\"null\\"></option><option value=\\"true\\">Yes</option>');
    expect(getB({ o: Nothing, b: Nothing })).toBe(null);
    expect(getB({ o: Nothing, b: Just(true) })).toBe(true);
    expect(setB(null)({ o: Nothing, b: Just(true) }).b).toEqual(Nothing);
  });
  it("shows fixed and note fields", () => {
    const [jsF, getF, setF] = fieldToColumn(wId, true, grid, 0, TableField("Fixed", num, Nothing, EditFixed((n: number) => "n=" + String(n)), Nothing));
    expect(getF(row0)).toBe("n=2.5");
    expect(setF("n=3")(row0)).toEqual(row0); // Read-only.
    expect(jsF).toContain("parent.onclick=function (e) {jsb.event({d:" + JSON.stringify(wId) + ",v:jsb.rs[7].getRowIndex(uniqueIndex)});};");
    const [jsN] = fieldToColumn(wId, true, grid, 0, TableField("Note", iconL, Nothing, EditNote, Nothing));
    expect(jsN).toContain('readonly=\\"1\\"');
  });
});

describe("JavaScript and HTML", () => {
  scottyIcons([IconGroup("Actions", M.fromList([["go-up", IconData("/src/lib/GI/Gtk/icons/Adwaita/go-up-symbolic.svg", "IconSvg")]]))]);
  it("sends the table contents", () => {
    expect(jsSendChange(wId, grid)).toBe('if (jsb.rs[7]) {jsb.event({d:"' + wId + '",v:jsb.rs[7].getAllValue()});}');
  });
  it("updates icon and colour decorations", () => {
    const spec = [
      mkField("Flag", flag, Just((b: boolean) => (b ? "go-up" : "go-down")), EditBool, Just((b: boolean) => (b ? C.sRGB24(0, 0, 255) : C.sRGB24(0, 0, 0)))),
      mkField("Icon", iconL, Nothing, EditIcon(() => true), Nothing),
    ];
    const js = updateDecorations(spec, grid, [row0, { ...row0, flag: false }]);
    expect(js).toContain('jsb.rs[7].getCellCtrl("col0",0).previousSibling.src="');
    expect(js).toContain('#/icons/go-up";');
    expect(js).toContain('jsb.rs[7].getCellCtrl("col0",0).parentNode.style.backgroundColor="#0000ff";');
    expect(js).toContain('jsb.rs[7].getCellCtrl("col0",1).previousSibling.src="/icons/go-down";');
    expect(js).toContain('jsb.rs[7].getCellCtrl("col0",1).parentNode.style.backgroundColor="#000000";');
    expect(js).not.toContain("col1");
  });
  it("renders table icons", () => {
    expect(H.renderHtml(tableIcon(false, wId, grid, 2))).toBe(
      '<img alt="col2" src="/icons/no-icon" class="icon-inline" onclick="jsb.event({d:&quot;' + wId + '&quot;,v:{src:this.src,idx:this.dsmUnique,col:&quot;col2&quot;}});">',
    );
  });
});
