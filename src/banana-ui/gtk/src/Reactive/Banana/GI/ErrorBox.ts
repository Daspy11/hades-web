// Ported from banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Standard error dialogs.
 *
 * TypeScript port
 * ---------------
 * * `errorBox` runs the dialog with `dialogRun`, so it is `async` and returns `Promise<void>`
 *   (resolved when the user closes the box).
 * * `cannotHappen` used `unsafePerformIO` to show the box from pure code. Here it shows the box
 *   without waiting for it (`void errorBox(...)`) and returns the value immediately.
 */
import * as Gtk from "@/lib/GI/Gtk";

/** Displays an error box warning of an \"unexpected event\". */
export function cannotHappen<A>(err: string, v: A): A {
  const msg =
    "An unexpected event has occured. " +
    "Please save your work in a new file and report this bug.\n\n";
  // Web: the dialog is shown without blocking (Haskell unsafePerformIO around dialogRun).
  console.error("cannotHappen: " + err);
  void errorBox(null, msg + err);
  return v;
}

/** A standard error dialog. */
export async function errorBox(parent: Gtk.Widget | null, msg: string): Promise<void> {
  // Error dialog box.
  const box = Gtk.new_(Gtk.MessageDialog, {
    messageType: Gtk.MessageTypeError,
    buttons: Gtk.ButtonsTypeClose,
    text: msg,
    modal: true,
  });
  if (parent !== null) {
    const parentWin = Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(parent));
    if (parentWin !== null) Gtk.set(box, { transientFor: parentWin });
  }
  await Gtk.dialogRun(box);
  Gtk.widgetDestroy(box);
}
