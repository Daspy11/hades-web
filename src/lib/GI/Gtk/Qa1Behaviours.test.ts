import { describe, expect, it } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import { notebookPopupPageMenu, MenuItem } from "./Widgets";

describe("notebook enable-popup", () => {
  it("does nothing unless enable-popup is set", () => {
    const nb = Gtk.notebookNew();
    Gtk.notebookAppendPage(nb, Gtk.labelNew("page a"), Gtk.labelNew("Tab A"));
    expect(notebookPopupPageMenu(nb)).toBeNull();
  });

  it("lists the pages by menu label, else tab label text, else Page N; an item switches page", () => {
    const nb = Gtk.notebookNew();
    Gtk.notebookAppendPageMenu(nb, Gtk.labelNew("page a"), Gtk.labelNew("Tab A"), Gtk.labelNew("Menu A"));
    Gtk.notebookAppendPage(nb, Gtk.labelNew("page b"), Gtk.labelNew("Tab B"));
    Gtk.notebookAppendPage(nb, Gtk.labelNew("page c"), Gtk.boxNew(Gtk.OrientationHorizontal, 0));
    Gtk.setNotebookEnablePopup(nb, true);
    Gtk.notebookSetCurrentPage(nb, 0);
    const menu = notebookPopupPageMenu(nb);
    expect(menu).not.toBeNull();
    const items = menu!.children as MenuItem[];
    expect(items.map((i) => i.label)).toEqual(["Menu A", "Tab B", "Page 3"]);
    items[1].activate();
    expect(Gtk.notebookGetCurrentPage(nb)).toBe(1);
  });
});

describe("toolbar show-arrow", () => {
  it("defaults to true, as in GTK", () => {
    const t = Gtk.toolbarNew();
    expect(Gtk.toolbarGetShowArrow(t)).toBe(true);
    Gtk.toolbarSetShowArrow(t, false);
    expect(t.showArrow).toBe(false);
  });
});

describe("gtk-entry-select-on-focus", () => {
  it("widgetGrabFocus on an entry selects its text", () => {
    const e = Gtk.entryNew();
    const input = document.createElement("input");
    input.value = "Package 1";
    document.body.appendChild(input);
    e.setElement(input);
    Gtk.widgetGrabFocus(e);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Package 1".length]);
    input.remove();
  });
});

describe("grid rows", () => {
  it("an expanding row keeps its children's minimum height (minmax(auto, 1fr), not minmax(0, 1fr))", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { WidgetView } = await import("./Render");
    const g = Gtk.gridNew();
    const sw = Gtk.scrolledWindowNew(null, null);
    Gtk.widgetSetVexpand(sw, true);
    Gtk.gridAttach(g, Gtk.labelNew("Name"), 0, 0, 1, 1);
    Gtk.gridAttach(g, sw, 1, 1, 1, 1);
    const html = renderToStaticMarkup(React.createElement(WidgetView, { w: g }));
    expect(html).toContain("grid-template-rows:auto minmax(auto, 1fr)");
  });
});
