// Ported from hades/src/Model/Matrices/Screen.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * On-screen display of matrices: the matrix results are shown as a "forestTable" in a view
 * window, with editable cells for the entity fields.
 *
 * TypeScript port
 * ---------------
 * * The side channel carries `ModelScript p v v (Maybe Text)` values, i.e.
 *   `ModelScriptAct<P, V, V, Maybe<Text>>` (functions of a `ModelEditCtx<V, V>` returning a
 *   script generator).
 * * The `(Editable p v, EntityClass v, HasLookups v, HasMatrices v)` dictionary is
 *   `MatrixScreenClass<P, V>`; it is passed first: `getMatrixWrapper(cls, ctx, ent)` (a
 *   `ModelEdit v v`), `matrixDisplay(cls, mId)`, `getForest(cls, ...)`, `matrixTable(cls, ...)`,
 *   `columnTableField(cls, ...)`, `fieldColumn(cls, ...)`.
 * * The row type of the matrix table, `([ModelId], ExtensionValues, ExtensionValues)`, is
 *   `MatrixRow = readonly [readonly ModelId[], ExtensionValues, ExtensionValues]`.
 * * `proc` blocks are desugared into the arrow combinators of "ArrowDialog"; the original block
 *   is kept in a comment above each one.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as MP from "@/lib/Text/Megaparsec";
