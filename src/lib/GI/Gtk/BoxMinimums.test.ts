// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { keepBoxMinimums } from "./Render";

// jsdom has no layout: element heights are stubbed and the ResizeObserver / animation frame are
// driven by hand.

let roCallbacks: (() => void)[] = [];
let observedCount = 0;
let frames: FrameRequestCallback[] = [];

class FakeResizeObserver {
  constructor(private readonly cb: () => void) {
    roCallbacks.push(() => this.cb());
  }
  observe(): void {
    observedCount++;
  }
  unobserve(): void {
    observedCount--;
  }
  disconnect(): void {
    observedCount = 0;
  }
}

beforeEach(() => {
  roCallbacks = [];
  observedCount = 0;
  frames = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Notify a resize and run the scheduled frame. */
function resize(): void {
  roCallbacks.forEach((cb) => cb());
  const fs = frames;
  frames = [];
  fs.forEach((f) => f(0));
}

/** Give an element a layout: `content` is the height of its content, `allotted` its own height. */
function geometry(e: HTMLElement, content: () => number, allotted: () => number): void {
  Object.defineProperty(e, "scrollHeight", { get: () => Math.max(content(), allotted()), configurable: true });
  Object.defineProperty(e, "clientHeight", { get: allotted, configurable: true });
  Object.defineProperty(e, "offsetHeight", { get: () => allotted() + 2, configurable: true }); // 1px borders.
}

function div(cls: string, parent: HTMLElement, minHeight = ""): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  e.style.minHeight = minHeight;
  parent.appendChild(e);
  return e;
}

describe("keepBoxMinimums", () => {
  test("a squeezed box child gets its content height as minimum, innermost first, and is released", () => {
    const root = div("gtk-dialog-content", document.body);
    const outer = div("gtk-box vertical", root);
    const frame = div("gtk-frame", outer); // No inline min-height: never managed.
    const middle = div("gtk-box vertical", outer, "0px");
    const table = div("gtk-box vertical", middle, "0px");
    div("gtk-scrolledWindow", table);
    let space = 42;
    geometry(table, () => 235, () => space);
    // The middle box holds the table: its content is the table's minimum (or allotted height) + 10.
    const tableHeight = () => Math.max(space, parseFloat(table.style.minHeight) || 0);
    geometry(middle, () => tableHeight() + 10, () => space + 10);
    geometry(frame, () => 500, () => 100);

    const stop = keepBoxMinimums(root);
    resize();
    expect(table.style.minHeight).toBe("237px");
    expect(table.dataset.gtkMinHeight).toBe("237px");
    // Measured after the table's minimum was set.
    expect(middle.style.minHeight).toBe("249px");
    expect(frame.style.minHeight).toBe("");
    expect(observedCount).toBeGreaterThan(1);

    // More space: no box is squeezed, the minimums are released.
    space = 300;
    resize();
    expect(table.style.minHeight).toBe("0px");
    expect(middle.style.minHeight).toBe("0px");
    expect(table.dataset.gtkMinHeight).toBeUndefined();

    stop();
    expect(observedCount).toBe(0);
  });

  test("a minimum changed by a later render is left alone", () => {
    const root = div("gtk-dialog-content", document.body);
    const box = div("gtk-box vertical", root);
    const child = div("gtk-box vertical", box, "0px");
    let space = 40;
    geometry(child, () => 100, () => space);
    keepBoxMinimums(root);
    resize();
    expect(child.style.minHeight).toBe("102px");
    child.style.minHeight = "20px"; // As React would after a height request.
    space = 20;
    resize();
    expect(child.style.minHeight).toBe("20px");
    expect(child.dataset.gtkMinHeight).toBeUndefined();
  });

  test("scroll containers are not given a minimum", () => {
    const root = div("gtk-dialog-content", document.body);
    const box = div("gtk-box vertical", root);
    const child = div("gtk-box vertical", box, "0px");
    child.style.overflowY = "auto";
    geometry(child, () => 100, () => 40);
    keepBoxMinimums(root);
    resize();
    expect(child.style.minHeight).toBe("0px");
  });
});
