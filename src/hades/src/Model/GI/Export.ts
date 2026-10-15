// Ported from hades/src/Model/GI/Export.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Exporting reports (HTML previews, HTML and Word files) and matrices (Excel workbooks).
 *
 * TypeScript port
 * ---------------
 * * Every function here does file I/O, so they are `async` and return Promises. The functions
 *   with a `(HasDiagrams HadesRender v)` constraint take that dictionary first.
 * * `ImageMap` is `Model.Report.Docx`'s `ImageFiles`:
 *   `M.Map<ImageRef, readonly [Uint8Array (PNG), Maybe<Uint8Array> (SVG)]>`.
 * * File paths are `@/lib/System/IO` virtual paths (`/download/<name>`, `/handle/...` from a
 *   save picker, `/memory/...`).
 * * Web: the desktop wrote an HTML report as a stub file plus a folder holding `index.html` and
 *   the image files. A browser writes one file per save picker or download, so
 *   "formatReportHtml" writes a single self-contained HTML file: the images that the desktop
 *   wrote next to the report are embedded as `data:` URIs (the same bytes, with the same choice
 *   of SVG or PNG as "imagePath" makes). See "formatReportHtml".
 * * Web: previews are kept in memory (`/memory/.dsmPreviews/...`) and opened in a new browser
 *   tab instead of the desktop's external web browser.
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { fromRight } from "@/lib/Data/Either";
import { identity } from "@/lib/Control/Lens";
import { getCurrentTime, type UTCTime } from "@/lib/Data/Time";
import { fromXlsx, type Xlsx } from "@/lib/Codec/Xlsx";
import * as Cairo from "@/lib/GI/Cairo";
import * as Gtk from "@/lib/GI/Gtk";
import { svgWithFonts } from "@/lib/GI/Gtk/SvgFonts";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import {
  type FilePath, builtinPath, fileUrl, hasExtension, joinPath, readFileBytes,
  readFileText, removeFile, takeBaseName, takeExtension, writeFileData, IOError,
} from "@/lib/System/IO";
import { dataFileUrl, getDataDir, isDataFile } from "@/lib/System/Paths";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import { checkExtension } from "@/hades/src/Hades/GI/Saving";
import type { HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import { type Model, current, evalModelEdit, goToEntity } from "@/hades/src/Model/Abstract/PackageTree";
import { getDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { renderForExport, renderOnPng } from "@/hades/src/Model/GI/ModelDiagrams";
import type { ImageRef } from "@/hades/src/Model/Report/Base";
import type { ReportFormat } from "@/hades/src/Model/Report/Dialogs";
import type { Block } from "@/hades/src/Model/Report/Document";
import { insertDocx, makeDocx } from "@/hades/src/Model/Report/Docx";
import type { RelTargetType } from "@/hades/src/Model/Report/Docx/Document";
import { mkHtmlDocument } from "@/hades/src/Model/Report/Html";
import { errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";

type Text = string;

/**
 * Table of images. For each ImageRef there are 1 or 2 files. The first is the PNG, and the
 * second is an optional SVG.
 */
export type ImageMap = M.Map<ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]>;


/**
 * Preview files are stored in this folder.
 *
 * Web: there is no home directory; previews are in-memory files under `/memory/.dsmPreviews`.
 */
export async function previewFolder(): Promise<FilePath> {
  const h = "/memory"; // getHomeDirectory
  return joinPath(h, ".dsmPreviews");
}


/**
 * Web: the contents of the preview folder: each preview file with its modification time and the
 * URL it was opened at. (In-memory files cannot be listed or dated through `@/lib/System/IO`, so
 * "previewReport" records them here and "previewFolderClean" removes them.)
 */
const previewFiles = new Map<FilePath, { readonly modTime: UTCTime; readonly url: Maybe<string> }>();

/** Web: `emptyTempFile dir template`: a new, empty file in the folder named after the template. */
async function emptyTempFile(dir: FilePath, template: string): Promise<FilePath> {
  const ext = takeExtension(template);
  const base = takeBaseName(template);
  let path: FilePath;
  do {
    path = joinPath(dir, base + String(Math.floor(Math.random() * 1e9)) + ext);
  } while (previewFiles.has(path));
  await writeFileData(path, "", "text/html");
  previewFiles.set(path, { modTime: getCurrentTime(), url: Nothing });
  return path;
}


/**
 * Write the report to a temporary file and folder in HTML, then view it.
 *
 * Web: the preview is an in-memory file, opened in a new browser tab. The tab is opened first
 * (empty) and shows the preview once it is ready.
 *
 * @param title Report title
 */
export async function previewReport<V>(
  cls: HasDiagrams<HadesRender, V>,
  model: Model<V>,
  title: Text,
  blks: readonly Block[],
  imgs: readonly ImageRef[],
): Promise<void> {
  const noWindow: Gtk.Window | null = null;
  const noWidget: Gtk.Widget | null = null;
  const previewError = (err: unknown): Promise<void> =>
    errorBox(noWindow, T.pack("File error during preview: " + showException(err)));
  // Web: browsers only let a page open a tab shortly (about 5 s) after the user's click, and
  // rendering the images of a large report can take longer than that; a blocked tab would fail
  // silently. So the tab is opened now, before any work is done, and pointed at the preview
  // once it has been written (see "openPreviewTab").
  const tab = openPreviewTab();
  try {
    await previewFolderClean();
    const fldr = await previewFolder();
    const imageMap = await getImageResources(cls, model, imgs);
    // createDirectoryIfMissing True fldr: in-memory folders need not be created.
    const baseName = await emptyTempFile(fldr, "preview.html");
    await formatReportHtml(title, baseName, blks, imageMap);
    // Web: GLib.filenameToUri gives a file: URI, which the browser cannot open from a page;
    // the in-memory file is opened through an object URL instead.
    const uri = await fileUrl(baseName);
    const entry = previewFiles.get(baseName);
    previewFiles.set(baseName, { modTime: entry?.modTime ?? getCurrentTime(), url: Just(uri) });
    try {
      if (tab !== null && !tab.closed) {
        tab.location.replace(uri); // Web: the tab opened above.
      } else {
        Gtk.showUriOnWindow(noWindow, uri, 0); // Zero is magic timestamp value for "now".
      }
    } catch (err) {
      await errorBox(noWidget, T.pack(showException(err)));
    }
  } catch (err) {
    closePreviewTab(tab);
    if (!isIOError(err)) throw err;
    await previewError(err);
  }
}

/**
 * Web: open an empty browser tab for a report preview (while the user's click still allows
 * it), saying that the preview is being prepared. Returns `null` if the browser refused (or
 * there is no `window.open`, e.g. in tests); "previewReport" then opens the preview with
 * `Gtk.showUriOnWindow` as before. The new tab's `opener` is cleared, as `noopener` would.
 */
export function openPreviewTab(): Window | null {
  if (typeof window === "undefined" || typeof window.open !== "function") return null;
  try {
    const tab = window.open("", "_blank");
    if (!tab) return null;
    try {
      tab.opener = null;
      tab.document.title = "Report preview";
      tab.document.body.textContent = "Preparing the report preview…";
    } catch {
      // The placeholder text is only a courtesy.
    }
    return tab;
  } catch {
    return null;
  }
}

/** Web: close the tab of a preview that failed. */
function closePreviewTab(tab: Window | null): void {
  try {
    if (tab !== null && !tab.closed) tab.close();
  } catch {
    // Nothing to do.
  }
}


/**
 * Clean the preview folder: attempt to delete any files older than 8 hours. Ignore any failures.
 *
 * In theory "previewReport" should create a temporary folder and delete it once the preview is
 * closed. However it uses an external web browser as a viewer, so we don't know when that is.
 * The application also can't just delete the file once the program exits because the previewer
 * might have the file still open. This is the best compromise available.
 *
 * Web: the previews are in-memory files and the object URLs they were opened at; both are
 * released. A tab that already shows a preview keeps showing it.
 */
export async function previewFolderClean(): Promise<void> {
  const expiry = 8 * 60 * 60; // 8 hours (seconds)
  try {
    const now = getCurrentTime();
    const top = await previewFolder();
    const folderContents = [...previewFiles.keys()].filter((p) => p.startsWith(top + "/"));
    for (const path of folderContents) {
      const entry = previewFiles.get(path);
      if (entry === undefined) continue;
      const modTime = entry.modTime;
      if ((now - modTime) / 1000 > expiry) {
        // removePathForcibly
        await removeFile(path);
        if (entry.url.tag === "Just") URL.revokeObjectURL(entry.url.value);
        previewFiles.delete(path);
      }
    }
  } catch (err) {
    if (!isIOError(err)) throw err;
    // Ignore any errors
  }
}


/**
 * Path of the file holding an image of the report, relative to the report folder. (A `where`
 * helper of "formatReportHtml".)
 */
export function imagePath(ref: ImageRef, files: readonly [Uint8Array, Maybe<Uint8Array>]): FilePath {
  switch (ref.tag) {
    case "IconRef":
      return files[1].tag === "Nothing"
        ? ref._0 + ".png" // Some icons are only PNG.
        : ref._0 + ".svg";
    case "DiagramRef":
      return U.toText(ref._0) + ".svg"; // Diagrams always have SVG.
  }
}

/**
 * The image file written for an image: its name (the base name plus ".png" or ".svg") and
 * bytes. (`writeImage`, a `where` helper of "formatReportHtml".)
 */
export function writeImage(base: FilePath, [png, svg]: readonly [Uint8Array, Maybe<Uint8Array>]): [FilePath, Uint8Array] {
  return svg.tag === "Nothing" ? [base + ".png", png] : [base + ".svg", svg.value];
}

/** Web: a `data:` URI holding an image file (by the extension of its name). */
export function imageDataUri(name: FilePath, bytes: Uint8Array): string {
  const mime = takeExtension(name) === ".svg" ? "image/svg+xml" : "image/png";
  return "data:" + mime + ";base64," + bytesToBase64(bytes);
}


/**
 * Write the report to the specified HTML file. Images are placed in a folder of the same name.
 * The first argument is the title of the resulting report.
 *
 * Web: a browser writes a single file, so the report is written to `path2` itself (the desktop
 * wrote a stub there that redirected to `<resultDir>/index.html`) and each image that the
 * desktop wrote as `<resultDir>/<name>.png|.svg` is embedded in it as a `data:` URI. The report
 * HTML is otherwise the same.
 *
 * @param title Report title
 * @param path Path for HTML file.
 */
export async function formatReportHtml(
  title: Text,
  path: FilePath,
  blks: readonly Block[],
  imageMap: ImageMap,
): Promise<void> {
  const dataDir = getDataDir("hades");
  const stylesheet = await readFileText(builtinPath(dataFileUrl(joinPath(dataDir, "report.css"))));
  // The image files the desktop wrote into the report folder, by their relative path.
  const imageFiles = new Map<FilePath, string>();
  for (const [ref, bytes] of M.toList(imageMap)) {
    const base = ref.tag === "IconRef" ? ref._0 : U.toText(ref._0);
    const [name, contents] = writeImage(base, bytes);
    imageFiles.set(name, imageDataUri(name, contents));
  }
  const imageFunc = (() => {
    const m = M.mapWithKey(imagePath, imageMap);
    // brokenImage can't happen because "m" includes every image in "blks".
    return (r: ImageRef): FilePath => {
      const rel = fromMaybe("brokenImage", M.lookup(r, m));
      return imageFiles.get(rel) ?? rel;
    };
  })();
  const headStuff = H.head(H.mconcat_Html([
    H.with_(H.meta(), HA.charset(H.toValue("UTF-8" as Text))),
    H.style(H.preEscapedText(stylesheet)), // H.unsafeLazyByteString
    H.title(H.toHtml(title)),
  ]));
  const reportHtml = mkHtmlDocument(imageFunc, headStuff, blks);
  const path2 = hasExtension(path) ? path : path + ".html";
  // Web: no report folder (resultDir = dropExtension path2) or redirecting stub; see above.
  // Write the HTML for the report.
  await writeFileData(path2, U.encodeUtf8(H.renderHtml(reportHtml)), "text/html;charset=utf-8");
}


/**
 * Ask the user for a file to write to, and create a formatted report file.
 *
 * @param title Report title.
 */
export async function writeReportToFile<V>(
  cls: HasDiagrams<HadesRender, V>,
  format: ReportFormat,
  title: Text,
  model: Model<V>,
  blks: readonly Block[],
  imgs: readonly ImageRef[],
): Promise<void> {
  const imageMap = await getImageResources(cls, model, imgs);
  switch (format.tag) {
    case "ReportHtml":
      return await formatReportHtml(title, format._0, blks, imageMap);
    case "ReportDocx":
      return await makeDocx(Just(format._0), title, format._1, blks, imageMap);
    case "ReportTemplate":
      return await insertDocx(format._0, format._1, blks, imageMap);
  }
}


/** Minimal PNG file: one transparent pixel. */
const nullPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1"
  + "BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=";

/**
 * The binary data associated with each ImageRef. Within the result elements the first item
 * is a PNG, the second is an optional SVG.
 */
export async function getImageResources<V>(
  cls: HasDiagrams<HadesRender, V>,
  model: Model<V>,
  refs: readonly ImageRef[],
): Promise<ImageMap> {
  const iconTheme = getDataIconTheme();
  // Minimal PNG file: one transparent pixel.
  const nullPng = base64DecodeLenient(nullPngBase64);
  const results: [ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]][] = [];
  for (const ref of refs) {
    const png = fromMaybe(nullPng, await binaryResourceFunc(cls, model, iconTheme, ref, "PngTarget"));
    const svg = await binaryResourceFunc(cls, model, iconTheme, ref, "SvgTarget");
    results.push([ref, [png, svg]]);
  }
  return M.fromList(results);
}

/**
 * The file of the given type for an image, if there is one. (A `where` helper of
 * "getImageResources", which closes over the model; the icon theme is an argument.)
 */
export async function binaryResourceFunc<V>(
  cls: HasDiagrams<HadesRender, V>,
  model: Model<V>,
  iconTheme: Gtk.IconTheme,
  ref: ImageRef,
  target: RelTargetType,
): Promise<Maybe<Uint8Array>> {
  if (target === "ExternalTarget") return Nothing;
  switch (ref.tag) {
    case "IconRef": {
      const iconName = ref._0;
      if (target === "PngTarget") {
        // 48x48 icon taken because that is what the Diametric iconTheme has available.
        const info = Gtk.iconThemeLookupIcon(iconTheme, iconName, 48, [Gtk.IconLookupFlagsNoSvg]);
        if (info === null) return Nothing;
        const iconPath = Gtk.iconInfoGetFilename(info);
        return takeExtension(iconPath) === ".png" ? Just(await readIconFile(iconPath, info)) : Nothing;
      } else {
        // Any resolution except 48x48. Otherwise we still get the PNG.
        const info = Gtk.iconThemeLookupIcon(iconTheme, iconName, 128, [Gtk.IconLookupFlagsForceSvg]);
        if (info === null) return Nothing;
        const iconPath = Gtk.iconInfoGetFilename(info);
        return takeExtension(iconPath) === ".svg" ? Just(await readIconFile(iconPath, info)) : Nothing;
      }
    }
    case "DiagramRef": {
      const modelId = ref._0;
      // ModelEdit (IO (Maybe ByteString))
      const act = fromRight<unknown, () => Promise<Maybe<Uint8Array>>>(
        async () => Nothing,
        evalModelEdit(cls, identity<V>(), model, (ctx) => {
          goToEntity(ctx, modelId);
          const e = current(ctx);
          if (e.tag === "Nothing") return async () => Nothing; // Should never happen.
          const w = cls.getDiagramWrapper(ctx, e.value);
          if (w.tag !== "Just" || w.value.tag !== "DiagramWrapper") {
            return async () => Nothing; // No diagram. Shouldn't happen.
          }
          const { diagramClass, diagramToEdit: dgram, diagramTraversal: prsm, diagramContext: ctrl } = w.value;
          if (target === "PngTarget") {
            const [draw, size] = renderForExport(diagramClass, cls, iconTheme, prsm, model, ctrl, dgram);
            return async () => Just(renderOnPng(72 * 2, size, draw));
          }
          return async () => { // IO
            const [draw, [w1, h1]] = renderForExport(diagramClass, cls, iconTheme, prsm, model, ctrl, dgram);
            // Web: the SVG document is returned by the surface instead of going through a
            // temporary file (emptySystemTempFile, readFile, removeFile).
            const svgPath = "dsm-.svg";
            const [, svg] = Cairo.withSVGSurface(svgPath, w1, h1, (surface) => {
              Cairo.renderWith(surface, draw);
              Cairo.surfaceFinish(surface);
            });
            // Web: Cairo's SVG surface draws text as glyph outlines; the browser's SVG has
            // `<text>` elements, so the bundled fonts are embedded to render the same anywhere.
            return Just(U.encodeUtf8(await svgWithFonts(svg)));
          };
        }),
      );
      return await act();
    }
  }
}

/**
 * Web: `BL.readFile iconPath` for an icon file: bundled theme icons are data files, fetched from
 * their URL.
 */
async function readIconFile(iconPath: FilePath, info: Gtk.IconInfo): Promise<Uint8Array> {
  const url = isDataFile(iconPath) ? dataFileUrl(iconPath) : info.url;
  return await readFileBytes(builtinPath(url));
}


/** Ask the user for a file and write the matrix workbook to it. */
export async function writeMatrixToFile(book: Xlsx): Promise<void> {
  const mkFilters = (): Gtk.FileFilter[] => {
    const fileFilter = Gtk.fileFilterNew();
    Gtk.fileFilterSetName(fileFilter, "Excel *.xlsx");
    Gtk.fileFilterAddPattern(fileFilter, "*.xlsx");
    return [fileFilter];
  };
  const dialog = Gtk.new_(Gtk.FileChooserNative, {
    action: Gtk.FileChooserActionSave,
    title: "Export matrix as",
    acceptLabel: "Export",
  });
  const filters = mkFilters();
  for (const f of filters) Gtk.fileChooserAddFilter(dialog, f);
  Gtk.fileChooserSetDoOverwriteConfirmation(dialog, true);
  const result = await Gtk.nativeDialogRun(dialog);
  if (result === Gtk.ResponseTypeAccept) {
    const mTarget = Gtk.fileChooserGetFilename(dialog);
    Gtk.nativeDialogDestroy(dialog);
    if (mTarget === null) return;
    const target = mTarget;
    const t = getCurrentTime() / 1000; // getPOSIXTime
    await writeFileData(
      checkExtension("xlsx", target),
      fromXlsx(t, book),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  }
}


// ---------------------------------------------------------------------------------------------
// Helpers (not in the Haskell module)

/** True for the exceptions Haskell's `catchIOError` catches. */
function isIOError(err: unknown): boolean {
  return err instanceof IOError || (typeof DOMException !== "undefined" && err instanceof DOMException);
}

/** `show` of an exception. */
function showException(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** `B64.decodeLenient`: decode base 64, ignoring invalid characters. */
export function base64DecodeLenient(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  // A single left-over character carries no complete byte.
  const usable = clean.length % 4 === 1 ? clean.slice(0, -1) : clean;
  const bin = atob(usable + "=".repeat((4 - (usable.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
