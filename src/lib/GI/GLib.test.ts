import { describe, expect, test } from "vitest";
import * as GLib from "./GLib";
import { dataFileUrl, getDataDir } from "../System/Paths";

describe("GLib.filenameToUri", () => {
  test("data files and /builtin/ paths give their URL", () => {
    const manual = getDataDir("dsm") + "/documentation/Manual.pdf";
    expect(GLib.filenameToUri(manual, null)).toMatch(/Manual\.pdf$/);
    expect(GLib.filenameToUri(manual, null)).toContain(dataFileUrl(manual));
    expect(GLib.filenameToUri("/builtin/https://example.com/a%20b.pdf", null)).toBe("https://example.com/a%20b.pdf");
  });

  test("other absolute paths are escaped as GLib does", () => {
    // Expected values from g_filename_to_uri (libglib 2.80).
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).filter((c) => c !== "/").join("");
    expect(GLib.filenameToUri("/" + ascii, null)).toBe(
      "file:///%20!%22%23$%25&'()*+,-.0123456789:%3B%3C=%3E%3F@ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~",
    );
    expect(GLib.filenameToUri("/café/x.dsm", null)).toBe("file:///caf%C3%A9/x.dsm");
    expect(GLib.filenameToUri("/x\x01\x7f", null)).toBe("file:///x%01%7F");
    expect(GLib.filenameToUri("/x y", "host")).toBe("file://host/x%20y");
  });

  test("a relative path is an error", () => {
    expect(() => GLib.filenameToUri("rel/x", null)).toThrow("The pathname “rel/x” is not an absolute path");
  });
});
