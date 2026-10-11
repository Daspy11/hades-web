// Ported from hades/src/Model/Lookups/Base.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Lookup tables: a 2D matrix mapping a pair of extension field values to an output value.
 *
 * TypeScript port
 * ---------------
 * * `HasLookups v` is the dictionary interface `HasLookups<V>` with the member `_LookupTable`
 *   (a `Prism<V, LookupTable>`). Constrained functions take the dictionary first:
 *   `tableFunctions(cls)`, `lookupForest(cls, model)` with `cls: EntityClass<V> & HasLookups<V>`,
 *   and `lookupEditGadget(cls)` with `cls: EntityClass<V>` (unused, kept for the convention).
 * * `LookupTable` is a readonly record built with `LookupTable(...)`. The table values are a
 *   `M.Map<readonly [ExtValue, ExtValue], ExtValue>` keyed by the (column, row) pair; the
 *   tuple keys are ordered by the generic `compare`, which uses the Haskell `Ord ExtValue`.
 *   The JSON of the map is an array of `[[x, y], value]` pairs, as aeson writes a `Map` whose
 *   key type has no text key encoding.
 * * Instances: `def_LookupTable`, `JSON_LookupTable`, `Reflective_LookupTable`,
 *   `show_LookupTable` (derived `Show`), `eq_LookupTable` (derived `Eq`; structural `equals`
 *   gives the same answer).
 * * The lenses `tableName`, `horizontalAxis`, `verticalAxis`, `tableOutput`, `tableValues` are
 *   constants.
 */
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { darkred } from "@/lib/Data/Colour";
import { Just, Nothing, fromMaybe, isJust, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { formatDay } from "@/lib/Data/Time";
import type { Forest } from "@/lib/Data/Tree";
import { absurd, showDouble, showInt } from "@/lib/Prelude";
import {
  identity, lens, preview, set, view,
  type Lens, type Prism, type StateCell,
} from "@/lib/Control/Lens";
import {
  ComboItem, arr, comboBox, exec, focusing, focusingOver, form, gFirst, gPipe, getInitialEnv, grid,
  message1, simpleTextBox,
  type GadgetF_, type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  Name, type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelError, type ModelId,
  current, entityContents, evalModelEdit, followPath, goToRoot, nameField, nameText, show_Name,
  throwUser,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelFilter } from "@/hades/src/Model/Abstract/Properties";
import { fieldElement } from "@/hades/src/Model/Reflection/Dialogs";
import {
  arity, getArg, type Function, type FunctionName, type FunctionTable,
} from "@/hades/src/Model/Reflection/Parser";
import { defaultVariantUserLabel, extract, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import {
  enumItemName, fieldMulti, fieldName, fieldType, migrateField1,
  type Field, type FieldId, type FieldName, type FieldTable, type TypeDef,
} from "@/hades/src/Model/Reflection/Types";
import {
  ExtBool, ExtInt, ExtNone, ExtText, JSON_ExtValue, Variant, _ExtText, displayValue, extValue,
  type ExtValue, type ExtensionValues,
} from "@/hades/src/Model/Reflection/Values";

/** The maximum size of an integer range allowed in an axis. Value = 10. */
export const maxAxisRange: number = 10;

/** Prism for the lookup table in a model entity. */
export interface HasLookups<V> {
  readonly _LookupTable: Prism<V, LookupTable>;
}

/** Lookup tables provide a 2D matrix mapping a pair of inputs to an output. */
export interface LookupTable {
  readonly _tableName: Name;
  readonly _horizontalAxis: FieldId;
  readonly _verticalAxis: FieldId;
  readonly _tableOutput: FieldId;
  readonly _tableValues: M.Map<readonly [ExtValue, ExtValue], ExtValue>;
}

export function LookupTable(
  _tableName: Name,
  _horizontalAxis: FieldId,
  _verticalAxis: FieldId,
  _tableOutput: FieldId,
  _tableValues: M.Map<readonly [ExtValue, ExtValue], ExtValue>,
): LookupTable {
  return { _tableName, _horizontalAxis, _verticalAxis, _tableOutput, _tableValues };
}

/** Derived `instance Eq LookupTable`. */
export function eq_LookupTable(a: LookupTable, b: LookupTable): boolean {
  return equals(a, b);
}

/** Derived `Show` for an `ExtValue` (`showsPrec 11`, as for a constructor argument). */
function showsExtValue(v: ExtValue): string {
  const neg = (s: string, x: number): string => (x < 0 ? "(" + s + ")" : s);
  switch (v.tag) {
    case "ExtNone": return "ExtNone";
    case "ExtBool": return "ExtBool " + (v._0 ? "True" : "False");
    case "ExtInt": return "ExtInt " + neg(showInt(v._0), v._0);
    case "ExtReal": return "ExtReal " + neg(showDouble(v._0), v._0);
    case "ExtText": return "ExtText " + T.showText(v._0);
    case "ExtDate": return "ExtDate " + formatDay(v._0);
    default: return absurd(v);
  }
}

/** Derived `instance Show LookupTable`. */
export function show_LookupTable(tbl: LookupTable): string {
  const pairs = M.toList(tbl._tableValues).map(([[x, y], v]) =>
    "((" + showsExtValue(x) + "," + showsExtValue(y) + ")," + showsExtValue(v) + ")");
  return "LookupTable {_tableName = " + show_Name(tbl._tableName) +
    ", _horizontalAxis = " + U.toText(tbl._horizontalAxis) +
    ", _verticalAxis = " + U.toText(tbl._verticalAxis) +
    ", _tableOutput = " + U.toText(tbl._tableOutput) +
    ", _tableValues = fromList [" + pairs.join(",") + "]}";
}

/** `instance Default LookupTable` */
export const def_LookupTable: LookupTable = LookupTable(Name(""), U.nil, U.nil, U.nil, M.empty());

/** JSON codec for the table values: a list of @((x, y), value)@ pairs. */
const tableValuesJ: J.JSONCodec<M.Map<readonly [ExtValue, ExtValue], ExtValue>> =
  J.mapPairsJ<readonly [ExtValue, ExtValue], ExtValue>(J.tuple2J(JSON_ExtValue, JSON_ExtValue), JSON_ExtValue);

/** `instance ToJSON LookupTable` and `instance FromJSON LookupTable` */
export const JSON_LookupTable: J.JSONCodec<LookupTable> = J.codec(
  (tbl) => J.object([
    ["type", J.textJ.toJSON("lookup-table")],
    ["name", J.textJ.toJSON(view(tableName.dot(nameText), tbl))],
    ["horizontal", J.uuidJ.toJSON(view(horizontalAxis, tbl))],
    ["vertical", J.uuidJ.toJSON(view(verticalAxis, tbl))],
    ["output", J.uuidJ.toJSON(view(tableOutput, tbl))],
    ["values", tableValuesJ.toJSON(view(tableValues, tbl))],
  ]),
  (val) => J.withObject("Lookup Table", (v) => {
    const t = J.field(v, "type", J.textJ);
    if (t !== "lookup-table") J.fail(t + " is not a lookup table.");
    return LookupTable(
      Name(T.strip(J.field(v, "name", J.textJ))), // FromJSON Name strips white space.
      migrateField1(J.field(v, "horizontal", J.textJ)),
      migrateField1(J.field(v, "vertical", J.textJ)),
      migrateField1(J.field(v, "output", J.textJ)),
      J.field(v, "values", tableValuesJ),
    );
  }, val),
);

/** `instance Reflective LookupTable` */
export const Reflective_LookupTable: Reflective<LookupTable> = {
  reflectiveName: (_) => Variant("Lookup Table"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [LookupTable(Name(""), U.nil, U.nil, U.nil, M.empty())],
  reflectiveBuiltIn: (_) => [nameField],
  reflectiveGet: (t) => M.singleton(nameField, ExtText(view(tableName.dot(nameText), t))),
  reflectiveSet: (st: StateCell<ExtensionValues>, t: LookupTable): LookupTable => {
    const nm = Name(T.strip(extract(st, view(tableName.dot(nameText), t), _ExtText, nameField)));
    return set(tableName, nm, t);
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
};

export const tableName: Lens<LookupTable, Name> =
  lens((s: LookupTable) => s._tableName, (s, n: Name) => ({ ...s, _tableName: n }));

export const horizontalAxis: Lens<LookupTable, FieldId> =
  lens((s: LookupTable) => s._horizontalAxis, (s, h: FieldId) => ({ ...s, _horizontalAxis: h }));

export const verticalAxis: Lens<LookupTable, FieldId> =
  lens((s: LookupTable) => s._verticalAxis, (s, v: FieldId) => ({ ...s, _verticalAxis: v }));

export const tableOutput: Lens<LookupTable, FieldId> =
  lens((s: LookupTable) => s._tableOutput, (s, t: FieldId) => ({ ...s, _tableOutput: t }));

/** The values stored by the table. The key is the (x, y) position. */
export const tableValues: Lens<LookupTable, M.Map<readonly [ExtValue, ExtValue], ExtValue>> =
  lens(
    (s: LookupTable) => s._tableValues,
    (s, v: M.Map<readonly [ExtValue, ExtValue], ExtValue>) => ({ ...s, _tableValues: v }),
  );

/** Functions for lookup tables. Currently just \"Lookup\". */
export function tableFunctions<V>(cls: EntityClass<V> & HasLookups<V>): FunctionTable<Model<V>> {
  const showError = (path: T.Text, e: ModelError): T.Text => {
    switch (e.tag) {
      case "UserError": return e._0 + ": " + path;
      case "InternalError": return "Internal error: " + e._0;
      default: return absurd(e);
    }
  };
  // A `ModelEdit v v LookupTable`.
  const getTable = (ctx: ModelEditCtx<V, V>, path: readonly Name[]): LookupTable => {
    goToRoot(ctx);
    followPath(ctx, path);
    const c = current(ctx);
    switch (c.tag) {
      case "Nothing": return throwUser(ctx, "Not a lookup table");
      case "Just": {
        const t = preview(entityContents<V>().dot(cls._LookupTable), c.value);
        switch (t.tag) {
          case "Nothing": return throwUser(ctx, "Not a lookup table");
          case "Just": return t.value;
        }
      }
    }
  };
  const lookupF: Function<Model<V>> = (argVals, extVals, model): Either<T.Text, ExtValue> => {
    // Either monad.
    const a = arity("Lookup", argVals, 1);
    if (a.tag === "Left") return Left(a.value);
    const arg = getArg("Lookup", argVals, 0);
    if (arg.tag === "Left") return Left(arg.value);
    const path0 = displayValue(arg.value);
    const path = T.splitOn("/", path0).filter((p) => !T.isNull(p)).map((p) => Name(p));
    const tbl = evalModelEdit(cls, identity<V>(), model, (c) => getTable(c, path));
    if (tbl.tag === "Left") return Left(showError(path0, tbl.value)); // BF.first (showError path0)
    return Right(runLookup(tbl.value, extVals));
  };
  return M.fromList<FunctionName, Function<Model<V>>>([["Lookup", lookupF]]);
}

/** Editor for lookup tables. */
export function lookupEditGadget<V, W = any>(_cls: EntityClass<V>): GadgetF_<Model<V>, W, LookupTable> {
  type E = Model<V>;
  type Body = readonly [ExtValue[], ExtValue[], Field];

  const emptyItem: ComboItem<FieldId> = ComboItem("<Select type>", Nothing, Just(Colour(darkred)), U.nil);
  const axisCombo: Gadget_<E, W, FieldId> = comboBox<E, W, FieldId>((model) => [
    emptyItem,
    ...mapMaybe(goodAxis, L.sortOn((f: Field) => view(fieldName, f), M.elems(model.modelFields)))
      .map(([fid, fname, _]) => ComboItem<FieldId>(fname, Nothing, Nothing, fid)),
  ]);
  const outputCombo: Gadget_<E, W, FieldId> = comboBox<E, W, FieldId>((model) => [
    emptyItem,
    ...M.elems(model.modelFields).map((f) => ComboItem<FieldId>(view(fieldName, f), Nothing, Nothing, f.fieldId)),
  ]);
  const headingForm: GadgetF_<E, W, LookupTable> = form<E, W, LookupTable>("Vertical", [
    ["Table name:", focusing(tableName.dot(nameText), simpleTextBox<E, W>())],
    ["Horizontal axis:", focusing(horizontalAxis, axisCombo)],
    ["Vertical axis:", focusing(verticalAxis, axisCombo)],
    ["Output:", focusing(tableOutput, outputCombo)],
  ]);
  const bodyForm = (m: Maybe<Body>): GadgetF_<E, W, LookupTable> => {
    if (m.tag === "Nothing") {
      return focusing(identity<LookupTable>(),
        message1<E, W, LookupTable>("Select the extension fields for the table above."));
    }
    const [hAxis, vAxis, out] = m.value;
    const cell = (col: ExtValue, row: ExtValue, g: GadgetF_<E, W, ExtValue>): GadgetF_<E, W, LookupTable> =>
      focusingOver(tableValues.dot(extValue<readonly [ExtValue, ExtValue]>([col, row])), g);
    const fld = fieldElement<E, W>(false, out);
    return grid(
      hAxis.map(displayValue),
      vAxis.map(displayValue),
      vAxis.map((row) => hAxis.map((col) => cell(col, row, focusing(identity<ExtValue>(), fld)))),
    );
  };
  const gridExtract = (fields: FieldTable, hAxis: FieldId, vAxis: FieldId, output: FieldId): Maybe<Body> => {
    // fields ^? ix k . to goodAxis . _Just
    const axis = (k: FieldId): Maybe<readonly [FieldId, FieldName, ExtValue[]]> => {
      const f = M.lookup(k, fields);
      return f.tag === "Just" ? goodAxis(f.value) : Nothing;
    };
    const h = axis(hAxis), v = axis(vAxis), out = M.lookup(output, fields);
    if (h.tag === "Just" && v.tag === "Just" && out.tag === "Just") return Just([h.value[2], v.value[2], out.value]);
    return Nothing;
  };

  // proc input -> do
  //   hdrF <- headingForm -< input
  //   let
  //     hdr = hdrF input
  //     tblDef = gridExtract
  //         (modelFields model)
  //         (hdr ^. horizontalAxis)
  //         (hdr ^. verticalAxis)
  //         (hdr ^. tableOutput)
  //   bodyF <- exec bodyForm -< (tblDef, hdr)
  //   returnA -< const $ bodyF hdr
  //   -- Or possibly "bodyF . hdrF", but it aint broke so lets not fix it.
  type Endo = (t: LookupTable) => LookupTable;
  return getInitialEnv((model: E) => gPipe(
    arr<E, W, LookupTable, [LookupTable, LookupTable]>((input) => [input, input]),
    gFirst<E, W, LookupTable, Endo, LookupTable>(headingForm), // (hdrF, input)
    arr<E, W, [Endo, LookupTable], [[Maybe<Body>, LookupTable], LookupTable]>(([hdrF, input]) => {
      const hdr = hdrF(input);
      const tblDef = gridExtract(
        model.modelFields,
        view(horizontalAxis, hdr),
        view(verticalAxis, hdr),
        view(tableOutput, hdr),
      );
      return [[tblDef, hdr], hdr];
    }),
    gFirst<E, W, [Maybe<Body>, LookupTable], Endo, LookupTable>(exec(bodyForm)), // (bodyF, hdr)
    arr<E, W, [Endo, LookupTable], Endo>(([bodyF, hdr]) => (_: LookupTable) => bodyF(hdr)),
  ));
}

/** If the field is suitable for use as an axis then return its ID, name and possible values. */
export function goodAxis(f: Field): Maybe<readonly [FieldId, FieldName, ExtValue[]]> {
  const goodAxis1 = (t: TypeDef): Maybe<ExtValue[]> => {
    switch (t.tag) {
      case "BuiltInDef":
        return t._0 === "ModelBool" ? Just([ExtBool(false), ExtBool(true)]) : Nothing;
      case "DecoBoolDef":
        return Just([ExtBool(false), ExtBool(true)]);
      case "DecoIntDef": {
        const d = t._0;
        if (d.tag !== "DecoRange") return Nothing;
        const [m1, m2] = d._0;
        if (m1.tag !== "Just" || m2.tag !== "Just") return Nothing;
        const x1 = m1.value, x2 = m2.value;
        if (x2 > x1 && x2 - x1 < maxAxisRange) {
          const r: ExtValue[] = [];
          for (let x = x1; x <= x2; x++) r.push(ExtInt(x)); // [x1 .. x2]
          return Just(r);
        }
        return Nothing;
      }
      case "EnumDef":
        return Just(t._0.map((item) => ExtText(view(enumItemName, item))));
      default:
        return Nothing;
    }
  };
  const vs = view(fieldType, f);
  const r = goodAxis1(vs);
  if (r.tag === "Nothing") return Nothing;
  return Just([f.fieldId, view(fieldName, f), view(fieldMulti, f) === "One" ? r.value : [ExtNone, ...r.value]]);
}

/** Extract the forest from the model and select all the members of the argument set. */
export function lookupForest<V>(
  cls: EntityClass<V> & HasLookups<V>,
  model: Model<V>,
): Forest<readonly [T.Text, Maybe<T.Text>, Maybe<ModelId>]> {
  return modelFilter(cls, (e: Entity<V>) => isJust(preview(entityContents<V>().dot(cls._LookupTable), e)), model);
}

/** Find the inputs in the list of entity values, and hence return the output or "ExtNone". */
export function runLookup(tbl: LookupTable, values: ExtensionValues): ExtValue {
  const findValue = (field: FieldId): Maybe<ExtValue> => M.lookup(field, values);
  // Maybe monad
  const r = ((): Maybe<ExtValue> => {
    const col = findValue(view(horizontalAxis, tbl));
    if (col.tag === "Nothing") return Nothing;
    const row = findValue(view(verticalAxis, tbl));
    if (row.tag === "Nothing") return Nothing;
    return Just(view(tableValues.dot(extValue<readonly [ExtValue, ExtValue]>([col.value, row.value])), tbl));
  })();
  return fromMaybe(ExtNone, r);
}
