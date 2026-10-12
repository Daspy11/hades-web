// Ported from hades/src/Model/Matrices/Design.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The design of a matrix: its name, description, default inputs and column groups, edited as a
 * forest of "DesignItem"s.
 *
 * TypeScript port
 * ---------------
 * * `DesignItem` is a tagged union (`DesignQuery(mId, sort)`, `DesignColumn(col)`); the prisms
 *   `_DesignQuery` (focus `readonly [ModelId, SortOrder]`) and `_DesignColumn` are constants.
 *   The derived `Eq` is the structural `equals`.
 * * The 4-tuple `(Name, Text, Set ModelId, Design)` of "matrixDesignIso" is
 *   `MatrixDesign = readonly [Name, Text, S.Set<ModelId>, Design]`.
 * * Constrained functions take their dictionary first: `designItemText(cls, model, item)`,
 *   `matrixDesignGadget(cls, matrixId)`, `sortOrderGadget(cls)`.
 * * The side channel of "matrixDesignGadget" carries `ModelEdit v Matrix (Maybe Text)` values,
 *   i.e. `(ctx: ModelEditCtx<V, Matrix>) => Maybe<Text>` functions.
 * * The `where`-bound helpers of "matrixDesignGadget" are module-level functions here; those that
 *   close over the dictionary or the matrix ID take them as leading arguments. "validDesign",
 *   "columnDesignIso", "matrixDelta", "designMenu", "canBeParent" and "itemDialog" are exported
 *   for the tests only (they are not exported by the Haskell module).
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as MP from "@/lib/Text/Megaparsec";
import { Just, Nothing, fromMaybe, listToMaybe, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { Node, flatten, type Forest, type Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  _1, _2, from, iso, ix, lens, over, preview, prism, prism_, review, set, view,
  type Iso, type Lens, type Prism,
} from "@/lib/Control/Lens";
import { defaultIso, setMaybeIso } from "@/hades/src/Control/Lens/Hades";
import {
  Name, entityContents, entityName, entityStampFields, goToEntity, modifyValue,
  nameField, nameText, setValue, withStampFields,
  type Entity, type EntityClass, type Model, type ModelEdit, type ModelEditCtx, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelSubsetSpecifier } from "@/hades/src/Model/Abstract/Properties";
import { lookupForest, type HasLookups } from "@/hades/src/Model/Lookups/Base";
import {
  ColumnGroup, ExprColumn, FieldColumn, FieldColumnData, LookupColumn, Matrix, MatrixColumn, QueryColumn, SortOrder,
  _ExprColumn, _FieldColumn, _LookupColumn, _QueryColumn, def_FieldColumnData, fieldColumnLink,
  fieldColumnText, groupColumns, groupQuery, groupSort, matrixColumnData, matrixColumnName, matrixDefaultInput,
  matrixDescription, matrixName, showSortOrder, show_SortDir,
  type HasMatrices, type MatrixColumnData, type SortDir,
} from "@/hades/src/Model/Matrices/Base";
import { queryForest, type Queryable } from "@/hades/src/Model/Query/Diagram";
import { expressionEntry } from "@/hades/src/Model/Reflection/Dialogs";
import { ShowErrorComponent_Text, topExpr, type FunctionTable } from "@/hades/src/Model/Reflection/Parser";
import {
  BuiltInDef, builtInFields, fieldName, fieldType, fieldsByName, withBuiltIn,
  type Field, type FieldId, type FieldName,
} from "@/hades/src/Model/Reflection/Types";
import {
  ComboItem, Dialog, OkApplyButton, TreeAddAfter, TreeAddBefore, TreeAddIn, TreeDelete,
  accum, arr, box, comboBox, focusing, focusingOver, forestEditor, form, gFanout, gId, gPipe, getEnv,
  getInitial, getInitialEnv, memoBox, prismaticOver, send, simpleFrame, simpleTextBox, table, tickBox,
  treeSelector, validateText1,
  type Dialog_, type GadgetF_, type Gadget_, type TreeOper,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { EditCombo, EditEnum, TableDelete, TableShuffle, mkField } from "@/banana-ui/base/Reactive/Banana/Table";


// ---------------------------------------------------------------------------------------------
// Design items

/** An element in a matrix design. See "Design" for details. */
export type DesignItem =
  | { readonly tag: "DesignQuery"; readonly _0: ModelId; readonly _1: SortOrder }
  | { readonly tag: "DesignColumn"; readonly _0: MatrixColumn };

export function DesignQuery(_0: ModelId, _1: SortOrder): DesignItem {
  return { tag: "DesignQuery", _0, _1 };
}

export function DesignColumn(_0: MatrixColumn): DesignItem {
  return { tag: "DesignColumn", _0 };
}

export const _DesignQuery: Prism<DesignItem, readonly [ModelId, SortOrder]> = prism(
  ([mId, sorts]: readonly [ModelId, SortOrder]) => DesignQuery(mId, sorts),
  (v: DesignItem): Either<DesignItem, readonly [ModelId, SortOrder]> =>
    (v.tag === "DesignQuery" ? Right([v._0, v._1] as const) : Left(v)),
);

export const _DesignColumn: Prism<DesignItem, MatrixColumn> = prism(
  (c: MatrixColumn) => DesignColumn(c),
  (v: DesignItem): Either<DesignItem, MatrixColumn> => (v.tag === "DesignColumn" ? Right(v._0) : Left(v)),
);


/** Descriptive text for the item. */
export function designItemText<V>(cls: EntityClass<V>, model: Model<V>, item: DesignItem): T.Text {
  const entityNameOf = (mId: ModelId): Maybe<T.Text> =>
    preview(ix<ModelId, Entity<V>>(mId).dot(entityName<V>(cls)).dot(nameText), model.modelContents);
  switch (item.tag) {
    case "DesignQuery": {
      const qId = item._0, qSort = item._1;
      const fields = M.union(M.union(model.modelFields, entityStampFields), builtInFields);
      return fromMaybe("- ? -", entityNameOf(qId)) + (
        qSort.getSortOrder.length === 0
          ? ""
          : " sorted by " + showSortOrder(fields, qSort)
      );
    }
    case "DesignColumn": {
      const c = item._0;
      const allFields = withStampFields(withBuiltIn(model.modelFields));
      const fname = (fid: FieldId): T.Text => {
        const f = M.lookup(fid, allFields);
        return f.tag === "Just" ? view(fieldName, f.value) : "<deleted>";
      };
      const d = view(matrixColumnData, c);
      let rest: T.Text;
      switch (d.tag) {
        case "FieldColumn": {
          const fcd = d._0;
          rest = fcd._fieldColumnLink.tag === "Nothing"
            ? "Field <" + fname(fcd._fieldColumnText) + ">"
            : "Field <" + fname(fcd._fieldColumnText) + "> with link <" + fname(fcd._fieldColumnLink.value) + ">";
          break;
        }
        case "ExprColumn":
          rest = d._0 ? "Memo formula: " + d._1 : "Formula: " + d._1;
          break;
        case "QueryColumn":
          rest = "Query <" + fromMaybe("- ? -", entityNameOf(d._0)) + ">";
          break;
        case "LookupColumn":
          rest = "Lookup table <" + fromMaybe("- ? -", entityNameOf(d._0)) + ">";
          break;
        default:
          return absurd(d);
      }
      return view(matrixColumnName, c) + ": " + rest;
    }
    default:
      return absurd(item);
  }
}


/**
 * A matrix design is represented as a "Forest" for the benefit of the GUI. However it must
 * conform to the following structure laws:
 *
 * * The first level nodes must be "DesignQuery" values.
 *
 * * The second level nodes must be "DesignColumn" values with no children.
 */
export type Design = Forest<DesignItem>;


/**
 * Report on the validity of the design. A null result means the design:
 *
 * * Conforms to the laws for "Design".
 *
 * * Only refers to field names that are valid in the model.
 *
 * * Only refers to queries that exist in the model.
 *
 * (Not exported by the Haskell module; exported here for the tests.)
 */
export function validDesign<V>(
  cls: EntityClass<V> & HasLookups<V> & Queryable<V>,
  model: Model<V>,
  _old: Design,
  design: Design,
): Maybe<T.Text> {
  // entityFunctions1 :: (EntityClass v) => Model v -> FunctionTable (Model v)
  // Tie things together for type checker.
  const entityFunctions1 = (_m: Model<V>): FunctionTable<Model<V>> => cls.entityFunctions;
  const allFields = withStampFields(withBuiltIn(model.modelFields));
  const verifyQuery = (mId: ModelId): T.Text[] =>
    preview(ix<ModelId, Entity<V>>(mId).dot(entityContents<V>()).dot(cls._QueryDiagram), model.modelContents).tag === "Just"
      ? []
      : ["Query missing or invalid."];
  const verifyLookupTable = (tId: ModelId): T.Text[] =>
    preview(ix<ModelId, Entity<V>>(tId).dot(entityContents<V>()).dot(cls._LookupTable), model.modelContents).tag === "Just"
      ? []
      : ["Lookup table missing or invalid."];
  const checkName = (c: MatrixColumn): T.Text[] =>
    (T.isNull(view(matrixColumnName, c)) ? ["Column with no name."] : []);
  const checkField = (fid: FieldId): T.Text[] =>
    (!M.member(fid, allFields) ? ["Unknown or deleted field"] : []);
  const checkExpr = (expr: T.Text): T.Text[] => {
    const r = MP.parse(topExpr(entityFunctions1(model), allFields), "", expr);
    if (r.tag === "Left") {
      return r.value.bundleErrors.slice(0, 3).map((e) =>
        T.pack(MP.parseErrorTextPretty(ShowErrorComponent_Text, e)));
    }
    return [];
  };
  const verifyColumn = (node: Tree<DesignItem>): T.Text[] => {
    const item = node.rootLabel;
    if (item.tag !== "DesignColumn") return ["Contains another group"];
    const c = item._0;
    if (node.subForest.length > 0) return [view(matrixColumnName, c) + " has children."];
    const d: MatrixColumnData = view(matrixColumnData, c);
    let errs: T.Text[];
    switch (d.tag) {
      case "FieldColumn":
        errs = d._0._fieldColumnLink.tag === "Nothing"
          ? checkField(d._0._fieldColumnText)
          : [...checkField(d._0._fieldColumnText), ...checkField(d._0._fieldColumnLink.value)];
        break;
      case "ExprColumn":
        errs = checkExpr(d._1);
        break;
      case "QueryColumn":
        errs = verifyQuery(d._0);
        break;
      case "LookupColumn":
        errs = verifyLookupTable(d._0);
        break;
      default:
        return absurd(d);
    }
    return [...checkName(c), ...errs.map((e) => view(matrixColumnName, c) + ": " + e)];
  };
  const validGroup = (n: number, node: Tree<DesignItem>): T.Text[] => {
    const item = node.rootLabel;
    if (item.tag === "DesignQuery") {
      return [...verifyQuery(item._0), ...L.concatMap(verifyColumn, node.subForest)]
        .map((e) => T.pack("Group " + String(n) + ": ") + e);
    }
    return [T.pack("Item " + String(n) + ": Not a column group.")];
  };
  return listToMaybe(L.concat(design.map((t, i) => validGroup(i + 1, t))));
}


/** The 4-tuple viewed by "matrixDesignIso": name, description, default inputs and design. */
export type MatrixDesign = readonly [Name, T.Text, S.Set<ModelId>, Design];

/** Lens `_1` on a 4-tuple. */
function _1of4<A, B, C, D>(): Lens<readonly [A, B, C, D], A> {
  return lens((s: readonly [A, B, C, D]) => s[0], (s, x: A) => [x, s[1], s[2], s[3]] as const);
}
/** Lens `_2` on a 4-tuple. */
function _2of4<A, B, C, D>(): Lens<readonly [A, B, C, D], B> {
  return lens((s: readonly [A, B, C, D]) => s[1], (s, x: B) => [s[0], x, s[2], s[3]] as const);
}
/** Lens `_3` on a 4-tuple. */
function _3of4<A, B, C, D>(): Lens<readonly [A, B, C, D], C> {
  return lens((s: readonly [A, B, C, D]) => s[2], (s, x: C) => [s[0], s[1], x, s[3]] as const);
}
/** Lens `_4` on a 4-tuple. */
function _4of4<A, B, C, D>(): Lens<readonly [A, B, C, D], D> {
  return lens((s: readonly [A, B, C, D]) => s[3], (s, x: D) => [s[0], s[1], s[2], x] as const);
}


/**
 * Isomoprphism between "Matrix" and "Design". Round-trip equality is guaranteed if the @Design@
 * complies with its laws.
 */
export const matrixDesignIso: Iso<Matrix, MatrixDesign> = iso(
  (m: Matrix): MatrixDesign =>
    [m._matrixName, m._matrixDescription, m._matrixDefaultInput, view(columnDesignIso, m._matrixGroups)],
  ([nm, desc, inputs, design]: MatrixDesign): Matrix => Matrix(
    over(nameText, T.strip, nm),
    desc,
    inputs,
    view(from(columnDesignIso), design),
  ),
);


/** (Not exported by the Haskell module; exported here for the tests.) */
export const columnDesignIso: Iso<readonly ColumnGroup[], Design> = (() => {
  const columnToItem = (c: MatrixColumn): Tree<DesignItem> => Node(DesignColumn(c), []);
  const groupToItem = (cg: ColumnGroup): Tree<DesignItem> => Node(
    DesignQuery(view(groupQuery, cg), view(groupSort, cg)),
    view(groupColumns, cg).map(columnToItem),
  );
  const itemToColumn = (t: Tree<DesignItem>): Maybe<MatrixColumn> =>
    (t.rootLabel.tag === "DesignColumn" ? Just(t.rootLabel._0) : Nothing);
  const itemToGroup = (t: Tree<DesignItem>): Maybe<ColumnGroup> => {
    const item = t.rootLabel;
    if (item.tag !== "DesignQuery") return Nothing;
    return Just(ColumnGroup(item._0, mapMaybe(itemToColumn, t.subForest), item._1));
  };
  return iso(
    (cgs: readonly ColumnGroup[]): Design => cgs.map(groupToItem),
    (d: Design): readonly ColumnGroup[] => mapMaybe(itemToGroup, d),
  );
})();


// ---------------------------------------------------------------------------------------------
// The matrix design gadget

/** The `(EntityClass v, HasLookups v, HasMatrices v, Queryable v)` dictionary. */
export type MatrixDesignClass<V> = EntityClass<V> & HasLookups<V> & HasMatrices<V> & Queryable<V>;

/** The side-channel type of "matrixDesignGadget": `ModelEdit v Matrix (Maybe Text)`. */
type MatrixEdit<V> = ModelEdit<V, Matrix, Maybe<T.Text>>;

/** Present the matrix design as a tree. */
export function matrixDesignGadget<V>(
  cls: MatrixDesignClass<V>,
  matrixId: ModelId,
): Gadget_<Model<V>, MatrixEdit<V>, [null, Matrix]> {
  type E = Model<V>;
  type W = MatrixEdit<V>;
  type Inp = [null, Matrix];
  return getInitial<E, W, Inp, Inp>(([, matrix1]) => {
    const nm1 = view(matrixName.dot(nameText), matrix1);
    // proc ((), matrix) -> do
    //   let d = matrix ^. matrixDesignIso
    //   d' <- accum $ box Vertical [[
    //       form Vertical [
    //           ("Name:", focusing (_1 . nameText) simpleTextBox),
    //           ("Description:", focusing _2 (memoBox MemoSmall False)),
    //           ("Default Inputs:", focusing _3
    //             (modelSubsetSpecifier (const $ const True) (const Nothing)))
    //         ],
    //       simpleFrame "Matrix contents" $ focusing _4 $ validateText1 validDesign $
    //         forestEditor designItemText designMenu canBeParent $ Just $ const itemDialog
    //     ]] -< d
    //   model <- getEnv -< ()
    //   _ <- send (matrixDelta nm1) -< (model, d, d')
    //   returnA -< ((), d' ^. from matrixDesignIso)
    const editor: Gadget_<E, W, MatrixDesign> = accum(box<E, W, MatrixDesign>("Vertical", [[
      form<E, W, MatrixDesign>("Vertical", [
        ["Name:", focusing(_1of4<Name, T.Text, S.Set<ModelId>, Design>().dot(nameText), simpleTextBox<E, W>())],
        ["Description:", focusing(_2of4<Name, T.Text, S.Set<ModelId>, Design>(), memoBox<E, W>("MemoSmall", false))],
        ["Default Inputs:", focusing(_3of4<Name, T.Text, S.Set<ModelId>, Design>(),
          modelSubsetSpecifier<V, W>(cls, () => () => true, () => Nothing))],
      ]),
      simpleFrame("Matrix contents", focusing(_4of4<Name, T.Text, S.Set<ModelId>, Design>(),
        validateText1<E, W, Design, Design>(
          (model, d1, d2) => validDesign(cls, model, d1, d2),
          forestEditor<E, W, DesignItem>(
            (model, item) => designItemText(cls, model, item),
            designMenu,
            canBeParent,
            Just((_e: E, item: DesignItem) => itemDialog(cls, item)),
          ),
        ))),
    ]]));
    return gPipe(
      arr<E, W, Inp, MatrixDesign>(([, matrix]) => view(matrixDesignIso, matrix)),
      gFanout(gId<E, W, MatrixDesign>(), editor),
      gFanout(gId<E, W, [MatrixDesign, MatrixDesign]>(), getEnv<E, W, [MatrixDesign, MatrixDesign]>()),
      gFanout(
        gPipe(
          arr<E, W, [[MatrixDesign, MatrixDesign], E], readonly [E, MatrixDesign, MatrixDesign]>(
            ([[d, d2], model]) => [model, d, d2]),
          send<E, W, readonly [E, MatrixDesign, MatrixDesign]>((args) => matrixDelta(cls, matrixId, nm1, args)),
        ),
        gId<E, W, [[MatrixDesign, MatrixDesign], E]>(),
      ),
      arr<E, W, [readonly [E, MatrixDesign, MatrixDesign], [[MatrixDesign, MatrixDesign], E]], Inp>(
        ([, [[, d2]]]) => [null, review(matrixDesignIso, d2)]),
    );
  });
}


/**
 * Compare two matrices. If they are the same then return Nothing. Otherwise return
 * an update for the second with an appropriate message. Assumes only a single edit.
 *
 * (A `where` function of "matrixDesignGadget" in Haskell, closing over the dictionary and the
 * matrix ID, which are the first two arguments here. Exported for the tests.)
 */
export function matrixDelta<V>(
  cls: EntityClass<V>,
  matrixId: ModelId,
  oldName: T.Text,
  [model, [n1, d1, s1, t1], v2]: readonly [Model<V>, MatrixDesign, MatrixDesign],
): Maybe<MatrixEdit<V>> {
  const [n2, d2, s2, t2] = v2;
  if (!equals(n1, n2)) {
    return Just((ctx: ModelEditCtx<V, Matrix>) => {
      goToEntity(ctx, matrixId);
      void modifyValue(ctx, (m: Matrix) => set(matrixName, n2, m));
      return Just("Renamed " + oldName);
    });
  }
  if (d1 !== d2) {
    return Just((ctx: ModelEditCtx<V, Matrix>) => {
      goToEntity(ctx, matrixId);
      void modifyValue(ctx, (m: Matrix) => set(matrixDescription, d2, m));
      return Just("Edited " + oldName + " description");
    });
  }
  if (!equals(s1, s2)) {
    return Just((ctx: ModelEditCtx<V, Matrix>) => {
      goToEntity(ctx, matrixId);
      void modifyValue(ctx, (m: Matrix) => set(matrixDefaultInput, s2, m));
      return Just("Edited " + oldName + " default inputs");
    });
  }
  if (!equals(t1, t2)) {
    return Just((ctx: ModelEditCtx<V, Matrix>) => {
      const ft1 = L.concatMap(flatten, t1);
      const ft2 = L.concatMap(flatten, t2);
      const z = L.zip(ft1, ft2);
      const diff = L.find(([a, b]: [DesignItem, DesignItem]) => !equals(a, b), z);
      const l1 = ft1.length;
      const l2 = ft2.length;
      let changed: T.Text;
      if (l1 > l2) {  // Something deleted from ft1.
        changed = "Deleted " + designItemText(cls, model, diff.tag === "Just" ? diff.value[0] : L.last(ft1));
          // "last" is safe because length ft1 > 0
      } else if (l1 < l2) {  // Something inserted in ft2.
        changed = "Inserted " + designItemText(cls, model, diff.tag === "Just" ? diff.value[1] : L.last(ft2));
      } else {
        changed = diff.tag === "Just"
          ? "Changed " + designItemText(cls, model, diff.value[0])
          : "Changed something";  // Should never happen.
      }
      goToEntity(ctx, matrixId);
      void setValue(ctx, review(matrixDesignIso, v2));
      return Just("Edit " + oldName + ": " + changed);
    });
  }
  return Nothing;
}


/** The default new group: the nil query, sorted by name. */
function newGroup(): DesignItem {
  return DesignQuery(U.nil, SortOrder([[nameField, "Ascending"]]));
}
const newFieldColumn = (): DesignItem =>
  DesignColumn(MatrixColumn("-title-", FieldColumn(FieldColumnData(nameField, Nothing))));
const newFormulaColumn = (): DesignItem =>
  DesignColumn(MatrixColumn("-title-", ExprColumn(true, "Name ++ \": \" ++ Description")));
const newQueryColumn = (): DesignItem =>
  DesignColumn(MatrixColumn("-title-", QueryColumn(U.nil)));
const newLookupColumn = (): DesignItem =>
  DesignColumn(MatrixColumn("-title-", LookupColumn(U.nil)));

/**
 * The context menu of the design tree. (A `where` function of "matrixDesignGadget" in Haskell;
 * exported for the tests.)
 */
export function designMenu(item: Maybe<DesignItem>): Menu<TreeOper<DesignItem>> {
  type Op = TreeOper<DesignItem>;
  if (item.tag === "Nothing") {
    return Menu<Op>([[menuItem<Op>("Add group", TreeAddAfter(newGroup()))]]);
  }
  switch (item.value.tag) {
    case "DesignQuery":
      return Menu<Op>([[
        menuItem<Op>("Add field column", TreeAddIn(newFieldColumn())),
        menuItem<Op>("Add formula column", TreeAddIn(newFormulaColumn())),
        menuItem<Op>("Add query column", TreeAddIn(newQueryColumn())),
        menuItem<Op>("Add lookup table column", TreeAddIn(newLookupColumn())),
      ], [
        menuItem<Op>("New group before", TreeAddBefore(newGroup())),
        menuItem<Op>("New group after", TreeAddAfter(newGroup())),
      ], [
        menuItem<Op>("Delete group", TreeDelete),
      ]]);
    case "DesignColumn":
      return Menu<Op>([[
        menuItem<Op>("Insert field column before", TreeAddBefore(newFieldColumn())),
        menuItem<Op>("Insert formula column before", TreeAddBefore(newFormulaColumn())),
        menuItem<Op>("Insert query column before", TreeAddBefore(newQueryColumn())),
        menuItem<Op>("Insert lookup table column before", TreeAddBefore(newLookupColumn())),
      ], [
        menuItem<Op>("Insert field column after", TreeAddAfter(newFieldColumn())),
        menuItem<Op>("Insert formula column after", TreeAddAfter(newFormulaColumn())),
        menuItem<Op>("Insert query column after", TreeAddAfter(newQueryColumn())),
        menuItem<Op>("Insert lookup table column after", TreeAddAfter(newLookupColumn())),
      ], [
        menuItem<Op>("Delete column", TreeDelete),
      ]]);
    default:
      return absurd(item.value);
  }
}

/** (A `where` function of "matrixDesignGadget" in Haskell; exported for the tests.) */
export function canBeParent(item: DesignItem): boolean {
  return item.tag === "DesignQuery";
}

/**
 * The dialog for an item in the design tree.
 *
 * > itemDialog :: (EntityClass v, Queryable v, HasLookups v) =>
 * >    DesignItem -> Maybe (Dialog' (Model v) w DesignItem)
 *
 * (A `where` function of "matrixDesignGadget" in Haskell; exported for the tests.)
 */
export function itemDialog<V, W = any>(
  cls: EntityClass<V> & Queryable<V> & HasLookups<V>,
  item: DesignItem,
): Maybe<Dialog_<Model<V>, W, DesignItem>> {
  switch (item.tag) {
    case "DesignQuery":
      return Just(groupDialog<V, W>(cls));
    case "DesignColumn": {
      const d = view(matrixColumnData, item._0);
      switch (d.tag) {
        case "FieldColumn": return Just(fieldDialog1<V, W>());
        case "ExprColumn": return Just(exprDialog<V, W>(cls));
        case "QueryColumn": return Just(queryDialog<V, W>(cls));
        case "LookupColumn": return Just(lookupDialog<V, W>(cls));
        default: return absurd(d);
      }
    }
    default:
      return absurd(item);
  }
}

/** Given a prism for the column data, return a prism for the column as a pair. */
function columnPrism<A>(p: Prism<MatrixColumnData, A>): Prism<MatrixColumn, readonly [T.Text, A]> {
  return prism_(
    ([txt1, dat1]: readonly [T.Text, A]) => MatrixColumn(txt1, review(p, dat1)),
    (c: MatrixColumn): Maybe<readonly [T.Text, A]> => {
      const r = preview(p, c._columnData);
      return r.tag === "Just" ? Just([c._columnName, r.value] as const) : Nothing;
    },
  );
}

/** `fieldDialog1 :: (EntityClass v) => Dialog' (Model v) w DesignItem` */
function fieldDialog1<V, W>(): Dialog_<Model<V>, W, DesignItem> {
  type E = Model<V>;
  type A = readonly [T.Text, FieldColumnData];
  return Dialog("Matrix Column", OkApplyButton,
    accum(prismaticOver<E, W, DesignItem, A>(["", def_FieldColumnData], _DesignColumn.dot(columnPrism(_FieldColumn)),
      form<E, W, A>("Vertical", [
        ["Heading:", focusing(_1<T.Text, FieldColumnData>(), simpleTextBox<E, W>())],
        ["Column Text:", focusing(_2<T.Text, FieldColumnData>().dot(fieldColumnText),
          comboBox<E, W, FieldId>(fieldNameMenu))],
        ["Column Link:", focusing(_2<T.Text, FieldColumnData>().dot(fieldColumnLink),
          comboBox<E, W, Maybe<FieldId>>(linkFieldMenu))],
      ]))));
}

/** `exprDialog :: (EntityClass v) => Dialog' (Model v) w DesignItem` */
function exprDialog<V, W>(cls: EntityClass<V>): Dialog_<Model<V>, W, DesignItem> {
  type E = Model<V>;
  type A = readonly [T.Text, readonly [boolean, T.Text]];
  return Dialog("Field Column", OkApplyButton, getInitialEnv<E, W, DesignItem, DesignItem>((model) => {
    const knownFields = withStampFields(withBuiltIn(model.modelFields));
    return accum(prismaticOver<E, W, DesignItem, A>(["", [false, ""]], _DesignColumn.dot(columnPrism(_ExprColumn)),
      form<E, W, A>("Vertical", [
        ["Heading:", focusing(_1<T.Text, readonly [boolean, T.Text]>(), simpleTextBox<E, W>())],
        ["Multi-line display: ", focusing(
          _2<T.Text, readonly [boolean, T.Text]>().dot(_1<boolean, T.Text>()), tickBox<E, W>())],
        ["Formula: ", focusing(
          _2<T.Text, readonly [boolean, T.Text]>().dot(_2<boolean, T.Text>()),
          expressionEntry<E, W>(cls.entityFunctions, knownFields))],
      ])));
  }));
}

/** Iso from a model ID to the set picked in a tree selector: `from (setMaybeIso . defaultIso U.nil)`. */
function pickIso(): Iso<ModelId, S.Set<ModelId>> {
  return from(setMaybeIso<ModelId>().dot(defaultIso<ModelId>(U.nil)));
}

/** `queryDialog :: (EntityClass v, Queryable v) => Dialog' (Model v) w DesignItem` */
function queryDialog<V, W>(cls: EntityClass<V> & Queryable<V>): Dialog_<Model<V>, W, DesignItem> {
  type E = Model<V>;
  type A = readonly [T.Text, ModelId];
  return Dialog("Query Column", OkApplyButton, accum(
    prismaticOver<E, W, DesignItem, A>(["", U.nil], _DesignColumn.dot(columnPrism(_QueryColumn)),
      form<E, W, A>("Vertical", [
        ["Heading:", focusing(_1<T.Text, ModelId>(), simpleTextBox<E, W>())],
        ["Query:", focusing(_2<T.Text, ModelId>().dot(pickIso()), queryPick<V, W>(cls))],
      ]))));
}

/** `lookupDialog :: (EntityClass v, HasLookups v) => Dialog' (Model v) w DesignItem` */
function lookupDialog<V, W>(cls: EntityClass<V> & HasLookups<V>): Dialog_<Model<V>, W, DesignItem> {
  type E = Model<V>;
  type A = readonly [T.Text, ModelId];
  return Dialog("Lookup Column", OkApplyButton, accum(
    prismaticOver<E, W, DesignItem, A>(["", U.nil], _DesignColumn.dot(columnPrism(_LookupColumn)),
      form<E, W, A>("Vertical", [
        ["Heading:", focusing(_1<T.Text, ModelId>(), simpleTextBox<E, W>())],
        ["Lookup table:", focusing(_2<T.Text, ModelId>().dot(pickIso()),
          treeSelector<E, W, ModelId>((m) => lookupForest(cls, m)))],
      ]))));
}

/** `groupDialog :: (EntityClass v, Queryable v) => Dialog' (Model v) w DesignItem` */
function groupDialog<V, W>(cls: EntityClass<V> & Queryable<V>): Dialog_<Model<V>, W, DesignItem> {
  type E = Model<V>;
  type A = readonly [ModelId, SortOrder];
  return Dialog("Matrix Column Group", OkApplyButton, accum(
    prismaticOver<E, W, DesignItem, A>([U.nil, SortOrder([])], _DesignQuery,
      form<E, W, A>("Vertical", [
        ["Group Query:", focusing(_1<ModelId, SortOrder>().dot(pickIso()), queryPick<V, W>(cls))],
        ["Sort by:", focusingOver(_2<ModelId, SortOrder>(), sortOrderGadget<V, W>(cls))],
      ]))));
}

/** List of field names */
function fieldNameMenu<V>(model: Model<V>): ComboItem<FieldId>[] {
  return L.sortOn((x: Field) => view(fieldName, x), M.elems(withStampFields(withBuiltIn(model.modelFields))))
    .map((x) => ComboItem(view(fieldName, x), Nothing, Nothing, x.fieldId));
}

function linkFieldMenu<V>(model: Model<V>): ComboItem<Maybe<FieldId>>[] {
  const cs = M.elems(M.filter((f: Field) => equals(BuiltInDef("ModelURL"), view(fieldType, f)), model.modelFields))
    .map((x) => ComboItem<Maybe<FieldId>>(view(fieldName, x), Nothing, Nothing, Just(x.fieldId)));
  return [ComboItem<Maybe<FieldId>>(" - ", Nothing, Nothing, Nothing), ...cs];
}

/** Model tree showing only queries. */
function queryPick<V, W>(cls: EntityClass<V> & Queryable<V>): Gadget_<Model<V>, W, S.Set<ModelId>> {
  return treeSelector<Model<V>, W, ModelId>((m) => queryForest(cls, m));
}


// ---------------------------------------------------------------------------------------------
// Sort orders

/** Gadget for setting the sort order on a list of entities. */
export function sortOrderGadget<V, W = any>(cls: EntityClass<V>): GadgetF_<Model<V>, W, SortOrder> {
  type E = Model<V>;
  type Row = readonly [FieldName, SortDir];
  void cls;
  const blankText = " -?- ";
  const extraIso: Iso<readonly Row[], readonly Row[]> = iso(
    (xs: readonly Row[]): readonly Row[] => [...xs, [blankText, "Ascending"]],
    (xs: readonly Row[]): readonly Row[] => xs.filter(([n]) => T.strip(n) !== T.strip(blankText)),
  );
  return getInitialEnv<E, W, SortOrder, (s: SortOrder) => SortOrder>((model) => {
    const fidMap = M.union(entityStampFields, withBuiltIn(model.modelFields));
    const nameMap = fieldsByName(withBuiltIn(model.modelFields));
    const sortOrderIso: Iso<SortOrder, readonly Row[]> = iso(
      (so: SortOrder): readonly Row[] => mapMaybe(([k, o]: readonly [FieldId, SortDir]): Maybe<Row> => {
        const f = M.lookup(k, fidMap);
        return f.tag === "Just" ? Just([view(fieldName, f.value), o] as const) : Nothing;
      }, so.getSortOrder),
      (rows: readonly Row[]): SortOrder => SortOrder(mapMaybe(([k, o]: Row): Maybe<readonly [FieldId, SortDir]> => {
        const f = M.lookup(k, nameMap);
        return f.tag === "Just" ? Just([f.value.fieldId, o] as const) : Nothing;
      }, rows)),
      // Not a true Iso because unknown fields are dropped. But that is the Right Thing here.
    );
    const fieldList = L.sort(M.elems(withStampFields(withBuiltIn(model.modelFields))).map((f) => view(fieldName, f)));
    return focusing(sortOrderIso.dot(extraIso), table<E, W, Row>(
      [TableDelete, TableShuffle],
      [
        mkField<Row, FieldName>("Field Name", _1<FieldName, SortDir>(), Nothing, EditCombo(fieldList), Nothing),
        mkField<Row, SortDir>("Order", _2<FieldName, SortDir>(), Nothing,
          EditEnum((d: SortDir) => T.pack(show_SortDir(d)), ["Ascending", "Descending"]), Nothing),
      ],
      Nothing,
    ));
  });
}

