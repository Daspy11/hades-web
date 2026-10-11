// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import { cannotHappen, errorBox } from "./ErrorBox";
import { getDataIconTheme, setDataIconTheme } from "./DataIconTheme";

/** The message dialogs currently registered as toplevels. */
function messageDialogs(): Gtk.MessageDialog[] {
  return Gtk.toplevels.list().filter((w): w is Gtk.MessageDialog => w instanceof Gtk.MessageDialog);
}

describe("errorBox", () => {
  test("shows a modal error dialog, transient for the parent's window, until it is closed", async () => {
    const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
    const btn = Gtk.buttonNewWithLabel("x");
    Gtk.containerAdd(win, btn);
    let done = false;
    const p = errorBox(btn, "Broken").then(() => {
      done = true;
    });
    const d = messageDialogs().find((m) => m.text === "Broken")!;
    expect(d).toBeDefined();
    expect(d.messageType).toBe(Gtk.MessageTypeError);
    expect(d.modal).toBe(true);
    expect(d.transientFor).toBe(win);
    await Promise.resolve();
    expect(done).toBe(false);
    Gtk.dialogResponse(d, Gtk.ResponseTypeClose);
    await p;
    expect(done).toBe(true);
    expect(d.destroyed).toBe(true);
  });

  test("cannotHappen shows the box without waiting and returns the value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(cannotHappen("oops", 42)).toBe(42);
    const d = messageDialogs().find((m) => m.text.endsWith("oops"))!;
    expect(d.text).toBe(
      "An unexpected event has occured. Please save your work in a new file and report this bug.\n\noops");
    Gtk.dialogResponse(d, Gtk.ResponseTypeClose);
    spy.mockRestore();
  });
});

describe("DataIconTheme", () => {
  test("is initially an empty theme and can be replaced", () => {
    const t0 = getDataIconTheme();
    expect(t0).toBeInstanceOf(Gtk.IconTheme);
    const t1 = Gtk.iconThemeNew();
    setDataIconTheme(t1);
    expect(getDataIconTheme()).toBe(t1);
    setDataIconTheme(t0);
  });
});
