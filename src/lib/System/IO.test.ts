import { describe, expect, it } from "vitest";
import { isExtensionOf, readFileBytes, readFileText, takeExtensions, writeFileData } from "./IO";
import { showText } from "../Data/Text";

describe("System.IO", () => {
  it("isExtensionOf follows System.FilePath", () => {
    expect(isExtensionOf("gz", "a/b.tar.gz")).toBe(true);
    expect(isExtensionOf(".tar.gz", "a/b.tar.gz")).toBe(true);
    expect(isExtensionOf("tar", "a/b.tar.gz")).toBe(false);
    expect(isExtensionOf("DSM", "x.dsm")).toBe(false);
    expect(takeExtensions("/handle/1/report.v2.docx")).toBe(".v2.docx");
    expect(isExtensionOf("docx", "/download/.docx")).toBe(true);
  });
  it("reads back in-memory files", async () => {
    await writeFileData("/memory/t.txt", "héllo", "text/plain");
    expect(await readFileText("/memory/t.txt")).toBe("héllo");
    expect(Array.from(await readFileBytes("/memory/t.txt"))).toEqual([104, 195, 169, 108, 108, 111]);
  });
});

describe("Data.Text.showText", () => {
  it("matches Haskell show", () => {
    expect(showText("abc")).toBe('"abc"');
    expect(showText('say "hi"\\')).toBe('"say \\"hi\\"\\\\"');
    expect(showText("Größe")).toBe('"Gr\\246\\223e"');
    expect(showText("é1")).toBe('"\\233\\&1"');
    expect(showText("a\nb\tc")).toBe('"a\\nb\\tc"');
    expect(showText("\u0000\u001b\u007f")).toBe('"\\NUL\\ESC\\DEL"');
    expect(showText("\u000eH")).toBe('"\\SO\\&H"');
    expect(showText("😀")).toBe('"\\128512"');
  });
});
