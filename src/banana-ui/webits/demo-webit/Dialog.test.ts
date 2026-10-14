import { describe, expect, it } from "vitest";
import * as S from "@/lib/Data/Set";
import * as C from "@/lib/Data/Colour";
import { Just } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { drawTree } from "@/lib/Data/Tree";
import { view } from "@/lib/Control/Lens";
import * as H from "@/lib/Text/Blaze/Html5";
import { showGadget } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  boolColour,
  boolIcon,
  demoDialog,
  demoDialogPage,
  demoForestSelection,
  demoSetPopup,
  demoTableColumns,
  demoTableForm,
  loremIpsum,
} from "./Dialog";
import { DemoTable, demoForest } from "./Types";

describe("demo-webit Dialog", () => {
  it("decorates the boolean column", () => {
    expect(boolIcon(true)).toBe("computer-add");
    expect(boolIcon(false)).toBe("computer-application-exit");
    expect(equals(boolColour(true), Colour(C.darkgreen))).toBe(true);
    expect(equals(boolColour(false), Colour(C.darkred))).toBe(true);
  });

  it("has the table columns", () => {
    expect(demoTableColumns.map((c) => c._0.columnName)).toEqual(["Boolean", "Number", "Icon"]);
    expect(demoTableColumns.map((c) => c._0.fieldEditor.tag)).toEqual(["EditBool", "EditEntry", "EditIcon"]);
    const row = DemoTable(true, 2.5, "x");
    expect(demoTableColumns.map((c) => view(c._0.fieldValue as any, row))).toEqual([true, 2.5, "x"]);
    expect(demoTableColumns[0]._0.fieldIcon.tag).toBe("Just");
    expect(demoTableColumns[1]._0.fieldIcon.tag).toBe("Nothing");
  });

  it("shows the set in its popup text box and opens the tree selection", () => {
    const g = demoSetPopup as any;
    expect(g.tag).toBe("FixedText");
    expect(g._0(demoForest, S.fromList([21, 1, 13]))).toBe("1, 13, 21");
    expect(g._0(demoForest, S.fromList<number>([]))).toBe("");
    expect(g._1.value(demoForest, S.fromList([1]))).toEqual(Just(demoForestSelection));
    expect(demoForestSelection.dialogTitle).toBe("Demo Tree Selection");
    expect((demoForestSelection.dialogGadget as any)._0(demoForest)).toBe(demoForest);
  });

  it("builds the dialogs", () => {
    expect(demoTableForm.dialogTitle).toBe("Edit table row");
    expect(drawTree(showGadget(demoTableForm.dialogGadget)).split("\n")[0]).toBe("Accum");
    expect(demoDialog.dialogTitle).toBe("Demo Dialog");
    expect(demoDialog.dialogButtons.tag).toBe("OkApplyButton");
    const tree = drawTree(showGadget(demoDialog.dialogGadget));
    for (const label of ["Demo Text:", "Demo Number:", "Demo Choice:", "Demo Boolean:", "Demo Date:", "Demo Icon:", "Demo Colour:", "Demo Set:"]) {
      expect(tree).toContain(label + ": Focusing");
    }
    expect(tree).toContain("Buttons Increment, Decrement");
    expect(tree).toContain("Frame");
    expect(tree).toContain("ClickableList");
  });

  it("renders the test page", () => {
    const html = H.renderHtml(demoDialogPage);
    expect(html.startsWith('<head><title>Demo Webits</title><link rel="shortcut icon" type="image/x-icon" href="/favicon.ico"><style')).toBe(true);
    expect(html.endsWith("<body><p>" + loremIpsum + "</p></body>")).toBe(true);
    expect(loremIpsum.startsWith("Sed ut perspiciatis unde omnis")).toBe(true);
    expect(loremIpsum.endsWith("quo voluptas nulla pariatur?")).toBe(true);
  });
});
