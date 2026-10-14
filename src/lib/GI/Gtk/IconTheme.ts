/**
 * `GtkIconTheme` for the browser.
 *
 * Icons are bundled at build time with Vite's `import.meta.glob`:
 *
 *  - the standard GTK icons (Adwaita symbolic icons, vendored in `./icons/Adwaita`);
 *  - the application icon themes copied from the Haskell `share` directories
 *    (`src/hades/share/hicolor`, `src/dsm/share/hicolor`, `src/dsm/share/Diametric`).
 *
 * An icon theme has a search path of data directories (URLs from `getDataDir`, or any string
 * containing the package name) and optionally a custom theme name, as in GTK. The default
 * theme looks in Adwaita and in every bundled `hicolor` theme, so application icons such as
 * "export" resolve everywhere.
 */
import { GObject } from "./Core";
import { Pixbuf, pixbufNewFromUrlAtSize } from "../Gdk";

const adwaita = import.meta.glob("./icons/Adwaita/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const shareIcons = import.meta.glob(
  ["/src/hades/share/hicolor/**/*.{svg,png}", "/src/dsm/share/hicolor/**/*.{svg,png}", "/src/dsm/share/Diametric/**/*.{svg,png}"],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;
const indexFiles = import.meta.glob(
  ["/src/hades/share/hicolor/index.theme", "/src/dsm/share/hicolor/index.theme", "/src/dsm/share/Diametric/index.theme"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** One icon file in a theme directory. */
interface IconFile {
  readonly url: string;
  /** Pixel size, or 0 for scalable. */
  readonly size: number;
  readonly context: string;
  readonly symbolic: boolean;
  /** Virtual source path of the file (e.g. `/src/dsm/share/Diametric/48x48/x.png`). */
  readonly path: string;
}

/** A theme: name → files, rooted at e.g. "/src/dsm/share/Diametric". */
class ThemeDir {
  readonly icons = new Map<string, IconFile[]>();
  readonly contexts = new Map<string, string>();
  constructor(readonly root: string, readonly themeName: string) {}
  add(rel: string, url: string): void {
    // rel: "<sizeDir>/<context dir...>/<name>.<ext>"
    const parts = rel.split("/");
    const file = parts.pop()!;
    const dir = parts.join("/");
    const name = file.replace(/\.(svg|png)$/, "").replace(/\.symbolic$/, "");
    const symbolic = /\.symbolic\.png$/.test(file) || name.endsWith("-symbolic");
    const sizeDir = parts[0] ?? "";
    const m = /^(\d+)x\d+/.exec(sizeDir);
    const size = m ? parseInt(m[1], 10) : 0;
    const context = this.contexts.get(dir) ?? parts[parts.length - 1] ?? "";
    const list = this.icons.get(name) ?? [];
    list.push({ url, size, context, symbolic, path: this.root + "/" + rel });
    this.icons.set(name, list);
  }
}

const themes: ThemeDir[] = [];
function themeFor(root: string, name: string): ThemeDir {
  let t = themes.find((x) => x.root === root);
  if (!t) {
    t = new ThemeDir(root, name);
    const idx = indexFiles[root + "/index.theme"];
    if (idx) parseIndex(idx, t);
    themes.push(t);
  }
  return t;
}
function parseIndex(txt: string, t: ThemeDir): void {
  let section = "";
  for (const line of txt.split(/\r?\n/)) {
    const s = /^\[(.*)\]$/.exec(line.trim());
    if (s) {
      section = s[1];
      continue;
    }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(line.trim());
    if (kv && kv[1] === "Context" && section !== "Icon Theme") t.contexts.set(section, kv[2]);
  }
}

for (const [path, url] of Object.entries(shareIcons)) {
  const m = /^(\/src\/(?:hades|dsm)\/share\/(hicolor|Diametric))\/(.*)$/.exec(path);
  if (!m) continue;
  themeFor(m[1], m[2]).add(m[3], url);
}
const adwaitaTheme = new ThemeDir("adwaita", "Adwaita");
for (const [path, url] of Object.entries(adwaita)) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  adwaitaTheme.add("scalable/" + file, url);
}

/** Pick the best file for a requested size: scalable first, else nearest larger size. */
function bestFile(files: IconFile[], size: number): IconFile {
  const scalable = files.find((f) => f.size === 0);
  if (scalable) return scalable;
  const sorted = files.slice().sort((a, b) => a.size - b.size);
  return sorted.find((f) => f.size >= size) ?? sorted[sorted.length - 1];
}

export type IconLookupFlags =
  | "IconLookupFlagsForceSize" | "IconLookupFlagsForceSvg" | "IconLookupFlagsNoSvg" | "IconLookupFlagsUseBuiltin" | number;
export const IconLookupFlagsForceSize: IconLookupFlags = "IconLookupFlagsForceSize";
/** Never return an SVG icon. */
export const IconLookupFlagsNoSvg: IconLookupFlags = "IconLookupFlagsNoSvg";
/** Return an SVG icon even if a bitmap of the requested size is available. */
export const IconLookupFlagsForceSvg: IconLookupFlags = "IconLookupFlagsForceSvg";

function isSvgFile(f: IconFile): boolean {
  return /\.svg$/i.test(f.path);
}

export class IconInfo {
  /** `filename`: the icon file's virtual path (`iconInfoGetFilename`); defaults to the URL. */
  constructor(readonly url: string, readonly size: number, readonly filename: string = url) {}
}

export class IconTheme extends GObject {
  searchPath: string[] = [];
  customTheme: string | null = null;
  constructor(readonly isDefault = false) {
    super();
  }
  /** Theme directories searched, in order. */
  dirs(): ThemeDir[] {
    const pkgs: string[] = [];
    for (const p of this.searchPath) {
      if (/dsm/.test(p)) pkgs.push("dsm");
      if (/hades/.test(p)) pkgs.push("hades");
    }
    const r: ThemeDir[] = [];
    const add = (root: string) => {
      const t = themes.find((x) => x.root === root);
      if (t && !r.includes(t)) r.push(t);
    };
    for (const pkg of pkgs) {
      if (this.customTheme) add(`/src/${pkg}/share/${this.customTheme}`);
    }
    for (const pkg of pkgs) add(`/src/${pkg}/share/hicolor`);
    if (this.isDefault) {
      r.push(adwaitaTheme);
      add("/src/hades/share/hicolor");
      add("/src/dsm/share/hicolor");
    }
    return r;
  }
  lookup(name: string, size: number, flags: readonly IconLookupFlags[] = []): IconInfo | null {
    const noSvg = flags.includes(IconLookupFlagsNoSvg);
    const forceSvg = flags.includes(IconLookupFlagsForceSvg);
    for (const d of this.dirs()) {
      let files = d.icons.get(name) ?? d.icons.get(name.replace(/-symbolic$/, ""));
      if (files && noSvg) files = files.filter((f) => !isSvgFile(f));
      else if (files && forceSvg && files.some(isSvgFile)) files = files.filter(isSvgFile);
      if (files && files.length > 0) {
        const f = bestFile(files, size);
        return new IconInfo(f.url, size, f.path);
      }
    }
    if (noSvg) return null; // The symbolic fallback icons are all SVG.
    // Symbolic fallback for standard names.
    if (this.isDefault && !name.endsWith("-symbolic")) {
      const files = adwaitaTheme.icons.get(name + "-symbolic");
      if (files) return new IconInfo(files[0].url, size);
    }
    return null;
  }
}

let defaultTheme: IconTheme | null = null;
export function iconThemeGetDefault(): IconTheme {
  if (!defaultTheme) {
    defaultTheme = new IconTheme(true);
    defaultTheme.searchPath = ["hades"];
  }
  return defaultTheme;
}
export function iconThemeNew(): IconTheme {
  return new IconTheme(false);
}
export function iconThemeSetSearchPath(t: IconTheme, dirs: readonly string[]): void {
  t.searchPath = [...dirs];
  t.emit("changed");
}
export function iconThemeGetSearchPath(t: IconTheme): string[] {
  return t.searchPath.slice();
}
export function iconThemeAppendSearchPath(t: IconTheme, dir: string): void {
  t.searchPath.push(dir);
  t.emit("changed");
}
export function iconThemePrependSearchPath(t: IconTheme, dir: string): void {
  t.searchPath.unshift(dir);
  t.emit("changed");
}
export function iconThemeSetCustomTheme(t: IconTheme, name: string | null): void {
  t.customTheme = name;
  t.emit("changed");
}
export function iconThemeHasIcon(t: IconTheme, name: string): boolean {
  return t.lookup(name, 16) !== null;
}
/**
 * `iconThemeLookupIcon`: the flags `IconLookupFlagsNoSvg` and `IconLookupFlagsForceSvg` choose
 * between the bitmap and SVG files of an icon, as in GTK; other flags are ignored.
 */
export function iconThemeLookupIcon(t: IconTheme, name: string, size: number, flags: unknown): IconInfo | null {
  return t.lookup(name, size, Array.isArray(flags) ? (flags as IconLookupFlags[]) : []);
}
export function iconInfoLoadIcon(i: IconInfo): Pixbuf {
  return pixbufNewFromUrlAtSize(i.url, i.size, i.size);
}
/**
 * `iconInfoGetFilename`: the icon file's virtual path (for bundled theme icons a data-file path
 * such as `/src/dsm/share/Diametric/48x48/x.png`, readable via `dataFileUrl`), so its extension
 * is that of the file. Use `i.url` to load it.
 */
export function iconInfoGetFilename(i: IconInfo): string {
  return i.filename;
}
/** `iconThemeLoadIcon`: throws (like a GError) if the icon is missing. */
export function iconThemeLoadIcon(t: IconTheme, name: string, size: number, _flags: unknown): Pixbuf {
  const i = t.lookup(name, size);
  if (!i) throw new Error(`Icon '${name}' not present in theme`);
  return pixbufNewFromUrlAtSize(i.url, size, size);
}
/** Names of icons in a context (or all icons when `context` is null). */
export function iconThemeListIcons(t: IconTheme, context: string | null): string[] {
  const names = new Set<string>();
  for (const d of t.dirs()) {
    if (d === adwaitaTheme && context === null) continue;
    for (const [n, files] of d.icons) if (context === null || files.some((f) => f.context === context)) names.add(n);
  }
  return Array.from(names).sort();
}
export function iconThemeListContexts(t: IconTheme): string[] {
  const cs = new Set<string>();
  for (const d of t.dirs()) {
    if (d === adwaitaTheme) continue;
    for (const files of d.icons.values()) for (const f of files) if (f.context) cs.add(f.context);
  }
  return Array.from(cs).sort();
}

/**
 * Resolve an icon name to a URL using the default theme and then every bundled theme. Used by
 * widgets that show icons by name.
 */
export function iconUrl(name: string | null, size = 16, theme?: IconTheme): string | null {
  if (!name) return null;
  const t = theme ?? iconThemeGetDefault();
  const i = t.lookup(name, size);
  if (i) return i.url;
  for (const d of themes) {
    const files = d.icons.get(name);
    if (files && files.length > 0) return bestFile(files, size).url;
  }
  return null;
}

/** True if the icon is a monochrome symbolic icon (rendered with the text colour). */
export function isSymbolicIcon(name: string | null, url: string | null): boolean {
  return !!name && !!url && url.includes("Adwaita");
}
