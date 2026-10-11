// Ported from hades/src/Hades/GI/Saving.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Opening and saving model files with the GTK file chooser, and file error reporting.
 *
 * TypeScript port
 * ---------------
 * * File paths are the virtual paths of `@/lib/System/IO` (README "Files"); the file chooser is
 *   `Gtk.FileChooserNative`, which uses the browser's pickers.
 * * Everything that runs a dialog or touches a file is `async` and returns a `Promise`; the
 *   Haskell `IO a` arguments (`forEditing`'s opener, `catchFileError`'s action) are functions
 *   returning promises.
 * * `FromJSON`/`ToJSON` constraints are passed as codecs, first (`openJsonFile(codec, ...)`,
 *   `saveFile(codec, ...)`).
 * * `Maybe parent` widget arguments are `Gtk.Widget | null`.
 * * `LB.ByteString` file contents are `Uint8Array`s.
 * * `tryDecodeXml` does no I/O in the browser, so it is synchronous.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as J from "@/lib/Data/Aeson";
import * as T from "@/lib/Data/Text";
import { decodeUtf8, encodeUtf8 } from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe, isJust, isNothing } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { _Just, lens, preview, to, view, type Lens } from "@/lib/Control/Lens";
import { type Xlsx, show_ParseError, toXlsxEither } from "@/lib/Codec/Xlsx";
import {
  type FilePath, IOError, addExtension, displayPath, readFileBytes, takeExtension, writeFileData,
} from "@/lib/System/IO";
import { errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import { type EditLock, dropEditLock, tryEditLock } from "@/hades/src/System/Hades/EditLock";

/** Metadata about the file where a model is saved. */
export interface FileStatus {
  readonly _fileStatusLock: Maybe<EditLock>;
  readonly _fileStatusPath: FilePath;
}
export function FileStatus(_fileStatusLock: Maybe<EditLock>, _fileStatusPath: FilePath): FileStatus {
  return { _fileStatusLock, _fileStatusPath };
}

/** If the file is writeable then it will be locked for editing. */
export const fileStatusLock: Lens<FileStatus, Maybe<EditLock>> =
  lens((s: FileStatus) => s._fileStatusLock, (s, l: Maybe<EditLock>) => ({ ...s, _fileStatusLock: l }));

/** The path of the file being edited. */
export const fileStatusPath: Lens<FileStatus, FilePath> =
  lens((s: FileStatus) => s._fileStatusPath, (s, p: FilePath) => ({ ...s, _fileStatusPath: p }));

/**
 * Is the status read-only? "Nothing" means the model is unsaved and so can be edited freely.
 * A value with a lock can be edited. A value with no lock cannot be edited.
 */
export function readOnlyStatus(s: Maybe<FileStatus>): boolean {
  if (s.tag === "Nothing") return false;
  return view(fileStatusLock.dot(to((l: Maybe<EditLock>) => isNothing(l))), s.value);
}

/** The window containing a widget, if it is in one (`castTo Window <=< widgetGetToplevel`). */
function parentWindow(parent: Gtk.Widget): Gtk.Window | null {
  return Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(parent));
}

/**
 * Open a file, prompting for the path with the GTK File Chooser. If successful then return
 * the chosen pathname and its contents. If not then return @Nothing@. Problems are reported to
 * the user with GTK nofication windows.
 */
