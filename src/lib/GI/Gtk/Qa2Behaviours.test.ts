// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";

describe("shared scroll adjustments (ForestTable header above a scrolled body)", () => {
  it("layoutNew / scrolledWindowNew use the adjustments they are given", () => {
    const base = Gtk.layoutNew(null, null);
    const h = Gtk.scrollableGetHadjustment(base);
    const header = Gtk.layoutNew(h, null);
    const scroll = Gtk.scrolledWindowNew(h, null);
    expect(Gtk.scrollableGetHadjustment(header)).toBe(h);
    expect(Gtk.scrolledWindowGetHadjustment(scroll)).toBe(h);
  });

  it("a layout outside a scrolled window is drawn offset by its adjustment", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { WidgetView } = await import("./Render");
    const h = Gtk.adjustmentNew(0, 0, 1000, 1, 10, 100);
    const header = Gtk.layoutNew(h, null);
    Gtk.layoutSetSize(header, 1000, 20);
    Gtk.layoutPut(header, Gtk.labelNew("Heading"), 0, 0);
    expect(renderToStaticMarkup(React.createElement(WidgetView, { w: header }))).not.toContain("translate");
    Gtk.adjustmentSetValue(h, 30);
    expect(renderToStaticMarkup(React.createElement(WidgetView, { w: header }))).toContain("translate(-30px, 0px)");
  });
});

describe("tree view button presses", () => {
  it("a click on the blank area below the rows emits button-press-event (GTK delivers it too)", async () => {
    const React = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { WidgetView } = await import("./Render");
    const store = Gtk.forestStoreNew<string>([]);
    const vw = Gtk.treeViewNewWithModel(store);
    const events: number[] = [];
    Gtk.onWidgetButtonPressEvent(vw, (ev) => {
      events.push(ev.button);
      return true;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(WidgetView, { w: vw })));
    const tree = host.querySelector('[role="tree"]')!;
    expect(tree).not.toBeNull();
    await act(async () => {
      tree.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
    });
    expect(events).toEqual([3]);
    await act(async () => root.unmount());
    host.remove();
  });
});
