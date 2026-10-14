// Ported from hades/src/Model/Report/Dialogs.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Dialogs for designing and running reports.
 *
 * TypeScript port
 * ---------------
 * * Constrained functions take their dictionary first:
 *   `reportDesignGadget(cls, reportId)` and `reportDialogSelector(cls)` with
 *   `cls: ReportDialogClass<V>` (the `(EntityClass v, HasLookups v, HasMatrices v)` dictionary;
 *   `HasMatrices` includes `Queryable`), `reportRunDialog(cls, previewFlag, report)` with
 *   `cls: EntityClass<V> & HasMatrices<V>`, `reportWarningsDialog(cls, warnings)` with
 *   `cls: EntityClass<V>`. `reportDialogSelector(cls)` returns the (uncurried) selector
 *   `(model, fragment) => Maybe<Dialog>`.
 * * The side channel of "reportDesignGadget" carries `ModelEdit v (Report v) (Maybe Text)` values,
 *   i.e. `(ctx: ModelEditCtx<V, Report<V>>) => Maybe<Text>` functions. BasicTypes'
 *   `sendMap (Just . lift . withSubtype (prsm . _BasicReport)) $ reportDesignGadget mId` is
 *   `sendMap((e) => Just(... withSubtype(ctx, prsm.dot(_BasicReport), e) ...), reportDesignGadget(cls, mId))`.
 * * `reportTreeIso<V>()` is a zero-argument generic function (a polymorphic optic).
 * * `ReportFormat` is a tagged union (`ReportHtml(target)`, `ReportDocx(layout, target)`,
 *   `ReportTemplate(template, target)`, positional fields `_0`, `_1`); its derived `Eq` is the
 *   structural `equals`, its derived `Show` is `show_ReportFormat`. The (unexported in Haskell)
 *   prisms `_ReportHtml`, `_ReportDocx`, `_ReportTemplate` are constants.
 *   `ReportRunParameters(target, format)` is a record with the Haskell field names
 *   (`_reportTarget`, `_reportFormat`); the lenses `reportTarget`, `reportFormat` are constants;
 *   `show_ReportRunParameters` is the derived `Show`. File paths are `@/lib/System/IO` virtual
 *   paths, as chosen by the `filePathSelector` gadgets.
 * * The `where`-bound helpers of "reportDesignGadget" ("treeMenu", "addOptions", "reportDelta")
 *   and the input-set helpers of "reportRunDialog" ("topQueryIds", "topQueries",
 *   "queryInputSet", "topMatrixIds", "topMatrices", "matrixInputs", "inputFilter") are
 *   module-level functions here, taking what they close over (dictionary, report ID, report) as
 *   leading arguments, and are exported for the tests only. The remaining `where` bindings stay
 *   local. The fragment dialogs ("reportLiteralDialog" ...) are module-level, unexported, as in
 *   Haskell; they are reached through "reportDialogSelector".
 * * `proc` blocks are desugared with `gPipe`/`gFanout`/`arr`; the originals are kept in comments.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, isJust, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { Node, flatten, type Forest, type Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  _1, _1of3, _2, _2of3, _3, _Just, from, identity, iso, ix, lens, preview, prism, review, view,
  type Iso, type Lens, type Prism,
} from "@/lib/Control/Lens";
import { defaultIso, setMaybeIso } from "@/hades/src/Control/Lens/Hades";
import {
  entityContents, entityName, goToEntity, nameField, nameText, setValue, withStampFields,
  type Entity, type EntityClass, type Model, type ModelEdit, type ModelEditCtx, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelFilter, modelItemSpecifier } from "@/hades/src/Model/Abstract/Properties";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import { SortOrder, matrixInputSet, type HasMatrices, type Matrix } from "@/hades/src/Model/Matrices/Base";