export async function openUserFile(
  /** Widget in parent window. */
  parent: Gtk.Widget | null,
  /** Possible file types. Default is first item. Empty for no filter. */
  filters: readonly Gtk.FileFilter[],
  /** Default file name, if known. */
  fname: Maybe<FilePath>,
): Promise<Maybe<[FilePath, Uint8Array]>> {
  const dialog = Gtk.new_(Gtk.FileChooserNative, {
    action: Gtk.FileChooserActionOpen,
    title: "Open Model File",
  });
  const parentWin = parent === null ? null : parentWindow(parent);
  if (parentWin !== null) Gtk.set(dialog, { transientFor: parentWin });
  for (const f of filters) Gtk.fileChooserAddFilter(dialog, f);
  if (fname.tag === "Just") Gtk.fileChooserSetFilename(dialog, fname.value);
  Gtk.fileChooserSetDoOverwriteConfirmation(dialog, false);
  const result = await Gtk.nativeDialogRun(dialog);
  if (result === Gtk.ResponseTypeAccept) {
    const mTarget = Gtk.fileChooserGetFilename(dialog);
    Gtk.nativeDialogDestroy(dialog);
    if (mTarget === null) return Nothing;
    const target = mTarget;
    const contents = await catchFileError(parent, () => readFileBytes(target));
    return contents.tag === "Just" ? Just([target, contents.value]) : Nothing;
  }
  Gtk.nativeDialogDestroy(dialog);
  return Nothing;
}

/**
 * If the argument action opens a file then try to get an edit lock on it. If successful return
 * the lock. Otherwise ask the user if they want a read-only copy.
 */
export async function forEditing<A>(
  /** Widget in parent window for read-only dialog. */
  parent: Gtk.Widget,
  /** Status of the old model, if any. */
  oldStatus: Maybe<FileStatus>,
  /** IO action that can open a file, returning the path and contents if successful. */
  openAct: () => Promise<Maybe<readonly [FilePath, A]>>,
): Promise<Maybe<[FileStatus, A]>> {
  const showProblem = async (d: Gtk.MessageDialog, p: FilePath, v: A): Promise<Maybe<[FileStatus, A]>> => {
    const parentWin = parentWindow(parent);
    if (parentWin !== null) Gtk.set(d, { transientFor: parentWin });
    const result = await Gtk.dialogRun(d);
    Gtk.widgetDestroy(d);
    return result === Gtk.ResponseTypeOk ? Just([FileStatus(Nothing, p), v]) : Nothing;
  };
  const opened = await openAct();
  if (opened.tag === "Nothing") return Nothing;
  const [p, v] = opened.value;
  const oldLock = preview(_Just<FileStatus>().dot(fileStatusLock).dot(_Just<EditLock>()), oldStatus);
  if (oldLock.tag === "Just") await dropEditLock(oldLock.value);
  const lockResult = await tryEditLock(p);
  switch (lockResult.tag) {
    case "EditLockSuccessful":
      return Just([FileStatus(Just(lockResult._0), p), v]);
    case "EditLockFailed": {
      const dialog = Gtk.new_(Gtk.MessageDialog, {
        messageType: Gtk.MessageTypeQuestion,
        buttons: Gtk.ButtonsTypeOkCancel,
        text: lockResult._0 + ".\n" +
          "You can currently open it read-only. Either save it in a new file " +
          "or try again later.",
      });
      return await showProblem(dialog, p, v);
    }
    case "EditLockError": {
      const dialog = Gtk.new_(Gtk.MessageDialog, {
        messageType: Gtk.MessageTypeWarning,
        buttons: Gtk.ButtonsTypeOkCancel,
        text: "Cannot create the editing lock file because: " + T.pack(showError(lockResult._0)) + ".\n" +
          "The file will be opened read-only.",
      });
      return await showProblem(dialog, p, v);
    }
  }
}

/** As for "openUserFile", but also parses the file contents as a JSON object. */
export async function openJsonFile<A>(
  codec: J.FromJSON<A>,
  /** Widget in parent window. */
  parent: Gtk.Widget,
  /** Possible file types. Default is first item. Empty for no filter. */
  filters: readonly Gtk.FileFilter[],
  /** Default file name, if known. */
  fname: Maybe<FilePath>,
): Promise<Maybe<[FilePath, A]>> {
  const opened = await openUserFile(parent, filters, fname);
  if (opened.tag === "Nothing") return Nothing;
  const [target, text] = opened.value;
  const doc = J.eitherDecode(codec, decodeUtf8(text));
  switch (doc.tag) {
    case "Left":
      // Web: messages name the file (`displayPath`), not the virtual path.
      await errorBox(parent, T.pack(
        "File \"" + displayPath(target) + "\" was corrupt and could not be read.\n\n"
        + "Technical details: " + doc.value));
      return Nothing;
    case "Right":
      return Just([target, doc.value]);
  }
}

