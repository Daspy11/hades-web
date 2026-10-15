// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { PdfSurface, PdfTarget } from "./Cairo";

describe("PDF recording surface", () => {
  test("text is WinAnsi encoded and scaled to the measured width", () => {
    const t = new PdfTarget(50);
    t.font = "bold 10px Roboto";
    t.fillStyle = "#000000";
    // The drawing font measures "MM" at half its Helvetica-Bold width (2 * 833 * 10 / 1000 = 16.66).
    vi.spyOn(t, "measureText").mockReturnValue({ width: 8.33 } as TextMetrics);
    t.fillText("MM", 5, 20);
    expect(t.content()).toContain("BT /F2 10 Tf 50 Tz 5 30 Td (MM) Tj ET");
    t.fillText("(a)\\é’➔", 0, 0);
    expect(t.content()).toContain("(\\(a\\)\\\\\\351\\222?) Tj");
  });

  test("the fonts use WinAnsiEncoding and images become soft-masked XObjects", () => {
    const s = new PdfSurface(10, 10);
    (s.target.images as unknown as unknown[]).push({ width: 1, height: 1, rgb: "ff0000>", alpha: "80>" });
    const pdf = new TextDecoder().decode(s.pdfBytes());
    expect(pdf).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(pdf).toContain("/XObject << /Im0 7 0 R >>");
    expect(pdf).toContain("/SMask 8 0 R /Filter /ASCIIHexDecode /Length 7 >>\nstream\nff0000>\nendstream");
    expect(pdf).toMatch(/xref\n0 9\n/);
  });
});
