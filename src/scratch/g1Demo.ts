/**
 * Scratch demo for the banana-ui GTK modules ported by agent G1 (`?demo=g1`): an editable table
 * (`mkTableView`), a tree table (`mkTreeTableView`) and a popup menu (`mkGtkMenu`).
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node, type Forest } from "@/lib/Data/Tree";
import { lens, type Lens } from "@/lib/Control/Lens";
import { longDate, makeChanges, textPrismInt } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  EditBool, EditColour, EditDate, EditEntry, EditIcon, EditNote, Opt, TableAdd, TableDelete, TableShuffle,
  enumField, mkField, type Table,
} from "@/banana-ui/base/Reactive/Banana/Table";
import { eventLink } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { registerIOSignal } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { mkGtkMenu, popupMenuOn } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Menu";
import { mkTableView, mkTreeTableView } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Table";
import { widgetLinkColour } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Common";

type Kind = "Goal" | "Strategy" | "Solution";
interface Row {
  readonly name: string;
  readonly count: number;
  readonly done: boolean;
  readonly kind: Kind;
  readonly colour: C.Colour;
  readonly due: string;
  readonly icon: string;
  readonly note: Maybe<string>;
}
const field = <K extends keyof Row>(k: K): Lens<Row, Row[K]> =>
  lens((r: Row) => r[k], (r: Row, v: Row[K]) => ({ ...r, [k]: v }));

const kindColour = (k: Kind): C.Colour =>
  k === "Goal" ? C.sRGB24(204, 230, 255) : k === "Strategy" ? C.sRGB24(255, 236, 179) : C.sRGB24(30, 90, 50);

const cols: Table<Row> = [
  mkField("Name", field("name"), Just((r: string) => (r.startsWith("G") ? "emblem-ok-symbolic" : "")), EditNote, Nothing),
  mkField("Count", field("count"), Nothing, EditEntry(textPrismInt), Nothing),
  mkField("Done", field("done"), Nothing, EditBool, Nothing),
  mkField("Kind", field("kind"), Nothing, enumField<Kind>(["Goal", "Strategy", "Solution"]), Just(kindColour)),
  mkField("Colour", field("colour"), Nothing, EditColour, Nothing),
  mkField("Due", field("due"), Nothing, EditDate(longDate), Nothing),
  mkField("Icon", field("icon"), Nothing, EditIcon(() => true), Nothing),
  mkField("Note", field("note"), Nothing, Opt(EditNote), Nothing),
];

const rows: Row[] = [
  { name: "G1 System is safe", count: 3, done: true, kind: "Goal", colour: C.sRGB24(255, 128, 128), due: "2024-03-01", icon: "document-open", note: Just("Top goal") },
  { name: "S1 Argue over hazards", count: 12, done: false, kind: "Strategy", colour: C.sRGB24(40, 60, 160), due: "2024-04-15", icon: "edit-undo", note: Nothing },
  { name: "Sn1 Test results", count: 7, done: false, kind: "Solution", colour: C.sRGB24(250, 250, 210), due: "2024-05-30", icon: "", note: Nothing },
];

interface Item { readonly label: string; readonly size: number }
const itemLabel: Lens<Item, string> = lens((i: Item) => i.label, (i: Item, l: string) => ({ ...i, label: l }));
const itemSize: Lens<Item, number> = lens((i: Item) => i.size, (i: Item, n: number) => ({ ...i, size: n }));
const forest: Forest<Item> = [
  Node({ label: "Package A", size: 2 }, [Node({ label: "Diagram 1", size: 10 }), Node({ label: "Diagram 2", size: 4 })]),
  Node({ label: "Package B", size: 1 }, [Node({ label: "Diagram 3", size: 8 })]),
];

export function main(): void {
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "G1 demo: tables and menus");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  Gtk.containerSetBorderWidth(vbox, 8);
  Gtk.containerAdd(win, vbox);
  const status = Gtk.labelNew("Edit the table, or use the menu button.");
  Gtk.labelSetXalign(status, 0);
  const menuButton = Gtk.buttonNewWithLabel("Menu…");
  const hbox = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  Gtk.boxPackStart(hbox, menuButton, false, false, 0);
  Gtk.boxPackStart(hbox, status, true, true, 0);
  const colourEntry = Gtk.entryNew();
  Gtk.entrySetText(colourEntry, "linked colour");
  Gtk.boxPackEnd(hbox, colourEntry, false, false, 0);
  Gtk.boxPackStart(vbox, hbox, false, false, 0);

  const net = B.compile(() => {
    const [setE] = B.newEvent<readonly Row[]>();
    const [box, , actE, editE] = mkTableView(
      Gtk.iconThemeGetDefault(),
      [TableAdd("Row", rows[2]), TableDelete, TableShuffle],
      true,
      cols,
      rows,
      setE,
      B.pureB<readonly Row[]>(rows),
    );
    Gtk.boxPackStart(vbox, box, true, true, 0);

    const [tbox, , tAct] = mkTreeTableView(
      Gtk.iconThemeGetDefault(),
      true,
      [
        [mkField("Package", itemLabel, Nothing, EditNote, Nothing)],
        [mkField("Diagram", itemLabel, Nothing, EditNote, Nothing), mkField("Size", itemSize, Nothing, EditEntry(textPrismInt), Nothing)],
      ],
      forest,
      makeChanges(forest, B.never()),
    );
    Gtk.boxPackStart(vbox, tbox, true, true, 0);

    const [gtkMenu, menuE] = mkGtkMenu(Menu<string>([
      [menuItem("Add goal", "add goal"), menuItem("Add strategy", "add strategy")],
      [subMenu("Export", Menu([[menuItem("As PNG", "export png"), menuItem("As SVG", "export svg")]]))],
      [menuItem("Properties…", "properties")],
    ]));
    const clicks = registerIOSignal(menuButton, Gtk.onButtonClicked, () => [null, gtkMenu] as const);
    popupMenuOn(clicks);

    const messages = B.unionWith(
      (a: string, _b: string) => a,
      B.mapE((v: string) => "Menu: " + v, menuE),
      B.unionWith(
        (a: string, _b: string) => a,
        B.mapE((rs: Row[]) => `Table edited: ${rs.length} rows, counts ${rs.map((r) => r.count).join(", ")}`, editE),
        B.unionWith(
          (a: string, _b: string) => a,
          B.mapE(([n, r]: [number, Row]) => `Activated row ${n}: ${r.name}`, actE),
          B.mapE(([p, r]: [Gtk.TreePath, Item]) => `Tree activated ${p.toString()}: ${r.label}`, tAct),
        ),
      ),
    );
    eventLink(status, Gtk.labelSetText, messages);
    const colourB = B.stepper<Maybe<C.Colour>>(Just(C.sRGB24(40, 60, 160)), B.mapE((rs: Row[]) => Just(rs[0]?.colour ?? C.white), editE));
    widgetLinkColour(colourEntry, Just(C.sRGB24(40, 60, 160)), B.never(), colourB);
  });
  B.actuate(net);
  Gtk.widgetShowAll(win);
  Gtk.main();
}
