import { describe, expect, it } from "vitest";
import * as S from "@/lib/Data/Set";
import * as QC from "@/lib/Test/QuickCheck";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { set, view } from "@/lib/Control/Lens";
import { equals } from "@/lib/Data/Ord";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import * as C from "@/lib/Data/Colour";
import {
  Arbitrary_DemoData,
  Arbitrary_DemoEnum,
  Arbitrary_DemoTable,
  DemoTable,
  arbitraryColour,
  arbitraryDay,
  arbitraryIcon,
  arbitraryText,
  compare_DemoEnum,
  demoDefault,
  demoEnumValues,
  demoForest,
  demoNum,
  demoSet,
  iconList,
  numberField,
  prettyDemo,
  read_DemoEnum,
  show_DemoData,
  show_DemoTable,
  wordsList,
} from "./Types";

const gen = <A>(g: QC.Gen<A>, size = 30, seed = 5): A => QC.generateWith(seed, size, g);

describe("demo-webit Types", () => {
  it("shows values as the derived Show instances do", () => {
    expect(show_DemoTable(DemoTable(true, 4, "x"))).toBe('DemoTable {_boolField = True, _numberField = 4.0, _iconField = "x"}');
    expect(show_DemoTable(DemoTable(false, -0.5, "y"))).toBe('DemoTable {_boolField = False, _numberField = -0.5, _iconField = "y"}');
    expect(show_DemoData(demoDefault)).toBe(
      'DemoData {_demoText = "Foo! This is a ridiculously long line to put in a text box. It ought to be a paragraph!", ' +
        "_demoNum = 5, _demoEnum = Bar, _demoBool = False, _demoDate = 2021-08-01, " +
        '_demoIcon = "basic_checked", _demoColour = #00ffff, _demoSet = fromList [1,13,21], ' +
        '_demoTable = [DemoTable {_boolField = True, _numberField = 3.14159, _iconField = "computer-about"},' +
        'DemoTable {_boolField = False, _numberField = 4.0, _iconField = "general-car"},' +
        'DemoTable {_boolField = True, _numberField = 5.0, _iconField = "emoji-happy-1"}]}',
    );
  });

  it("prettyDemo lays out the fields", () => {
    expect(prettyDemo(set(demoSet, S.fromList([-2, 7]), set(demoNum, -3, demoDefault)))).toBe(
      "DemoData {\n" +
        '   demoText: "Foo! This is a ridiculously long line to put in a text box. It ought to be a paragraph!"\n' +
        "   demoNum: -3\n" +
        "   demoEnum: Bar\n" +
        "   demoBool: False\n" +
        "   demoDate: 2021-08-01\n" +
        '   demoIcon: "basic_checked"\n' +
        "   demoColour: #00ffff\n" +
        "   demoSet: {-2, 7}\n" +
        "   demoTable: [\n" +
        '       DemoTable {_boolField = True, _numberField = 3.14159, _iconField = "computer-about"}\n' +
        '       DemoTable {_boolField = False, _numberField = 4.0, _iconField = "general-car"}\n' +
        '       DemoTable {_boolField = True, _numberField = 5.0, _iconField = "emoji-happy-1"}\n' +
        "   ]\n" +
        "}",
    );
  });

  it("has the enumeration instances", () => {
    expect(demoEnumValues).toEqual(["Foo", "Bar", "Baz", "Wibble", "Woo"]);
    expect(read_DemoEnum(" Wibble ")).toEqual(Just("Wibble"));
    expect(read_DemoEnum("wibble")).toEqual(Nothing);
    expect([...demoEnumValues].reverse().sort(compare_DemoEnum)).toEqual(demoEnumValues);
    expect(new Set(gen(QC.vectorOf(200, Arbitrary_DemoEnum.arbitrary)))).toEqual(new Set(demoEnumValues));
  });

  it("lenses get and set their fields", () => {
    expect(view(numberField, set(numberField, 2.5, DemoTable(true, 1, "i")))).toBe(2.5);
    expect(view(demoNum, demoDefault)).toBe(5);
    expect(equals(demoDefault._demoColour, Colour(C.aqua))).toBe(true);
  });

  it("reads the icon and word lists from the bundled data", () => {
    expect(wordsList.length).toBe(1000);
    expect(wordsList.every((w) => w.length > 0 && !w.includes("\n"))).toBe(true);
    expect(iconList).toContain("general-tick");
    expect(iconList).toContain("road-sign-no-entry");
    expect([...iconList].sort()).toEqual(iconList);
  });

  it("the forest has the tree selector items", () => {
    expect(demoForest.map((t) => t.rootLabel[0])).toEqual(["Item 1", "Item 2"]);
    expect(demoForest[0].subForest[2].subForest[0].rootLabel).toEqual(["Final 1.3.1", Just("some tips"), Just(131)]);
  });

  it("generates random demo data", () => {
    const ds = gen(QC.vectorOf(30, Arbitrary_DemoData.arbitrary));
    for (const d of ds) {
      const ws = d._demoText.split(" ");
      expect(ws.length).toBe(5);
      expect(ws.every((w) => wordsList.includes(w))).toBe(true);
      expect(Math.abs(d._demoNum)).toBeLessThanOrEqual(30);
      expect(d._demoDate >= "2021-01-01" && d._demoDate <= "2021-12-31").toBe(true);
      expect(iconList).toContain(d._demoIcon);
      expect(d._demoTable.every((t) => iconList.includes(t._iconField))).toBe(true);
    }
    expect(new Set(ds.map((d) => d._demoBool))).toEqual(new Set([true, false]));
    const days = gen(QC.vectorOf(400, arbitraryDay));
    expect(days.every((d) => d.startsWith("2021-"))).toBe(true);
    expect(new Set(days).size).toBeGreaterThan(200);
    expect(gen(arbitraryText(3)).split(" ").length).toBe(3);
    expect(iconList).toContain(gen(arbitraryIcon));
    expect(Arbitrary_DemoTable.arbitrary(QC.mkQCGen(1), 30)._iconField).not.toBe("");
    const c = gen(arbitraryColour, 5);
    // Word8 at size 5 is at most 4: a very dark colour.
    expect(C.sRGB24show(c) <= "#040404").toBe(true);
  });
});