/** As for "openUserFile", but also parses the file contents as an Excel file. */
export async function openExcelFile(parent: Gtk.Widget, fname: Maybe<FilePath>): Promise<Maybe<[FilePath, Xlsx]>> {
  const xlsFilter = Gtk.fileFilterNew();
  Gtk.fileFilterSetName(xlsFilter, "Excel files *.xlsx");
  Gtk.fileFilterAddPattern(xlsFilter, "*.xlsx");
  const opened = await openUserFile(parent, [xlsFilter], fname);
  if (opened.tag === "Nothing") return Nothing;
  const [target, text] = opened.value;
  const book = toXlsxEither(text);
  switch (book.tag) {
    case "Left":
      await errorBox(parent, T.pack(
        "File \"" + displayPath(target) + "\" was corrupt and could not be read.\n\n"
        + "Technical details: " + show_ParseError(book.value)));
      return Nothing;
    case "Right":
      return Just([target, book.value]);
  }
}

/** `LB.writeFile target $ encode document` */
function writeJsonFile<A>(codec: J.ToJSON<A>, target: FilePath, document: A): Promise<void> {
  return writeFileData(target, J.encode(codec.toJSON(document)), "application/json");
}

/** If the target file name is known then overwrite that file. Otherwise invoke "saveAsFile" */
export async function saveFile<A>(
  codec: J.ToJSON<A>,
  /** Widget in parent window. */
  parent: Gtk.Widget,
  /**
   * Possible file types if "saveAsFile" is invoked. Default is first item. Empty for no
   * filter.
   */
  filters: readonly Gtk.FileFilter[],
  /** Modify the chosen pathname, e.g. to have the right extension. */
  pathFunc: (p: FilePath) => FilePath,
  /** Target file name, if known. */
  fname: Maybe<FilePath>,
  /** Document to be saved. */
  document: A,
): Promise<Maybe<[FilePath, A]>> {
  switch (fname.tag) {
    case "Just": {
      const target = fname.value;
      const success = await catchFileError_(parent, () => writeJsonFile(codec, target, document));
      if (success) return Just([target, document]);
      return await saveAsFile(codec, parent, filters, pathFunc, fname, document);
    }
    case "Nothing":
      return await saveAsFile(codec, parent, filters, pathFunc, fname, document);
  }
}

/** As for "writeAsFile", except that the dialog title is hard coded. */
export function saveAsFile<A>(
  codec: J.ToJSON<A>,
  /** Widget in parent window. */
  parent: Gtk.Widget,
  /** Possible file types. Default is first item. Empty for no filter. */
  filters: readonly Gtk.FileFilter[],
  /** Modify the chosen pathname, e.g. to have the right extension. */
  pathFunc: (p: string) => string,
  /** The file name for this document, if known. */
  fname: Maybe<string>,
  /** Document to be saved. */
  document: A,
): Promise<Maybe<[FilePath, A]>> {
  return writeAsFile(codec, parent, "Save Model File", "Save", filters, pathFunc, fname, document);
}

/**
 * Save the document under a new file name. Returns the new name. If the
 * operation is cancelled or fails then it does nothing.
 */
