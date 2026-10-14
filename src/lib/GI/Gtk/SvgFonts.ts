/**
 * Fonts for SVG files shown by image widgets.
 *
 * librsvg draws the text of an SVG file with the system fonts. A browser draws an SVG loaded as
 * an image (`<img src="x.svg">`) in isolation: it cannot use the page's web fonts, so text in
 * a family that is not installed (e.g. `font-family:Roboto` with no generic fallback, as in the
 * DSM welcome artwork) falls back to the browser's default serif font. This application's
 * "system" fonts are the bundled Cantarell (user interface) and Roboto (diagrams), so
 * `svgUrlWithFonts` gives an SVG file `@font-face` rules for those of them that it names, with
 * the font data inline (the only way an SVG image may load fonts), and returns a blob URL of the
 * result.
 */
import robotoRegular from "@fontsource/roboto/files/roboto-latin-400-normal.woff2?url";
import robotoBold from "@fontsource/roboto/files/roboto-latin-700-normal.woff2?url";
import cantarellRegular from "@fontsource/cantarell/files/cantarell-latin-400-normal.woff2?url";
import cantarellBold from "@fontsource/cantarell/files/cantarell-latin-700-normal.woff2?url";

/** The bundled font families: weight → font file URL. */
const bundledFonts: Readonly<Record<string, readonly (readonly [number, string])[]>> = {
  Roboto: [[400, robotoRegular], [700, robotoBold]],
  Cantarell: [[400, cantarellRegular], [700, cantarellBold]],
};

/** True if the URL (ignoring query and fragment) names an SVG file. */
export function isSvgUrl(url: string): boolean {
  return /\.svg$/i.test(url.replace(/[?#].*$/, ""));
}

async function dataUrl(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "data:font/woff2;base64," + btoa(bin);
}

/** The SVG text with `@font-face` rules for the bundled fonts it names (unchanged if none). */
export async function svgWithFonts(svg: string): Promise<string> {
  const used = Object.keys(bundledFonts).filter((family) => new RegExp(`font-family\\s*[:=]\\s*["']?[^;"'>]*\\b${family}\\b`).test(svg));
  if (used.length === 0) return svg;
  const rules: string[] = [];
  for (const family of used) {
    for (const [weight, url] of bundledFonts[family]) {
      rules.push(`@font-face{font-family:${family};font-style:normal;font-weight:${weight};src:url(${await dataUrl(url)}) format("woff2");}`);
    }
  }
  const style = `<style type="text/css"><![CDATA[${rules.join("")}]]></style>`;
  // Insert the rules as the first child of the root element.
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) return svg;
  const at = m.index + m[0].length;
  return svg.slice(0, at) + style + svg.slice(at);
}

const cache = new Map<string, Promise<string>>();

/**
 * A URL showing the SVG file at `url` with the bundled fonts it names available. Resolves to
 * `url` itself when the file names none of them or cannot be processed.
 */
export function svgUrlWithFonts(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) return url;
        const text = await r.text();
        const withFonts = await svgWithFonts(text);
        if (withFonts === text) return url;
        return URL.createObjectURL(new Blob([withFonts], { type: "image/svg+xml" }));
      } catch {
        return url;
      }
    })();
    cache.set(url, p);
  }
  return p;
}
