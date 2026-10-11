import { describe, expect, it } from "vitest";
import * as A from "./Abstract";
import * as AutoMonad from "./Abstract/AutoMonad";
import * as Diagram from "./Abstract/Diagram";

describe("Hades.Abstract", () => {
  it("re-exports every Hades.Abstract module", () => {
    expect(typeof A.processAction).toBe("function"); // Commands
    expect(typeof A.ShapeClass_Rectangle.shapeBounds).toBe("function"); // BasicShapes
    expect(typeof A.connectableDefaults).toBe("function"); // Connections
    expect(typeof A.yieldViews).toBe("function"); // Delta
    expect(typeof A.emptyDiagram).toBe("function"); // Diagram
    expect(typeof A.mkBoundBox).toBe("function"); // Geometry
    expect(typeof A.selectionOrTarget).toBe("function"); // Menus
    expect(typeof A.updateItem).toBe("function"); // Primitives
    expect(A.alignmentTools().length).toBe(3); // Toolbar
    expect(typeof A.startStream).toBe("function"); // AutoMonad
  });
  it("names exported twice are the same binding", () => {
    expect(A.applyInputT).toBe(AutoMonad.applyInputT);
    expect(A.diagramOrder).toBe(Diagram.diagramOrder);
  });
});