export async function writeAsFile<A>(
  codec: J.ToJSON<A>,
  /** Widget in parent window. */
  parent: Gtk.Widget,
  /** Title for dialog. */
  titleTxt: string,
  /** Label for accept button. */
  buttonTxt: string,
  /** Possible file types. Default is first item. Empty for no filter. */
  filters: readonly Gtk.FileFilter[],
  /** Modify the chosen pathname, e.g. to have the right extension. */
  pathFunc: (p: string) => string,
  /** The file name for this document, if known. */
  fname: Maybe<string>,
  /** Document to be saved. */
  document: A,
): Promise<Maybe<[FilePath, A]>> {
  const dialog = Gtk.new_(Gtk.FileChooserNative, {
    action: Gtk.FileChooserActionSave,
    title: titleTxt,
    acceptLabel: buttonTxt,
  });
  const parentWin = parentWindow(parent);
  if (parentWin !== null) Gtk.set(dialog, { transientFor: parentWin });
  if (fname.tag === "Just") Gtk.fileChooserSetFilename(dialog, fname.value);
  for (const f of filters) Gtk.fileChooserAddFilter(dialog, f);
  Gtk.fileChooserSetDoOverwriteConfirmation(dialog, true);
  const result = await Gtk.nativeDialogRun(dialog);
  if (result === Gtk.ResponseTypeAccept) {
    const chosen = Gtk.fileChooserGetFilename(dialog);
    const mTarget = chosen === null ? null : pathFunc(chosen);
    Gtk.nativeDialogDestroy(dialog);
    if (mTarget === null) return Nothing;
    const target = mTarget;
    const success = await catchFileError_(parent, () => writeJsonFile(codec, target, document));
    if (success) return Just([target, document]);
    return await saveAsFile(codec, parent, filters, pathFunc, fname, document);
  }
  Gtk.nativeDialogDestroy(dialog);
  return Nothing;
}

/** Haskell `T.decodeLatin1`. */
function decodeLatin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Lenient UTF-32 decoding (`T.decodeUtf32LEWith T.lenientDecode`); TextDecoder has no UTF-32. */
function decodeUtf32(bytes: Uint8Array, littleEndian: boolean): string {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: string[] = [];
  const n = Math.floor(bytes.byteLength / 4);
  for (let i = 0; i < n; i++) {
    const cp = dv.getUint32(i * 4, littleEndian);
    out.push(cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp));
  }
  if (bytes.byteLength % 4 !== 0) out.push("�");
  return out.join("");
}

/** Haskell `T.encodeUtf16LE` etc. for the XML tag (ASCII only). */
function encodeAscii(s: string, width: 2 | 4, littleEndian: boolean): Uint8Array {
  const r = new Uint8Array(s.length * width);
  for (let i = 0; i < s.length; i++) r[i * width + (littleEndian ? 0 : width - 1)] = s.charCodeAt(i);
  return r;
}

/** Haskell `B.isPrefixOf`. */
function bytesPrefixOf(prefix: Uint8Array, bytes: Uint8Array): boolean {
  if (prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== bytes[i]) return false;
  return true;
}

/**
 * Try to find out what encoding this XML file is in, and return as a @Right@ text string.
 * @Left@ indicates an error.
 *
 * The ICU converters of the original are replaced by the browser's `TextDecoder` (which knows
 * the WHATWG encoding labels, with replacement characters for invalid input).
 */
export function tryDecodeXml(bytes: Uint8Array): Either<string, string> {
  const xmlTag = "<?xml";
  const testHeader = ([tag]: readonly [Uint8Array, (b: Uint8Array) => string]): boolean => bytesPrefixOf(tag, bytes);
  const headers: readonly (readonly [Uint8Array, (b: Uint8Array) => string])[] = [
    [encodeAscii(xmlTag, 2, true), (b) => new TextDecoder("utf-16le").decode(b)],
    [encodeAscii(xmlTag, 2, false), (b) => new TextDecoder("utf-16be").decode(b)],
    [encodeAscii(xmlTag, 4, true), (b) => decodeUtf32(b, true)],
    [encodeAscii(xmlTag, 4, false), (b) => decodeUtf32(b, false)],
  ];
  // exceptionHandler: return . Left . T.pack . show
  try {
    // This is either in an 8-bit format or its in one of the UTF multi-byte formats.
    if (bytesPrefixOf(encodeUtf8(xmlTag), bytes.subarray(0, T.length(xmlTag)))) {
      // This is an 8-bit format. Read the encoding from the XML Declaration.
      // Find the closing "?>". 100 chars > the longest possible declaration.
      const decl = T.breakOn("?>", T.take(100, decodeLatin1(bytes.subarray(0, 100))))[0];
      // Extract a quoted string following "encoding", or "" if not found.
      const encoding1 = T.breakOn("encoding", decl)[1];
      const encoding2 = T.drop(1, T.breakOn("\"", encoding1)[1]);
      const encoding3 = T.breakOn("\"", encoding2)[0];
      const encoding = encoding3 === "" ? "utf-8" : encoding3;
      // Get the converter for the encoding.
      const cnv = new TextDecoder(T.unpack(encoding));
      return Right(cnv.decode(bytes));
    }
    // Not an 8-bit format. Compare the initial bytes to find out which.
    const found = headers.find(testHeader);
    if (found !== undefined) return Right(found[1](bytes));
    return Left("Not an XML file.");
  } catch (e) {
    return Left(T.pack(showError(e)));
  }
}

