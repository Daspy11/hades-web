// Ported from hades/src/Model/Report/Docx/File.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * General file utilities for managing Docx Word documents.
 *
 * The OpenOffice document standard uses Zip as a packaging mechanism so that different file types
 * (e.g. image files) can be included verbatim. There are also a number of metadata files. Some
 * of these can be copied verbatim from an existing file, and others
 * in modified versions.
 *
 * To this end an empty Word file has been unzipped and its components stored in the application data.
 *
 * TypeScript port
 * ---------------
 * * The skeleton (`share/docx` of the `hades` package) is bundled with the application: its files
 *   are imported as text with Vite's `import.meta.glob(..., { query: "?raw" })` and turned back
 *   into their UTF-8 bytes, so reading them is synchronous and works in tests. `getSkeletonDir`
 *   returns the virtual data directory (`/src/hades/share/docx`, see `@/lib/System/Paths`), and
 *   `walkDirectory` lists the bundled files below a virtual path.
 * * `getSkeletonStyles` is therefore synchronous. `writeDocxFile` and `insertDocxFile` are
 *   `async` (they read and write files through `@/lib/System/IO` virtual paths).
 * * Zip archives are read and written with `fflate` (`unzipSync`/`zipSync`). As with the Haskell
 *   `zip-archive`, the entries are written in the order of their paths and carry the document
 *   time (as UTC fields of the DOS date and time).
 * * `ByteString` is `Uint8Array`. As in Haskell, XML parts are parsed from their bytes, which the
 *   `xml` package reads one byte per character (Latin-1); see the note at `updateXml`.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Nothing, Just, type Maybe } from "@/lib/Data/Maybe";
import { getCurrentTime, type UTCTime } from "@/lib/Data/Time";
import { IOError, readFileBytes, takeFileName, writeFileData, type FilePath } from "@/lib/System/IO";
import { getDataFileName } from "@/lib/System/Paths";
import * as X from "@/lib/Text/XML/Light";
import * as XC from "@/lib/Text/XML/Light/Cursor";
import { getUserName } from "@/hades/src/System/Hades/DataFiles";
import { getStyleById, pPr, wAttr, wName } from "@/hades/src/Model/Report/Docx/Document";
import { applyAll, findNameDF, goStart, setElemText } from "@/hades/src/Model/Report/Docx/Utils";

type Text = T.Text;

export { findNameDF };


// Web: the skeleton files, bundled as text (`exhaustive` includes `_rels/.rels`).
const skeletonFiles = import.meta.glob("/src/hades/share/docx/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
  exhaustive: true,
}) as Record<string, string>;


/** The MIME type of Word documents (for downloads). */
export const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";


/** The directory where the Word skeleton files are stored. */
export function getSkeletonDir(): FilePath {
  return getDataFileName("hades", "docx");
}


/**
 * `LB.readFile` for the skeleton files. Web: reads the bundled copy of the file; throws an
 * `IOError` if the path is not one of the skeleton files.
 */
function readSkeletonFile(p: FilePath): Uint8Array {
  const txt = skeletonFiles[p];
  if (txt === undefined) throw new IOError(`${p}: openBinaryFile: does not exist (No such file or directory)`);
  return U.encodeUtf8(txt);
}


/**
 * Read the named styles from the styles.xml file in the skeleton. Missing styles are silently
 * ignored.
 */
export function getSkeletonStyles(names: readonly Text[]): X.Element[] {
  const getStyle = (file: readonly X.Content[], nm: Text): X.Element => {
    const s = getStyleById(nm, file);
    return s.tag === "Nothing" ? namedBlankStyle(nm) : s.value;
  };
  const stylePath = getSkeletonDir() + "/word/styles.xml";
  const styleFile = X.parseXML(readSkeletonFile(stylePath));
  return names.map((nm) => getStyle(styleFile, nm));
}


/**
 * A blank style (no formatting changes) with the given name.
 *
 * Word requires that every style used in the document must have an entry in the styles.xml file.
 * This fulfils that requirement.
 */
export function namedBlankStyle(nm: Text): X.Element {
  return X.node(wName("style"), [
    [wAttr("type", "paragraph"), wAttr("customStyle", "1"), wAttr("styleId", nm)],
    [
      X.node(wName("name"), [wAttr("val", nm)]),
      X.node(wName("basedOn"), [wAttr("val", "Normal")]),
      X.node(wName("qFormat"), null),
      pPr(null),
    ],
  ]);
}


