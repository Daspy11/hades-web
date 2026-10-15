/**
 * Browser replacement for the `Paths_<pkg>` modules that Cabal generates for packages with
 * data files (`Paths_hades`, `Paths_dsm`, `Paths_banana_ui_gtk`, `Paths_webits`).
 *
 * The data directories are copied into the source tree (`src/hades/share`, `src/dsm/share`,
 * `src/banana-ui/gtk/banana-gtk.css`, `src/banana-ui/webits/...`) and bundled by Vite with
 * `import.meta.glob(..., { query: "?url" })`, so every data file has a URL that can be fetched
 * or used as an image source.
 *
 * `getDataDir(pkg)` returns the package's data directory as a virtual path: the location of the
 * directory in the source tree (e.g. `"/src/dsm/share"`). Paths built from it, such as
 * `getDataDir("dsm") + "/examples/x.dsm"`, are turned into fetchable URLs with `dataFileUrl`
 * (in a production build the files are renamed into `assets/`, so the virtual path itself is only
 * fetchable from the development server). `getDataFileName(pkg, relPath)` does both steps, as
 * Cabal's `getDataFileName` does. As with Cabal, a missing file is not an error until it is
 * read: `fetchDataFile` rejects for a file that is not part of the package data.
 *
 * Relative paths use `/` separators and are resolved Cabal style against the `data-dir`:
 * `getDataFileName("hades", "hicolor/48x48/actions/foo.png")` is the URL of
 * `src/hades/share/hicolor/48x48/actions/foo.png`, and
 * `getDataFileName("dsm", "examples/1 Quick Guide to the DSM.dsm")` the URL of
 * `src/dsm/share/examples/1 Quick Guide to the DSM.dsm`.
 */

import { IOError } from "./IO";

/** The packages that have data files. */
export type DataPackage = "hades" | "dsm" | "banana-ui-gtk" | "webits";

/** Virtual data directory of each package (its location relative to the project root). */
const dataDirs: Readonly<Record<DataPackage, string>> = {
  hades: "/src/hades/share",
  dsm: "/src/dsm/share",
  "banana-ui-gtk": "/src/banana-ui/gtk",
  webits: "/src/banana-ui/webits",
};

// The globs must be literal for Vite. `exhaustive` includes dot files such as `docx/_rels/.rels`.
const hadesFiles = import.meta.glob("/src/hades/share/**/*", {
  query: "?url",
  import: "default",
  eager: true,
  exhaustive: true,
}) as Record<string, string>;

const dsmFiles = import.meta.glob("/src/dsm/share/**/*", {
  query: "?url",
  import: "default",
  eager: true,
  exhaustive: true,
}) as Record<string, string>;

const gtkFiles = import.meta.glob("/src/banana-ui/gtk/banana-gtk.css", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Only the files listed in webits.cabal, not the (future) TypeScript sources next to them.
const webitsFiles = import.meta.glob(
  [
    "/src/banana-ui/webits/Testcard_F.jpg",
    "/src/banana-ui/webits/words.txt",
    "/src/banana-ui/webits/JS/**/*",
    "/src/banana-ui/webits/JQuery/**/*",
  ],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

/**
 * All data files: virtual path → URL. (Test runners may give an empty URL for some file types,
 * such as CSS; the virtual path is used then.)
 */
const allFiles: ReadonlyMap<string, string> = new Map(
  [hadesFiles, dsmFiles, gtkFiles, webitsFiles].flatMap((m) =>
    Object.entries(m).map(([path, url]) => [path, devCssUrl(url) || path] as [string, string]),
  ),
);

/**
 * The development server answers a plain fetch of a `.css` file with a JavaScript module (the
 * HMR wrapper), not the stylesheet; `?direct` makes it serve the CSS itself (as for a `<link>`).
 * Production asset URLs are left alone.
 */
export function devCssUrl(url: string): string {
  return url && import.meta.env?.DEV && /\.css$/.test(url) ? url + "?direct" : url;
}

/**
 * Normalise a path: `\` and `/` separators, empty and `.` segments dropped, `..` resolved.
 * A leading `/` is kept.
 */
function normalise(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const seg of path.split(/[\\/]+/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return (absolute ? "/" : "") + out.join("/");
}

/** `getDataDir`: the (virtual) directory holding the package's data files. */
export function getDataDir(pkg: DataPackage): string {
  return dataDirs[pkg];
}

/**
 * The URL of a data file given its path under one of the data directories (as built from
 * `getDataDir`). If the file is not one of the bundled data files the normalised path is
 * returned unchanged.
 */
export function dataFileUrl(path: string): string {
  const p = normalise(path);
  return allFiles.get(p) ?? p;
}

/** True if the path names one of the bundled data files. */
export function isDataFile(path: string): boolean {
  return allFiles.has(normalise(path));
}

/** `getDataFileName`: the URL of a data file of the package. */
export function getDataFileName(pkg: DataPackage, relPath: string): string {
  return dataFileUrl(dataDirs[pkg] + "/" + relPath);
}

/** True if the package has the data file. */
export function dataFileExists(pkg: DataPackage, relPath: string): boolean {
  return isDataFile(dataDirs[pkg] + "/" + relPath);
}

/**
 * Fetch a data file of the package. Rejects if the file is not one of the package's data files
 * or cannot be loaded.
 */
export async function fetchDataFile(pkg: DataPackage, relPath: string): Promise<Response> {
  const path = normalise(dataDirs[pkg] + "/" + relPath);
  const url = allFiles.get(path);
  if (url === undefined) throw new Error(`${relPath}: data file of ${pkg} does not exist`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${relPath}: cannot load data file of ${pkg} (${response.status})`);
  return response;
}

/**
 * The data files of the package within the directory `dirPrefix` (recursively), as paths
 * relative to the data directory (the form `getDataFileName` takes), in sorted order. An empty
 * prefix lists all the package's data files.
 */
export function listDataFiles(pkg: DataPackage, dirPrefix: string): string[] {
  const base = dataDirs[pkg] + "/";
  const rel = normalise(dirPrefix).replace(/^\//, "");
  const result: string[] = [];
  for (const p of allFiles.keys()) {
    if (!p.startsWith(base)) continue;
    const r = p.slice(base.length);
    if (rel === "" || r === rel || r.startsWith(rel + "/")) result.push(r);
  }
  return result.sort();
}

/**
 * `System.Directory.listDirectory` for a data directory given as a virtual path (as built from
 * `getDataDir`, e.g. `getDataDir("dsm") + "/examples"`): the names of the files and
 * subdirectories directly inside it, in no particular order (sort them, as Haskell callers do).
 * Throws an `IOError` when no bundled data file lies under the path (no such directory).
 */
export function listDataDirectory(dir: string): string[] {
  const base = normalise(dir).replace(/\/$/, "") + "/";
  const names = new Set<string>();
  for (const p of allFiles.keys()) {
    if (p.startsWith(base)) names.add(p.slice(base.length).split("/")[0]);
  }
  if (names.size === 0) throw new IOError(`${dir}: listDirectory: does not exist (No such file or directory)`);
  return [...names];
}
