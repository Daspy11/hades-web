// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as GLib from "@/lib/GI/GLib";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { set, view } from "@/lib/Control/Lens";
import { dataFileUrl, getDataDir } from "@/lib/System/Paths";
import { takeFileName, type FilePath } from "@/lib/System/IO";
import {
  WelcomeResult, builtinDataPath, configFileKey, manualFile, show_WelcomeResult, welcomeDon_tShow, welcomeExample,
  welcomeFlagFile, welcomeScreen,
} from "./Welcome";

const docs = getDataDir("dsm") + "/documentation";
const samples = getDataDir("dsm") + "/examples";
const flagKey = configFileKey(welcomeFlagFile());

/** All widgets in a tree, depth first. */
function allWidgets(w: Gtk.Widget): Gtk.Widget[] {
  return [w, ...w.getChildren().flatMap(allWidgets)];
}
function find<W extends Gtk.Widget>(cls: abstract new (...args: any[]) => W, ws: readonly Gtk.Widget[]): W[] {
  return ws.flatMap(allWidgets).filter((x): x is W => x instanceof cls);
}

/** Start the welcome screen; returns the result promise and the dialog it opened (if any). */
function start(force: boolean, sampleFolder: Maybe<FilePath> = Just(samples)): [Promise<Maybe<FilePath>>, Gtk.Dialog | undefined] {
  const before = new Set(Gtk.toplevels.list());
  const p = welcomeScreen(Gtk.labelNew("parent"), force, docs, sampleFolder);
  const d = Gtk.toplevels.list().find((w) => !before.has(w)) as Gtk.Dialog | undefined;
  return [p, d];
}
function radios(d: Gtk.Dialog): Gtk.RadioButton[] {
  return find(Gtk.RadioButton, [d.contentArea]);
}
function tick(d: Gtk.Dialog): Gtk.CheckButton {
  return find(Gtk.CheckButton, [d.contentArea]).filter((b) => !(b instanceof Gtk.RadioButton))[0];
}
function continueButton(d: Gtk.Dialog): Gtk.Button {
  return d.actionArea.children.find((b) => b.data.get("response") === Gtk.ResponseTypeClose) as Gtk.Button;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("WelcomeResult", () => {
  test("lenses and Show", () => {
    const r = WelcomeResult(false, Nothing);
    expect(view(welcomeDon_tShow, r)).toBe(false);
    expect(view(welcomeExample, set(welcomeExample, Just("2 FMEA.dsm"), r))).toEqual(Just("2 FMEA.dsm"));
    expect(set(welcomeDon_tShow, true, r)).toEqual(WelcomeResult(true, Nothing));
    expect(show_WelcomeResult(r)).toBe("WelcomeResult {_welcomeDon'tShow = False, _welcomeExample = Nothing}");
    expect(show_WelcomeResult(WelcomeResult(true, Just("a \"b\".dsm")))).toBe(
      "WelcomeResult {_welcomeDon'tShow = True, _welcomeExample = Just \"a \\\"b\\\".dsm\"}",
    );
  });

  test("Show escapes the file path as Haskell's show of a String does", () => {
    const shown = (p: string): string =>
      show_WelcomeResult(WelcomeResult(false, Just(p))).replace(/^.*_welcomeExample = Just (.*)\}$/s, "$1");
    // show "Café\\x\n" == "\"Caf\\233\\\\x\\n\""
    expect(shown("Café\\x\n")).toBe(String.raw`"Caf\233\\x\n"`);
    // A numeric escape followed by a digit is protected with \&; so is \SO before H.
    expect(shown("é1.dsm")).toBe(String.raw`"\233\&1.dsm"`);
    expect(shown("\x0eH\x0e")).toBe(String.raw`"\SO\&H\SO"`);
    expect(shown("\0\x01\x07\t\x1b\x7f😀")).toBe(String.raw`"\NUL\SOH\a\t\ESC\DEL\128512"`);
  });

  test("flag file and manual", () => {
    expect(welcomeFlagFile()).toBe("/config/DiametricSoftware/DSM/welcome-seen");
    expect(flagKey).toBe("hades:/config/DiametricSoftware/DSM/welcome-seen");
    expect(manualFile).toBe("Manual.pdf");
    expect(GLib.filenameToUri(docs + "/" + manualFile, null)).toMatch(/Manual\.pdf$/);
  });

  test("builtinDataPath keeps the file name", () => {
    const p = builtinDataPath(samples + "/2 FMEA.dsm");
    expect(p.startsWith("/builtin/")).toBe(true);
    expect(takeFileName(p)).toBe("2 FMEA.dsm");
    expect(p).toContain(dataFileUrl(samples + "/2 FMEA.dsm"));
  });
});

