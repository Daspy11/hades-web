// Ported from banana-ui/webits/src/Network/Webits/Icons.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Utiltities for managing icons.
 *
 * TypeScript port
 * ---------------
 * * File paths are virtual source paths (as from `getDataDir`). The "file system" that
 *   `getIconData` reads is the set of icon files bundled with the application: the vendored
 *   Adwaita icons in `/src/lib/GI/Gtk/icons` (one flat directory, so
 *   `getIconData("/src/lib/GI/Gtk/icons")` gives a single group "Adwaita"), the `share`
 *   directories of the HADES packages (e.g. `/src/hades/share/hicolor/48x48`, whose groups are
 *   "Actions", "Categories" and "Stock") and anything under `/src/banana-ui`.
 * * Web: there is no web server, so `scottyIcons` (and `elmerStatic`) register the icons in a
 *   page-wide table instead of serving them under @/icons/:icon@. `iconUrl` then gives the bundled
 *   URL of the icon file followed by the fragment @#/icons/<name>@: the last path component of the
 *   URL is still the icon name, which the pushed JavaScript and 'iconFromUrl' rely on, and the
 *   fragment is never sent to the server. Unregistered icons get the original @/icons/<name>@
 *   URL, which does not resolve (as the original server answered 404).
 */
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { iso, type Iso } from "@/lib/Control/Lens";
import { takeBaseName, type FilePath } from "@/lib/System/IO";
import { getDataFileName } from "@/lib/System/Paths";
import type { IconName } from "@/banana-ui/base/Reactive/Banana/Common";

export type { IconName } from "@/banana-ui/base/Reactive/Banana/Common";

/** Icon catalog data */
export interface IconGroup {
  readonly iconGroupName: string;
  readonly iconGroupContents: M.Map<IconName, IconData>;
}
export function IconGroup(iconGroupName: string, iconGroupContents: M.Map<IconName, IconData>): IconGroup {
  return { iconGroupName, iconGroupContents };
}

export interface IconData {
  /** Path on local file system. */
  readonly iconPath: FilePath;
  /** MIME type for the icon file. */
  readonly iconMime: IconMime;
}
export function IconData(iconPath: FilePath, iconMime: IconMime): IconData {
  return { iconPath, iconMime };
}

export type IconMime = "IconSvg" | "IconPng";

/** `instance Show IconMime` */
export function show_IconMime(m: IconMime): string {
  switch (m) {
    case "IconSvg":
      return "image/svg+xml";
    case "IconPng":
      return "image/png";
  }
}

