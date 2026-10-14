/**
 * Scratch demo for `App.ModelMain` (open the app with `?demo=mm`, optionally `&open=2 FMEA`).
 *
 * Runs the real `modelMain` with the SafetyModel-like test dictionary of
 * `src/dsm/causality/Causality/BowTieTestModel.ts` (GSN and bow tie diagrams, packages,
 * evidence, queries, matrices and lookup tables; reports are kept as raw JSON), until
 * `DSM.SafetyCase`/`dsm/Main` are ported. The descriptor is the DSM one (examples, documentation
 * and icons from `src/dsm/share`). Double-click activation and tree menus are added here as
 * DSM.SafetyCase does for these entity types.
 *
 * `window.mm` exposes a few helpers for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { getDataDir } from "@/lib/System/Paths";
import { getDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { Menu, append_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  type ModelScript, type ModelScriptAct, diagramEntityMenu, editEntityProperties, entityMenu, promoteScript,
} from "@/hades/src/Model/Abstract/DiagramType";
import type { Entity } from "@/hades/src/Model/Abstract/PackageTree";
import { evidenceIconName, traceIconName } from "@/hades/evidence/Evidence/Model";
import { type ModelMainClass, MainDescriptor, modelMain } from "@/hades/src/App/ModelMain";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import { gsnActivation, gsnStockItem } from "@/dsm/gsn/GSN/Model";
import { bowTieActivation, bowTieIcon } from "@/dsm/causality/Causality/Risk";
import { type TV, _BowTieItem, _GsnItem, cls, gsnCls } from "@/dsm/causality/Causality/BowTieTestModel";

type P = HadesRender;
type Script = ModelScriptAct<P, TV, TV, Maybe<string>>;

/** The test dictionary with DSM-like activation and tree menus. */
const demoCls: ModelMainClass<TV> = Object.assign(Object.create(cls) as object, {
  editableActivation: (mEnt: Maybe<Entity<TV>>): Script => {
    if (mEnt.tag === "Nothing") return function* (): ModelScript<P, TV, Maybe<string>> {
      return Nothing;
    };
    const e = mEnt.value;
    switch (e._entityContents.tag) {
      case "GsnItem": return promoteScript(_GsnItem, gsnActivation(gsnCls, Just(e)));
      case "BowTieItem": return promoteScript(_BowTieItem, bowTieActivation(cls, Just(e)));
      default: return (c) => editEntityProperties<P, TV, TV>(c, e.entityId);
    }
  },
  editableTreeMenu: (mEnt: Maybe<Entity<TV>>): Maybe<Menu<Script>> => {
    if (mEnt.tag === "Nothing") return Nothing;
    const e = mEnt.value;
    if (cls.isDiagram(e._entityContents)) {
      return Just(append_Menu(diagramEntityMenu<P, TV, TV>(cls, e.entityId), entityMenu<P, TV, TV>(cls, e)));
    }
    return Just(entityMenu<P, TV, TV>(cls, e));
  },
}) as ModelMainClass<TV>;

/** Stock icons, as DSM.SafetyCase's `entityIcon`. */
function entityIcon(e: Entity<TV>): string {
  const v = e._entityContents;
  switch (v.tag) {
    case "GsnItem": return gsnStockItem(gsnCls, v._0);
    case "BowTieItem": return bowTieIcon(v._0);
    case "Package": return "model-package";
    case "Query": return "model-query";
    case "Matrix": return "model-matrix";
    case "Lookup": return "model-lookup";
    case "EvidenceItem": return evidenceIconName;
    case "TraceItem": return traceIconName;
    case "Other": return "model-report";
  }
}

export function main(): void {
  // As dsm/Main.hs.
  const dataTheme = getDataIconTheme();
  const dataDir = getDataDir("dsm");
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [dataDir]);
  const descriptor = MainDescriptor<TV>(
    "dsm",
    "Diametric Safety Case Manager",
    "dsm",
    entityIcon,
    [dataDir],
    () => {},
    dataDir + "/documentation",
    Just(dataDir + "/examples"),
  );
  (window as any).mm = { descriptor };
  void modelMain(demoCls, descriptor).catch((e) => console.error("modelMain failed", e));
}