describe("welcomeScreen", () => {
  test("shows the dialog and returns the chosen example as a readable path", async () => {
    const [p, d] = start(false);
    expect(d).toBeDefined();
    const dlg = d!;
    expect(Gtk.windowGetTitle(dlg)).toBe("Welcome to the Diametric Safety Case Manager");
    // Artwork, manual button, examples (sorted, by base name) and the tick box.
    const img = find(Gtk.Image, [dlg.contentArea])[0];
    expect(img.file).toBe(dataFileUrl(docs + "/welcome.svg"));
    const manual = find(Gtk.Button, [dlg.contentArea]).find((b) => b.label === "Click here for the User Manual")!;
    expect(manual.classes.has("welcome-doc-button")).toBe(true);
    expect(radios(dlg).map((r) => r.label)).toEqual([
      "Empty model", "1 Quick Guide to the DSM", "2 FMEA", "3 Managing Risks", "4 Managing Hazards",
    ]);
    expect(radios(dlg)[0].active).toBe(true);
    expect(tick(dlg).active).toBe(false);
    expect(find(Gtk.Label, [dlg.contentArea]).map((l) => Gtk.labelGetText(l))).toEqual(
      expect.arrayContaining(["Open a worked example", "Don't show this again"]),
    );
    expect(continueButton(dlg).label).toBe("_Continue");
    radios(dlg)[2].click();
    continueButton(dlg).click();
    const r = await p;
    expect(r.tag).toBe("Just");
    const path = (r as { value: string }).value;
    expect(path).toBe(builtinDataPath(samples + "/2 FMEA.dsm"));
    expect(takeFileName(path)).toBe("2 FMEA.dsm");
    expect(localStorage.getItem(flagKey)).toBeNull();
  });

  test("Empty model gives Nothing; the manual button opens the manual in a new tab", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const [p, d] = start(false);
    const manual = find(Gtk.Button, [d!.contentArea]).find((b) => b.label === "Click here for the User Manual")!;
    manual.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0]).toBe(GLib.filenameToUri(docs + "/" + manualFile, null));
    continueButton(d!).click();
    expect(await p).toEqual(Nothing);
  });

  test("\"Don't show this again\" writes the flag, and the screen is then skipped unless forced", async () => {
    const [p1, d1] = start(false);
    tick(d1!).click();
    continueButton(d1!).click();
    expect(await p1).toEqual(Nothing);
    expect(localStorage.getItem(flagKey)).toBe("");
    // Not forced: no dialog.
    const [p2, d2] = start(false);
    expect(d2).toBeUndefined();
    expect(await p2).toEqual(Nothing);
    // Forced: the dialog shows the box ticked; unticking removes the flag.
    const [p3, d3] = start(true);
    expect(tick(d3!).active).toBe(true);
    tick(d3!).click();
    radios(d3!)[1].click();
    continueButton(d3!).click();
    expect(await p3).toEqual(Just(builtinDataPath(samples + "/1 Quick Guide to the DSM.dsm")));
    expect(localStorage.getItem(flagKey)).toBeNull();
  });

  test("closing the dialog returns Nothing and leaves the flag alone", async () => {
    localStorage.setItem(flagKey, "");
    const [p, d] = start(true);
    tick(d!).click();
    radios(d!)[3].click();
    Gtk.dialogResponse(d!, Gtk.ResponseTypeDeleteEvent);
    expect(await p).toEqual(Nothing);
    expect(localStorage.getItem(flagKey)).toBe("");
  });

  test("storage errors when writing or removing the flag are ignored, as IOExceptions are", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const [p1, d1] = start(true);
    tick(d1!).click();
    radios(d1!)[2].click();
    continueButton(d1!).click();
    expect(await p1).toEqual(Just(builtinDataPath(samples + "/2 FMEA.dsm")));
    vi.restoreAllMocks();
    localStorage.setItem(flagKey, "");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const [p2, d2] = start(true);
    tick(d2!).click();
    continueButton(d2!).click();
    expect(await p2).toEqual(Nothing);
    expect(localStorage.getItem(flagKey)).toBe("");
  });

  test("without (readable) examples there is no example choice", async () => {
    for (const folder of [Nothing, Just("/src/dsm/share/no-such-folder")] as Maybe<FilePath>[]) {
      const [p, d] = start(false, folder);
      expect(radios(d!)).toEqual([]);
      expect(find(Gtk.Label, [d!.contentArea]).map((l) => Gtk.labelGetText(l))).not.toContain("Open a worked example");
      continueButton(d!).click();
      expect(await p).toEqual(Nothing);
    }
  });
});
