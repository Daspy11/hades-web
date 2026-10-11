import { expect, test } from "vitest";
import * as J from "@/lib/Data/Aeson";
import { sRGB24, sRGB24show } from "@/lib/Data/Colour";
import { JSON_Colour } from "./Orphan";

test("Colour is a hex string in HTML style", () => {
  const c = sRGB24(255, 128, 0);
  expect(JSON_Colour.toJSON(c)).toBe("#ff8000");
  expect(sRGB24show(JSON_Colour.parseJSON("#ff8000"))).toBe("#ff8000");
  expect(sRGB24show(JSON_Colour.parseJSON("  #FF8000\n"))).toBe("#ff8000");
  expect(sRGB24show(JSON_Colour.parseJSON("00ff00"))).toBe("#00ff00");
  expect(() => JSON_Colour.parseJSON("#ff80")).toThrow(J.JSONParseError);
  expect(() => JSON_Colour.parseJSON("red")).toThrow('Colour not parsed: "red"');
  expect(() => JSON_Colour.parseJSON(3)).toThrow(J.JSONParseError);
  // Same encoding as the library codec.
  expect(JSON_Colour.toJSON(c)).toBe(J.colourJ.toJSON(c));
});
