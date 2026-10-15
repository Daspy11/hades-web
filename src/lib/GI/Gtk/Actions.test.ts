import { describe, expect, it } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as Gio from "@/lib/GI/Gio";
import { actionEnabledFor } from "./Widgets";

describe("widgets bound to actions", () => {
  it("are insensitive while their action does not exist or is disabled (as GTK)", () => {
    const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
    const item = Gtk.menuItemNewWithLabel("Import License");
    Gtk.containerAdd(win, item);
    expect(actionEnabledFor(item, "win.actions-test-missing")).toBe(false);
    const a = Gio.simpleActionNew("actions-test-present", null);
    Gio.actionMapAddAction(win, a);
    expect(actionEnabledFor(item, "win.actions-test-present")).toBe(true);
    Gio.simpleActionSetEnabled(a, false);
    expect(actionEnabledFor(item, "win.actions-test-present")).toBe(false);
  });
});
