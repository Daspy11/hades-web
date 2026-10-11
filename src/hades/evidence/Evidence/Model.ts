// Ported from hades/evidence/Evidence/Model.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module defines two entity types which can be included in models. It contains no
 * separate diagram type: it is for the various other diagrams to determine whether evidence
 * and traces can be included.
 *
 * \"Evidence\" is an entity type for recording a piece of external evidence. This may be a document,
 * database or something else. The only built-in field is the name. It is for the end user to
 * define other extension fields for evidence depending on their procedures.
 *
 * \"Trace\" is an arrow entity relating some other entity to associated evidence. The head end of
 * the arrow may connect to \"Evidence\", but it may also connect to other
 *
 * TypeScript port
 * ---------------
 * * `HasEvidence v` is the dictionary interface `HasEvidence<V, PM>` (extends `EntityClass`),
 *   with the prisms as members `_Evidence` and `_Trace`.
 * * `Evidence` and `Trace` are newtypes with their own instances, so they are records with
 *   their Haskell field (`{ _evidenceName: Name }`, `{ _traceName: Name }`) built with the
 *   constructor functions. Instances: `JSON_Evidence`, `Reflective_Evidence`, `show_Evidence`,
 *   `JSON_Trace`, `Reflective_Trace`, `show_Trace`. `evidenceName` and `traceName` are
 *   constant isos.
 * * Menus and activation scripts follow `Model.Abstract.DiagramType`: the scripts take the
 *   `ModelEditCtx` (which carries the `EntityClass`), so `evidenceEntityMenu(ent)`,
 *   `traceEntityMenu(modelId)`, `evidenceActivation(mEnt)` and `traceActivation(mEnt)` take no
 *   dictionary (like `cloneEntityMenuItem`). `addEvidenceEntityMenu(cls, parent)` needs the
 *   `HasEvidence` prisms, and `drawEvidence(cls, mEnt, contents, border, box)` needs the
 *   `EntityClass` for the entity name.
 * * `evidenceIconPixbuf` (an `unsafePerformIO` constant) is the memoising function
 *   `evidenceIconPixbuf()`, evaluated when first used (i.e. after the application has set the
 *   data icon theme), as the lazy Haskell constant is.
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import * as Gtk from "@/lib/GI/Gtk";
import type * as Gdk from "@/lib/GI/Gdk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { absurd } from "@/lib/Prelude";
import { iso, review, view, type Iso, type Prism, type StateCell } from "@/lib/Control/Lens";
import type { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { getDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { BoxShapeClass_Rectangle, Rectangle, rectangleCorners } from "@/hades/src/Hades/Abstract/BasicShapes";
import type { BoundBox } from "@/hades/src/Hades/Abstract/Geometry";
import {
  type ArrowHead, type HadesLayout, type HadesRender, drawPolygon, layoutParagraphGap, layoutTitle,
  openArrowHead, runLayout_, withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";
import {
  type ModelScriptAct, cloneEntityMenuItem, deleteEntity, editEntityProperties,
  insertEntity, promoteScript,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type ModelId, JSON_Name, Name, checkType, entityName, nameField, nameText,
  show_Name,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import {
  type RefTypeTable, append_RefTypeTable, mempty_RefTypeTable, mkOneToMany,
} from "@/hades/src/Model/Reflection/References";
import { type Reflective, defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { type ExtensionValues, ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";

// ---------------------------------------------------------------------------------------------
// * Models that include evidence

/** (`PM` is `PackageMeta v`, as in `EntityClass`.) */
export interface HasEvidence<V, PM = any> extends EntityClass<V, PM> {
  readonly _Evidence: Prism<V, Evidence>;
  readonly _Trace: Prism<V, Trace>;
}

// ---------------------------------------------------------------------------------------------
// * Model entity definition.

/**
 * The only built-in data for evidence is its name. Its up to the user to add title, author,
 * publication date, status etc as extension data.
 *
 * Likewise @Evidence@ has no built in references or arrows; its up to the application to add
 * reference links to entities that can have evidence associated with them.
 */
export interface Evidence {
  readonly _evidenceName: Name;
}
export function Evidence(_evidenceName: Name): Evidence {
  return { _evidenceName };
}

/** Derived `instance Show Evidence`. (Derived `Eq` is the structural `equals`.) */
export function show_Evidence(e: Evidence): string {
  return "Evidence {_evidenceName = " + show_Name(e._evidenceName) + "}";
}

/** `instance ToJSON Evidence` and `instance FromJSON Evidence` */
export const JSON_Evidence: J.JSONCodec<Evidence> = J.codec(
  (evidence) => J.object([
    ["type", J.textJ.toJSON("evidence")],
    ["name", JSON_Name.toJSON(view(evidenceName, evidence))],
  ]),
  (val) => J.withObject("Evidence", (v) => {
    const typ = J.field(v, "type", J.textJ);
    const nm = J.field(v, "name", JSON_Name);
    if (typ !== "evidence") return J.fail("Not an evidence item: " + show_Name(nm));
    return Evidence(nm);
  }, val),
);

/** `instance Reflective Evidence` */
export const Reflective_Evidence: Reflective<Evidence> = {
  reflectiveName: (_) => evidenceVariant,
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Evidence(Name(""))],
  reflectiveBuiltIn: (_) => [nameField],
  reflectiveGet: (e) => M.singleton(nameField, ExtText(e._evidenceName._0)),
  reflectiveSet: (st: StateCell<ExtensionValues>, e: Evidence): Evidence =>
    Evidence(Name(T.strip(extract(st, e._evidenceName._0, _ExtText, nameField)))),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
};

export const evidenceName: Iso<Evidence, Name> = iso((e: Evidence) => e._evidenceName, Evidence);

export const evidenceVariant: Variant<any> = Variant("Evidence");

/** Context menu for evidence items. */
export function evidenceEntityMenu<P, V>(ent: Entity<V>): Menu<ModelScriptAct<P, V, Evidence, Maybe<string>>> {
  type Item = ModelScriptAct<P, V, Evidence, Maybe<string>>;
  return Menu<Item>([[
    menuItem<Item>("Properties", (ctx) => editEntityProperties<P, V, Evidence>(ctx, ent.entityId)),
    cloneEntityMenuItem<P, V, Evidence>(ent.entityId),
    menuItem<Item>("Delete", (ctx) => deleteEntity<P, V, Evidence>(ctx, ent.entityId)),
  ]]);
}

/** Menu for adding evidence entities. */
export function addEvidenceEntityMenu<P, V>(
  cls: HasEvidence<V>,
  parent: ModelId,
): Menu<ModelScriptAct<P, V, V, Maybe<string>>> {
  type Item = ModelScriptAct<P, V, V, Maybe<string>>;
  return Menu<Item>([[
    menuItem<Item>("Add Evidence", promoteScript<P, V, V, Evidence, Maybe<string>>(cls._Evidence, function* (ctx) {
      const r = yield* insertEntity<P, V, Evidence>(ctx, review(cls._Evidence, Evidence(Name("Evidence-"))), parent);
      switch (r.tag) {
        case "Nothing":
          return Nothing;
        case "Just":
          return Just("Insert " + view(nameText, r.value[0]));
        default:
          return absurd(r);
      }
    })),
    menuItem<Item>("Add Trace", promoteScript<P, V, V, Trace, Maybe<string>>(cls._Trace, function* (ctx) {
      const r = yield* insertEntity<P, V, Trace>(ctx, review(cls._Trace, Trace(Name("Trace-"))), parent);
      switch (r.tag) {
        case "Nothing":
          return Nothing;
        case "Just":
          return Just("Insert " + view(nameText, r.value[0]));
        default:
          return absurd(r);
      }
    })),
  ]]);
}

/** Icon name for evidence items. */
export const evidenceIconName: string = "evidence-doc";

/** The memoised value of "evidenceIconPixbuf", and the data icon theme it was looked up in. */
let evidenceIconCache: { readonly theme: Gtk.IconTheme; readonly pixbuf: Maybe<Gdk.Pixbuf> } | null = null;

/**
 * Should be @Just@ the evidence icon 16x16. Uses @unsafePerformIO@ to avoid reading the
 * icon file every time.
 *
 * (TypeScript: a function memoising its result. Web: the result is recomputed if the data icon
 * theme has been replaced since it was computed, so a lookup made before the application set the
 * theme does not stick.)
 */
export function evidenceIconPixbuf(): Maybe<Gdk.Pixbuf> {
  const thm = getDataIconTheme();
  if (evidenceIconCache === null || evidenceIconCache.theme !== thm) {
    const sz = 16;
    const info = Gtk.iconThemeLookupIcon(thm, evidenceIconName, sz, []);
    const pixbuf: Maybe<Gdk.Pixbuf> = info === null ? Nothing : Just(Gtk.iconInfoLoadIcon(info));
    evidenceIconCache = { theme: thm, pixbuf };
  }
  return evidenceIconCache.pixbuf;
}

/** `evidenceActivation :: (EntityClass v) => ActivationScript p v Evidence` */
export function evidenceActivation<P, V>(e: Maybe<Entity<V>>): ModelScriptAct<P, V, Evidence, Maybe<string>> {
  switch (e.tag) {
    case "Nothing":
      // eslint-disable-next-line require-yield
      return function* (_ctx) {
        return Nothing;
      };
    case "Just": {
      const ent = e.value;
      return (ctx) => editEntityProperties<P, V, Evidence>(ctx, ent.entityId);
    }
    default:
      return absurd(e);
  }
}

// ---------------------------------------------------------------------------------------------
// * HADES Graphical Representations

/**
 * Draw the avatar as an evidence box. Evidence items can be included in many different
 * diagrams so there is no distinct @EvidenceBox@ type. It is for each instance of
 * \"DiagramTypeClass\" to define a diagram element subtype for evidence boxes and call this
 * function when it is drawn.
 */
export function drawEvidence<V>(
  cls: EntityClass<V>,
  /** Entity to represent. */
  mEnt: Maybe<Entity<V>>,
  /** Box contents. */
  contents: HadesLayout<void>,
  /** Border colour if not default. */
  border: Maybe<Colour>,
  box1: BoundBox,
): HadesRender<void> {
  return (env) => {
    const box2 = BoxShapeClass_Rectangle.shapeInnerBox(Rectangle(box1));
    const outline = drawPolygon(rectangleCorners(Rectangle(box1)));
    // maybe id withLineColour border $ drawPolygon ...
    (border.tag === "Just" ? withLineColour(border.value, outline) : outline)(env);
    runLayout_(box2, (env1, st) => {
      layoutTitle(
        evidenceIconPixbuf(),
        mEnt.tag === "Just" ? view(entityName(cls).dot(nameText), mEnt.value) : "Evidence",
      )(env1, st);
      layoutParagraphGap(env1, st);
      contents(env1, st);
    })(env);
  };
}

// ---------------------------------------------------------------------------------------------
// * Trace Arrows

/**
 * A trace represents a link from something asserted in the assurance model to a
 * supporting argument or evidence.
 */
export interface Trace {
  readonly _traceName: Name;
}
export function Trace(_traceName: Name): Trace {
  return { _traceName };
}

/** Derived `instance Show Trace`. (Derived `Eq` is the structural `equals`.) */
export function show_Trace(t: Trace): string {
  return "Trace {_traceName = " + show_Name(t._traceName) + "}";
}

/** `instance ToJSON Trace` and `instance FromJSON Trace` */
export const JSON_Trace: J.JSONCodec<Trace> = J.codec(
  (t) => J.object([
    ["type", J.textJ.toJSON("trace")],
    ["name", JSON_Name.toJSON(t._traceName)],
  ]),
  (val) => J.withObject("Trace", (v) => {
    checkType(v, "trace");
    return Trace(J.field(v, "name", JSON_Name));
  }, val),
);

export const traceName: Iso<Trace, Name> = iso((t: Trace) => t._traceName, Trace);

export const traceVariant: Variant<any> = Variant("Trace");

export const traceTailRelation: Relation = "Trace Tail";

export const traceHeadRelation: Relation = "Trace Head";

/**
 * Construct a RefTypeTable for Trace arrows. Diagrams which include trace arrows should
 * use this to add to the types of entities that can be traced.
 */
export function traceArrowRelations<A>(
  /** The list of things the tail can connect to. */
  tailList: readonly Variant<A>[],
  /** The list of things the head can connect to. */
  headList: readonly Variant<A>[],
): RefTypeTable<A> {
  return append_RefTypeTable(
    mkOneToMany<A>(traceTailRelation, tailList, [traceVariant]),
    mkOneToMany<A>(traceHeadRelation, headList, [traceVariant]),
  );
}

/**
 * `instance Reflective Trace`
 *
 * (Defined after the constants it uses, which TypeScript evaluates in order.)
 */
export const Reflective_Trace: Reflective<Trace> = {
  reflectiveName: (_) => traceVariant,
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Trace(Name(""))],
  reflectiveBuiltIn: (_) => [nameField],
  reflectiveGet: (t) => M.singleton(nameField, ExtText(t._traceName._0)),
  reflectiveSet: (st: StateCell<ExtensionValues>, t: Trace): Trace =>
    Trace(Name(extract(st, t._traceName._0, _ExtText, nameField))),
  reflectiveBuiltInRefs: traceArrowRelations<Trace>([], [evidenceVariant]),
  reflectiveArrows: M.fromList<Variant<Trace>, readonly [Relation, Relation]>([
    [traceVariant, [traceTailRelation, traceHeadRelation]],
  ]),
};

/** Dash pattern for trace arrows. */
export const traceArrowDash: readonly number[] = [10, 5];

/** How to draw the head of a trace arrow. */
export const traceArrowHead: ArrowHead = openArrowHead(60, 10);

/** Icon name for trace arrows. */
export const traceIconName: string = "trace-arrow";

/** Context menu for evidence items. */
export function traceEntityMenu<P, V>(modelId: ModelId): Menu<ModelScriptAct<P, V, Trace, Maybe<string>>> {
  type Item = ModelScriptAct<P, V, Trace, Maybe<string>>;
  return Menu<Item>([[
    menuItem<Item>("Properties", (ctx) => editEntityProperties<P, V, Trace>(ctx, modelId)),
    menuItem<Item>("Delete", (ctx) => deleteEntity<P, V, Trace>(ctx, modelId)),
  ]]);
}

/** `traceActivation :: (EntityClass v) => ActivationScript p v Trace` */
export function traceActivation<P, V>(e: Maybe<Entity<V>>): ModelScriptAct<P, V, Trace, Maybe<string>> {
  switch (e.tag) {
    case "Nothing":
      // eslint-disable-next-line require-yield
      return function* (_ctx) {
        return Nothing;
      };
    case "Just": {
      const ent = e.value;
      return (ctx) => editEntityProperties<P, V, Trace>(ctx, ent.entityId);
    }
    default:
      return absurd(e);
  }
}
