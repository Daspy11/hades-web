import { describe, expect, it } from "vitest";
import { suppressBrowserContextMenu } from "./RenderRoot";

function fire(target: Element): boolean {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "target", { value: target });
  suppressBrowserContextMenu(e);
  return e.defaultPrevented;
}

describe("browser context menu", () => {
  it("is suppressed over widgets and popups", () => {
    const div = document.createElement("div");
    div.innerHTML = '<div role="tree"><span>Model</span></div>';
    expect(fire(div.querySelector("span")!)).toBe(true);
  });
  it("is kept for editable text", () => {
    expect(fire(document.createElement("input"))).toBe(false);
    expect(fire(document.createElement("textarea"))).toBe(false);
  });
});
