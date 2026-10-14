// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { isSvgUrl, svgWithFonts } from "./SvgFonts";

afterEach(() => vi.restoreAllMocks());

describe("SvgFonts", () => {
  test("isSvgUrl", () => {
    expect(isSvgUrl("/src/dsm/share/documentation/welcome.svg")).toBe(true);
    expect(isSvgUrl("/assets/welcome-abc123.SVG?import#x")).toBe(true);
    expect(isSvgUrl("/a/b.png")).toBe(false);
    expect(isSvgUrl("blob:http://x/123")).toBe(false);
  });

  test("an SVG naming no bundled font is unchanged", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text style="font-family:Arial, sans-serif">x</text></svg>`;
    expect(await svgWithFonts(svg)).toBe(svg);
  });

  test("font faces are inserted for the bundled families used", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(new Uint8Array([1, 2, 3])),
    );
    const svg = `<?xml version="1.0"?>\n<svg\n   xmlns="http://www.w3.org/2000/svg" width="10"><text style="font-size:3px;font-family:Roboto;fill:#fff">x</text></svg>`;
    const out = await svgWithFonts(svg);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Roboto regular and bold.
    expect(out).toContain(`<svg\n   xmlns="http://www.w3.org/2000/svg" width="10"><style type="text/css"><![CDATA[@font-face{font-family:Roboto;`);
    expect(out).toContain("font-weight:400;src:url(data:font/woff2;base64,AQID)");
    expect(out).toContain("font-weight:700;");
    expect(out).not.toContain("Cantarell");
    expect(out.endsWith(`<text style="font-size:3px;font-family:Roboto;fill:#fff">x</text></svg>`)).toBe(true);
  });
});
