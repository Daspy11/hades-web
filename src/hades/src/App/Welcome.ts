// Ported from hades/src/App/Welcome.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The welcome screen shown when the program starts: the welcome artwork, a button that opens the
 * User Manual, a choice of worked examples to load and a \"Don't show this again\" box.
 *
 * TypeScript port
 * ---------------
 * * `WelcomeResult` is a record (`WelcomeResult(don'tShow, example)`) with the Haskell field names
 *   (primes become underscores: `_welcomeDon_tShow`); its lenses `welcomeDon_tShow` and
 *   `welcomeExample` are constants. `show_WelcomeResult` is the derived `Show`.
 * * `welcomeScreen` waits for the user (`runDialog`), so it returns a `Promise`.
 * * Web: the documentation and example folders are the virtual data directories of
 *   `@/lib/System/Paths` (`getDataDir("dsm") + "/documentation"`, `... + "/examples"`). The
 *   examples are listed with `listDataDirectory`, and the chosen example is returned as a
 *   `/builtin/<url>` virtual path (its bundled asset URL, see `builtinDataPath`), so that
 *   `readFileBytes`/`readFileText` of `@/lib/System/IO` can read it. The manual opens in a new
 *   browser tab.
 * * Web: the user configuration directory (`getXdgDirectory XdgConfig`) is the virtual directory
 *   `/config`; its files live in `localStorage` under the key `"hades:" + path` (see
 *   `configFileKey`). `welcomeFlagFile` therefore names the `localStorage` entry
 *   `"hades:/config/DiametricSoftware/DSM/welcome-seen"`.
 */
