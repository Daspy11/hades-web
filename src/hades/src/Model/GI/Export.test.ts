import { describe, expect, it, vi } from "vitest";
import * as M from "@/lib/Data/Map";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { DiagramRef, IconRef } from "@/hades/src/Model/Report/Base";
import { Attr, Heading, Icon, Para, Picture, Str, noAttr } from "@/hades/src/Model/Report/Document";

const written = new Map<string, { data: unknown; mime: string }>();

vi.mock("@/lib/System/IO", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/System/IO")>();
  return {
    ...orig,
    readFileText: async (p: string) => {
      if (p.endsWith("report.css")) return "body { color: black; }";
      return orig.readFileText(p);
    },
    writeFileData: async (p: string, data: unknown, mime = "application/octet-stream") => {
      written.set(p, { data, mime });
    },
  };
});

const { base64DecodeLenient, formatReportHtml, imagePath, writeImage } = await import("./Export");

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const svg = U.encodeUtf8("<svg/>");
const dId = U.fromWords(1, 2, 3, 4);

describe("Model.GI.Export helpers", () => {
  it("decodes the null PNG", () => {
    const b = base64DecodeLenient(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1"
      + "BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=");
    expect(Array.from(b.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(b.length).toBe(95);
    expect(Array.from(base64DecodeLenient("QU\nJD*"))).toEqual([65, 66, 67]);
  });

  it("names image files as the desktop did", () => {
    expect(imagePath(IconRef("flag"), [png, Nothing])).toBe("flag.png");
    expect(imagePath(IconRef("flag"), [png, Just(svg)])).toBe("flag.svg");
    expect(imagePath(DiagramRef(dId), [png, Just(svg)])).toBe(U.toText(dId) + ".svg");
    expect(writeImage("flag", [png, Nothing])).toEqual(["flag.png", png]);
    expect(writeImage("x", [png, Just(svg)])).toEqual(["x.svg", svg]);
  });

  it("writes a self-contained HTML report", async () => {
    const imageMap = M.fromList([
      [IconRef("flag"), [png, Nothing] as const],
      [DiagramRef(dId), [png, Just(svg)] as const],
    ]);
    const blocks = [
      Heading(1, noAttr, [Str("Title & more")]),
      Para([Icon("flag")]),
      Picture(Attr(Nothing, Just("DiagramBox")), [Str("D")], "D", [100, 50], dId),
    ];
    await formatReportHtml("My <report>", "/download/report", blocks, imageMap);
    const out = written.get("/download/report.html");
    expect(out?.mime).toBe("text/html;charset=utf-8");
    const html = U.decodeUtf8(out!.data as Uint8Array);
    expect(html).toContain("<title>My &lt;report&gt;</title>");
    expect(html).toContain("<style>body { color: black; }</style>");
    expect(html).toContain(`src="data:image/png;base64,iVBORw=="`);
    expect(html).toContain(`src="data:image/svg+xml;base64,${btoa("<svg/>")}"`);
    expect(html).toContain("Title &amp; more");
  });
});
