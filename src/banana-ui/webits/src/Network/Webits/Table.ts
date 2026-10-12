// Ported from banana-ui/webits/src/Network/Webits/Table.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Implements "Reactive.Banana.Table" in Webits using the <https://appendgrid.apphb.com AppendGrid>
 * JavaScript plugin.
 *
 * TypeScript port
 * ---------------
 * * Follows `Network/Webits` (see its header and porting-notes/w1.md): `Elmer` functions take the
 *   `ElmerEnv` first (`mkTableWebit(env, editFlags, spec, initial)`), STM is
 *   `@/lib/Control/Concurrent/STM`, `Eq row` is the structural `equals`.
 * * `FromJSON` instances are parser dictionaries `FromJSON_TableIconClick`,
 *   `FromJSON_TableRowOp`; `deriving Show` of `TableIconClick` is `show_TableIconClick`.
 * * `TableRowOp` is a tagged union with constructor functions `TableRowInsert(n)`,
 *   `TableRowDelete(n)`, `TableRowSwap(n)`.
 * * The AppendGrid library is the bundled UMD build, loaded as the global `AppendGrid` by
 *   `elmerScotty` (see `Network/Webits`); the JavaScript text pushed to it is the original's.
 * * The setter returned by `fieldToColumn` stays curried (`(j) => (row) => row`), because it is
 *   partially applied as in Haskell.
 * * Faithfully kept quirks of the original (see porting-notes/w2.md): an icon chosen from the icon
 *   menu is first written into row number /column number/ (corrected by the edit event that
 *   follows); edits of `EditEnum` and `Opt EditBool` columns are ignored, because the browser
 *   reports a @select@ value as a string; the icon of a table opened with clicks has a broken
 *   @onclick@ handler.
 */
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, fromMaybe, isJust, mapMaybeValue, catMaybes, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { isDigit } from "@/lib/Data/Char";
import { error, newIORef, readInt } from "@/lib/Prelude";
import {
  identity,
  iso,
  ixList,
  preview,
  prism,
  prism_,
  review,
  set,
  withPrism,
  type Prism,
} from "@/lib/Control/Lens";
import {
  atomically,
  dupTChan,
  newBroadcastTChanIO,
  newTChanIO,
  newTVarIO,
  orElse,
  readTChan,
  readTVar,
  writeTChan,
  writeTVar,
  atomicallySync,
  type TChan,
  type TVar,
} from "@/lib/Control/Concurrent/STM";
import {
  call,
  command,
  constructor,
  delete_ as jsDelete,
  send,
  seqRemote,
  value,
  var_,
  type JavaScript,
  type RemoteMonad,
  type RemoteValue,
} from "@/lib/Network/JavaScript";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import type { TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import {
  addWebitChannel,
  deleteWebit,
  elmerDaemon,
  elmerSend,
  getIconChoice,
  htmlValue,
  jsValue,
  makeWebitContainer,
  makeWebitContainer1,
  showWebit,
  webitEventData,
  Webit,
  WebitClass_WebitContainer,
  type Elmer,
  type ElmerEnv,
  type WebitContainer,
  type WebitId,
} from "@/banana-ui/webits/src/Network/Webits";
import { iconFromUrl, iconIso, iconUrl } from "@/banana-ui/webits/src/Network/Webits/Icons";
import type { FieldEditor, Table, TableEditing, TableField } from "@/banana-ui/base/Reactive/Banana/Table";
import { EditEnum } from "@/banana-ui/base/Reactive/Banana/Table";
import { colourPrism, datePrism, prismToMaybe } from "@/banana-ui/base/Reactive/Banana/Common";

/** @AppendGrid@ JavaScript objects. */
export interface WebitTable<A> {
  readonly wtRoot: WebitContainer;
  readonly wtGrid: RemoteValue<WebitTable<A>>;
}
export function WebitTable<A>(wtRoot: WebitContainer, wtGrid: RemoteValue<WebitTable<A>>): WebitTable<A> {
  return { wtRoot, wtGrid };
}

export interface TableIconClick {
  /** Full URL of clicked icon. */
  readonly tableIconSrc: T.Text;
  readonly tableIconColumn: T.Text;
  readonly tableIconIndex: number;
}
export function TableIconClick(tableIconSrc: T.Text, tableIconColumn: T.Text, tableIconIndex: number): TableIconClick {
  return { tableIconSrc, tableIconColumn, tableIconIndex };
}

/** `deriving Show` for TableIconClick. */
export function show_TableIconClick(c: TableIconClick): string {
  return (
    "TableIconClick {tableIconSrc = " + T.showText(c.tableIconSrc) +
    ", tableIconColumn = " + T.showText(c.tableIconColumn) +
    ", tableIconIndex = " + String(c.tableIconIndex) + "}"
  );
}

/** `instance FromJSON TableIconClick` */
export const FromJSON_TableIconClick: J.FromJSON<TableIconClick> = {
  parseJSON: (v) =>
    J.withObject(
      "Table icon click",
      (o) => TableIconClick(iconFromUrl(J.field(o, "src", J.textJ)), J.field(o, "col", J.textJ), J.field(o, "idx", J.intJ)),
      v,
    ),
};

/**
 * The JSON value is a record with @op@ being @insert@, @delete@ or @swap@, and @n@ being
 * the index value.
 */
export type TableRowOp =
  /** The index of the new row. */
  | { readonly tag: "TableRowInsert"; readonly _0: number }
  /** The index of the deleted row. */
  | { readonly tag: "TableRowDelete"; readonly _0: number }
  /** The index of the first row, swapped with it's successor. */
  | { readonly tag: "TableRowSwap"; readonly _0: number };

/** The index of the new row. */
export function TableRowInsert(_0: number): TableRowOp {
  return { tag: "TableRowInsert", _0 };
}
/** The index of the deleted row. */
export function TableRowDelete(_0: number): TableRowOp {
  return { tag: "TableRowDelete", _0 };
}
/** The index of the first row, swapped with it's successor. */
export function TableRowSwap(_0: number): TableRowOp {
  return { tag: "TableRowSwap", _0 };
}

/** `instance FromJSON TableRowOp` */
export const FromJSON_TableRowOp: J.FromJSON<TableRowOp> = {
  parseJSON: (v) =>
    J.withObject(
      "Table row op",
      (o) => {
        const op1 = J.field(o, "op", J.stringJ);
        const n = J.fieldDefault(o, "n", J.intJ, 0);
        switch (op1) {
          case "insert":
            return TableRowInsert(n);
          case "delete":
            return TableRowDelete(n);
          case "swap":
            return TableRowSwap(n);
          default:
            return J.fail("Unrecognised table op: " + T.showText(op1));
        }
      },
      v,
    ),
};

/** Haskell `splitAt`: a negative count splits at 0. */
function splitAt<A>(n: number, xs: readonly A[]): [A[], A[]] {
  const k = Math.max(0, n);
  return [xs.slice(0, k), xs.slice(k)];
}

/**
 * Apply the table row operation to the list. The first argument is the value to insert. If
 * it is @Nothing@ then insertion is ignored.
 */
export function applyTableRowOp<A>(d: Maybe<A>, op: TableRowOp, xs: readonly A[]): A[] {
  switch (op.tag) {
    case "TableRowInsert": {
      if (d.tag === "Nothing") return xs.slice();
      const [xs1, xs2] = splitAt(op._0, xs);
      return [...xs1, d.value, ...xs2];
    }
    case "TableRowDelete": {
      const [xs1, xs2] = splitAt(op._0, xs);
      return [...xs1, ...xs2.slice(1)];
    }
    case "TableRowSwap": {
      const [xs1, xs2] = splitAt(op._0, xs);
      if (xs2.length >= 2) {
        const [x1, x2, ...xs3] = xs2;
        return [...xs1, x2, x1, ...xs3];
      }
      return [...xs1, ...xs2];
    }
  }
}

/** lens-aeson `_Integral` (`_Number . iso floor fromIntegral`). */
function _Integral(): Prism<J.Value, number> {
  return J._Number().dot(iso((x: number) => Math.floor(x), (n: number) => n));
}

/**
 * Convert a table field to a triple of:
 *
 * * A JSON object representing the AppendGrid column type.
 *
 * * A getter for extracting the JSON for this column from a Haskell @row@. This needs to be
 * inserted into an 'Object' along with the rest of the columns to generate a JSON row record.
 *
 * * A setter for updating the associated Haskell value from the JSON row record.
 */
export function fieldToColumn<Row, A>(
  /**
   * If the field is an icon then this webit will get the IconClick events. It should
   * react by putting up the 'iconMenu'.
   */
  wId: WebitId,
  /** When @True@, add a @click@ event to the column that sends the column and index. */
  clickFlag: boolean,
  grid: RemoteValue<WebitTable<Row>>,
  /** Column number (used for identification) */
  colNum: number,
  tf: TableField<Row, A>,
): [JavaScript, (row: Row) => J.Value, (j: J.Value) => (row: Row) => Row] {
  // `if clickFlag then HA.readonly "1" else mempty`
  const readonlyIf = (): H.Attribute[] => (clickFlag ? [HA.readonly("1")] : []);
  const onchangeSend = (): H.Attribute => HA.onchange(jsValue(jsSendChange(wId, grid)));
  const fieldHtml = (fe: FieldEditor<any>): H.Html => {
    switch (fe.tag) {
      case "EditBool":
        return clickFlag
          ? H.with_(
              H.input(),
              HA.type_("checkBox"),
              HA.onchange(jsValue("this.checked=!this.checked;")), // Simulate read-only
              HA.readonly("1"),
            )
          : H.with_(H.input(), HA.type_("checkbox"), onchangeSend());
      case "EditEntry":
        return H.with_(H.input(), HA.type_("text"), onchangeSend(), ...readonlyIf());
      case "EditNote":
        return H.with_(H.textarea(""), HA.rows("3"), HA.cols("20"), onchangeSend(), ...readonlyIf());
      case "EditEnum": {
        const f = fe._0;
        return H.with_(
          H.select(H.mconcat_Html(fe._1.map((x: any, n: number) => H.with_(H.option(H.text(f(x))), HA.value(H.toValue(n)))))),
          onchangeSend(),
          ...readonlyIf(),
        );
      }
      case "EditDate":
        return H.with_(H.input(), HA.type_("date"), onchangeSend(), ...readonlyIf());
      case "EditColour":
        return H.with_(H.input(), HA.type_("color"), onchangeSend(), ...readonlyIf());
      case "EditIcon":
        return tableIcon(clickFlag, wId, grid, colNum);
      case "EditCombo":
        return H.with_(
          H.select(H.mconcat_Html(fe._0.map((str) => H.with_(H.option(H.text(str)), HA.value(H.textValue(str)))))),
          onchangeSend(),
          ...readonlyIf(),
        );
      case "EditFixed":
        return H.with_(H.input(), HA.type_("text"), HA.readonly("1"), onchangeSend());
      case "Opt": {
        const inner = fe._0;
        switch (inner.tag) {
          case "EditBool":
            return H.with_(
              H.select(
                H.with_(H.option(H.text("")), HA.value("null")),
                H.with_(H.option(H.text("Yes")), HA.value("true")),
                H.with_(H.option(H.text("No")), HA.value("false")),
              ),
              onchangeSend(),
              ...readonlyIf(),
            );
          case "EditEntry":
            return H.with_(H.input(), HA.type_("text"), onchangeSend(), ...readonlyIf());
          case "EditNote":
            return H.with_(H.textarea(""), HA.rows("3"), HA.cols("20"), onchangeSend(), ...readonlyIf());
          case "EditEnum": {
            const f = inner._0;
            return fieldHtml(
              EditEnum((m: Maybe<any>) => (m.tag === "Nothing" ? "" : f(m.value)), [Nothing, ...inner._1.map((x: any) => Just(x))]),
            );
          }
          case "EditDate":
            return H.with_(H.input(), HA.type_("date"), onchangeSend(), ...readonlyIf());
          case "EditColour":
            return H.with_(H.input(), HA.type_("color"), onchangeSend(), ...readonlyIf());
          case "EditIcon":
            return tableIcon(clickFlag, wId, grid, colNum);
          case "EditCombo":
            return H.with_(
              H.select(
                H.with_(H.option(H.text("")), HA.value("null")),
                ...inner._0.map((str) => H.with_(H.option(H.text(str)), HA.value(H.textValue(str)))),
              ),
              onchangeSend(),
              ...readonlyIf(),
            );
          case "EditFixed":
            return H.with_(H.input(), HA.type_("text"), HA.readonly("1"));
          case "Opt":
            return error("fieldToColumn: Nested Opt not supported in FieldEditor type.");
        }
      }
    }
  };
  const fieldPrism = (fe: FieldEditor<any>): Prism<J.Value, any> => {
    switch (fe.tag) {
      case "EditBool":
        return J._Bool();
      case "EditEntry":
        return J._String().dot(fe._0);
      case "EditNote":
        return J._String();
      case "EditEnum": {
        const xs = fe._1;
        const fwd = xs;
        const bwd = M.fromList(xs.map((x: any, n: number): [any, number] => [x, n]));
        const prsm = prism_(
          (x: any) => fromMaybe(0, M.lookup(x, bwd)),
          (n: number) => (Number.isInteger(n) && n >= 0 && n < fwd.length ? Just(fwd[n]) : Nothing),
        );
        return _Integral().dot(prsm);
      }
      case "EditDate":
        return J._String().dot(datePrism("%Y-%m-%d"));
      case "EditColour":
        return J._String().dot(colourPrism);
      case "EditIcon":
        return J._String().dot(iconIso);
      case "EditCombo":
        return J._String();
      case "EditFixed":
        return J._String().dot(prism_(fe._0, (_: T.Text) => Nothing));
      case "Opt": {
        const inner = fe._0;
        if (inner.tag === "EditEntry") return J._String().dot(prismToMaybe(inner._0));
        if (inner.tag === "EditNote") return J._String().dot(prismToMaybe(identity<T.Text>()));
        return nullIsNothing(fieldPrism(inner));
      }
    }
  };
  const fieldJS = (fe: FieldEditor<any>): JavaScript => {
    if (fe.tag === "EditBool") return "checked";
    if (fe.tag === "EditIcon") return "attributes.src.value";
    if (fe.tag === "Opt" && fe._0.tag === "EditIcon") return "attributes.src.value";
    return "value";
  };

  const fPrsm = fieldPrism(tf.fieldEditor);
  const hasIcon = isJust(tf.fieldIcon);
  const fieldIdx = hasIcon ? 1 : 0;
  const customHtml: H.Html = H.mconcat_Html([
    hasIcon ? H.with_(H.img(), HA.class_("icon-inline"), HA.src("")) : H.mempty_Html,
    fieldHtml(tf.fieldEditor),
  ]);
  const customBuilder: JavaScript = clickFlag
    ? "function (parent, idPrefix, name, uniqueIndex) {" +
      'let controlId=idPrefix+"_"+name+"_"+uniqueIndex;' +
      "parent.onclick=function (e) {" +
      webitEventData(wId, var_(grid) + ".getRowIndex(uniqueIndex)") +
      "};" +
      "parent.innerHTML=" + htmlValue(customHtml) + ";" +
      "let n=parent.childNodes[" + value(fieldIdx) + "];" +
      "n.id=controlId;" +
      "n.dsmUnique=uniqueIndex;" +
      "}"
    : "function (parent, idPrefix, name, uniqueIndex) {" +
      'let controlId=idPrefix+"_"+name+"_"+uniqueIndex;' +
      "parent.innerHTML=" + htmlValue(customHtml) + ";" +
      "let n=parent.childNodes[" + value(fieldIdx) + "];" +
      "n.id=controlId;" +
      "n.dsmUnique=uniqueIndex;" +
      "}";
  const customGetter: JavaScript =
    "function (idPrefix, name, uniqueIndex) {" +
    'let controlId=idPrefix+"_"+name+"_"+uniqueIndex;' +
    "return document.getElementById(controlId)." + fieldJS(tf.fieldEditor) + ";" +
    "}";
  const customSetter: JavaScript =
    "function (idPrefix, name, uniqueIndex, v) {" +
    'let controlId=idPrefix+"_"+name+"_"+uniqueIndex;' +
    "document.getElementById(controlId)." + fieldJS(tf.fieldEditor) + "=v;" +
    "}";
  const column: JavaScript =
    "{" +
    "name:" + value(columnId(colNum)) + "," +
    "display:" + value(tf.columnName) + "," +
    'type:"custom",' +
    "customBuilder:" + customBuilder + "," +
    "customGetter:" + customGetter + "," +
    "customSetter:" + customSetter +
    "}";
  return [
    column,
    // \row -> fromMaybe Null $ row ^? fieldValue tf . re (clonePrism fPrsm)
    (row: Row): J.Value => fromMaybe<J.Value>(null, mapMaybeValue((a: A) => review(fPrsm, a) as J.Value, preview(tf.fieldValue, row))),
    // \j -> maybe id (set (fieldValue tf)) $ j ^? clonePrism fPrsm
    (j: J.Value) => {
      const m = preview(fPrsm, j);
      return (row: Row): Row => (m.tag === "Just" ? set(tf.fieldValue, m.value as A, row) : row);
    },
  ];
}

/** Javasript to send an updated copy of the table to the server. */
export function jsSendChange<Row>(wId: WebitId, grid: RemoteValue<WebitTable<Row>>): JavaScript {
  return "if (" + var_(grid) + ") {" + webitEventData(wId, var_(grid) + ".getAllValue()") + "}";
}

/**
 * The output `TState` of a table webit (the local @output@ of 'mkTableWebit' and
 * 'mkTableWebitWithClicks'): the current value and the broadcast channel of its events.
 */
function tableOutput<Row>(
  current: TVar<readonly Row[]>,
  events: TChan<[null, readonly Row[]]>,
  eventsOut: TChan<[null, readonly Row[]]>,
): TState<null, readonly Row[]> {
  // let output = TState {
  //       tStateBehaviour = readTVar current,
  //       tStateEvent = readTChan eventsOut,
  //       tStateDup = do
  //         newEvents <- dupTChan events
  //         return $ TState (tStateBehaviour output) (readTChan newEvents) (tStateDup output)
  //     }
  const output: TState<null, readonly Row[]> = {
    tStateBehaviour: () => readTVar(current),
    tStateEvent: () => readTChan(eventsOut),
    tStateDup: () => {
      const newEvents = dupTChan(events);
      return { tStateBehaviour: output.tStateBehaviour, tStateEvent: () => readTChan(newEvents), tStateDup: output.tStateDup };
    },
  };
  return output;
}

/**
 * Creates a Webit for editing a list of values in a table.
 *
 * The obvious way to implement this would be to make @a@ an instance of 'ToJSON' and 'FromJSON'.
 * However 'TableField' type does not include an internal fieldname that could be matched to the
 * JSON object fields. The solution is to make each cell update its row, starting from a default
 * value. As a result of this, any parts of @a@ that are not listed in the 'Table' specification
 * will have old values. Where shuffling is enabled these may be values from other rows.
 *
 * The result includes a command to be executed once the table has been inserted into the DOM.
 */
export function mkTableWebit<Row>(
  env: ElmerEnv,
  editFlags: readonly TableEditing<Row>[],
  spec: Table<Row>,
  initial: readonly Row[],
): [Webit<readonly Row[]>, RemoteMonad<null>] {
  const isAdd = (e: TableEditing<Row>): Maybe<readonly [T.Text, Row]> => (e.tag === "TableAdd" ? Just([e._0, e._1] as const) : Nothing);
  const addButtons = catMaybes(editFlags.map(isAdd));
  const hideButtons: JavaScript[] = [
    ...(editFlags.some((e) => e.tag === "TableShuffle") ? [] : ["moveUp: true", "moveDown: true"]),
    ...(editFlags.some((e) => e.tag === "TableDelete") ? [] : ["remove: true", "removeLast: true"]),
    ...(addButtons.length === 0 ? ["append: true"] : []),
  ];
  const isIconEditor = (c: Table<Row>[number]): boolean => c._0.fieldEditor.tag === "EditIcon";

  const outerBox = makeWebitContainer(env, "");
  const tableBox = makeWebitContainer1(env, "table", []);
  showWebit(WebitClass_WebitContainer, env, outerBox, tableBox);
  const editChan = addWebitChannel(J.valueJ, WebitClass_WebitContainer, env, tableBox); // Full copy of contents when an edit occurs.
  const opChan = addWebitChannel(FromJSON_TableRowOp, WebitClass_WebitContainer, env, tableBox); // Insert, delete, shuffle.
  const current = newTVarIO<readonly Row[]>(initial);
  const inputChan = newTChanIO<readonly Row[]>();
  const events = newBroadcastTChanIO<[null, readonly Row[]]>();
  const eventsOut = atomicallySync(() => dupTChan(events));
  const output = tableOutput(current, events, eventsOut);
  const elmer = env;
  const iconMenuNeeded = spec.some(isIconEditor);
  const tableId = WebitClass_WebitContainer.webitId(tableBox);
  const eng = elmer.elmerEngine;
  // defList = maybe [] repeat $ addButtons ^? _head . _2
  const defItem: Maybe<Row> = addButtons.length > 0 ? Just(addButtons[0][1]) : Nothing;
  const grid = send(eng, constructor<WebitTable<Row>>("null")); // Null constructor to avoid mdo.
  const columns = spec.map((c, n) => fieldToColumn(tableId, false, grid, n, c._0));
  const columnSpecs = columns.map((c) => c[0]);
  const getters = columns.map((c) => c[1]);
  const setters = columns.map((c) => c[2]);
  const rowToJson = (row: Row): J.Value => J.object(getters.map((g, n) => [columnId(n), g(row)] as const));
  // Load new values into the grid, being careful to set and unset the callback disable flag.
  // Loading new data triggers a multiple row append operation, resulting in an endless
  // ping-pong between client and server if the callback is not blocked during data load.
  const loadNewValues = (vs: readonly Row[]): JavaScript =>
    "{" +
    var_(grid) + ".dsmRowDisable=true;" +
    (vs.length === 0
      ? // Bodge because AppendGrid won't accept empty data.
        var_(grid) + ".load([{col0:null}]);" + var_(grid) + ".removeRow(0);"
      : call(var_(grid) + ".load", [value(vs.map(rowToJson))]) + ";") +
    updateDecorations(spec, grid, vs) + ";" +
    var_(grid) + ".dsmRowDisable=false;" +
    "}";
  const parseRow = (v: J.Value): ((row: Row) => Row) =>
    J.withObject(
      "Table row",
      (o) => {
        const fs = setters.map((s, n) => s(J.fieldDefault(o, columnId(n), J.valueJ, null)));
        // foldr (.) id
        return (row: Row): Row => fs.reduceRight((acc, f) => f(acc), row);
      },
      v,
    );
  const domCode1: RemoteMonad<null> = seqRemote(
    command(
      "{" +
        "let sendOp=function(o1,n1){" +
        "if (" + var_(grid) + " && !(" + var_(grid) + ".dsmRowDisable)){" +
        webitEventData(tableId, "{op:o1,n:n1}") +
        "}};" +
        var_(grid) + "=new AppendGrid({" +
        "element:" + var_(WebitClass_WebitContainer.webitHandle(tableBox)) + "," +
        "columns:[" + columnSpecs.join(",") + "]," +
        "hideButtons:{" + hideButtons.join(",") + "}," +
        "afterRowInserted:function(c,p,ns){sendOp('insert',p===null?0:p+1);}," +
        "afterRowSwapped:function(c,n1,n2){sendOp('swap',Math.min(n1,n2));}," +
        "afterRowRemoved:function(c,n){" +
        "sendOp('delete',n===null?" + var_(grid) + ".getRowCount():n);}," +
        "afterRowAppended:function(c,p,ns){sendOp('insert',p===null?0:p+1);}," +
        "hideRowNumColumn:true});" +
        "}",
    ),
    command(loadNewValues(initial)),
    command(updateDecorations(spec, grid, initial)),
  );
  // If there are EditIcon columns then run the icon menu.
  if (iconMenuNeeded) {
    const iconClicks = addWebitChannel(FromJSON_TableIconClick, WebitClass_WebitContainer, env, tableBox); // TableIconClick record.
    elmerDaemon(WebitClass_WebitContainer, env, tableBox, async (env1) => {
      const click = await atomically(() => readTChan(iconClicks)); // Icon was clicked; pop up menu.
      const choice = await getIconChoice(env1, iconFromUrl(click.tableIconSrc));
      if (choice.tag === "Nothing") return;
      const newIcon = choice.value;
      atomicallySync(() => {
        const oldValue = readTVar(current);
        const colNum = fromMaybe(0, readInt(T.unpack(click.tableIconColumn).split("").filter(isDigit).join("")));
        // Faithful: the Haskell indexes the rows with the column number here.
        const c = spec[colNum];
        const newValue =
          c !== undefined && c._0.fieldEditor.tag === "EditIcon"
            ? set(ixList<Row>(colNum).dot(c._0.fieldValue), newIcon, oldValue)
            : oldValue;
        writeTVar(current, newValue);
        writeTChan(events, [null, newValue]);
      });
      elmerSend(
        env1,
        "{" +
          var_(grid) + ".setCtrlValue(" +
          value(click.tableIconColumn) + "," +
          var_(grid) + ".getRowIndex(" + value(click.tableIconIndex) + ")," +
          value(iconUrl(newIcon)) + ");" +
          jsSendChange(tableId, grid) +
          "}",
      );
    });
  }
  elmerDaemon(WebitClass_WebitContainer, env, tableBox, async (env1) => {
    const io = await atomically(
      (): (() => void) =>
        orElse(
          () =>
            orElse(
              () => {
                // Process input from the rest of the application.
                const newValue = readTChan(inputChan);
                const oldValue = readTVar(current);
                writeTVar(current, newValue);
                return () => {
                  if (!equals(newValue, oldValue)) elmerSend(env1, loadNewValues(newValue));
                };
              },
              () => {
                // Process user edits to the table data.
                const v = readTChan(editChan);
                const r = J.parseEither((x) => J.withArray("Table values", (a) => a.map(parseRow), x), v);
                if (r.tag === "Right") {
                  const updates = r.value;
                  const oldValue = readTVar(current);
                  // zipWith ($) updates $ oldValue ++ defList
                  const newValue: Row[] = [];
                  for (let n = 0; n < updates.length; n++) {
                    if (n < oldValue.length) newValue.push(updates[n](oldValue[n]));
                    else if (defItem.tag === "Just") newValue.push(updates[n](defItem.value));
                    else break;
                  }
                  writeTVar(current, newValue);
                  writeTChan(events, [null, newValue]);
                  return () => elmerSend(env1, updateDecorations(spec, grid, newValue));
                }
                return () => {};
              },
            ),
          () => {
            // Process row operations.
            const op1 = readTChan(opChan);
            const oldValue = readTVar(current);
            const newValue = applyTableRowOp(defItem, op1, oldValue);
            writeTVar(current, newValue);
            writeTChan(events, [null, newValue]);
            return () => elmerSend(env1, loadNewValues(newValue));
          },
        ),
    );
    io();
  });
  const parent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  const final = newIORef<Elmer<void>>((e) => elmerSend(e, "delete " + var_(grid)));
  return [
    Webit<readonly Row[]>(
      WebitClass_WebitContainer.webitHandle(outerBox),
      (v) => writeTChan(inputChan, v),
      output,
      current,
      WebitClass_WebitContainer.webitId(outerBox),
      parent,
      final,
    ),
    domCode1,
  ];
}

/**
 * Like 'mkTableWebit', but when the table is clicked an event is sent with the
 * row number. The channel that receives these clicks is returned as the third part of the result.
 *
 * The webit may also update itself when row add, delete or shuffle buttons are clicked.
 */
export function mkTableWebitWithClicks<Row>(
  env: ElmerEnv,
  editFlags: readonly TableEditing<Row>[],
  spec: Table<Row>,
  initial: readonly Row[],
): [Webit<readonly Row[]>, RemoteMonad<null>, TChan<number>] {
  const isAdd = (e: TableEditing<Row>): Maybe<readonly [T.Text, Row]> => (e.tag === "TableAdd" ? Just([e._0, e._1] as const) : Nothing);
  const addButtons = catMaybes(editFlags.map(isAdd));
  const hideButtons: JavaScript[] = [
    ...(editFlags.some((e) => e.tag === "TableShuffle") ? [] : ["moveUp: true", "moveDown: true"]),
    ...(editFlags.some((e) => e.tag === "TableDelete") ? [] : ["remove: true", "removeLast: true"]),
    ...(addButtons.length === 0 ? ["append: true"] : []),
  ];

  const tableBox = makeWebitContainer1(env, "table", []);
  const current = newTVarIO<readonly Row[]>(initial);
  const inputChan = newTChanIO<readonly Row[]>(); // Inputs from the application.
  const opChan = addWebitChannel(FromJSON_TableRowOp, WebitClass_WebitContainer, env, tableBox); // Insert, delete, shuffle.
  const events = newBroadcastTChanIO<[null, readonly Row[]]>(); // Events to be sent on the output channel.
  const eventsOut = atomicallySync(() => dupTChan(events));
  const output = tableOutput(current, events, eventsOut);
  const elmer = env;
  const clickRows = addWebitChannel(J.intJ, WebitClass_WebitContainer, env, tableBox);
  const tableId = WebitClass_WebitContainer.webitId(tableBox);
  const eng = elmer.elmerEngine;
  const grid = send(eng, constructor<WebitTable<Row>>("null")); // Null constructor to avoid mdo.
  const columns = spec.map((c, n) => fieldToColumn(tableId, true, grid, n, c._0));
  const columnSpecs = columns.map((c) => c[0]);
  const getters = columns.map((c) => c[1]);
  const rowToJson = (row: Row): J.Value => J.object(getters.map((g, n) => [columnId(n), g(row)] as const));
  // Load new values into the grid, being careful to set and unset the callback disable flag.
  const loadNewValues = (vs: readonly Row[]): JavaScript =>
    "{" +
    var_(grid) + ".dsmRowDisable=true;" +
    (vs.length === 0
      ? // Bodge because AppendGrid won't accept empty data.
        var_(grid) + ".load([{col0:null}]);" + var_(grid) + ".removeRow(0);"
      : call(var_(grid) + ".load", [value(vs.map(rowToJson))]) + ";") +
    updateDecorations(spec, grid, vs) + ";" +
    var_(grid) + ".dsmRowDisable=false;" +
    "}";
  const defItem: Maybe<Row> = addButtons.length > 0 ? Just(addButtons[0][1]) : Nothing; // snd <$> listToMaybe addButtons
  const domCode: RemoteMonad<null> = seqRemote(
    command(
      "{" +
        "let sendOp=function(o1,n1){" +
        "if (" + var_(grid) + " && !(" + var_(grid) + ".dsmRowDisable)){" +
        webitEventData(tableId, "{op:o1,n:n1}") +
        "}};" +
        var_(grid) + "=new AppendGrid({" +
        "element:" + var_(WebitClass_WebitContainer.webitHandle(tableBox)) + "," +
        "columns:[" + columnSpecs.join(",") + "]," +
        "hideButtons:{" + hideButtons.join(",") + "}," +
        "afterRowInserted:function(c,p,ns){sendOp('insert',p===null?0:p+1);}," +
        "afterRowSwapped:function(c,n1,n2){sendOp('swap',Math.min(n1,n2));}," +
        "beforeRowRemoved:function(c,n)" +
        "{sendOp('delete',n===null?$(this).getRowCount():n);}," +
        "afterRowAppended:function(c,p,ns){sendOp('insert',p===null?0:p+1);}," +
        "hideRowNumColumn:true});" +
        "}",
    ),
    command(loadNewValues(initial)),
    command(updateDecorations(spec, grid, initial)),
  );
  elmerDaemon(WebitClass_WebitContainer, env, tableBox, async (env1) => {
    const io = await atomically(
      (): (() => void) =>
        orElse(
          () => {
            // Process input from the rest of the application.
            const newValue = readTChan(inputChan);
            const oldValue = readTVar(current);
            writeTVar(current, newValue);
            return () => {
              if (!equals(newValue, oldValue)) elmerSend(env1, loadNewValues(newValue));
            };
          },
          () => {
            // Process row operations.
            const op1 = readTChan(opChan);
            const oldValue = readTVar(current);
            const newValue = applyTableRowOp(defItem, op1, oldValue);
            writeTVar(current, newValue);
            writeTChan(events, [null, newValue]);
            return () => {
              if (!equals(newValue, oldValue)) elmerSend(env1, loadNewValues(newValue));
            };
          },
        ),
    );
    io();
  });
  const parent = newTVarIO<Maybe<WebitContainer>>(Nothing);
  const final = newIORef<Elmer<void>>((e) => elmerSend(e, "delete " + var_(grid)));
  return [
    Webit<readonly Row[]>(
      WebitClass_WebitContainer.webitHandle(tableBox),
      (v) => writeTChan(inputChan, v),
      output,
      current,
      WebitClass_WebitContainer.webitId(tableBox),
      parent,
      final,
    ),
    domCode,
    clickRows,
  ];
}

/** JavaScript command to update any icons and colours in the table, based on the new row values. */
export function updateDecorations<Row>(spec: Table<Row>, grid: RemoteValue<WebitTable<Row>>, newValue: readonly Row[]): JavaScript {
  return newValue
    .flatMap((v, row) =>
      spec.flatMap((c, col) => {
        const tf = c._0;
        return catMaybes<JavaScript>([
          (() => {
            // Maybe monad
            if (tf.fieldIcon.tag === "Nothing") return Nothing;
            const iconF = tf.fieldIcon.value;
            const newIcon = mapMaybeValue(iconF, preview(tf.fieldValue, v));
            if (newIcon.tag === "Nothing") return Nothing;
            return Just(
              call(var_(grid) + ".getCellCtrl", [value(columnId(col)), value(row)]) +
                ".previousSibling.src=" + value(iconUrl(newIcon.value)) + ";",
            );
          })(),
          (() => {
            // Maybe monad
            if (tf.fieldColour.tag === "Nothing") return Nothing;
            const colF = tf.fieldColour.value;
            const newColour = mapMaybeValue((a: any) => review(colourPrism, colF(a)), preview(tf.fieldValue, v));
            if (newColour.tag === "Nothing") return Nothing;
            return Just(
              call(var_(grid) + ".getCellCtrl", [value(columnId(col)), value(row)]) +
                ".parentNode.style.backgroundColor=" + value(newColour.value) + ";",
            );
          })(),
        ]);
      }),
    )
    .join("");
}

export async function deleteTableWebit<A>(env: ElmerEnv, wt: WebitTable<A>): Promise<void> {
  const { wtRoot: r, wtGrid: g } = wt;
  await deleteWebit(WebitClass_WebitContainer, env, r);
  const eng = env.elmerEngine;
  send(eng, jsDelete(g));
}

/** Generate the column identifier from a serial number. */
export function columnId(colNum: number): T.Text {
  return T.pack("col" + String(colNum));
}

/**
 * Treat JSON @Null@ as @Nothing@. This has been submitted to the lens-aeson project, so this
 * code can be deleted if it clashes with a future version.
 */
export function nullIsNothing<A>(p: Prism<J.Value, A>): Prism<J.Value, Maybe<A>> {
  return withPrism(p, (bk, fw) => {
    const bk1 = (m: Maybe<A>): J.Value => (m.tag === "Nothing" ? null : bk(m.value));
    const fw1 = (x: J.Value) => {
      if (x === null) return Right<Maybe<A>>(Nothing);
      const r = fw(x);
      return r.tag === "Right" ? Right<Maybe<A>>(Just(r.value)) : Left<J.Value>(r.value);
    };
    return prism<J.Value, Maybe<A>>(bk1, fw1);
  });
}

/** Icon in a table. */
export function tableIcon<Row>(clickFlag: boolean, wId: WebitId, grid: RemoteValue<WebitTable<Row>>, colNum: number): H.Html {
  const c = columnId(colNum);
  return H.with_(
    H.img(),
    HA.alt(H.textValue(c)),
    HA.src(H.textValue(iconUrl("no-icon"))), // Value set later.
    HA.class_("icon-inline"),
    HA.onclick(
      jsValue(
        webitEventData(
          wId,
          clickFlag
            ? "{" + webitEventData(wId, var_(grid) + ".getRowIndex(this.dsmUnique)") + "}"
            : "{src:this.src,idx:this.dsmUnique,col:" + value(c) + "}",
        ),
      ),
    ),
  );
}