/**
 * Like "catchFileError" but with return value ignored. Returns True for normal exit,
 * False for exception.
 */
export async function catchFileError_<A>(parent: Gtk.Widget | null, action: () => Promise<A>): Promise<boolean> {
  return isJust(await catchFileError(parent, action));
}

/** Haskell `catchIOError` catches I/O exceptions only: here file system errors. */
function isIOError(e: unknown): e is Error {
  return e instanceof IOError || (typeof DOMException !== "undefined" && e instanceof DOMException);
}

/** Haskell `show` of an exception. */
function showError(e: unknown): string {
  if (typeof DOMException !== "undefined" && e instanceof DOMException) return e.name + ": " + e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Haskell `ioeGetFileName`. The `IOError`s of `@/lib/System/IO` have messages of the form
 * "<file name>: <reason>"; browser exceptions do not name the file.
 */
function ioeGetFileName(err: Error): Maybe<string> {
  if (!(err instanceof IOError)) return Nothing;
  const i = err.message.indexOf(": ");
  return i > 0 ? Just(displayPath(err.message.slice(0, i))) : Nothing;
}

/**
 * Put up a dialog box with a meaningful error message when a file access fails,
 * and return Nothing.
 */
export async function catchFileError<A>(parent: Gtk.Widget | null, action: () => Promise<A>): Promise<Maybe<A>> {
  // Web: the Haskell IOError predicates are replaced by the browser's exception names.
  const errorType = (err: Error): string => {
    const name = err instanceof IOError ? "" : err.name;
    const msg = err.message;
    if (name === "InvalidModificationError" || name === "TypeMismatchError") return "already exists";
    if (name === "NotFoundError" || (err instanceof IOError && /does not exist|no longer available|404/.test(msg))) {
      return "does not exist";
    }
    if (name === "NoModificationAllowedError" || name === "InvalidStateError") {
      return "cannot be accessed because it is being used";
    }
    if (name === "QuotaExceededError") return "cannot be written because the device is full";
    if (name === "NotReadableError" || name === "EncodingError") return "is incomplete or corrupt";
    if (err instanceof IOError && /cannot read this file/.test(msg)) {
      return "cannot be accessed for some reason (illegal operation)";
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "cannot be accessed because you do not have permission";
    }
    if (name === "AbortError") return "cannot be accessed for some reason (programmer exception)";
    return "cannot be accessed due to an unknown error";
  };
  const messageText = (err: Error): string => {
    const errorFile = ioeGetFileName(err);
    return errorFile.tag === "Just"
      ? "File \"" + errorFile.value + "\" " + errorType(err) + "."
      : "That file " + errorType(err) + ".";
  };
  try {
    return Just(await action());
  } catch (err) {
    if (!isIOError(err)) throw err;
    console.log(err);
    await errorBox(parent, T.pack(messageText(err) + "\n\nTechnical details:\n" + showError(err)));
    return Nothing;
  }
}

/** Ensure that a pathname has the right extension. If not, append it. */
export function checkExtension(
  /** Extension without the \".\" separator. */
  ext: string,
  path: FilePath,
): FilePath {
  return takeExtension(path) === "." + ext ? path : addExtension(path, ext);
}

/** Supported types of file export. */
export type ExportType = "SVG" | "Postscript" | "PDF" | "PNG";
export const exportTypeValues: readonly ExportType[] = ["SVG", "Postscript", "PDF", "PNG"];