/**
 * Package up a list of ByteStrings as a Word document.
 *
 * The skeleton files are modified in two ways before being written:
 *
 * 1. XML files can be parsed and edited using a cursor.
 *
 * 2. Files can be added, overwriting any skeleton file of the same path.
 *
 * The core document properties will have the date, user and title set automatically.
 *
 * The @FilePath@s within the skeleton MUST use \"/\" as a pathname separator regardless of the
 * platform. DO NOT use the "(</>)" operator to create them, as it will do the wrong thing on
 * Windows.
 *
 * @param title Title of the report.
 * @param target1 File to be created. Will have \".docx\" suffix appended if it is not present.
 * @param edits Edits to XML files within the skeleton.
 * @param additions Pairs of paths within the zip file and their contents.
 */
export async function writeDocxFile(
  title: Text,
  target1: FilePath,
  edits: readonly (readonly [FilePath, (c: XC.Cursor) => XC.Cursor])[],
  additions: readonly (readonly [FilePath, Uint8Array])[],
): Promise<void> {
  const fixSlash = (c: string): string => (c === "\\" ? "/" : c);
  const docTime = getCurrentTime();
  const posixTime = Math.floor(docTime / 1000);
  const userName = lookupUserName();
  const skeleton = ((): M.Map<FilePath, Uint8Array> => {
    const skelDir = getSkeletonDir();
    const paths = walkDirectory(skelDir);
    const pairs = paths.map((p): [FilePath, Uint8Array] => {
      const bytes = readSkeletonFile(p);
      return [Array.from(makeRelative(skelDir, p)).map(fixSlash).join(""), bytes];
    });
    return M.fromList(pairs);
  })();
  const target2 = isExtensionOf("docx", target1) ? target1 : target1 + ".docx";
  const core = setCreation(title, docTime, userName);
  const skel2 = foldrEdits([core, ...edits], skeleton);
  const skel3 = foldrAdditions(additions, skel2);
  // Web: written through a virtual path (a `/download/...` target downloads the document), with
  // the Word MIME type for the download.
  await writeFileData(target2, zipArchive(posixTime, M.toList(skel3)), docxMimeType);
}


/**
 * Insert material into an existing template Word document.
 *
 * The @FilePath@s within the template MUST use \"/\" as a pathname separator regardless of the
 * platform. DO NOT use the "(</>)" operator to create them, as it will do the wrong thing on
 * Windows.
 *
 * @param templatePath Word file to use as template.
 * @param targetPath Word file to write result into.
 * @param edits XML files within the template to modify.
 * @param additions New media to add to the template.
 */
export async function insertDocxFile(
  templatePath: FilePath,
  targetPath: FilePath,
  edits: readonly (readonly [FilePath, (c: XC.Cursor) => XC.Cursor])[],
  additions: readonly (readonly [FilePath, Uint8Array])[],
): Promise<void> {
  const docTime = getCurrentTime();
  const posixTime = Math.floor(docTime / 1000);
  const userName = lookupUserName();
  const template = M.fromList(unzipArchive(await readFileBytes(templatePath)));
  const targetPath2 = isExtensionOf("docx", targetPath) ? targetPath : targetPath + ".docx";
  const core = setModified(docTime, userName);
  const template2 = foldrEdits([core, ...edits], template);
  const template3 = foldrAdditions(additions, template2);
  // Web: written through a virtual path, with the Word MIME type for a download.
  await writeFileData(targetPath2, zipArchive(posixTime, M.toList(template3)), docxMimeType);
}


/**
 * `foldr (\(p, f) -> M.adjust (updateXml f) p) files edits`: the last edit is applied first.
 * (Shared by "writeDocxFile" and "insertDocxFile".)
 */
function foldrEdits(
  edits: readonly (readonly [FilePath, (c: XC.Cursor) => XC.Cursor])[],
  files: M.Map<FilePath, Uint8Array>,
): M.Map<FilePath, Uint8Array> {
  let acc = files;
  for (let i = edits.length - 1; i >= 0; i--) {
    const [p, f] = edits[i];
    acc = M.adjust((bytes: Uint8Array) => updateXml(f, bytes), p, acc);
  }
  return acc;
}


/**
 * `foldr (uncurry M.insert) files additions`: the first of several additions with the same path
 * wins.
 */
