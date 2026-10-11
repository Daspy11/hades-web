// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { encodeUtf8 } from "@/lib/Data/UUID";
import type { EditLock } from "@/hades/src/System/Hades/EditLock";
import { FileStatus, checkExtension, readOnlyStatus, tryDecodeXml } from "./Saving";

function utf16(s: string, le: boolean): Uint8Array {
  const r = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    r[2 * i + (le ? 0 : 1)] = c & 0xff;
    r[2 * i + (le ? 1 : 0)] = c >> 8;
  }
  return r;
}

function utf32(s: string, le: boolean): Uint8Array {
  const cps = Array.from(s).map((c) => c.codePointAt(0)!);
  const r = new Uint8Array(cps.length * 4);
  const dv = new DataView(r.buffer);
  cps.forEach((cp, i) => dv.setUint32(i * 4, cp, le));
  return r;
}

describe("checkExtension", () => {
  test("appends a missing extension", () => {
    expect(checkExtension("dsm", "/download/model")).toBe("/download/model.dsm");
    expect(checkExtension("svg", "/handle/3/picture.png")).toBe("/handle/3/picture.png.svg");
  });
  test("keeps a matching extension", () => {
    expect(checkExtension("dsm", "/handle/3/model.dsm")).toBe("/handle/3/model.dsm");
  });
});

describe("readOnlyStatus", () => {
  test("unsaved models are editable, locked files are editable, unlocked files are read-only", () => {
    const lock = { _0: "$x$", _1: { lockName: "x", unlockFile: async () => {}, removeFile: () => {} } } as EditLock;
    expect(readOnlyStatus(Nothing)).toBe(false);
    expect(readOnlyStatus(Just(FileStatus(Just(lock), "/handle/1/x.dsm")))).toBe(false);
    expect(readOnlyStatus(Just(FileStatus(Nothing, "/upload/1/x.dsm")))).toBe(true);
  });
});

describe("tryDecodeXml", () => {
  const doc = "<?xml version=\"1.0\"?><a>café ☃</a>";

  test("UTF-8 with no declared encoding", () => {
    expect(tryDecodeXml(encodeUtf8(doc))).toEqual(Right(doc));
  });

  test("8-bit encodings named in the declaration", () => {
    const latin = "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><a>café</a>";
    const bytes = Uint8Array.from(Array.from(latin).map((c) => c.charCodeAt(0)));
    expect(tryDecodeXml(bytes)).toEqual(Right(latin));
  });

  test("UTF-16 and UTF-32 in both byte orders", () => {
    expect(tryDecodeXml(utf16(doc, true))).toEqual(Right(doc));
    expect(tryDecodeXml(utf16(doc, false))).toEqual(Right(doc));
    expect(tryDecodeXml(utf32(doc, true))).toEqual(Right(doc));
    expect(tryDecodeXml(utf32(doc, false))).toEqual(Right(doc));
  });

  test("anything else is not XML", () => {
    expect(tryDecodeXml(encodeUtf8("<svg/>"))).toEqual(Left("Not an XML file."));
  });

  test("an unknown encoding is an error", () => {
    const r = tryDecodeXml(encodeUtf8("<?xml version=\"1.0\" encoding=\"no-such-encoding\"?><a/>"));
    expect(r.tag).toBe("Left");
  });
});
