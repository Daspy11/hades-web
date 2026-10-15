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
    // jsdom has no object URLs.
    fileUrl: async (p: string) => "blob:test" + p,
  };
});

const {
  base64DecodeLenient, formatReportHtml, getImageResources, imagePath, previewFolderClean, previewReport,
  writeImage, writeReportToFile,
} = await import("./Export");
const { ReportHtml } = await import("@/hades/src/Model/Report/Dialogs");

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

/** A stand-in for the browser tab that `previewReport` opens first. */
function fakeTab() {
  return {
    closed: false,
    opener: {} as unknown,
    document: { title: "", body: { textContent: "" } },
    location: { replace: vi.fn() },
    close: vi.fn(function (this: { closed: boolean }) { this.closed = true; }),
  };
}

describe("Model.GI.Export previews", () => {
  // The image resources are not needed: the reports below have no pictures.
  const cls = {} as any;
  const model = {} as any;
  const blocks = [Para([Str("Preview text")])];

  it("opens the tab at once and shows the preview in it when it is ready", async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window);
    try {
      await previewReport(cls, model, "Preview", blocks, []);
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0].slice(0, 2)).toEqual(["", "_blank"]);
      expect(tab.opener).toBeNull();
      expect(tab.document.body.textContent).toContain("Preparing");
      expect(tab.location.replace).toHaveBeenCalledTimes(1);
      const uri = tab.location.replace.mock.calls[0][0] as string;
      const path = uri.replace(/^blob:test/, "");
      expect(path).toMatch(/^\/memory\/\.dsmPreviews\/preview\d+\.html$/);
      const html = U.decodeUtf8(written.get(path)!.data as Uint8Array);
      expect(html).toContain("<title>Preview</title>");
      expect(html).toContain("Preview text");
      expect(tab.close).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it("falls back to showUriOnWindow when the browser gives no tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await previewReport(cls, model, "Preview 2", blocks, []);
      expect(open).toHaveBeenCalledTimes(2);
      expect(open.mock.calls[1][0]).toMatch(/^blob:test\/memory\/\.dsmPreviews\/preview\d+\.html$/);
      expect(open.mock.calls[1][1]).toBe("_blank");
    } finally {
      open.mockRestore();
    }
  });

  it("closes the tab and rethrows when the report cannot be generated", async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window);
    try {
      // A diagram picture needs the model: this one is not a model, so rendering fails.
      await expect(previewReport(cls, model, "Bad", blocks, [DiagramRef(dId)])).rejects.toThrow();
      expect(tab.close).toHaveBeenCalled();
      expect(tab.location.replace).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it("cleans previews older than 8 hours, once", async () => {
    const revoke = vi.fn();
    const urlAny = URL as unknown as { revokeObjectURL?: (u: string) => void };
    const oldRevoke = urlAny.revokeObjectURL;
    urlAny.revokeObjectURL = revoke;
    const now = vi.spyOn(Date, "now");
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window);
    try {
      const t0 = 1_700_000_000_000;
      now.mockReturnValue(t0);
      await previewReport(cls, model, "Old", blocks, []);
      const uri = tab.location.replace.mock.calls[0][0] as string;
      now.mockReturnValue(t0 + 7 * 3600 * 1000);
      await previewFolderClean();
      expect(revoke).not.toHaveBeenCalledWith(uri);
      now.mockReturnValue(t0 + 9 * 3600 * 1000);
      await previewFolderClean();
      expect(revoke).toHaveBeenCalledWith(uri);
      const n = revoke.mock.calls.length;
      await previewFolderClean();
      expect(revoke.mock.calls.length).toBe(n);
    } finally {
      open.mockRestore();
      now.mockRestore();
      urlAny.revokeObjectURL = oldRevoke;
    }
  });
});

describe("Model.GI.Export resources and report files", () => {
  it("gives a missing icon the null PNG and no SVG", async () => {
    const m = await getImageResources({} as any, {} as any, [IconRef("no-such-icon-anywhere")]);
    const r = M.lookup(IconRef("no-such-icon-anywhere"), m);
    expect(r.tag).toBe("Just");
    if (r.tag === "Just") {
      expect(r.value[0].length).toBe(95);
      expect(r.value[1]).toEqual(Nothing);
    }
  });

  it("writes an HTML report for ReportHtml", async () => {
    await writeReportToFile({} as any, ReportHtml("/download/out"), "Out", {} as any, [Para([Str("Body")])], []);
    const out = written.get("/download/out.html");
    expect(U.decodeUtf8(out!.data as Uint8Array)).toContain("Body");
  });
});
