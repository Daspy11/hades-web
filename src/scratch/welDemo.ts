/**
 * Scratch demo for `App.Welcome`: open with `?demo=wel`.
 *
 * At start-up the demo does what `App.ModelMain` does: it calls
 * `welcomeScreen window False docs (Just examples)` with the DSM documentation and example
 * folders, so the welcome dialog appears unless "Don't show this again" was ticked earlier
 * (`&force=1` forces it, as the Help menu would). The main window then shows the result: the
 * chosen example's virtual path and, read back with `readFileText`, its size and model name.
 *
 * Buttons: "Welcome screen…" (forced), "Start-up check" (not forced: does nothing while the flag
 * is set), "Clear flag" (removes the `localStorage` flag file).
 *
 * `window.wel` exposes `results` (every welcome result so far), `flag()` (the flag file's
 * `localStorage` value, or null) and `show(force)` for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import { Just, type Maybe } from "@/lib/Data/Maybe";
import { getDataDir } from "@/lib/System/Paths";
import { readFileText, takeFileName } from "@/lib/System/IO";
import { configFileKey, welcomeFlagFile, welcomeScreen } from "@/hades/src/App/Welcome";

export function main(): void {
  Gtk.main();
  const params = new URLSearchParams(location.search);
  const baseFolder = getDataDir("dsm");
  const docs = baseFolder + "/documentation";
  const samples = Just(baseFolder + "/examples");

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Diametric Safety Case Manager");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  Gtk.containerSetBorderWidth(vbox, 12);
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  const welcomeButton = Gtk.buttonNewWithLabel("Welcome screen…");
  const startupButton = Gtk.buttonNewWithLabel("Start-up check");
  const clearButton = Gtk.buttonNewWithLabel("Clear flag");
  for (const b of [welcomeButton, startupButton, clearButton]) Gtk.boxPackStart(bar, b, false, false, 0);
  const status = Gtk.labelNew("");
  Gtk.labelSetXalign(status, 0);
  Gtk.labelSetLineWrap(status, true);
  Gtk.labelSetSelectable(status, true);
  Gtk.boxPackStart(vbox, bar, false, false, 0);
  Gtk.boxPackStart(vbox, status, false, false, 0);
  Gtk.containerAdd(win, vbox);
  Gtk.windowSetDefaultSize(win, 1300, 820);
  Gtk.widgetShowAll(win);

  const flagKey = configFileKey(welcomeFlagFile());
  const flag = (): string | null => {
    try {
      return localStorage.getItem(flagKey);
    } catch {
      return null;
    }
  };
  const results: Maybe<string>[] = [];
  const describe = async (r: Maybe<string>): Promise<string> => {
    const flagText = `Flag file ${welcomeFlagFile()} ${flag() === null ? "absent" : "present"}.`;
    if (r.tag === "Nothing") return `Result: Nothing (blank model). ${flagText}`;
    try {
      const text = await readFileText(r.value);
      const json = JSON.parse(text) as { modelName?: unknown };
      return `Result: Just ${JSON.stringify(r.value)}\nFile name: ${takeFileName(r.value)}; ${text.length} characters; ` +
        `model name ${JSON.stringify(json.modelName ?? null)}. ${flagText}`;
    } catch (err) {
      return `Result: Just ${JSON.stringify(r.value)} — could not read it: ${String(err)}. ${flagText}`;
    }
  };
  const show = async (force: boolean): Promise<Maybe<string>> => {
    Gtk.labelSetText(status, force ? "Welcome screen open…" : "Start-up: checking the flag…");
    const r = await welcomeScreen(win, force, docs, samples);
    results.push(r);
    Gtk.labelSetText(status, await describe(r));
    return r;
  };
  Gtk.onButtonClicked(welcomeButton, () => void show(true));
  Gtk.onButtonClicked(startupButton, () => void show(false));
  Gtk.onButtonClicked(clearButton, () => {
    try {
      localStorage.removeItem(flagKey);
    } catch {
      // Storage blocked.
    }
    Gtk.labelSetText(status, `Flag cleared (${flagKey}).`);
  });
  (window as any).wel = { results, flag, show };
  void show(params.get("force") === "1");
}
