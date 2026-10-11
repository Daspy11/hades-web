// Ported from hades/src/Model/Reflection/Reflective.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * TypeScript port
 * ---------------
 * * The `Reflective a` class is the dictionary interface `Reflective<A>`. Constrained functions
 *   take it first: `reflectiveNames(cls)`, `reflection(cls, ext, v)`, `valueReferences(cls, tbl, v)`.
 * * `variantUserLabel` has a default method in Haskell. TypeScript interfaces cannot carry
 *   defaults, so it is a required member and instances that do not override it set
 *   `variantUserLabel: defaultVariantUserLabel`.
 * * `Extract a` (`State ExtensionValues a`) follows the `State` rule: an `Extract` action is a
 *   function of a `StateCell<ExtensionValues>`, and `reflectiveSet :: a -> Extract a` is the
 *   member `reflectiveSet(st, a)`, which takes the built-in fields out of `st.state` and returns
 *   the updated value. `runState (reflectiveSet v) exts` is
 *   `const st = { state: exts }; const v2 = cls.reflectiveSet(st, v); // st.state is the rest`.
 * * `extract d prsm k` is `extract(st, d, prsm, k)`.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { preview, type Prism, type StateCell } from "@/lib/Control/Lens";
import { round } from "@/lib/Prelude";
import type { Colour, IconName } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Relation } from "./NamedRelation";
import { type RefTypeTable, append_RefTypeTable, refTypeOtherSide, refTypeTableToList } from "./References";
import { type FieldId, type TypeDef, rangeMap } from "./Types";
import { type ExtValue, type ExtensionValues, type Extensions, type Variant, ExtNone, displayValue } from "./Values";

/**
 * A reflective type can describe its type and expose its value in terms of
 * that description. All extension fields have value "ExtNone" by default. Access to values
 * is by way of the "ix" function from "Ixed".
 *
 * ToDo: Figure out some kind of type hierarchy.
 */
export interface Reflective<A> {
  /**
   * A reflective type may have a fixed name, or it may be a union where each variant has
   * a distinct name.
   */
  reflectiveName(a: A): Variant<A>;
  /**
   * The original design for Variant simply had them as the human-readable name. However this
   * caused issues when a name change was required because the old name was already baked
   * into the JSON of existing models. Hence this function to translate from the Variant's internal
   * name to the user interface name. The default is just the "variantName"
   * (`defaultVariantUserLabel`).
   */
  variantUserLabel(v: Variant<A>): string;
  /** One default value of the type for each reflective name. */
  readonly reflectiveDefaults: readonly A[];
  /** Some fields are built in to the underlying data type. */
  reflectiveBuiltIn(a: A): FieldId[];
  /** Read the built-in fields of @a@. */
  reflectiveGet(a: A): ExtensionValues;
  /**
   * Write the built-in fields, and return any unused fields. (An `Extract a` action: the
   * unused fields are left in `st.state`.)
   */
  reflectiveSet(st: StateCell<ExtensionValues>, a: A): A;
  /** Built-in references between variants of @a@. */
  readonly reflectiveBuiltInRefs: RefTypeTable<A>;
  /**
   * Built-in notions of \"arrows\". These are variants which are represented by lines
   * on a diagram and have \"tail\" and \"head\" relationships to other entities in the model.
   */
  readonly reflectiveArrows: M.Map<Variant<A>, readonly [Relation, Relation]>;
}

/** The default method for "variantUserLabel": just the "variantName". */
export function defaultVariantUserLabel<A>(v: Variant<A>): string {
  return v;
}

/** All possible results from "reflectiveName" */
export function reflectiveNames<A>(cls: Reflective<A>): Variant<A>[] {
  return cls.reflectiveDefaults.map((a) => cls.reflectiveName(a));
}

/** The full set of fields, built in first followed by the extensions. */
export function reflection<A>(cls: Reflective<A>, ext: Extensions<A>, v: A): FieldId[] {
  return [...cls.reflectiveBuiltIn(v), ...ext(cls.reflectiveName(v))];
}

/**
 * Given a "RefTypeTable" and a value, find all the reference fields that can apply to the
 * value. The @Bool@ flag is true if the argument can only reference one instance of the
 * types listed.
 */
export function valueReferences<A>(
  cls: Reflective<A>,
  tbl: RefTypeTable<A>,
  v: A,
): [Relation, boolean, S.Set<Variant<A>>][] {
  const varName = cls.reflectiveName(v);
  const fullTable = refTypeTableToList(append_RefTypeTable(cls.reflectiveBuiltInRefs, tbl));
  const f = ([field, typ]: [Relation, typeof fullTable[number][1]]): [Relation, boolean, S.Set<Variant<A>>] => {
    const [single, vars] = refTypeOtherSide(varName, typ);
    return [field, single, vars];
  };
  return fullTable.map(f).filter(([, , vars]) => !S.isNull(vars));
}

/**
 * Tiny monad for managing reflective extension data. An instance of "Reflective"
 * will have some built-in fields which must be marshalled in and out of "ExtensionValues".
 * This assists with extracting the built-in fields.
 *
 * A first-class `Extract a` action: a function of the `ExtensionValues` state cell.
 */
export type Extract<A> = (st: StateCell<ExtensionValues>) => A;

/**
 * Destructively read a value from the state, with a default if it is not found or is the
 * wrong type.
 */
export function extract<A>(st: StateCell<ExtensionValues>, d: A, prsm: Prism<ExtValue, A>, k: FieldId): A {
  const s = st.state;
  st.state = M.delete_(k, s);
  return fromMaybe(d, preview(prsm, M.findWithDefault(ExtNone, k, s)));
}

/** Icon and colour to display the value with. */
export function valueFormat(t: TypeDef, v: ExtValue): [Maybe<IconName>, Maybe<Colour>] {
  const none: [Maybe<IconName>, Maybe<Colour>] = [Nothing, Nothing];
  const fromRange = (r: Maybe<readonly [Maybe<IconName>, Maybe<Colour>]>): [Maybe<IconName>, Maybe<Colour>] =>
    r.tag === "Just" ? [r.value[0], r.value[1]] : none;
  switch (t.tag) {
    case "DecoBoolDef":
      if (t._0.tag === "DecoBool" && v.tag === "ExtBool") {
        const { _0: icons, _1: colours } = t._0;
        const b = v._0;
        const f = <X>(p: readonly [X, X]): X => (b ? p[1] : p[0]);
        return [
          icons.tag === "Just" ? Just(f(icons.value)) : Nothing,
          colours.tag === "Just" ? Just(f(colours.value)) : Nothing,
        ];
      }
      break;
    case "DecoIntDef":
      if (t._0.tag === "DecoRange") {
        const m = t._0._1;
        if (v.tag === "ExtInt") return fromRange(rangeMap(m, v._0));
        if (v.tag === "ExtReal") return fromRange(rangeMap(m, round(v._0)));
      }
      break;
    case "DecoRealDef":
      if (t._0.tag === "DecoRange") {
        const m = t._0._1;
        if (v.tag === "ExtInt") return fromRange(rangeMap(m, v._0));
        if (v.tag === "ExtReal") return fromRange(rangeMap(m, v._0));
      }
      break;
    case "EnumDef": {
      const txt = displayValue(v);
      const item = t._0.find((e) => e._enumItemName === txt);
      return item ? [item._enumItemIcon, item._enumItemColour] : none;
    }
    default:
      break;
  }
  return none;
}
