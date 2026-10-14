/**
 * Browser replacement for the parts of `GI.GLib` used by HADES. Import as
 * `import * as GLib from "@/lib/GI/GLib"`.
 *
 * File names are the virtual paths of `@/lib/System/IO` and the data file paths of
 * `@/lib/System/Paths` (`getDataDir(pkg) + "/..."`), so a "file URI" is the URL the browser can
 * open (e.g. with `Gtk.showUriOnWindow`, which opens it in a new tab).
 */
import { dataFileUrl, isDataFile } from "../System/Paths";

/**
 * `g_filename_to_uri`: the URI of a file.
 *
 * Web: a bundled data file (a path under one of the `getDataDir` directories) gives the URL it
 * is served at, a `/builtin/<url>` virtual path gives its URL, both made absolute against the
 * page (the host name is not used for these). Any other absolute path gives a `file://` URI
 * escaped as GLib escapes it, with the host name if one is given (the browser cannot open it).
 * As in GLib, a relative path is an error.
 */
export function filenameToUri(filename: string, hostname: string | null): string {
  const absolute = (url: string): string => {
    const base = globalThis.document?.baseURI;
    try {
      return base ? new URL(url, base).href : url;
    } catch {
      return url;
    }
  };
  if (filename.startsWith("/builtin/")) return absolute(filename.slice("/builtin/".length));
  if (isDataFile(filename)) return absolute(dataFileUrl(filename));
  if (!filename.startsWith("/")) {
    throw new Error(`The pathname “${filename}” is not an absolute path`);
  }
  return "file://" + (hostname ?? "") + escapeFileUriPath(filename);
}

/**
 * GLib's escaping of a file name in a `file:` URI (`g_escape_file_uri`): every UTF-8 byte except
 * ASCII letters, digits and `!$&'()*+,-.:=@_~/` becomes `%XX` (upper-case hex).
 */
function escapeFileUriPath(path: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(path)) {
    const c = String.fromCharCode(byte);
    out += byte < 0x80 && /[A-Za-z0-9!$&'()*+,\-.:=@_~/]/.test(c)
      ? c
      : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
