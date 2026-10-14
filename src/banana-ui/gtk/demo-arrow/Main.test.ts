// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import { drawTree } from "@/lib/Data/Tree";
import { showGadget } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { loopDialog1, main } from "./Main";
import { initialValue, show_DemoData } from "./Demo/Dialog";

// `Gtk.main` mounts the React views; the behaviour is tested on the widget objects alone.
vi.mock("@/lib/GI/Gtk", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/GI/Gtk")>()), main: () => {} }));

function allWidgets(w: Gtk.Widget): Gtk.Widget[] {
  return [w, ...w.getChildren().flatMap(allWidgets)];
}
function buttonLabelled(w: Gtk.Widget, label: string): Gtk.Button {
  const b = allWidgets(w).find((x): x is Gtk.Button => x instanceof Gtk.Button && x.label === label);
  if (!b) throw new Error("No button " + label);
  return b;
}
/** Click a button and return the dialog it opened. */
function clickOpening(b: Gtk.Button): Gtk.Dialog {
  const before = new Set(Gtk.toplevels.list());
  b.click();
  return Gtk.toplevels.list().find((w) => !before.has(w) && w instanceof Gtk.Dialog) as Gtk.Dialog;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("demo-arrow Main", () => {
  test("each button pops up its dialog and the results are printed", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const before = new Set(Gtk.toplevels.list());
    main();
    const window = Gtk.toplevels.list().find((w) => !before.has(w)) as Gtk.Window;
    const labels = allWidgets(window).filter((x) => x instanceof Gtk.Button).map((b) => (b as Gtk.Button).label);
    expect(labels).toEqual(["Show test dialog", "Show notebook dialog", "Show Conditional dialog", "Show Loop dialog"]);

    // Loop dialog: the gadget tree is printed, then the result.
    const loop = clickOpening(buttonLabelled(window, "Show Loop dialog"));
    expect(loop.title).toBe("Loop Demo 1");
    expect(log).toHaveBeenLastCalledWith(drawTree(showGadget(loopDialog1.dialogGadget)));
    expect(log).toHaveBeenLastCalledWith("GetInitial");
    buttonLabelled(loop.contentArea, "+5").click();
    buttonLabelled(loop.contentArea, "+10").click();
    buttonLabelled(loop.contentArea, "+1").click();
    Gtk.dialogResponse(loop, Gtk.ResponseTypeApply);
    expect(log).toHaveBeenLastCalledWith("(1,16)");
    buttonLabelled(loop.contentArea, "Reset").click();
    Gtk.dialogResponse(loop, Gtk.ResponseTypeOk);
    expect(log).toHaveBeenLastCalledWith("(1,0)");
    const loop2 = clickOpening(buttonLabelled(window, "Show Loop dialog"));
    Gtk.dialogResponse(loop2, Gtk.ResponseTypeCancel);
    expect(log).toHaveBeenLastCalledWith("Loop dialog cancelled");

    // Notebook and conditional dialogs start with Right "Foo!".
    const nb = clickOpening(buttonLabelled(window, "Show notebook dialog"));
    expect(nb.title).toBe("Notebook Test");
    Gtk.dialogResponse(nb, Gtk.ResponseTypeOk);
    expect(log).toHaveBeenLastCalledWith('(1,Right "Foo!")');
    const nb2 = clickOpening(buttonLabelled(window, "Show notebook dialog"));
    Gtk.dialogResponse(nb2, Gtk.ResponseTypeCancel);
    expect(log).toHaveBeenLastCalledWith("Notebook dialog cancelled.");
    const cd = clickOpening(buttonLabelled(window, "Show Conditional dialog"));
    expect(cd.title).toBe("Conditional Test");
    Gtk.comboBoxSetActive(allWidgets(cd.contentArea).find((x) => x instanceof Gtk.ComboBox) as Gtk.ComboBox, 0);
    Gtk.dialogResponse(cd, Gtk.ResponseTypeOk);
    expect(log).toHaveBeenLastCalledWith("(1,Left 0)");
    const cd2 = clickOpening(buttonLabelled(window, "Show Conditional dialog"));
    Gtk.dialogResponse(cd2, Gtk.ResponseTypeDeleteEvent);
    expect(log).toHaveBeenLastCalledWith("Cond dialog cancelled.");

    // The test dialog starts with initialValue.
    const td = clickOpening(buttonLabelled(window, "Show test dialog"));
    expect(td.title).toBe("Demo Dialog");
    Gtk.dialogResponse(td, Gtk.ResponseTypeOk);
    expect(log).toHaveBeenLastCalledWith("(1," + show_DemoData(initialValue) + ")");
    const td2 = clickOpening(buttonLabelled(window, "Show test dialog"));
    Gtk.dialogResponse(td2, Gtk.ResponseTypeCancel);
    expect(log).toHaveBeenLastCalledWith("Dialog cancelled.");
  });
});
