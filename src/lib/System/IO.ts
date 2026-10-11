/**
 * Browser replacement for `System.IO`, `System.Directory` and `System.FilePath`.
 *
 * Desktop file paths become *virtual paths* naming where the bytes live:
 *
 * | path                         | meaning                                                     |
 * |------------------------------|-------------------------------------------------------------|
 * | `/handle/<id>/<name>`        | a File System Access API file handle (read and write)       |
 * | `/upload/<id>/<name>`        | a file the user picked or dropped (read-only)               |
 * | `/download/<name>`           | a write-only target: writing it downloads the file          |
 * | `/builtin/<url>`             | a file bundled with the application (read-only, fetched)    |
 * | `/memory/<name>`             | an in-memory file (used for exports opened in a new tab)    |
 *
 * The file name (last path component) is always the real file name, so `takeFileName`,
 * `takeExtension` etc. behave as on the desktop.
 */
import { Just, Nothing, type Maybe } from "../Data/Maybe";

export type FilePath = string;

// ---------------------------------------------------------------------------------------------
// System.FilePath

export function takeFileName(p: FilePath): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
export function takeDirectory(p: FilePath): FilePath {
  const i = p.lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : ".") : p.slice(0, i);
}
export function takeExtension(p: FilePath): string {
  const n = takeFileName(p);
  const i = n.lastIndexOf(".");
  return i <= 0 ? "" : n.slice(i);
}
export function takeBaseName(p: FilePath): string {
  const n = takeFileName(p);
  const i = n.lastIndexOf(".");
  return i <= 0 ? n : n.slice(0, i);
}
export function dropExtension(p: FilePath): FilePath {
  const e = takeExtension(p);
  return e ? p.slice(0, p.length - e.length) : p;
}
export function replaceExtension(p: FilePath, ext: string): FilePath {
  const e = ext.startsWith(".") || ext === "" ? ext : "." + ext;
  return dropExtension(p) + e;
}
export function addExtension(p: FilePath, ext: string): FilePath {
  return p + (ext.startsWith(".") ? ext : "." + ext);
}
/** Haskell `</>` */
export function joinPath(a: FilePath, b: FilePath): FilePath {
  if (b.startsWith("/")) return b;
  if (a === "" || a === ".") return b;
  return a.endsWith("/") ? a + b : a + "/" + b;
}
export function splitExtension(p: FilePath): [FilePath, string] {
  const e = takeExtension(p);
  return [p.slice(0, p.length - e.length), e];
}
export function hasExtension(p: FilePath): boolean {
  return takeExtension(p) !== "";
}
export function isExtensionOf(ext: string, p: FilePath): boolean {
  const e = ext.startsWith(".") ? ext : "." + ext;
  return takeExtension(p).toLowerCase() === e.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Registry of handles and uploaded files

let nextId = 1;
const handles = new Map<string, FileSystemFileHandle>();
const uploads = new Map<string, Blob>();
const memory = new Map<string, Blob>();

export function registerHandle(h: FileSystemFileHandle): FilePath {
  const id = String(nextId++);
  handles.set(id, h);
  return `/handle/${id}/${h.name}`;
}
export function registerUpload(f: File | Blob, name?: string): FilePath {
  const id = String(nextId++);
  uploads.set(id, f);
  return `/upload/${id}/${name ?? (f as File).name ?? "file"}`;
}
export function downloadPath(name: string): FilePath {
  return `/download/${name}`;
}
export function builtinPath(url: string): FilePath {
  return `/builtin/${url}`;
}

interface Parsed {
  kind: "handle" | "upload" | "download" | "builtin" | "memory" | "other";
  id: string;
  name: string;
  rest: string;
}
function parse(p: FilePath): Parsed {
  const m = /^\/(handle|upload)\/(\d+)\/(.*)$/.exec(p);
  if (m) return { kind: m[1] as "handle" | "upload", id: m[2], name: m[3], rest: m[3] };
  if (p.startsWith("/download/")) return { kind: "download", id: "", name: takeFileName(p), rest: p.slice(10) };
  if (p.startsWith("/builtin/")) return { kind: "builtin", id: "", name: takeFileName(p), rest: p.slice(9) };
  if (p.startsWith("/memory/")) return { kind: "memory", id: "", name: takeFileName(p), rest: p.slice(8) };
  return { kind: "other", id: "", name: takeFileName(p), rest: p };
}

/** True if writing to the path replaces the file in place (rather than downloading). */
export function isWritableInPlace(p: FilePath): boolean {
  return parse(p).kind === "handle" || parse(p).kind === "memory";
}

/** A user-facing description of a virtual path (its file name). */
export function displayPath(p: FilePath): string {
  return parse(p).name;
}

// ---------------------------------------------------------------------------------------------
// Reading and writing

export class IOError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IOError";
  }
}

async function blobOf(p: FilePath): Promise<Blob> {
  const q = parse(p);
  switch (q.kind) {
    case "handle": {
      const h = handles.get(q.id);
      if (!h) throw new IOError(`${q.name}: file handle is no longer available`);
      return await h.getFile();
    }
    case "upload": {
      const b = uploads.get(q.id);
      if (!b) throw new IOError(`${q.name}: file is no longer available`);
      return b;
    }
    case "memory": {
      const b = memory.get(q.rest);
      if (!b) throw new IOError(`${q.name}: does not exist`);
      return b;
    }
    case "builtin": {
      const r = await fetch(q.rest);
      if (!r.ok) throw new IOError(`${q.name}: ${r.status} ${r.statusText}`);
      return await r.blob();
    }
    default:
      throw new IOError(`${p}: cannot read this file`);
  }
}