import * as T from "@/lib/Data/Text";
import * as L from "@/lib/Data/List";
import * as Gtk from "@/lib/GI/Gtk";
import * as GLib from "@/lib/GI/GLib";
import { Just, Nothing, liftA2Maybe, type Maybe } from "@/lib/Data/Maybe";
import { _2, lens, over, view, type Lens } from "@/lib/Control/Lens";
import { showBool } from "@/lib/Prelude";
import {
  CloseButton, Dialog, accum, arr, box, buttonIO, focusing, form, gDot, grid, image, message1, radio, styled1, tickBox,
  type Dialog_, type Gadget_, type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { runDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { IOError, builtinPath, joinPath, takeBaseName, takeFileName, type FilePath } from "@/lib/System/IO";
import { dataFileUrl, listDataDirectory } from "@/lib/System/Paths";

export interface WelcomeResult {
  readonly _welcomeDon_tShow: boolean;
  readonly _welcomeExample: Maybe<FilePath>;
}
export function WelcomeResult(_welcomeDon_tShow: boolean, _welcomeExample: Maybe<FilePath>): WelcomeResult {
  return { _welcomeDon_tShow, _welcomeExample };
}

/** Derived `Show` instance of `WelcomeResult`. */
export function show_WelcomeResult(r: WelcomeResult): string {
  const ex = r._welcomeExample.tag === "Just" ? "Just " + showFilePath(r._welcomeExample.value) : "Nothing";
  return `WelcomeResult {_welcomeDon'tShow = ${showBool(r._welcomeDon_tShow)}, _welcomeExample = ${ex}}`;
}

/** Control character names used by Haskell's `showLitChar` (`asciiTab`). */
const asciiTab: readonly string[] = [
  "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL", "BS", "HT", "LF", "VT", "FF", "CR", "SO", "SI",
  "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB", "CAN", "EM", "SUB", "ESC", "FS", "GS", "RS", "US",
];

/**
 * Haskell `show` of a `String` (`FilePath`), as the derived `Show` instance uses it: escapes as
 * `showLitString` does (`\"`, `\\`, `\n`, `\DEL`, `\233`, `\&` after a numeric escape followed by
 * a digit, ...), not JSON escapes.
 */
function showFilePath(s: string): string {
  const cs = Array.from(s);
  let out = "\"";
  cs.forEach((c, i) => {
    const next = i + 1 < cs.length ? cs[i + 1] : "";
    const n = c.codePointAt(0)!;
    if (c === "\"") out += "\\\"";
    else if (n > 0x7f) out += "\\" + n + (/^[0-9]$/.test(next) ? "\\&" : "");
    else if (n === 0x7f) out += "\\DEL";
    else if (c === "\\") out += "\\\\";
    else if (n >= 0x20) out += c;
    else if (c === "\x07") out += "\\a";
    else if (c === "\b") out += "\\b";
    else if (c === "\f") out += "\\f";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\x0e") out += "\\SO" + (next === "H" ? "\\&" : "");
    else if (c === "\t") out += "\\t";
    else if (c === "\v") out += "\\v";
    else out += "\\" + asciiTab[n];
  });
  return out + "\"";
}

/** Haskell `welcomeDon'tShow`. */
export const welcomeDon_tShow: Lens<WelcomeResult, boolean> = lens(
  (r) => r._welcomeDon_tShow,
  (r, b) => ({ ...r, _welcomeDon_tShow: b }),
);

export const welcomeExample: Lens<WelcomeResult, Maybe<FilePath>> = lens(
  (r) => r._welcomeExample,
  (r, p) => ({ ...r, _welcomeExample: p }),
);

/**
 * Display a welcome screen unless the Boolean @force@ argument is @False@ and user has
 * previously clicked the \"Don't show me this again\" box. Returns an initial example file to load,
 * or @Nothing@ for a blank file.
 *
 * @param force Force showing the welcome screen.
 * @param docFolder Documentation folder, including manual file and @welcome.svg@.
 * @param sampleFolder Folder holding example files, if any.
 *
 * Web: the folders are virtual data directories (`getDataDir(pkg) + "/..."`); the result is a
 * `/builtin/` virtual path of the bundled example (see the module header).
 */
export async function welcomeScreen(
  parent: Gtk.Widget,
  force: boolean,
  docFolder: FilePath,
  sampleFolder: Maybe<FilePath>,
): Promise<Maybe<FilePath>> {
  const iconTheme = Gtk.iconThemeGetDefault();
  // Web: the toolkit's image widget takes a URL, so the bundled file is given by its URL.
  const imageFile = dataFileUrl(joinPath(docFolder, "welcome.svg"));
  const docFile = joinPath(docFolder, manualFile);
  const uri = GLib.filenameToUri(docFile, null);
  let examplePaths: FilePath[];
  if (sampleFolder.tag === "Just") {
    try {
      examplePaths = L.sort(listDirectory(sampleFolder.value));
    } catch (err) {
      if (!(err instanceof IOError)) throw err;
      examplePaths = [];
    }
  } else {
    examplePaths = [];
  }
  const examples = examplePaths.map((p) => [T.pack(takeBaseName(p)), p] as const);
  const flagPath = welcomeFlagFile();
  const don_tShow = doesFileExist(flagPath);
  const defaultWelcome = WelcomeResult(don_tShow, Nothing);
  const d = welcomeDialog<null, never>(imageFile, uri, examples);
  if (force || !don_tShow) {
    const result = await runDialog(parent, iconTheme, d, null, defaultWelcome);
    if (result.tag === "Nothing") return Nothing;
    const r = result.value;
    try {
      if (view(welcomeDon_tShow, r)) writeFile(flagPath, "");
      else removeFile(flagPath);
    } catch (err) {
      if (!(err instanceof IOError)) throw err; // Ignore file-not-found errors.
    }
    // Web: the joined path names a bundled data file; return it as a readable virtual path.
    return liftA2Maybe((f: FilePath, p: FilePath) => builtinDataPath(joinPath(f, p)), sampleFolder, view(welcomeExample, r));
  } else {
    return Nothing;
  }
}

/**
 * The welcome dialog. (Internal in Haskell; exported for tests.)
 *
 * @param imageFile Image file for left hand side of dialog.
 * @param docFile Manual URI.
 * @param examples Title / pathname pairs for examples.
 */
export function welcomeDialog<E, W>(
  imageFile: FilePath,
  docFile: T.Text,
  examples: readonly (readonly [T.Text, FilePath])[],
): Dialog_<E, W, WelcomeResult> {
  type R = WelcomeResult;
  const constId = (): ((r: R) => R) => (r: R) => r;
  const pickExample: Gadget_<E, W, Maybe<FilePath>> = radio<E, W, Maybe<FilePath>>(
    (_e) => [
      ["Empty model", Nothing],
      ...examples.map((ex) => over(_2<T.Text, FilePath, Maybe<FilePath>>(), (p: FilePath) => Just(p), ex)),
    ],
  );
  // pickExample = optional "" $ comboBox $ const exampleItems
  // exampleItems = map (\(nm, p) -> ComboItem nm Nothing Nothing p) examples
  const spacer: GadgetF_<E, W, R> = gDot(arr(constId), message1<E, W, R>("\n\n")); // Kludge for spacing.
  return Dialog(
    "Welcome to the Diametric Safety Case Manager",
    CloseButton("_Continue"),
    accum(
      styled1("welcome", box<E, W, R>("Vertical", [[
        box<E, W, R>("Horizontal", [[
          gDot(arr(constId), gDot(image<E, W>(imageFile), arr((_r: R): [number, number] => [-1, -1]))),
          grid<E, W, R>([], [], [
            [gDot(arr(constId), message1<E, W, R>("\n"))], // Kludge for spacing.
            [
              gDot(
                arr(constId),
                styled1(
                  "welcome-doc-button",
                  buttonIO<E, W, R, void>(
                    "Click here for the User Manual",
                    (_e, _i) => Gtk.showUriOnWindow(null as Gtk.Window | null, docFile, 0),
                  ), // Zero is magic timestamp for "now".
                ),
              ),
              spacer,
            ],
            [
              spacer,
            ],
            [
              examples.length === 0
                ? focusing(welcomeExample, arr((x: Maybe<FilePath>) => x))
                : styled1("welcome-gadget", form<E, W, R>("Horizontal", [
                  ["Open a worked example", focusing(welcomeExample, pickExample)],
                ])),
            ],
          ]),
        ]]),
        styled1("welcome-gadget", form<E, W, R>("Vertical", [
          ["Don't show this again", focusing(welcomeDon_tShow, tickBox<E, W>())],
        ])),
      ]])),
    ),
  );
}

/**
 * Get the pathname for the flag file. If this file exists then the Welcome screen is not shown.
 * This creates the directory if it doesn't already exist.
 *
 * Web: the path is in the virtual configuration directory `/config` (see `xdgConfigDirectory`),
 * whose files are `localStorage` entries; there is no directory to create.
 */
export function welcomeFlagFile(): FilePath {
  const base = joinPath(xdgConfigDirectory, joinPath("DiametricSoftware", "DSM"));
  createDirectoryIfMissing(true, base);
  return joinPath(base, "welcome-seen");
}

/**
 * On Windows GTK can't open a PDF file in Acrobat, due to non-standard brain damage in Acrobat.
 * Hence we open a HTML file which redirects to the PDF. On Linux we don't have this problem so
 * we just open the PDF.
 *
 * Web: browsers display PDF files themselves, so this is the PDF (the non-Windows choice).
 */
export const manualFile: FilePath = "Manual.pdf";

// ---------------------------------------------------------------------------------------------
// Web: file system replacements used above.

/**
 * Web: the virtual XDG configuration directory (`getXdgDirectory XdgConfig ""`). The files in it
 * are kept in `localStorage` (see `configFileKey`).
 */
export const xdgConfigDirectory: FilePath = "/config";

/** Web: the `localStorage` key holding the contents of a file in `xdgConfigDirectory`. */
export function configFileKey(path: FilePath): string {
  return "hades:" + path;
}

/** Web: `createDirectoryIfMissing`. Directories do not exist in `localStorage`: nothing to do. */
function createDirectoryIfMissing(_parents: boolean, _dir: FilePath): void {}

/** Web: the browser's `localStorage`, or an `IOError` if storage is unavailable (blocked). */
function storage(): Storage {
  try {
    const s = globalThis.localStorage;
    if (s) return s;
  } catch {
    // Access denied (e.g. privacy settings): fall through.
  }
  throw new IOError("user configuration storage is not available");
}

/** Web: `doesFileExist` for a configuration file. False if storage is unavailable. */
function doesFileExist(path: FilePath): boolean {
  try {
    return storage().getItem(configFileKey(path)) !== null;
  } catch {
    return false;
  }
}

/** Web: `writeFile` for a configuration file. Throws an `IOError` if it cannot be stored. */
function writeFile(path: FilePath, contents: string): void {
  try {
    storage().setItem(configFileKey(path), contents);
  } catch (err) {
    throw err instanceof IOError ? err : new IOError(`${path}: ${String(err)}`);
  }
}

/**
 * Web: `removeFile` for a configuration file. Throws an `IOError` if it does not exist or
 * cannot be removed.
 */
function removeFile(path: FilePath): void {
  const s = storage();
  const key = configFileKey(path);
  let present: boolean;
  try {
    present = s.getItem(key) !== null;
    if (present) s.removeItem(key);
  } catch (err) {
    throw new IOError(`${path}: ${String(err)}`);
  }
  if (!present) throw new IOError(`${path}: removeFile: does not exist (No such file or directory)`);
}

/** Web: `listDirectory` of a folder of bundled data files (throws an `IOError` if there is none). */
function listDirectory(dir: FilePath): FilePath[] {
  return listDataDirectory(dir);
}

/**
 * Web: a bundled data file (a path under a `getDataDir` directory) as a `/builtin/<url>` virtual
 * path, readable with `@/lib/System/IO`. If the asset URL does not end with the file name (the
 * name is URL-encoded, or a production build added a content hash) the real name is appended
 * as a fragment, which `fetch` ignores, so that `takeFileName` of the result is the file name.
 */
export function builtinDataPath(path: FilePath): FilePath {
  const url = dataFileUrl(path);
  const name = takeFileName(path);
  return builtinPath(takeFileName(url) === name ? url : url + "#/" + name);
}