function foldrAdditions(
  additions: readonly (readonly [FilePath, Uint8Array])[],
  files: M.Map<FilePath, Uint8Array>,
): M.Map<FilePath, Uint8Array> {
  let acc = files;
  for (let i = additions.length - 1; i >= 0; i--) acc = M.insert(additions[i][0], additions[i][1], acc);
  return acc;
}


/**
 * Parse an XML file, edit it with the cursor function and render it again. The file is left
 * unchanged if it holds no XML content.
 *
 * Faithful quirk: as in Haskell (the `XmlSource` instance of lazy `ByteString`), the bytes are
 * read as Latin-1 characters, and `renderXml` writes every non-ASCII character as a numeric
 * character reference. So non-ASCII text in an edited part (e.g. a template's `document.xml`)
 * comes out as one reference per UTF-8 byte (mojibake). Likewise a UTF-8 byte order mark at the
 * start of an edited part becomes text (`&#239;&#187;&#191;`) in front of the XML declaration,
 * which makes the part ill-formed. To fix both, parse `U.decodeUtf8(bytes)` instead of `bytes`.
 */
export function updateXml(f: (c: XC.Cursor) => XC.Cursor, bytes: Uint8Array): Uint8Array {
  const c = XC.fromForest(X.parseXML(bytes));
  return c.tag === "Nothing" ? bytes : renderXml(XC.toForest(f(c.value)));
}


/**
 * Update core attributes with creation details.
 *
 * @param title Document title.
 * @param utcTime Creation time.
 * @param n Creator name.
 */
export function setCreation(
  title: Text,
  utcTime: UTCTime,
  n: string,
): readonly [FilePath, (c: XC.Cursor) => XC.Cursor] {
  const titleQN = X.QName("title", Nothing, Just("dc"));
  const creatorQN = X.QName("creator", Nothing, Just("dc"));
  const modifiedByQN = X.QName("lastModifiedBy", Nothing, Just("cp"));
  const createdQN = X.QName("created", Nothing, Just("dcterms"));
  const modifiedQN = X.QName("modified", Nothing, Just("dcterms"));
  const dateTime = iso8601DateTime(utcTime);
  const setTo = (str: string, qn: X.QName) => (c: XC.Cursor): Maybe<XC.Cursor> => {
    const r = findNameDF(qn, goStart(c));
    return r.tag === "Nothing" ? Nothing : Just(XC.modifyContent((x) => setElemText(str, x), r.value));
  };
  const setTitle = setTo(T.unpack(title), titleQN);
  const setCreator = setTo(n, creatorQN);
  const setModifiedBy = setTo(n, modifiedByQN);
  const setCreated = setTo(dateTime, createdQN);
  const setModified1 = setTo(dateTime, modifiedQN);
  const f = (c: XC.Cursor): XC.Cursor => applyAll([setTitle, setCreator, setModifiedBy, setCreated, setModified1], c);
  return ["docProps/core.xml", f];
}


/** Update core attributes with modification details. */
export function setModified(utcTime: UTCTime, n: string): readonly [FilePath, (c: XC.Cursor) => XC.Cursor] {
  const modifiedByQN = X.QName("lastModifiedBy", Nothing, Just("cp"));
  const modifiedQN = X.QName("modified", Nothing, Just("dcterms"));
  const dateTime = iso8601DateTime(utcTime);
  const setModifiedBy = (c: XC.Cursor): Maybe<XC.Cursor> => {
    const r = findNameDF(modifiedByQN, goStart(c));
    return r.tag === "Nothing" ? Nothing : Just(XC.modifyContent((x) => setElemText(n, x), r.value));
  };
  const setModified1 = (c: XC.Cursor): Maybe<XC.Cursor> => {
    const r = findNameDF(modifiedQN, goStart(c));
    return r.tag === "Nothing" ? Nothing : Just(XC.modifyContent((x) => setElemText(dateTime, x), r.value));
  };
  const f = (c: XC.Cursor): XC.Cursor => applyAll([setModifiedBy, setModified1], c);
  return ["docProps/core.xml", f];
}


/**
 * `formatTime defaultTimeLocale (iso8601DateFormat $ Just "%H:%M:%SZ")`, i.e.
 * `%Y-%m-%dT%H:%M:%SZ` (UTC).
 */
