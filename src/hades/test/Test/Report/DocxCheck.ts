/**
 * Test helper (not a port of a Haskell module): checks a Word (.docx) package with Python.
 *
 * The script checks that every XML part is well-formed, that every part has a content type,
 * that every internal relationship target exists, that every relationship id used in
 * `word/document.xml` is defined, and that every paragraph, run and table style used is defined
 * in `word/styles.xml`. If `python-docx` is installed the document is also opened with it.
 */
import { execFileSync } from "node:child_process";

/** Python script checking an OOXML package; prints a JSON summary. */
const checkDocx = String.raw`
import json, sys, zipfile, posixpath
import xml.etree.ElementTree as ET
path = sys.argv[1]
z = zipfile.ZipFile(path)
names = z.namelist()
problems = []
assert z.testzip() is None
parsed = {}
for n in names:
    if n.endswith(".xml") or n.endswith(".rels"):
        try:
            parsed[n] = ET.fromstring(z.read(n))
        except ET.ParseError as e:
            problems.append("%s: %s" % (n, e))
ct = parsed["[Content_Types].xml"]
CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
defaults = {d.get("Extension").lower() for d in ct.findall(CT + "Default")}
overrides = {o.get("PartName") for o in ct.findall(CT + "Override")}
for n in names:
    if n.endswith("/"):
        continue
    ext = n.rsplit(".", 1)[-1].lower()
    if ext not in defaults and "/" + n not in overrides:
        problems.append("no content type for " + n)
for o in overrides:
    if o[1:] not in names:
        problems.append("override for missing part " + o)
R = "{http://schemas.openxmlformats.org/package/2006/relationships}"
rels = {}
for n in names:
    if n.endswith(".rels"):
        src_dir = posixpath.dirname(posixpath.dirname(n))
        for r in parsed[n].findall(R + "Relationship"):
            rels[(n, r.get("Id"))] = r.attrib
            if r.get("TargetMode") == "External":
                continue
            target = posixpath.normpath(posixpath.join(src_dir, r.get("Target")))
            if target not in names:
                problems.append("%s: %s -> missing %s" % (n, r.get("Id"), target))
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
doc = parsed["word/document.xml"]
doc_rels = {r.get("Id") for r in parsed["word/_rels/document.xml.rels"].findall(R + "Relationship")}
used = set()
for el in doc.iter():
    for k, v in el.attrib.items():
        if k in (RNS + "id", RNS + "embed", RNS + "link"):
            used.add(v)
            if v not in doc_rels:
                problems.append("dangling relationship id " + v)
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
styles = {s.get(W + "styleId") for s in parsed["word/styles.xml"].iter(W + "style")}
used_styles = {e.get(W + "val") for tag in ("pStyle", "rStyle", "tblStyle") for e in doc.iter(W + tag)}
for s in used_styles - styles:
    problems.append("undefined style " + s)
text = "".join(t.text or "" for t in doc.iter(W + "t"))
docx_ok = None
try:
    import docx
    d = docx.Document(path)
    docx_ok = {"paragraphs": len(d.paragraphs), "tables": len(d.tables)}
except ImportError:
    pass
print(json.dumps({"names": sorted(names), "problems": problems, "text": text, "python_docx": docx_ok,
  "core": z.read("docProps/core.xml").decode("utf8"), "used_rels": sorted(used)}))
`;

/** Run the Python package checker on a .docx file. */
export function checkDocxFile(file: string): {
  names: string[];
  problems: string[];
  text: string;
  python_docx: { paragraphs: number; tables: number } | null;
  core: string;
  used_rels: string[];
} {
  return JSON.parse(execFileSync("python3", ["-I", "-c", checkDocx, file], { encoding: "utf8" }));
}

