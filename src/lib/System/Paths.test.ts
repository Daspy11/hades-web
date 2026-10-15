import { describe, expect, test } from "vitest";
import {
  dataFileExists,
  dataFileUrl,
  devCssUrl,
  fetchDataFile,
  getDataDir,
  getDataFileName,
  isDataFile,
  listDataDirectory,
  listDataFiles,
} from "./Paths";
import { IOError } from "./IO";

describe("System.Paths", () => {
  test("data directories", () => {
    expect(getDataDir("hades")).toBe("/src/hades/share");
    expect(getDataDir("dsm")).toBe("/src/dsm/share");
    expect(getDataDir("banana-ui-gtk")).toBe("/src/banana-ui/gtk");
    expect(getDataDir("webits")).toBe("/src/banana-ui/webits");
  });

  test("data files exist and have URLs", () => {
    expect(dataFileExists("dsm", "examples/1 Quick Guide to the DSM.dsm")).toBe(true);
    expect(dataFileExists("hades", "report.css")).toBe(true);
    expect(dataFileExists("hades", "docx/_rels/.rels")).toBe(true);
    expect(dataFileExists("hades", "docx/[Content_Types].xml")).toBe(true);
    expect(dataFileExists("banana-ui-gtk", "banana-gtk.css")).toBe(true);
    expect(dataFileExists("webits", "JS/favicon.ico")).toBe(true);
    expect(dataFileExists("hades", "nonexistent.css")).toBe(false);
    const url = getDataFileName("hades", "report.css");
    expect(typeof url).toBe("string");
    expect(url).toContain("report");
    // Paths are normalised, and paths built from getDataDir resolve the same way.
    expect(getDataFileName("hades", "./hicolor/../report.css")).toBe(url);
    expect(dataFileUrl(getDataDir("hades") + "/report.css")).toBe(url);
    expect(isDataFile("/src/hades/share/report.css")).toBe(true);
    // The development server serves a plain `.css` URL as a JavaScript module; `?direct` gives the
    // stylesheet itself (the HTML report embedded the HMR module instead of the CSS).
    if (url !== "/src/hades/share/report.css") expect(url).toMatch(/\.css\?direct$/);
    expect(devCssUrl("/src/hades/share/report.css")).toBe("/src/hades/share/report.css?direct");
    expect(devCssUrl("/src/dsm/share/examples/2 FMEA.dsm")).toBe("/src/dsm/share/examples/2 FMEA.dsm");
    expect(devCssUrl("")).toBe("");
    // Unknown files keep their (virtual) path, as Cabal does not check existence.
    expect(getDataFileName("hades", "share/hades-gtk.css")).toBe("/src/hades/share/share/hades-gtk.css");
  });

  test("listing", () => {
    expect(listDataFiles("dsm", "examples")).toEqual([
      "examples/1 Quick Guide to the DSM.dsm",
      "examples/2 FMEA.dsm",
      "examples/3 Managing Risks.dsm",
      "examples/4 Managing Hazards.dsm",
    ]);
    const docx = listDataFiles("hades", "docx/");
    expect(docx).toContain("docx/_rels/.rels");
    expect(docx).toContain("docx/word/document.xml");
    expect(docx.every((p) => p.startsWith("docx/"))).toBe(true);
    expect(listDataFiles("banana-ui-gtk", "")).toEqual(["banana-gtk.css"]);
    expect(listDataFiles("hades", "hicolor/48x48/actions").length).toBeGreaterThan(0);
    expect(listDataFiles("hades", "hicol")).toEqual([]);
    expect(listDataFiles("webits", "").every((p) => !p.endsWith(".ts"))).toBe(true);
  });

  test("listDataDirectory lists the entries directly inside a data directory", () => {
    expect(listDataDirectory(getDataDir("dsm") + "/examples").sort()).toEqual([
      "1 Quick Guide to the DSM.dsm",
      "2 FMEA.dsm",
      "3 Managing Risks.dsm",
      "4 Managing Hazards.dsm",
    ]);
    expect(listDataDirectory("/src/dsm/share/examples/")).toHaveLength(4);
    const share = listDataDirectory(getDataDir("dsm"));
    expect(share).toContain("documentation");
    expect(share).toContain("examples");
    expect(listDataDirectory("/src/hades/share/docx")).toContain("_rels");
    expect(() => listDataDirectory("/src/dsm/share/exam")).toThrow(IOError);
    expect(() => listDataDirectory("/nowhere")).toThrow(IOError);
  });

  test("fetching a missing file rejects", async () => {
    await expect(fetchDataFile("dsm", "examples/none.dsm")).rejects.toThrow("does not exist");
  });
});
