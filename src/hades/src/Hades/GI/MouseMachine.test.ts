// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as B from "@/lib/Reactive/Banana";
import {
  type MouseCommand, DoubleClick, MouseCommand as mkCommand, MouseDrag, MouseEndDrag, MouseKey, MouseZoom,
  RightClick, SingleClick, mouseCommandEvent,
} from "./MouseMachine";

/** A drawing area wired to the mouse machine, and the commands it has produced. */
function setup(): { area: Gtk.DrawingArea; seen: MouseCommand[] } {
  const area = Gtk.drawingAreaNew();
  const ev = B.liftMomentIO(() => mouseCommandEvent(area));
  const seen: MouseCommand[] = [];
  B.subscribeE(ev, (c) => seen.push(c));
  return { area, seen };
}

function button(type: Gdk.EventType, btn: number, x: number, y: number, state: Gdk.ModifierType[] = []): Gdk.EventButton {
  return { type, button: btn, x, y, xRoot: x, yRoot: y, state, time: 0 };
}
const press = (b: number, x: number, y: number, s: Gdk.ModifierType[] = []) => button("EventTypeButtonPress", b, x, y, s);
const press2 = (b: number, x: number, y: number) => button("EventType2buttonPress", b, x, y);
const release = (b: number, x: number, y: number, s: Gdk.ModifierType[] = []) => button("EventTypeButtonRelease", b, x, y, s);
const motion = (x: number, y: number, state: Gdk.ModifierType[] = [Gdk.ModifierTypeButton1Mask]): Gdk.EventMotion =>
  ({ x, y, state, time: 0 });
const key = (keyval: number, state: Gdk.ModifierType[] = []): Gdk.EventKey => ({ keyval, key: "", state, time: 0 });
const scroll = (deltaY: number, state: Gdk.ModifierType[]): Gdk.EventScroll =>
  ({ direction: "ScrollDirectionSmooth", x: 0, y: 0, deltaX: 0, deltaY, state, time: 0 });

describe("mouseCommandEvent", () => {
  test("press and release with the left button is a single click at the release point", () => {
    const { area, seen } = setup();
    expect(area.emit("button-press-event", press(1, 10, 20))).toBe(true);
    expect(area.emit("button-release-event", release(1, 11, 21, [Gdk.ModifierTypeShiftMask]))).toBe(true);
    expect(seen).toEqual([mkCommand(SingleClick, [11, 21], [Gdk.ModifierTypeShiftMask])]);
  });

  test("a right button click is a right click", () => {
    const { area, seen } = setup();
    area.emit("button-press-event", press(3, 5, 5));
    area.emit("button-release-event", release(3, 5, 5));
    expect(seen).toEqual([mkCommand(RightClick, [5, 5], [])]);
  });

  test("middle clicks and mismatched releases are ignored", () => {
    const { area, seen } = setup();
    area.emit("button-press-event", press(2, 5, 5));
    area.emit("button-release-event", release(2, 5, 5));
    area.emit("button-press-event", press(1, 5, 5));
    area.emit("button-release-event", release(3, 5, 5));
    expect(seen).toEqual([]);
    // The machine has restarted: a normal click works again.
    area.emit("button-press-event", press(1, 1, 1));
    area.emit("button-release-event", release(1, 1, 1));
    expect(seen).toEqual([mkCommand(SingleClick, [1, 1], [])]);
  });

  test("a GTK double click sequence gives a single click then a double click", () => {
    const { area, seen } = setup();
    area.emit("button-press-event", press(1, 7, 8));
    area.emit("button-release-event", release(1, 7, 8));
    area.emit("button-press-event", press(1, 7, 8));
    area.emit("button-press-event", press2(1, 7, 8));
    area.emit("button-release-event", release(1, 7, 8));
    expect(seen).toEqual([mkCommand(SingleClick, [7, 8], []), mkCommand(DoubleClick, [7, 8], [])]);
  });

  test("dragging gives cumulative deltas from the press point, then an end drag", () => {
    const { area, seen } = setup();
    area.emit("button-press-event", press(1, 10, 10, [Gdk.ModifierTypeControlMask]));
    area.emit("motion-notify-event", motion(12, 13));
    area.emit("motion-notify-event", motion(20, 30));
    // A spurious key press during the drag repeats the last drag.
    area.emit("key-press-event", key(0x61));
    area.emit("button-release-event", release(1, 20, 30));
    const mods = [Gdk.ModifierTypeControlMask];
    expect(seen).toEqual([
      mkCommand(MouseDrag([2, 3]), [10, 10], mods),
      mkCommand(MouseDrag([10, 20]), [10, 10], mods),
      mkCommand(MouseDrag([10, 20]), [10, 10], mods),
      mkCommand(MouseEndDrag([10, 20]), [10, 10], mods),
    ]);
  });

  test("motion without button 1 down is not a drag", () => {
    const { area, seen } = setup();
    expect(area.emit("motion-notify-event", motion(1, 1, []))).toBe(false);
    area.emit("button-press-event", press(3, 0, 0));
    area.emit("motion-notify-event", motion(5, 5, [Gdk.ModifierTypeButton3Mask]));
    area.emit("button-release-event", release(3, 5, 5));
    expect(seen).toEqual([mkCommand(RightClick, [5, 5], [])]);
  });

  test("keys become key commands, with GDK special keys mapped to control characters", () => {
    const { area, seen } = setup();
    area.emit("key-press-event", key(0x61, [Gdk.ModifierTypeControlMask]));
    area.emit("key-press-event", key(Gdk.KEY_Delete));
    area.emit("key-press-event", key(Gdk.KEY_Return));
    area.emit("key-press-event", key(Gdk.KEY_Left));
    expect(seen).toEqual([
      mkCommand(MouseKey("a"), [0, 0], [Gdk.ModifierTypeControlMask]),
      mkCommand(MouseKey("\x7f"), [0, 0], []),
      mkCommand(MouseKey("\r"), [0, 0], []),
      mkCommand(MouseKey("\0"), [0, 0], []),
    ]);
  });

  test("control-scroll zooms and is handled; plain scrolling is passed on", () => {
    const { area, seen } = setup();
    expect(area.emit("scroll-event", scroll(1, [Gdk.ModifierTypeControlMask]))).toBe(true);
    expect(area.emit("scroll-event", scroll(1, []))).toBe(false);
    expect(seen).toEqual([MouseZoom(1.01)]);
  });

  test("zooming half way through a click cancels the click", () => {
    const { area, seen } = setup();
    area.emit("button-press-event", press(1, 0, 0));
    area.emit("scroll-event", scroll(-1, [Gdk.ModifierTypeControlMask]));
    area.emit("button-release-event", release(1, 0, 0));
    expect(seen).toEqual([]);
  });
});