export async function readFileBytes(p: FilePath): Promise<Uint8Array> {
  return new Uint8Array(await (await blobOf(p)).arrayBuffer());
}
export async function readFileText(p: FilePath): Promise<string> {
  return await (await blobOf(p)).text();
}
/** `doesFileExist` */
export async function doesFileExist(p: FilePath): Promise<boolean> {
  try {
    await blobOf(p);
    return true;
  } catch {
    return false;
  }
}

function toBlob(data: Uint8Array | string | Blob, mime: string): Blob {
  if (data instanceof Blob) return data;
  return new Blob([data as BlobPart], { type: mime });
}

/** Trigger a browser download of the data. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function writeFileData(p: FilePath, data: Uint8Array | string | Blob, mime = "application/octet-stream"): Promise<void> {
  const q = parse(p);
  const blob = toBlob(data, mime);
  switch (q.kind) {
    case "handle": {
      const h = handles.get(q.id);
      if (!h) throw new IOError(`${q.name}: file handle is no longer available`);
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return;
    }
    case "memory":
      memory.set(q.rest, blob);
      return;
    case "download":
    case "upload":
    case "builtin":
    case "other":
      downloadBlob(q.name, blob);
      return;
  }
}
export const writeFile = writeFileData;
/** `removeFile`: only in-memory files can be removed. */
export async function removeFile(p: FilePath): Promise<void> {
  const q = parse(p);
  if (q.kind === "memory") memory.delete(q.rest);
}

/** A URL for displaying the file (e.g. opening an exported HTML report in a new tab). */
export async function fileUrl(p: FilePath): Promise<string> {
  const q = parse(p);
  if (q.kind === "builtin") return q.rest;
  return URL.createObjectURL(await blobOf(p));
}

// ---------------------------------------------------------------------------------------------
// Pickers (used by GtkFileChooserNative)

export interface PickerFilter {
  readonly name: string;
  readonly patterns: readonly string[];
  readonly mimeTypes: readonly string[];
}

function acceptOf(filters: readonly PickerFilter[]): string {
  const parts: string[] = [];
  for (const f of filters) {
    for (const p of f.patterns) {
      const m = /^\*(\.[A-Za-z0-9]+)$/.exec(p);
      if (m) parts.push(m[1]);
    }
    parts.push(...f.mimeTypes);
  }
  return parts.join(",");
}

function pickerTypes(filters: readonly PickerFilter[]): FilePickerAcceptType[] {
  const r: FilePickerAcceptType[] = [];
  for (const f of filters) {
    const exts = f.patterns.map((p) => /^\*(\.[A-Za-z0-9]+)$/.exec(p)?.[1]).filter((x): x is string => !!x);
    const mimes = f.mimeTypes.length > 0 ? f.mimeTypes : ["application/octet-stream"];
    if (exts.length === 0 && f.mimeTypes.length === 0) continue;
    const accept: Record<string, string[]> = {};
    for (const m of mimes) accept[m] = exts as string[];
    r.push({ description: f.name, accept: accept as any });
  }
  return r;
}

/** Let the user choose a file to open. Returns its virtual path, or Nothing if cancelled. */
export async function pickFileToOpen(filters: readonly PickerFilter[]): Promise<Maybe<FilePath>> {
  const w = window as any;
  if (typeof w.showOpenFilePicker === "function") {
    try {
      const types = pickerTypes(filters);
      const [h] = await w.showOpenFilePicker(types.length > 0 ? { types, excludeAcceptAllOption: false } : {});
      return Just(registerHandle(h));
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return Nothing;
      // Fall through to the input element (e.g. cross-origin iframe restrictions).
    }
  }
  return await new Promise<Maybe<FilePath>>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const acc = acceptOf(filters);
    if (acc) input.accept = acc;
    input.style.display = "none";
    let settled = false;
    input.onchange = () => {
      settled = true;
      const f = input.files?.[0];
      input.remove();
      resolve(f ? Just(registerUpload(f)) : Nothing);
    };
    input.addEventListener("cancel", () => {
      if (!settled) {
        settled = true;
        input.remove();
        resolve(Nothing);
      }
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Let the user choose where to save. With the File System Access API this is a native save
 * dialog; otherwise the caller is given a download path for the suggested name.
 */
export async function pickFileToSave(suggestedName: string, filters: readonly PickerFilter[]): Promise<Maybe<FilePath>> {
  const w = window as any;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const types = pickerTypes(filters);
      const h = await w.showSaveFilePicker({ suggestedName, ...(types.length > 0 ? { types } : {}) });
      return Just(registerHandle(h));
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return Nothing;
    }
  }
  return Just(downloadPath(suggestedName));
}

/** True if the browser can save files in place. */
export function hasNativeSave(): boolean {
  return typeof (window as any).showSaveFilePicker === "function";
}