import { Just, Nothing, fromMaybe, listToMaybe, mapMaybe, mapMaybeValue, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Node, fmapTree, type Forest, type Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  identity, iso, ix, lens, preview, prism, prism_, review, set, view,
  type Iso, type Prism,
} from "@/lib/Control/Lens";
import {
  PrismaticGadget, Lens1, arr, cond, displayMemo, displayText, exec, focusing, forestTable, gDot, gFanout, gId,
  gPipe, gSecond, getEnv, getInitial, getInitialEnv, linked, message1, optional, prismatic, readOnlyMemo,
  readOnlyText, send, sendMap, simpleFrame,
  type Gadget, type GadgetF_, type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import {
  ViewWrapper,
  type Editable, type EntityWrapper, type ModelScript, type ModelScriptAct,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  currentName, entityContents, entityName, entityStampsAsFields, entityVariantProperties, getData, goToEntity1,
  nameText, setData, withStampFields,
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelSubsetSpecifier } from "@/hades/src/Model/Abstract/Properties";
import { runLookup, tableOutput, type HasLookups } from "@/hades/src/Model/Lookups/Base";
import {
  compileMatrix, groupColumns, groupQuery, groupSort, matrixColumnData, matrixColumnName, matrixDefaultInput,
  matrixGroups, matrixInputSet, runMatrix, sortForest,
  type ColumnGroup, type HasMatrices, type Matrix, type MatrixColumn, type MatrixId, type SortOrder,
} from "@/hades/src/Model/Matrices/Base";
import { addFieldDecoration, fieldElement1 } from "@/hades/src/Model/Reflection/Dialogs";
import { fieldType, withBuiltIn, type Field, type FieldId, type Multiplicity } from "@/hades/src/Model/Reflection/Types";
import {
  ExtNone, _ExtText, displayValue, extValue,
  type ExtValue, type ExtensionValues,
} from "@/hades/src/Model/Reflection/Values";
import { runQuery, type Query } from "@/hades/src/Model/Query/Base";
import { clickableEntitySet, compileQueryDiagram, queryDiagram } from "@/hades/src/Model/Query/Diagram";
import { ShowErrorComponent_Text, evaluate, topExpr } from "@/hades/src/Model/Reflection/Parser";
import { forestCatMaybe } from "@/banana-ui/base/Reactive/Banana/Common";

/** The `(Editable p v, EntityClass v, HasLookups v, HasMatrices v)` dictionary. */
export type MatrixScreenClass<P, V> = Editable<P, V> & EntityClass<V> & HasLookups<V> & HasMatrices<V>;

/** The side channel of the matrix gadgets: `ModelScript p v v (Maybe Text)`. */
type MatrixScript<P, V> = ModelScriptAct<P, V, V, Maybe<T.Text>>;

/**
 * A row of the matrix table: `([ModelId], ExtensionValues, ExtensionValues)`. See "getForest".
 */
export type MatrixRow = readonly [readonly ModelId[], ExtensionValues, ExtensionValues];

/** The data edited by the matrix table: the model contents. */
type Store<V> = M.Map<ModelId, Entity<V>>;


/**
 * A Matrix takes inputs of type @i@, but does not output changes to something downstream.
 * Instead it emits model edit scripts via the side channel. The output value is ignored, and
 * is only a function because that is the type required by the "forestEdit" gadget.
 */
export type MatrixGadget<P, V, I> = GadgetF_<Model<V>, ModelScriptAct<P, V, V, Maybe<T.Text>>, I>;


/** If the entity is a matrix then return a wrapper for viewing the matrix. */
export function getMatrixWrapper<P, V>(
  cls: MatrixScreenClass<P, V>,
  _ctx: ModelEditCtx<V, V>,
  ent: Entity<V>,
): Maybe<EntityWrapper<P, V>> {
  const m = preview(entityContents<V>().dot(cls._Matrix), ent);
  if (m.tag === "Nothing") return Nothing;
  return Just(ViewWrapper<P, V, null, S.Set<ModelId>>(
    ent.entityId,          // wrappedEntityId
    "run",                 // viewTag
    view(matrixDefaultInput, m.value),  // viewInitial
    Left(null),            // viewInput
    matrixDisplay(cls, ent.entityId),   // viewGadget
  ));
}


/**
 * Display the matrix results.
 *
 * The @Set ModelId@ is the set of entities used as input to the matrix query. It is input and output
 * so that it can be preserved when the matrix is re-run. The output is a function which can be safely
 * applied to the model contents.
 */
export function matrixDisplay<P, V>(
  cls: MatrixScreenClass<P, V>,
  mId: MatrixId,
): Gadget_<Model<V>, MatrixScript<P, V>, [S.Set<ModelId>, null]> {
  type E = Model<V>;
  type W = MatrixScript<P, V>;
  type Inp = [S.Set<ModelId>, null];
  type W1 = Either<W, [ModelId, (a: MatrixRow) => MatrixRow]>;
  const sorts = (matrix: Matrix): SortOrder[] => view(matrixGroups, matrix).map((g) => view(groupSort, g));
  const variantOk = (matrix: Matrix) => (model: E): ((e: Entity<V>) => boolean) => {
    const variantSet = matrixInputSet(cls, matrix, model);
    return (v) => S.member(cls.reflectiveName(view(entityContents<V>(), v)), variantSet);
  };
  const errorDisplay = (errs: readonly T.Text[]): Gadget_<E, W, Inp> =>
    simpleFrame("Matrix Errors", readOnlyMemo<E, W, Inp>("MemoMedium", true, () => T.intercalate("\n", errs)));
  const updateScript = (x: W1): Maybe<W> => (x.tag === "Left" ? Just(x.value) : Nothing);
    // Individual widgets are responsible for their own edit events.
  const unitSecond = (): Gadget<E, W, Inp, Inp> =>
    gSecond<E, W, null, null, S.Set<ModelId>>(arr<E, W, null, null>(() => null));
  return getInitialEnv<E, W, Inp, Inp>((model1) => {
    const mm = preview(ix<ModelId, Entity<V>>(mId).dot(entityContents<V>()).dot(cls._Matrix), model1.modelContents);
    if (mm.tag === "Nothing") {
      return gDot(unitSecond(), message1<E, W, Inp>("The matrix has been deleted."));
    }
    const matrix = mm.value;
    const compiled = compileMatrix(cls, matrix, model1);
    if (compiled.tag === "Left") return gDot(unitSecond(), errorDisplay(compiled.value));
    const queries = compiled.value;
    // (A lazy `let` in Haskell, only used when the matrix compiles, so it is built here.)
    const headings = matrixTable(cls, model1, matrix);
    // \input ->
    //   let (forest, warns) = getForest queries (sorts matrix) input model1
    //   in proc () -> do
    //     _ <- cond [
    //           PrismaticGadget () _Empty $ arr id,
    //           PrismaticGadget [] id $
    //             readOnlyMemo MemoSmall False (const $ T.intercalate "\n")
    //         ] -< warns
    //     sendMap updateScript $
    //         forestTable headings (const forest) <<< arr modelContents <<< getEnv
    //       -< ()
    const results = (input: S.Set<ModelId>): Gadget<E, W, null, (s: Store<V>) => Store<V>> => {
      const [forest, warns] = getForest(cls, queries, sorts(matrix), input, model1);
      return gPipe(
        gFanout(
          gPipe(
            arr<E, W, null, readonly T.Text[]>(() => warns),
            cond<E, W, readonly T.Text[], readonly T.Text[]>([
              PrismaticGadget(null, _Empty<T.Text>(), arr<E, W, null, null>((x) => x)),
              PrismaticGadget<E, W, readonly T.Text[], readonly T.Text[], readonly T.Text[], readonly T.Text[]>(
                [], identity<readonly T.Text[]>(),
                readOnlyMemo<E, W, readonly T.Text[]>("MemoSmall", false, (_e, ws) => T.intercalate("\n", ws))),
            ]),
          ),
          gId<E, W, null>(),
        ),
        arr<E, W, [readonly T.Text[], null], null>(([, u]) => u),
        sendMap<E, W1, W, null, (s: Store<V>) => Store<V>>(updateScript, gPipe(
          getEnv<E, W1, null>(),
          arr<E, W1, E, Store<V>>((m) => m.modelContents),
          forestTable<E, W, ModelId, Store<V>, MatrixRow>(headings, () => forest),
        )),
      );
    };
    // proc (input1, _) -> do
    //   input2 <- simpleFrame "Matrix inputs" $
    //       modelSubsetSpecifier (variantOk matrix) (const Nothing) -< input1
    //   _ <- exec (\input -> ...) -< (input2, ())
    //   returnA -< (input2, ())
    return gPipe(
      arr<E, W, Inp, S.Set<ModelId>>(([input1]) => input1),
      simpleFrame("Matrix inputs", modelSubsetSpecifier<V, W>(cls, variantOk(matrix), () => Nothing)),
      gFanout(
        gPipe(
          arr<E, W, S.Set<ModelId>, [S.Set<ModelId>, null]>((input2) => [input2, null]),
          exec<E, W, S.Set<ModelId>, null, (s: Store<V>) => Store<V>>(results),
        ),
        gId<E, W, S.Set<ModelId>>(),
      ),
      arr<E, W, [(s: Store<V>) => Store<V>, S.Set<ModelId>], Inp>(([, input2]) => [input2, null]),
    );
  });
}

/** `_Empty` for lists: matches the empty list. */
function _Empty<A>(): Prism<readonly A[], null> {
  return prism_((_: null): readonly A[] => [], (xs: readonly A[]) => (xs.length === 0 ? Just(null) : Nothing));
}


/**
 * Convert the matrix parameters into a table of entities and a forest of lenses to
 * access them. The lenses output a threeple containing:
 *
 * * The ID of the current entity and all the entities to its left.
 *
 * * The editable fields of the current entity.
 *
 * * The union of all the fields (including stamps) for the current entity and its ancestors
 * in the tree. This is read-only and is ignored for updates.
 */
export function getForest<V>(
  cls: EntityClass<V>,
  queries: readonly Query<V>[],
  /** Sort criteria for each level in the forest. */
  sorts: readonly SortOrder[],
  /** Input to the query list. */
  inputs: S.Set<ModelId>,
  /** The static model used to derive the matrix. */
  model: Model<V>,
): [Forest<readonly [ModelId, Lens1<Store<V>, MatrixRow>]>, T.Text[]] {
  const [idForest, warnings] = runMatrix(queries, model, inputs);
  // entForest :: Forest (Entity v)
  const entForest = sortForest(cls, sorts,
    forestCatMaybe(idForest.map((t) => fmapTree((u: ModelId) => M.lookup(u, model.modelContents), t))));
  const ancestors = ancestorize(entForest.map((t) => fmapTree((e: Entity<V>) => e.entityId, t)));  // sorted version
  const variantProps = entityVariantProperties<V>(cls, model);
  // makeLens :: [ModelId] ->
  //   (ModelId, Lens1 (Map ModelId (Entity v)) (ModelId, ExtensionValues, ExtensionValues))
  const makeLens = (ids: readonly ModelId[]): readonly [ModelId, Lens1<Store<V>, MatrixRow>] => {
    const extract1 = (store: Store<V>): MatrixRow => {
      if (ids.length === 0) return [[], M.empty<FieldId, ExtValue>(), M.empty<FieldId, ExtValue>()];
      const i = ids[0];
      const f = (i1: ModelId, evs: ExtensionValues): ExtensionValues =>
        M.union(evs, fromMaybe(M.empty<FieldId, ExtValue>(),
          preview(ix<ModelId, Entity<V>>(i1).dot(variantProps), store)));
      const anc = ids.reduceRight((acc: ExtensionValues, i1: ModelId) => f(i1, acc), M.empty<FieldId, ExtValue>());
        // foldr f mempty ids
      const ent = M.lookup(i, store);
      if (ent.tag === "Just") {
        return [
          ids,
          M.union(view(variantProps, ent.value), entityStampsAsFields(cls, ent.value)),
          M.union(entityStampsAsFields(cls, ent.value), anc),
        ];
      }
      return [ids, M.empty<FieldId, ExtValue>(), anc];
    };
    const update = (store: Store<V>, [, vs]: MatrixRow): Store<V> =>
      (ids.length === 0 ? store : set(ix<ModelId, Entity<V>>(ids[0]).dot(variantProps), vs, store));
    return [fromMaybe(U.nil, listToMaybe(ids)), Lens1(lens(extract1, update))];
  };
  return [ancestors.map((t) => fmapTree(makeLens, t)), warnings];
}

/* Design note:

makeLens.extract1 gets called for every cell every time the model is updated. On large matrices
this makes it slow. However I can't see an easy way of factoring this out.

Also makelens.update appears to be dead code, which is not surprising because updates are done
via the sent data side channel rather than the lens.
*/


/**
 * Replace every node value with a list of the value and its ancestors. The head of each list
 * is the origial value followed by the ancestors going up to the root as the last item.
 */
export function ancestorize<A>(forest: Forest<A>): Forest<A[]> {
  const ancestorizeTree = (ancestors: readonly A[], t: Tree<A>): Tree<A[]> => {
    const allVals = [t.rootLabel, ...ancestors];
    return Node(allVals, ancestorizeForest(allVals, t.subForest));
  };
  const ancestorizeForest = (ancestors: readonly A[], f: Forest<A>): Tree<A[]>[] =>
    f.map((t) => ancestorizeTree(ancestors, t));
  return ancestorizeForest([], forest);
}


/** Generate the table groups for displaying the matrix. */
export function matrixTable<P, V>(
  cls: MatrixScreenClass<P, V>,
  model: Model<V>,
  matrix: Matrix,
): (readonly [T.Text, (readonly [T.Text, MatrixGadget<P, V, MatrixRow>])[]])[] {
  const mkGroup = (grp: ColumnGroup): Maybe<readonly [T.Text, (readonly [T.Text, MatrixGadget<P, V, MatrixRow>])[]]> => {
    const txt = preview(ix<ModelId, Entity<V>>(view(groupQuery, grp)).dot(entityName(cls)).dot(nameText), model.modelContents);
    return txt.tag === "Just"
      ? Just([txt.value, view(groupColumns, grp).map((c) => columnTableField(cls, model, c))] as const)
      : Nothing;
  };
  return mapMaybe(mkGroup, view(matrixGroups, matrix));
}


/** Generate a table column corresponding to a matrix column. */
export function columnTableField<P, V>(
  cls: MatrixScreenClass<P, V>,
  model: Model<V>,
  col: MatrixColumn,
): readonly [T.Text, MatrixGadget<P, V, MatrixRow>] {
  type E = Model<V>;
  type W = MatrixScript<P, V>;
  type R = MatrixRow;
  type G = MatrixGadget<P, V, R>;
  const allFields = withStampFields(withBuiltIn(model.modelFields));
  const constId = (): Gadget<E, W, any, (r: R) => R> => arr<E, W, any, (r: R) => R>(() => (r: R) => r);
  const queryCell = (queryId: ModelId, modelIds: readonly ModelId[]): Either<T.Text[], Gadget_<E, W, readonly ModelId[]>> => {
    // Either monad.
    const queryEnt = M.lookup(queryId, model.modelContents);
    if (queryEnt.tag === "Nothing") return Left(["No such query"]);
    const qd = preview(entityContents<V>().dot(cls._QueryDiagram).dot(queryDiagram<V>()), queryEnt.value);
    if (qd.tag === "Nothing") return Left([view(entityName(cls).dot(nameText), queryEnt.value) + " is not a query"]);
    const query = compileQueryDiagram(cls, model, qd.value);
    if (query.tag === "Left") return query;
    return Right(getInitial<E, W, readonly ModelId[], readonly ModelId[]>((mIds) => {
      const mId = mIds.length === 0 ? S.empty<ModelId>() : S.singleton(mIds[0]);
      const resultSet = runQuery(query.value, modelIds, model, mId)[0];
      // proc mId1 -> do
      //   _ <- clickableEntitySet -< resultSet
      //   returnA -< mId1
      return gPipe(
        gFanout(
          gPipe(arr<E, W, readonly ModelId[], S.Set<ModelId>>(() => resultSet), clickableEntitySet<P, V>(cls)),
          gId<E, W, readonly ModelId[]>(),
        ),
        arr<E, W, [S.Set<ModelId>, readonly ModelId[]], readonly ModelId[]>(([, mId1]) => mId1),
      );
    }));
  };
  const lookupCell = (tableId: ModelId): Maybe<GadgetF_<E, W, ExtensionValues>> => {
    // Maybe monad
    const tbl = preview(ix<ModelId, Entity<V>>(tableId).dot(entityContents<V>()).dot(cls._LookupTable), model.modelContents);
    if (tbl.tag === "Nothing") return Nothing;
    const output = M.lookup(view(tableOutput, tbl.value), model.modelFields);
    if (output.tag === "Nothing") return Nothing;
    return Just(focusing(
      lens((vs: ExtensionValues) => runLookup(tbl.value, vs), (s: ExtensionValues, _v: ExtValue) => s),
        // Read-only so lens setter unused.
      addFieldDecoration<E, W>(view(fieldType, output.value),
        readOnlyText<E, W, ExtValue>((_e, v) => displayValue(v)))));
  };
  const d = view(matrixColumnData, col);
  let g: G;
  switch (d.tag) {
    case "FieldColumn": {
      const dataField = d._0._fieldColumnText, linkField = d._0._fieldColumnLink;
      const fType = M.lookup(dataField, allFields);
      if (fType.tag === "Nothing") {
        g = gDot(constId(), readOnlyMemo<E, W, R>("MemoSmall", false, () => "Unknown or deleted field."));
      } else {
        // proc (mIds, values, _) -> do
        //   let mId = fromMaybe U.nil $ listToMaybe mIds
        //   _ <- fieldColumn fType linkField -< (mId, values)
        //   returnA -< id
        g = gPipe(
          gFanout(
            gPipe(
              arr<E, W, R, readonly [ModelId, ExtensionValues]>(([mIds, values]) =>
                [fromMaybe(U.nil, listToMaybe(mIds)), values]),
              fieldColumn<P, V>(cls, fType.value, linkField),
            ),
            gId<E, W, R>(),
          ),
          constId(),
        );
      }
      break;
    }
    case "ExprColumn": {
      const isMemo = d._0, expr = d._1;
      const parsed = MP.parse(topExpr(cls.entityFunctions, allFields), "", expr);
      let inner: Gadget_<E, W, ExtensionValues>;
      if (parsed.tag === "Right") {
        const textFunc = (vs: ExtensionValues): T.Text => {
          const r = evaluate(parsed.value, vs, model);
          return r.tag === "Left" ? r.value : displayValue(r.value);
        };
        inner = isMemo
          ? readOnlyMemo<E, W, ExtensionValues>("MemoSmall", false, (_e, vs) => textFunc(vs))
          : readOnlyText<E, W, ExtensionValues>((_e, vs) => textFunc(vs));
      } else {
        const msg = T.pack(MP.parseErrorTextPretty(ShowErrorComponent_Text, L.head(parsed.value.bundleErrors)));
        inner = readOnlyMemo<E, W, ExtensionValues>("MemoSmall", false, () => msg);
      }
      g = gPipe(arr<E, W, R, ExtensionValues>(([, , x]) => x), inner, constId());
      break;
    }
    case "QueryColumn": {
      const queryId = d._0;
      // proc (mIds, _, _) -> do
      //   _ <- (getInitial $ \mIds1 -> case queryCell queryId mIds1 of
      //         Left msgs -> readOnlyMemo MemoSmall False $
      //             const $ const $ T.intercalate "\n" msgs
      //         Right cell -> cell)
      //     -< mIds
      //   returnA -< id
      g = gPipe(
        gFanout(
          gPipe(
            arr<E, W, R, readonly ModelId[]>(([mIds]) => mIds),
            getInitial<E, W, readonly ModelId[], readonly ModelId[]>((mIds1) => {
              const r = queryCell(queryId, mIds1);
              return r.tag === "Left"
                ? readOnlyMemo<E, W, readonly ModelId[]>("MemoSmall", false, () => T.intercalate("\n", r.value))
                : r.value;
            }),
          ),
          gId<E, W, R>(),
        ),
        constId(),
      );
      break;
    }
    case "LookupColumn": {
      const tableId = d._0;
      const cell = lookupCell(tableId);
      const inner: GadgetF_<E, W, ExtensionValues> = cell.tag === "Just"
        ? cell.value
        : focusing(identity<ExtensionValues>(), readOnlyText<E, W, ExtensionValues>(() => "Invalid lookup"));
      g = gPipe(arr<E, W, R, ExtensionValues>(([, , x]) => x), inner, constId());
      break;
    }
    default:
      return absurd(d);
  }
  return [view(matrixColumnName, col), g];
}


/** Create a table column for a field in an entity. */
export function fieldColumn<P, V>(
  _cls: EntityClass<V>,
  /** Extension field . */
  typ: Field,
  /** Link field */
  linkField: Maybe<FieldId>,
): MatrixGadget<P, V, readonly [ModelId, ExtensionValues]> {
  type E = Model<V>;
  type W = MatrixScript<P, V>;
  type In = readonly [ModelId, ExtensionValues];
  type UpdateF = (vs: ExtensionValues) => ExtensionValues;
  const optionalExtension: Iso<ExtValue, Maybe<ExtValue>> = iso(
    (x: ExtValue): Maybe<ExtValue> => (x.tag === "ExtNone" ? Nothing : Just(x)),
    (m: Maybe<ExtValue>): ExtValue => fromMaybe(ExtNone, m),
  );
  const multiMod = (multi: Multiplicity, prsm: Prism<ExtValue, T.Text>, g: Gadget<E, W, T.Text, T.Text>): Gadget_<E, W, ExtValue> => {
    switch (multi) {
      case "Optional":
        return prismatic(Nothing, optionalExtension.dot(below(prsm)), optional("", g));
      case "One":
        return prismatic("", prsm, g);
      default:
        return absurd(multi);
    }
  };
  const linkExt = (g: GadgetF_<E, W, ExtensionValues>): GadgetF_<E, W, ExtensionValues> => {
    if (linkField.tag === "Nothing") return g;
    const lfid = linkField.value;
    return linked((vs: ExtensionValues) => preview(ix<FieldId, ExtValue>(lfid).dot(_ExtText), vs), g);
  };
  const fieldGadget: GadgetF_<E, W, ExtensionValues> = linkExt((() => {
    const t = typ._fieldType;
    // Special case for one-line text fields in a matrix to let them be shown folded.
    if (!typ.fieldReadOnly && t.tag === "BuiltInDef" && t._0 === "ModelText") {
      return focusing(extValue<FieldId>(typ.fieldId), multiMod(typ._fieldMulti, _ExtText, displayText<E, W>()));
    }
    // Special case for memo fields to avoid a model update every key press.
    if (!typ.fieldReadOnly && t.tag === "BuiltInDef" && t._0 === "ModelNote") {
      return focusing(extValue<FieldId>(typ.fieldId), multiMod(typ._fieldMulti, _ExtText, displayMemo<E, W>()));
    }
    // Normal case: display the same as any other dialog.
    return fieldElement1<E, W>(false, typ)[1];
  })());
  const updateScript = (mId: ModelId, f: UpdateF): Maybe<W> =>
    Just(function* (ctx: ModelEditCtx<V, V>): ModelScript<P, V, Maybe<T.Text>> {
      goToEntity1(ctx, "That entity has been deleted in the model.", mId);
      const nm = currentName(ctx);
      const oldDat = getData(ctx);
      const change = setData(ctx, f(oldDat));
      return change ? Just("Edited " + nm) : Nothing;
    });
  // proc (mId, vs) -> do
  //   updateF <- fieldGadget -< vs
  //   _ <- send id <<< arr (uncurry updateScript) -< (mId, updateF)
  //   returnA -< id
  return gPipe(
    gFanout(gId<E, W, In>(), gPipe(arr<E, W, In, ExtensionValues>(([, vs]) => vs), fieldGadget)),
    gFanout(
      gPipe(
        arr<E, W, [In, UpdateF], Maybe<W>>(([[mId], updateF]) => updateScript(mId, updateF)),
        send<E, W, Maybe<W>>((x) => x),
      ),
      gId<E, W, [In, UpdateF]>(),
    ),
    arr<E, W, [Maybe<W>, [In, UpdateF]], (i: In) => In>(() => (i: In) => i),
  );
}

/** `below` for "Maybe": lift a prism to work on optional values. */
function below<St, A>(p: Prism<St, A>): Prism<Maybe<St>, Maybe<A>> {
  return prism(
    (ma: Maybe<A>): Maybe<St> => mapMaybeValue((a: A) => review(p, a), ma),
    (ms: Maybe<St>): Either<Maybe<St>, Maybe<A>> => {
      if (ms.tag === "Nothing") return Right(Nothing);
      const r = preview(p, ms.value);
      return r.tag === "Just" ? Right(Just(r.value)) : Left(ms);
    },
  );
}