function iso8601DateTime(t: UTCTime): string {
  const d = new Date(t);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const yyyy = y < 0 ? "-" + String(-y).padStart(4, "0") : String(y).padStart(4, "0");
  return yyyy + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) + "T" +
    p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) + ":" + p2(d.getUTCSeconds()) + "Z";
}


/**
 * The user name: `fromMaybe "unknown" $ user1 <|> user2` with `user1`, `user2` the `USERNAME`
 * and `USER` environment variables.
 *
 * Web: there are no environment variables; the name is the HADES user name of this browser
 * (`System.Hades.DataFiles.getUserName`), or "unknown" if it is empty.
 */
function lookupUserName(): string {
  const n = getUserName();
  return n === "" ? "unknown" : n;
}


/**
 * `System.FilePath.isExtensionOf`: true if the extensions of the file name end with the given
 * one (`"docx"` or `".docx"`). As in Haskell this is case-sensitive and looks at all the
 * extensions (`takeExtensions`: everything from the first dot of the file name), so
 * `"Report.DOCX"` does not have the extension `"docx"`. (The `@/lib/System/IO` version ignores
 * case and only looks at the last extension.)
 */
export function isExtensionOf(ext: string, p: FilePath): boolean {
  const e = ext.startsWith(".") ? ext : "." + ext;
  const name = takeFileName(p);
  const i = name.indexOf(".");
  const exts = i < 0 ? "" : name.slice(i);
  return exts.endsWith(e);
}


/** `makeRelative dir p`: the path relative to the directory (unchanged if not inside it). */
function makeRelative(dir: FilePath, p: FilePath): FilePath {
  const d = dir.endsWith("/") ? dir : dir + "/";
  return p.startsWith(d) ? p.slice(d.length) : p;
}


/**
 * Returns a list of the plain files (not the directories) in the path. The pathnames returned
 * use "/" as a separator regardless of the platform so that they are compatible with zip files.
 *
 * Web: walks the bundled skeleton files (the only directory this module reads), in sorted order.
 */
export function walkDirectory(path: FilePath): FilePath[] {
  const isFile = Object.prototype.hasOwnProperty.call(skeletonFiles, path); // File and directory should be mutually exclusive.
  const prefix = path.endsWith("/") ? path : path + "/";
  const contents = Object.keys(skeletonFiles).filter((p) => p.startsWith(prefix)).sort();
  const isDirectory = contents.length > 0;
  if (isFile) return [path];
  if (isDirectory) return contents;
  return []; // Should never happen.
}


/** Encode an XML document as a lazy bytestring. */
export function renderXml(cs: readonly X.Content[]): Uint8Array {
  return U.encodeUtf8(cs.map((c) => X.showContent(c)).join(""));
}


// ---------------------------------------------------------------------------------------------
// Web: zip archives (Haskell `Codec.Archive.Zip`).

/** The entries of a zip archive (`map extract . zEntries . toArchive`), in archive order. */
function unzipArchive(bytes: Uint8Array): [FilePath, Uint8Array][] {
  const files = unzipSync(fflateBytes(bytes));
  return Object.entries(files);
}


/**
 * The `Uint8Array` constructor of the realm `fflate` runs in. `fflate` tells files from folders
 * with `instanceof`, and byte arrays can come from another realm (e.g. TextEncoder output under
 * jsdom).
 */
const FflateUint8Array = zipSync({}).constructor as Uint8ArrayConstructor;

/** The bytes as an array of `fflate`'s realm (copied only if necessary). */
function fflateBytes(bytes: Uint8Array): Uint8Array {
  return bytes instanceof FflateUint8Array ? bytes : new FflateUint8Array(bytes as unknown as ArrayLike<number>);
}


/**
 * `fromArchive $ foldr addEntryToArchive emptyArchive (map (\(p, bytes) -> toEntry p posixTime
 * bytes) entries)`: a zip archive with the entries in the given order, all with the given
 * modification time (POSIX seconds, written as UTC fields as `zip-archive` does).
 */
function zipArchive(posixTime: number, entries: readonly (readonly [FilePath, Uint8Array])[]): Uint8Array {
  const ms = posixTime * 1000;
  // fflate writes the local time fields of the date; shift it so that they are the UTC ones.
  const mtime = new Date(ms + new Date(ms).getTimezoneOffset() * 60000);
  const files: Zippable = {};
  for (const [p, bytes] of entries) {
    files[p] = fflateBytes(bytes);
  }
  return zipSync(files, { level: 6, mtime });
}