import { sortOrderGadget } from "@/hades/src/Model/Matrices/Design";
import { queryInputs, type QueryDiagram, type Queryable } from "@/hades/src/Model/Query/Diagram";
import { fieldName, fieldNameIso, withBuiltIn, type Field, type FieldId, type FieldName } from "@/hades/src/Model/Reflection/Types";
import type { Variant } from "@/hades/src/Model/Reflection/Values";
import {
  ReportDiagram, ReportField, ReportFieldList, ReportHeading, ReportLiteral, ReportLookup, ReportMatrix,
  SubReport, _ReportField, _ReportFieldList, _ReportHeading, _ReportLiteral, _ReportLookup, _ReportMatrix,
  _SubReport, fragmentDescription, reportDefaultInput, reportDefaultTemplate, reportDescription, reportName,
  reportPageDefault, reportPageOrientation, reportPagePaper, reportSpec, show_ReportOrientation,
  show_ReportPageLayout, show_ReportPaper,
  type Report, type ReportFragment, type ReportOrientation, type ReportPageLayout, type ReportPaper,
} from "@/hades/src/Model/Report/Base";
import {
  ComboItem, Dialog, Enum_Int, FilePathGlob, OkButton, PrismaticGadget, TreeAddAfter, TreeAddBefore,
  TreeAddIn, TreeDelete,
  accum, arr, box, comboBox, filePathSelector, focusing, focusingOver, forestEditor, form, gFanout, gId,
  gPipe, getEnv, getInitial, getInitialEnv, memoBox, message1,
  optionalOver, prismatic, rangeCombo, readOnlyMemo, readOnlyText, send, simpleCombo, simpleFrame,
  simpleTextBox, styled1, table, treeSelector, unionTab, validate,
  type DialogSelector_, type Dialog_, type FilePathFilter, type GadgetF_, type Gadget_, type TreeOper,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { EditCombo, EditFixed, Opt, TableDelete, TableShuffle, mkField } from "@/banana-ui/base/Reactive/Banana/Table";

type Text = T.Text;
type FilePath = string;


/**
 * TypeScript: the `(EntityClass v, HasLookups v, HasMatrices v)` dictionary of
 * "reportDesignGadget" and "reportDialogSelector". (`HasMatrices` includes `Queryable`.)
 */
export type ReportDialogClass<V> = EntityClass<V> & HasLookups<V> & HasMatrices<V>;


// ---------------------------------------------------------------------------------------------
// * Tree Conversion

/**
 * To avoid duplicating almost the exact design of "ReportFragment" this module just stuffs
 * reports into a forest. The only difference is that "SubReport" items have their subreport lists
 * stored as children instead of in the internal field.
 */
export function reportFragmentToTree<V>(frag: ReportFragment<V>): Tree<ReportFragment<V>> {
  if (frag.tag === "SubReport") {
    const query = frag._0, order = frag._1, subreport = frag._2;
    return Node(SubReport<V>(query, order, []), reportFragmentsToForest(subreport));
  }
  return Node(frag, []);
}


export function reportFragmentsToForest<V>(frags: readonly ReportFragment<V>[]): Forest<ReportFragment<V>> {
  return frags.map((f) => reportFragmentToTree(f));
}


export function reportFragmentFromTree<V>(t: Tree<ReportFragment<V>>): ReportFragment<V> {
  const sr = t.rootLabel;
  if (sr.tag === "SubReport") {
    return SubReport<V>(sr._0, sr._1, reportFragmentsFromForest(t.subForest));
  }
  return sr;
}


export function reportFragmentsFromForest<V>(forest: Forest<ReportFragment<V>>): ReportFragment<V>[] {
  return forest.map((t) => reportFragmentFromTree(t));
}

/**
 * ISO for the conversion between report fragments and trees. Not quite a true ISO because the
 * reverse will ignore children of a node that is not a @SubReport@. However the forward followed
 * by the reverse will be an identity.
 */
export function reportTreeIso<V = any>(): Iso<ReportFragment<V>, Tree<ReportFragment<V>>> {
  return iso(
    (frag: ReportFragment<V>) => reportFragmentToTree(frag),
    (t: Tree<ReportFragment<V>>) => reportFragmentFromTree(t),
  );
}


/** Haskell `mapping` (from "Control.Lens") for lists: lift an "Iso" to an "Iso" on lists. */
function mapping<S, A>(i: Iso<S, A>): Iso<readonly S[], readonly A[]> {
  return iso(
    (ss: readonly S[]): readonly A[] => ss.map((s) => view(i, s)),
    (as: readonly A[]): readonly S[] => as.map((a) => review(i, a)),
  );
}


// ---------------------------------------------------------------------------------------------
// * Editing Reports

/** The side-channel type of "reportDesignGadget": `ModelEdit v (Report v) (Maybe Text)`. */
type ReportEdit<V> = ModelEdit<V, Report<V>, Maybe<Text>>;

/** Gadget for designing reports. Emits "ModelEdit" actions which carry undo information. */
export function reportDesignGadget<V>(
  cls: ReportDialogClass<V>,
  reportId: ModelId,
): Gadget_<Model<V>, ReportEdit<V>, [null, Report<V>]> {
  type E = Model<V>;
  type W = ReportEdit<V>;
  type R = Report<V>;
  type Inp = [null, R];
  return getInitial<E, W, Inp, Inp>(([, report1]) => {
    const nm1 = view(reportName<V>().dot(nameText), report1);
    // proc ((), report) -> do
    //     report' <- accum $ box Vertical [[
    //         form Vertical [
    //             ("Name:", focusing (reportName . nameText) simpleTextBox),
    //             ("Description:", focusing reportDescription $ memoBox MemoSmall False),
    //             ("Default Input:", focusing (reportDefaultInput . from setMaybeIso) $
    //                 modelItemSpecifier (const $ const True) (const Nothing)),
    //             ("Default Template:", focusing (reportDefaultTemplate . defaultIso "") $
    //               filePathSelector
    //                   "Report Template Document"
    //                   FilePathOpen
    //                   [("Word documents", [FilePathGlob "*.docx"])]
    //                   False)
    //           ],
    //         focusing (reportSpec . mapping reportTreeIso) $ simpleFrame "Structure" specEdit
    //       ]] -< report
    //     model <- getEnv -< ()
    //     _ <- send (reportDelta nm1) -< (model, report, report')
    //     returnA -< ((), report')
    const editor: Gadget_<E, W, R> = accum(box<E, W, R>("Vertical", [[
      form<E, W, R>("Vertical", [
        ["Name:", focusing(reportName<V>().dot(nameText), simpleTextBox<E, W>())],
        ["Description:", focusing(reportDescription<V>(), memoBox<E, W>("MemoSmall", false))],
        ["Default Input:", focusing(reportDefaultInput<V>().dot(from(setMaybeIso<ModelId>())),
          modelItemSpecifier<V, W>(cls, () => () => true, () => Nothing))],
        ["Default Template:", focusing(reportDefaultTemplate<V>().dot(defaultIso<FilePath>("")),
          filePathSelector<E, W>(
            "Report Template Document",
            "FilePathOpen",
            [["Word documents", [FilePathGlob("*.docx")]]],
            false,
          ))],
      ]),
      focusing(reportSpec<V>().dot(mapping(reportTreeIso<V>())), simpleFrame("Structure", specEdit<V, W>(cls))),
    ]]));
    type Pair = [R, R];
    return gPipe(
      arr<E, W, Inp, R>(([, report]) => report),
      gFanout(gId<E, W, R>(), editor),
      gFanout(gId<E, W, Pair>(), getEnv<E, W, Pair>()),
      gFanout(
        gPipe(
          arr<E, W, [Pair, E], readonly [E, R, R]>(([[report, report2], model]) => [model, report, report2]),
          send<E, W, readonly [E, R, R]>((args) => reportDelta(cls, reportId, nm1, args)),
        ),
        gId<E, W, [Pair, E]>(),
      ),
      arr<E, W, [readonly [E, R, R], [Pair, E]], Inp>(([, [[, report2]]]) => [null, report2]),
    );
  });
}


/**
 * The forest editor for the report structure.
 *
 * (A `where` binding of "reportDesignGadget" in Haskell.)
 */
function specEdit<V, W>(cls: ReportDialogClass<V>): Gadget_<Model<V>, W, Forest<ReportFragment<V>>> {
  return forestEditor<Model<V>, W, ReportFragment<V>>(
    (model, frag) => fragmentDescription(cls, 1000, model, frag),
    treeMenu,
    (frag) => isJust(preview(_SubReport<V>(), frag)),
    Just(reportDialogSelector<V, W>(cls)),
  );
}


/**
 * The context menu of the report structure tree.
 *
 * (A `where` binding of "reportDesignGadget" in Haskell; exported for the tests.)
 */
export function treeMenu<V = any>(item: Maybe<ReportFragment<V>>): Menu<TreeOper<ReportFragment<V>>> {
  type Op = TreeOper<ReportFragment<V>>;
  const opts = addOptions<V>();
  const addBefore = subMenu<Op>("Add before",
    Menu<Op>([opts.map(([txt, v]) => menuItem<Op>(txt, TreeAddBefore(v)))]));
  const addAfter = subMenu<Op>("Add after",
    Menu<Op>([opts.map(([txt, v]) => menuItem<Op>(txt, TreeAddAfter(v)))]));
  if (item.tag === "Just" && item.value.tag === "SubReport") {
    return Menu<Op>([[
      addBefore,
      subMenu<Op>("Add inside",
        Menu<Op>([opts.map(([txt, v]) => menuItem<Op>(txt, TreeAddIn(v)))])),
      addAfter,
      menuItem<Op>("Delete", TreeDelete),
    ]]);
  }
  if (item.tag === "Nothing") {
    return Menu<Op>([opts.map(([txt, v]) => menuItem<Op>(txt, TreeAddAfter(v)))]);
  }
  return Menu<Op>([[
    addBefore,
    addAfter,
    menuItem<Op>("Delete", TreeDelete),
  ]]);
}


/**
 * The kinds of fragment that can be added to a report, with their initial values.
 *
 * (A `where` binding of "reportDesignGadget" in Haskell; exported for the tests.)
 */
export function addOptions<V = any>(): (readonly [Text, ReportFragment<V>])[] {
  return [
    ["Literal", ReportLiteral<V>("")],
    ["Field", ReportField<V>(nameField)],
    ["Field List", ReportFieldList<V>([nameField])],
    ["Heading", ReportHeading<V>(1, "", Just([nameField, ""] as const))],
    ["Diagram", ReportDiagram as ReportFragment<V>],
    ["Matrix", ReportMatrix<V>(Nothing)],
    ["Lookup Table", ReportLookup<V>(Nothing)],
    ["Section", SubReport<V>(Nothing, SortOrder([[nameField, "Ascending"]]), [])],
  ];
}


/**
 * Compare two versions of the report. If they are the same then return Nothing. Otherwise return
 * an update to the second with an appropriate message for the undo history.
 *
 * (A `where` binding of "reportDesignGadget" in Haskell, closing over the report ID, which is the
 * second argument here after the dictionary. Exported for the tests.)
 */
export function reportDelta<V>(
  cls: EntityClass<V>,
  reportId: ModelId,
  oldName: Text,
  [model, r1, r2]: readonly [Model<V>, Report<V>, Report<V>],
): Maybe<ReportEdit<V>> {
  type Ctx = ModelEditCtx<V, Report<V>>;
  if (!equals(view(reportName<V>(), r1), view(reportName<V>(), r2))) {
    return Just((ctx: Ctx) => {
      goToEntity(ctx, reportId);
      void setValue(ctx, r2);
      return Just("Renamed " + oldName);
    });
  }
  if (!equals(view(reportDescription<V>(), r1), view(reportDescription<V>(), r2))) {
    return Just((ctx: Ctx) => {
      goToEntity(ctx, reportId);
      void setValue(ctx, r2);
      return Just("Edited " + oldName + " description");
    });
  }
  if (!equals(view(reportDefaultInput<V>(), r1), view(reportDefaultInput<V>(), r2))) {
    return Just((ctx: Ctx) => {
      goToEntity(ctx, reportId);
      void setValue(ctx, r2);
      return Just("Edited " + oldName + " default input");
    });
  }
  if (!equals(view(reportDefaultTemplate<V>(), r1), view(reportDefaultTemplate<V>(), r2))) {
    return Just((ctx: Ctx) => {
      goToEntity(ctx, reportId);
      void setValue(ctx, r2);
      return Just("Edited " + oldName + " default template");
    });
  }
  if (!equals(view(reportSpec<V>(), r1), view(reportSpec<V>(), r2))) {
    return Just((ctx: Ctx) => {
      const treeL = reportSpec<V>().dot(mapping(reportTreeIso<V>()));
      const ft1 = L.concatMap(flatten, view(treeL, r1));
      const ft2 = L.concatMap(flatten, view(treeL, r2));
      const diff = L.find(
        ([a, b]: [ReportFragment<V>, ReportFragment<V>]) => !equals(a, b),
        L.zip(ft1, ft2),
      );
      const l1 = ft1.length;
      const l2 = ft2.length;
      let changed: Text;
      if (l1 > l2) {  // Somthing deleted from ft1.
        changed = "Deleted " + fragmentDescription(cls, 40, model, diff.tag === "Just" ? diff.value[0] : L.last(ft1));
          // "last" is safe because length ft1 > 0
      } else if (l1 < l2) {  // Something inserted in ft2.
        changed = "Inserted " + fragmentDescription(cls, 40, model, diff.tag === "Just" ? diff.value[1] : L.last(ft2));
      } else {
        changed = diff.tag === "Just"
          ? "Changed " + fragmentDescription(cls, 40, model, diff.value[0])
          : "Changed something";  // Should never happen.
      }
      goToEntity(ctx, reportId);
      void setValue(ctx, r2);
      return Just("Edit " + oldName + ": " + changed);
    });
  }
  return Nothing;
}


export function reportDialogSelector<V, W = any>(
  cls: ReportDialogClass<V>,
): DialogSelector_<Model<V>, W, ReportFragment<V>> {
  return (_model: Model<V>, frag: ReportFragment<V>): Maybe<Dialog_<Model<V>, W, ReportFragment<V>>> => {
    switch (frag.tag) {
      case "ReportLiteral": return Just(reportLiteralDialog<V, W>());
      case "ReportField": return Just(reportFieldDialog<V, W>(cls));
      case "ReportFieldList": return Just(reportFieldListDialog<V, W>(cls));
      case "ReportHeading": return Just(reportHeadingDialog<V, W>(cls));
      case "ReportDiagram": return Nothing;
      case "ReportMatrix": return Just(reportMatrixDialog<V, W>(cls));
      case "ReportLookup": return Just(reportLookupDialog<V, W>(cls));
      case "SubReport": return Just(subReportDialog<V, W>(cls));
      default: return absurd(frag);
    }
  };
}


/** Dialog for the text in a literal fragment. */
function reportLiteralDialog<V, W>(): Dialog_<Model<V>, W, ReportFragment<V>> {
  return Dialog("Literal text", OkButton,
    prismatic("", _ReportLiteral<V>(), memoBox<Model<V>, W>("MemoMedium", true)));
}


/** Dialog for a single field selection. */
function reportFieldDialog<V, W>(cls: EntityClass<V>): Dialog_<Model<V>, W, ReportFragment<V>> {
  void cls;
  const fields = (model: Model<V>): ComboItem<FieldId>[] =>
    L.sortOn((f: Field) => view(fieldName, f), M.elems(withStampFields(withBuiltIn(model.modelFields))))
      .map((f) => ComboItem(view(fieldName, f), Nothing, Nothing, f.fieldId));
  return Dialog("Field contents", OkButton,
    prismatic(nameField, _ReportField<V>(),
      validate((fid: FieldId) => !U.isNil(fid), comboBox<Model<V>, W, FieldId>(fields))));
}

/** Dialog for a list of field selections. */
function reportFieldListDialog<V, W>(cls: EntityClass<V>): Dialog_<Model<V>, W, ReportFragment<V>> {
  type E = Model<V>;
  type FL = readonly FieldId[];
  void cls;
  const validFields = (xs: FL): boolean => (xs.length === 0 ? false : !xs.some((x) => U.isNil(x)));
  const extraIso: Iso<readonly FieldName[], readonly FieldName[]> = iso(
    (xs: readonly FieldName[]): readonly FieldName[] => [...xs, " -?- "],
    (xs: readonly FieldName[]): readonly FieldName[] => xs.filter((x) => T.strip(x) !== "-?-"),
  );
  return Dialog("Field definition list", OkButton,
    prismatic([nameField] as FL, _ReportFieldList<V>(), getInitialEnv<E, W, FL, FL>((model) => {
      const fields = withStampFields(withBuiltIn(model.modelFields));
      const fieldNames = L.sort(M.elems(fields).map((f) => view(fieldName, f)));
      const fieldTable = table<E, W, FieldName>(
        [TableDelete, TableShuffle],
        [mkField<FieldName, FieldName>("Field", identity<FieldName>(), Nothing, EditCombo(fieldNames), Nothing)],
        Nothing,
      );
      return validate(validFields, accum(focusing(fieldNameIso(fields).dot(extraIso), fieldTable)));
    })));
}


type HeadingRest = Maybe<readonly [FieldId, Text]>;
type HeadingData = readonly [number, Text, HeadingRest];

function reportHeadingDialog<V, W>(cls: EntityClass<V>): Dialog_<Model<V>, W, ReportFragment<V>> {
  type E = Model<V>;
  type FT = readonly [FieldId, Text];
  void cls;
  const fields = (model: Model<V>): ComboItem<FieldId>[] =>
    M.elems(withStampFields(withBuiltIn(model.modelFields)))
      .map((f) => ComboItem(view(fieldName, f), Nothing, Nothing, f.fieldId));
  return Dialog("Heading", OkButton, prismatic([1, "", Nothing] as HeadingData, _ReportHeading<V>(),
    accum(box<E, W, HeadingData>("Vertical", [[
      form<E, W, HeadingData>("Vertical", [
        ["Level:", focusing(_1of3<number, Text, HeadingRest>(), rangeCombo<E, W, number>(Enum_Int, [1, 5]))],
        ["Text 1:", focusing(_2of3<number, Text, HeadingRest>(), simpleTextBox<E, W>())],
      ]),
      focusingOver(_3<number, Text, HeadingRest>(), optionalOver([nameField, ""] as FT, form<E, W, FT>("Vertical", [
        ["Field:", focusing(_1<FieldId, Text>(),
          validate((fid: FieldId) => !U.isNil(fid), comboBox<E, W, FieldId>(fields)))],
        ["Text 2:", focusing(_2<FieldId, Text>(), simpleTextBox<E, W>())],
      ]))),
    ]]))));
}


function reportMatrixDialog<V, W>(cls: EntityClass<V> & HasMatrices<V>): Dialog_<Model<V>, W, ReportFragment<V>> {
  return Dialog("Select a matrix", OkButton,
    prismatic(S.empty<ModelId>(), _ReportMatrix<V>().dot(from(setMaybeIso<ModelId>())),
      validate((s: S.Set<ModelId>) => S.size(s) > 0,
        treeSelector<Model<V>, W, ModelId>((model) => modelFilter(cls,
          (e: Entity<V>) => isJust(preview(entityContents<V>().dot(cls._Matrix), e)), model)))));
}


function reportLookupDialog<V, W>(cls: EntityClass<V> & HasLookups<V>): Dialog_<Model<V>, W, ReportFragment<V>> {
  return Dialog("Select a lookup table", OkButton,
    prismatic(S.empty<ModelId>(), _ReportLookup<V>().dot(from(setMaybeIso<ModelId>())),
      validate((s: S.Set<ModelId>) => S.size(s) > 0,
        treeSelector<Model<V>, W, ModelId>((model) => modelFilter(cls,
          (e: Entity<V>) => isJust(preview(entityContents<V>().dot(cls._LookupTable), e)), model)))));
}


type SubReportData<V> = readonly [Maybe<ModelId>, SortOrder, readonly ReportFragment<V>[]];

function subReportDialog<V, W>(cls: EntityClass<V> & Queryable<V>): Dialog_<Model<V>, W, ReportFragment<V>> {
  type E = Model<V>;
  type SR = SubReportData<V>;
  type Frags = readonly ReportFragment<V>[];
  type F = (sr: SR) => SR;
  // proc frag -> do
  //   r <- box Vertical [[
  //         simpleFrame "Section query" $
  //           focusing (_1 . from setMaybeIso) $
  //           validate ((1 ==) . S.size) $
  //           treeSelector $ modelFilter $ isJust .  preview (entityContents . _QueryDiagram),
  //         simpleFrame "Section ordering" $ focusingOver _2 sortOrderGadget
  //       ]]
  //     -< frag
  //   _ <- message1 "The children of this item will be added to the report once for \
  //           \each result of the query."
  //     -< ()
  //   returnA -< r
  const body: GadgetF_<E, W, SR> = gPipe(
    gFanout(
      box<E, W, SR>("Vertical", [[
        simpleFrame("Section query",
          focusing(_1of3<Maybe<ModelId>, SortOrder, Frags>().dot(from(setMaybeIso<ModelId>())),
            validate((s: S.Set<ModelId>) => 1 === S.size(s),
              treeSelector<E, W, ModelId>((model) => modelFilter(cls,
                (e: Entity<V>) => isJust(preview(entityContents<V>().dot(cls._QueryDiagram), e)), model))))),
        simpleFrame("Section ordering", focusingOver(_2of3<Maybe<ModelId>, SortOrder, Frags>(), sortOrderGadget<V, W>(cls))),
      ]]),
      gPipe(
        arr<E, W, SR, null>(() => null),
        message1<E, W, null>("The children of this item will be added to the report once for " +
          "each result of the query."),
      ),
    ),
    arr<E, W, [F, null], F>(([r]) => r),
  );
  return Dialog("Report Section", OkButton,
    prismatic([Nothing, SortOrder([[nameField, "Ascending"]]), []] as SR, _SubReport<V>(), accum(body)));
}


// ---------------------------------------------------------------------------------------------
// * Running Reports

/** Format the diagram is to be generated in. */
export type ReportFormat =
  /** Destination file name. */
  | { readonly tag: "ReportHtml"; readonly _0: FilePath }
  /** Page layout and destination file name. */
  | { readonly tag: "ReportDocx"; readonly _0: ReportPageLayout; readonly _1: FilePath }
  /** Template and destination file names. */
  | { readonly tag: "ReportTemplate"; readonly _0: FilePath; readonly _1: FilePath };

/** Destination file name. */
export function ReportHtml(_0: FilePath): ReportFormat {
  return { tag: "ReportHtml", _0 };
}
/** Page layout and destination file name. */
export function ReportDocx(_0: ReportPageLayout, _1: FilePath): ReportFormat {
  return { tag: "ReportDocx", _0, _1 };
}
/** Template and destination file names. */
export function ReportTemplate(_0: FilePath, _1: FilePath): ReportFormat {
  return { tag: "ReportTemplate", _0, _1 };
}

/** Derived `instance Show ReportFormat`. */
export function show_ReportFormat(f: ReportFormat): string {
  switch (f.tag) {
    case "ReportHtml": return "ReportHtml " + T.showText(f._0);
    // The Show instance of ReportPageLayout is hand-written (no parentheses).
    case "ReportDocx": return "ReportDocx " + show_ReportPageLayout(f._0) + " " + T.showText(f._1);
    case "ReportTemplate": return "ReportTemplate " + T.showText(f._0) + " " + T.showText(f._1);
    default: return absurd(f);
  }
}

export const _ReportHtml: Prism<ReportFormat, FilePath> = prism(
  (p: FilePath) => ReportHtml(p),
  (v: ReportFormat): Either<ReportFormat, FilePath> => (v.tag === "ReportHtml" ? Right(v._0) : Left(v)),
);

export const _ReportDocx: Prism<ReportFormat, readonly [ReportPageLayout, FilePath]> = prism(
  ([l, p]: readonly [ReportPageLayout, FilePath]) => ReportDocx(l, p),
  (v: ReportFormat): Either<ReportFormat, readonly [ReportPageLayout, FilePath]> =>
    (v.tag === "ReportDocx" ? Right([v._0, v._1] as const) : Left(v)),
);

export const _ReportTemplate: Prism<ReportFormat, readonly [FilePath, FilePath]> = prism(
  ([t, p]: readonly [FilePath, FilePath]) => ReportTemplate(t, p),
  (v: ReportFormat): Either<ReportFormat, readonly [FilePath, FilePath]> =>
    (v.tag === "ReportTemplate" ? Right([v._0, v._1] as const) : Left(v)),
);


export interface ReportRunParameters {
  readonly _reportTarget: S.Set<ModelId>;
  readonly _reportFormat: ReportFormat;
}
export function ReportRunParameters(_reportTarget: S.Set<ModelId>, _reportFormat: ReportFormat): ReportRunParameters {
  return { _reportTarget, _reportFormat };
}

/** Derived `instance Show ReportRunParameters`. */
export function show_ReportRunParameters(p: ReportRunParameters): string {
  return "ReportRunParameters {_reportTarget = fromList [" + S.toList(p._reportTarget).join(",") +
    "], _reportFormat = " + show_ReportFormat(p._reportFormat) + "}";
}

export const reportTarget: Lens<ReportRunParameters, S.Set<ModelId>> =
  lens((s: ReportRunParameters) => s._reportTarget, (s, x: S.Set<ModelId>) => ({ ...s, _reportTarget: x }));

export const reportFormat: Lens<ReportRunParameters, ReportFormat> =
  lens((s: ReportRunParameters) => s._reportFormat, (s, f: ReportFormat) => ({ ...s, _reportFormat: f }));


/** Default value for "ReportRunParameters" in dialogs. */
export function reportRunDefault<V>(rpt: Report<V>): ReportRunParameters {
  const t = view(reportDefaultTemplate<V>(), rpt);
  return ReportRunParameters(
    view(reportDefaultInput<V>().dot(from(setMaybeIso<ModelId>())), rpt),
    t.tag === "Nothing" ? ReportDocx(reportPageDefault, "") : ReportTemplate(t.value, ""),
  );
}


/** `nullLens :: Lens' a ()` (a `where` binding of "reportRunDialog"). */
function nullLens<A>(): Lens<A, null> {
  return lens((_s: A) => null, (s: A, _v: null) => s);
}

/** Dialog for running a report. */
export function reportRunDialog<V>(
  cls: EntityClass<V> & HasMatrices<V>,
  /** True means report is preview only. */
  previewFlag: boolean,
  report: Report<V>,
): Dialog_<Model<V>, null, ReportRunParameters> {
  type E = Model<V>;
  type W = null;
  type P = ReportRunParameters;
  const contentItems: GadgetF_<E, W, P> = form<E, W, P>("Vertical", [
    ["Report name:",
      focusing(nullLens<P>(),
        readOnlyText<E, W, null>(() => view(reportName<V>().dot(nameText), report)))],
    ["Description:",
      focusing(nullLens<P>(),
        readOnlyMemo<E, W, null>("MemoSmall", true, () => view(reportDescription<V>(), report)))],
    ["Input:",
      focusing(reportTarget,
        validate((s: S.Set<ModelId>) => !S.null(s),
          modelItemSpecifier<V, W>(cls, (model) => inputFilter(cls, report, model), () => Nothing)))],
  ]);
  // Target word file selector
  const docxFilter: readonly FilePathFilter[] = [["Word documents", [FilePathGlob("*.docx")]]];
  const htmlFilter: readonly FilePathFilter[] = [["HTML documents", [FilePathGlob("*.html"), FilePathGlob("*.htm")]]];
  const templateDocx = (): Gadget_<E, W, FilePath> =>
    validate((p: FilePath) => p !== "",
      filePathSelector<E, W>("Word document for template", "FilePathOpen", docxFilter, false));
  const outputDocx = (): Gadget_<E, W, FilePath> =>
    validate((p: FilePath) => p !== "", filePathSelector<E, W>("Word document to create", "FilePathSave", docxFilter, true));
  const outputHtml = (): Gadget_<E, W, FilePath> =>
    validate((p: FilePath) => p !== "", filePathSelector<E, W>("HTML document to create", "FilePathSave", htmlFilter, true));
  type DocxData = readonly [ReportPageLayout, FilePath];
  type TemplateData = readonly [FilePath, FilePath];
  // outputItems :: GadgetF' e w ReportRunParameters
  const outputItems: GadgetF_<E, W, P> = styled1("reportParameters", focusing(reportFormat, unionTab<E, W, ReportFormat, ReportFormat>([
    ["New Word document", PrismaticGadget([reportPageDefault, ""] as DocxData, _ReportDocx,
      accum(form<E, W, DocxData>("Vertical", [
        ["Paper", focusing(_1<ReportPageLayout, FilePath>().dot(reportPagePaper),
          simpleCombo<E, W, ReportPaper>(["Letter", "A3", "A4"], show_ReportPaper))],
        ["Orientation", focusing(_1<ReportPageLayout, FilePath>().dot(reportPageOrientation),
          simpleCombo<E, W, ReportOrientation>(["Portrait", "Landscape"], show_ReportOrientation))],
        ["Output document", focusing(_2<ReportPageLayout, FilePath>(), outputDocx())],
      ])))],
    ["From Word template", PrismaticGadget(["", ""] as TemplateData, _ReportTemplate,
      accum(form<E, W, TemplateData>("Vertical", [
        ["Template document", focusing(_1<FilePath, FilePath>(), templateDocx())],
        ["Output document", focusing(_2<FilePath, FilePath>(), outputDocx())],
      ])))],
    ["HTML for Web", PrismaticGadget("" as FilePath, _ReportHtml,
      accum(form<E, W, FilePath>("Vertical", [
        ["Output document", focusing(identity<FilePath>(), outputHtml())],
      ])))],
  ])));
  return Dialog("Run Report", OkButton, accum(
    previewFlag
      ? contentItems
      : box<E, W, P>("Vertical", [[
        simpleFrame("Report Target", contentItems),
        simpleFrame("Output Format", outputItems),
      ]]),
  ));
}


// The input set for the report is the union of the input sets of the top level section
// queries and any matrices which appear in the top level.
//
// (The following functions are `where` bindings of "reportRunDialog" in Haskell, closing over
// the report, which is an argument here. Exported for the tests.)

export function topQueryIds<V>(report: Report<V>): ModelId[] {
  return mapMaybe(
    (frag: ReportFragment<V>) => preview(_SubReport<V>().dot(_1of3<Maybe<ModelId>, SortOrder, readonly ReportFragment<V>[]>()).dot(_Just<ModelId>()), frag),
    view(reportSpec<V>(), report),
  );
}

export function topQueries<V>(cls: EntityClass<V> & Queryable<V>, report: Report<V>, model: Model<V>): QueryDiagram<V>[] {
  return mapMaybe(
    (mId: ModelId) => preview(ix<ModelId, Entity<V>>(mId).dot(entityContents<V>()).dot(cls._QueryDiagram), model.modelContents),
    topQueryIds(report),
  );
}

export function queryInputSet<V>(cls: EntityClass<V> & Queryable<V>, report: Report<V>, model: Model<V>): S.Set<Variant<V>> {
  return topQueries(cls, report, model).reduceRight(
    (acc: S.Set<Variant<V>>, q: QueryDiagram<V>) => S.union(view(queryInputs<V>(), q), acc),
    S.empty<Variant<V>>(),
  );
}

export function topMatrixIds<V>(report: Report<V>): ModelId[] {
  return mapMaybe(
    (frag: ReportFragment<V>) => preview(_ReportMatrix<V>().dot(_Just<ModelId>()), frag),
    view(reportSpec<V>(), report),
  );
}

export function topMatrices<V>(cls: EntityClass<V> & HasMatrices<V>, report: Report<V>, model: Model<V>): Matrix[] {
  return mapMaybe(
    (mId: ModelId) => preview(ix<ModelId, Entity<V>>(mId).dot(entityContents<V>()).dot(cls._Matrix), model.modelContents),
    topMatrixIds(report),
  );
}

export function matrixInputs<V>(cls: EntityClass<V> & HasMatrices<V>, report: Report<V>, model: Model<V>): S.Set<Variant<V>> {
  return topMatrices(cls, report, model).reduceRight(
    (acc: S.Set<Variant<V>>, m: Matrix) => S.union(matrixInputSet(cls, m, model), acc),
    S.empty<Variant<V>>(),
  );
}

export function inputFilter<V>(
  cls: EntityClass<V> & HasMatrices<V>,
  report: Report<V>,
  model: Model<V>,
): (e: Entity<V>) => boolean {
  const inputSet = S.union(matrixInputs(cls, report, model), queryInputSet(cls, report, model));
  return S.null(inputSet)
    ? () => true
    : (e: Entity<V>) => S.member(cls.reflectiveName(view(entityContents<V>(), e)), inputSet);
}


/** Dialog for report warnings. Displays a non-editable table of warnings. */
export function reportWarningsDialog<V>(
  cls: EntityClass<V>,
  warnings: readonly (readonly [ModelId, Text])[],
): Dialog_<Model<V>, null, null> {
  type E = Model<V>;
  type W = null;
  type Row = readonly [Maybe<Text>, Text];
  const tbl = [
    mkField<Row, Maybe<Text>>("Entity", _1<Maybe<Text>, Text>(), Nothing, Opt(EditFixed((t: Text) => t)), Nothing),
    mkField<Row, Text>("Message", _2<Maybe<Text>, Text>(), Nothing, EditFixed((t: Text) => t), Nothing),
  ];
  // proc () -> do
  //   model <- getEnv -< ()
  //   let tblDat = map (_1 %~ (\k -> modelContents model ^? ix k . entityName . nameText)) warnings
  //   _ <- table [] tbl Nothing -< tblDat
  //   returnA -< ()
  return Dialog("Report Warnings", OkButton, gPipe(
    getEnv<E, W, null>(),
    arr<E, W, E, readonly Row[]>((model) => warnings.map(([k, msg]): Row => [
      preview(ix<ModelId, Entity<V>>(k).dot(entityName<V>(cls)).dot(nameText), model.modelContents),
      msg,
    ])),
    table<E, W, Row>([], tbl, Nothing),
    arr<E, W, readonly Row[], null>(() => null),
  ));
}
