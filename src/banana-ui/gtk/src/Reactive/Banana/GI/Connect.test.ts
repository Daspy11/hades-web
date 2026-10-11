// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import {
  behaviorLink, eventLink, registerIOSignal, registerIOSignal1, registerIOSignal2,
} from "./Connect";

function collect<A>(e: B.Event<A>): A[] {
  const out: A[] = [];
  B.subscribeE(e, (a) => out.push(a));
  return out;
}

describe("registerIOSignal", () => {
  test("fires the event when the button emits clicked", () => {
    const net = B.compile(() => {});
    B.actuate(net);
    const btn = Gtk.buttonNewWithLabel("Press");
    let n = 0;
    const ev = B.runMomentIO(net, () => registerIOSignal(btn, Gtk.onButtonClicked, () => [null, ++n]));
    const seen = collect(ev);
    btn.emit("clicked");
    btn.emit("clicked");
    expect(seen).toEqual([1, 2]);
  });

  test("returns the handler result to the toolkit", () => {
    const area = Gtk.drawingAreaNew();
    const ev = B.liftMomentIO(() =>
      registerIOSignal1(area, Gtk.onWidgetKeyPressEvent, (k) => [true, k]));
    const seen = collect(ev);
    const r = area.emit("key-press-event", "k1");
    expect(r).toBe(true);
    expect(seen).toEqual(["k1"]);
  });

  test("two-argument signals pass both arguments", () => {
    const store = Gtk.seqStoreNew<string>(["a", "b"]);
    const ev = B.liftMomentIO(() =>
      registerIOSignal2(store, Gtk.afterTreeModelRowChanged, (p, _it) => [null, p.toString()]));
    const seen = collect(ev);
    Gtk.seqStoreSetValue(store, 1, "c");
    expect(seen).toEqual(["1"]);
  });
});

describe("eventLink / behaviorLink", () => {
  test("eventLink pushes event values to the widget, and stops on destroy", async () => {
    const label = Gtk.labelNew("x");
    const [e, fire] = B.newEvent<string>();
    B.liftMomentIO(() => eventLink(label, Gtk.labelSetText, e));
    fire("hello");
    expect(Gtk.labelGetText(label)).toBe("hello");
    Gtk.widgetDestroy(label);
    await new Promise((r) => setTimeout(r, 0));
    fire("after");
    expect(Gtk.labelGetText(label)).toBe("hello");
  });

  test("behaviorLink follows the behavior", () => {
    const label = Gtk.labelNew("x");
    const [e, fire] = B.newEvent<string>();
    B.liftMomentIO(() => {
      const b = B.stepper("init", e);
      behaviorLink(label, Gtk.labelSetText, b);
    });
    fire("one");
    expect(Gtk.labelGetText(label)).toBe("one");
    fire("two");
    expect(Gtk.labelGetText(label)).toBe("two");
  });
});
