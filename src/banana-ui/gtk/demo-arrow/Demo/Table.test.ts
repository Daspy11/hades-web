import { describe, expect, test } from "vitest";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { set, view } from "@/lib/Control/Lens";
import { show_Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  blankTableRow, compare_DemoEnum, demoEnumValues, demoTableSpec, enumColour, enumIcon, read_DemoEnum, show_TableData,
  tableColour, tableNum, testTable,
} from "./Table";

describe("Demo.Table", () => {
  test("DemoEnum instances", () => {
    expect(demoEnumValues).toEqual(["Foo", "Bar", "Baz", "Wibble", "Woo"]);
    expect(read_DemoEnum(" Woo ")).toEqual(Just("Woo"));
    expect(read_DemoEnum("woo")).toEqual(Nothing);
    expect([...demoEnumValues].reverse().sort(compare_DemoEnum)).toEqual(demoEnumValues);
    expect(demoEnumValues.map((x) => show_Colour(enumColour(x)))).toEqual(["#ff7f50", "#808080", "#4b0082", "#00fa9a", "#fa8072"]);
    expect(enumIcon("Wibble")).toBe("weather-showers");
  });

  test("show_TableData is the derived Show", () => {
    expect(show_TableData(testTable[0])).toBe(
      'TableData {_tableText = "One row", _tableNum = 23, _tableEnum = Wibble, _tableDate = 2016-06-24, ' +
      '_tableColour = #ff0000, _tableIcon = "go-home", _tableCombo = "One"}',
    );
    expect(show_TableData(set(tableNum, -3, blankTableRow))).toContain("_tableNum = -3,");
  });

  test("lenses", () => {
    expect(view(tableColour, testTable[1])).toEqual(C.blue);
    expect(set(tableNum, 5, blankTableRow)._tableNum).toBe(5);
  });

  test("table specification columns", () => {
    expect(demoTableSpec.map((c) => c._0.columnName)).toEqual(["Text", "Number", "Enumeration", "Date", "Colour", "Icon", "Combo"]);
    expect(demoTableSpec.map((c) => c._0.fieldEditor.tag)).toEqual(["EditEntry", "EditEntry", "EditEnum", "EditDate", "EditColour", "EditIcon", "EditCombo"]);
    const num = demoTableSpec[1]._0;
    const icon = num.fieldIcon.tag === "Just" ? num.fieldIcon.value : null;
    expect([0, 24, 25, 49, 50, 74, 75, 200].map((n) => icon!(n))).toEqual([
      "face-sad", "face-sad", "face-plain", "face-plain", "face-smile", "face-smile", "face-smile-big", "face-smile-big",
    ]);
    const colour = num.fieldColour.tag === "Just" ? num.fieldColour.value : null;
    expect(show_Colour(colour!(-1))).toBe("#ff0000");
    expect(show_Colour(colour!(100))).toBe("#008000");
    expect(colour!(50)).toEqual(C.blend(0.5, C.green, C.red));
    const en = demoTableSpec[2]._0;
    expect(en.fieldEditor.tag === "EditEnum" ? en.fieldEditor._1 : null).toEqual(demoEnumValues);
  });
});