/** The bundled icon files: virtual path → URL. */
const iconFiles = import.meta.glob(
  [
    "/src/lib/GI/Gtk/icons/**/*.{svg,png}",
    "/src/hades/share/**/*.{svg,png}",
    "/src/dsm/share/**/*.{svg,png}",
    "/src/banana-ui/**/*.{svg,png}",
  ],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

/** The URL of a bundled icon file. */
function iconFileUrl(path: FilePath): string {
  return iconFiles[normalisePath(path)] ?? path;
}

function normalisePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split(/[\\/]+/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

/** `listDirectory` over the bundled icon files: the names of the entries in a directory. */
function listDirectory(path: FilePath): { files: string[]; dirs: string[] } {
  const base = normalisePath(path) + "/";
  const files = new Set<string>(), dirs = new Set<string>();
  for (const p of Object.keys(iconFiles)) {
    if (!p.startsWith(base)) continue;
    const rest = p.slice(base.length).split("/");
    if (rest.length === 1) files.add(rest[0]);
    else dirs.add(rest[0]);
  }
  if (files.size === 0 && dirs.size === 0) throw new Error(`listDirectory: ${path}: does not exist (No such directory)`);
  return { files: [...files].sort(), dirs: [...dirs].sort() };
}

/**
 * Generate the icon group data by reading a directory. The directory should contain
 * one sub-directory for each icon group. The names of the subdirectories will be capitalised
 * to give the group names. The sub-directories should contain icon files with @svg@
 * or @png@ suffixes. The base name is used as the icon name and the suffix is used to
 * determine the MIME type. Files not suffixed @svg@ or @png@ will be ignored.
 *
 * The returned icon groups are sorted into alphabetical order.
 *
 * (Web: reads the bundled icon files, see the module header. Synchronous.)
 */
export function getIconData(path: FilePath): IconGroup[] {
  const mkIconData = (p: FilePath, icon: string, iconFiles1: readonly string[]): Maybe<IconData> => {
    const pngFile = icon + ".png";
    const svgFile = icon + ".svg";
    if (iconFiles1.includes(svgFile)) return Just(IconData(p + "/" + svgFile, "IconSvg"));
    else if (iconFiles1.includes(pngFile)) return Just(IconData(p + "/" + pngFile, "IconPng"));
    else return Nothing;
  };
  const pathContents = listDirectory(path).dirs;
  return pathContents.map((groupDir) => {
    const groupName = T.toTitle(T.pack(groupDir));
    const groupPath = normalisePath(path) + "/" + groupDir;
    const groupContents = (() => {
      const l = listDirectory(groupPath);
      return [...l.files, ...l.dirs];
    })();
    const groupFiles = groupContents.reduceRight(
      (m, fp) => M.insertWith((n: string[], o: string[]) => [...n, ...o], takeBaseName(fp), [fp], m),
      M.empty<string, string[]>(),
    );
    const icons = M.mapMaybeWithKey((icon: string, fs: string[]) => mkIconData(groupPath, icon, fs), groupFiles);
    return IconGroup(groupName, M.mapKeys(T.pack, icons));
  });
}

/** Merge icon groups with the same name. Prefers SVG over PNG. Left-biased. */
export function mergeIconGroups(groups: readonly IconGroup[]): IconGroup[] {
  const mergeGroups = (gs1: readonly IconGroup[]): IconGroup =>
    IconGroup(
      gs1[0].iconGroupName,
      gs1.map((g) => g.iconGroupContents).reduceRight((acc, m) => mergeIcons(m, acc)),
    );
  // "head" is safe because groupBy never produces empty sub-lists.
  return L.groupBy(
    (a: IconGroup, b: IconGroup) => a.iconGroupName === b.iconGroupName,
    L.sortOn((g: IconGroup) => g.iconGroupName, groups),
  ).map(mergeGroups);
}

function mergeIcons(m1: M.Map<IconName, IconData>, m2: M.Map<IconName, IconData>): M.Map<IconName, IconData> {
  return M.unionWith(mergeIcon, m1, m2);
}

/** Prefer SVG over PNG. If both have the same MIME type then take the left. */
function mergeIcon(d1: IconData, d2: IconData): IconData {
  switch (d1.iconMime) {
    case "IconSvg":
      return d1;
    case "IconPng":
      switch (d2.iconMime) {
        case "IconSvg":
          return d2;
        case "IconPng":
          return d1;
      }
  }
}

/** Merge the icon data. */
export function allIcons(groups: readonly IconGroup[]): M.Map<IconName, IconData> {
  return M.unions(groups.map((g) => g.iconGroupContents));
}

/** The icons registered by `scottyIcons`: the routes of the original web server. */
let registeredIcons: M.Map<IconName, IconData> = M.empty();

/**
 * Serve icons in a web server.
 *
 * The icons from the argument are to be found in @/icons/:icon@. Also serves @/favicon.ico@
 * from the bundled data file @JS/favicon.ico@.
 *
 * Web: registers the icons for 'iconUrl' (earlier registrations take precedence, as the first
 * matching Scotty route did) and sets the page's favicon.
 */
export function scottyIcons(iconGroups: readonly IconGroup[]): void {
  const tbl = allIcons(iconGroups);
  registeredIcons = M.union(registeredIcons, tbl);
  if (typeof document !== "undefined") {
    let link = document.head.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (link === null) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/x-icon";
    link.href = getDataFileName("webits", "JS/favicon.ico");
  }
}

/** The local URL for the icon image file. (Web: see the module header.) */
export function iconUrl(nm: IconName): string {
  const d = M.lookup(nm, registeredIcons);
  return d.tag === "Just" ? iconFileUrl(d.value.iconPath) + "#/icons/" + nm : "/icons/" + nm;
}

/** Find the icon referenced in the URL. Actually just returns the last component of the path. */
export function iconFromUrl(url: string): IconName {
  return L.last(T.splitOn("/", url)); // Safe because splitOn never returns an empty list.
}

/**
 * ISO from URL to icon name. Not a true ISO because it ignores the everything except the last
 * component of the path.
 */
export const iconIso: Iso<string, IconName> = iso(iconFromUrl, iconUrl);
