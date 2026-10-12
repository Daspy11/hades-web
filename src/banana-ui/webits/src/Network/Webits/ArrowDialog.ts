// Ported from banana-ui/webits/src/Network/Webits/ArrowDialog.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * = Arrows for Web GUIs
 *
 * This is a web implementation of the arrow-based GUI language defined in
 * "Reactive.Banana.ArrowDialog".
 *
 * The Gadgets are rendered using web sockets. The following assumptions are made about the
 * environment that the GUI is running in:
 *
 * * Icons are in a static folder @/icon@. E.g. an icon named @tick@ will be in @/icon/tick@.
 * The web server may provide either PNG or SVG files, but with no suffix.  The icons must include:
 *   [object-select-symbolic]  A green tick.
 *   [list-remove-symbolic]  A red cross.
 *   [blank-icon] An empty icon.
 *
 * * The contents of 'webitJsLibrary' are included.
 *
 * The following CSS classes are used:
 *
 * [active]  A tab button which is currently selected.
 *
 * [dialog]  A container used as a modal dialog. These are created and destroyed by the server on
 * open and close, so there is no need for visibility settings in the CSS.
 *
 * [disabled]  Should be grayed out. The CSS is not expected to handle the unresponsive semantics.
 *
 * [grid]  A table of gadgets with row and column headers.
 *
 * [horizontal]  The contents should be displayed in a horizontal row.
 *
 * [icon-inline]  An icon displayed in line with another gadget. Typically 16x16 pixels.
 *
 * [invalid]  The element contains invalid data.
 *
 * [memo-small]  A memo-box sized to accept a short paragraph.
 *
 * [memo-medium] A memo-box sized to accept a couple of short paragraphs.
 *
 * [memo-large]  A memo-box sized to accept several paragraphs.
 *
 * [no-box]  A container used to organise content but which has no visible representation.
 *
 * [popup]  An element which contains a popup-widget.
 *
 * [popup-widget] An element which is positioned over another element and appears when given the
 * additional class @show@.
 *
 * [show]  A visible popup-widget.
 *
 * [tab-body]  The container for tab currently displayed.
 *
 * [tab-form]  A tabbed element with a tab-header and one or more tab-body elements.
 *
 * [tab-header]  The container for the list of tabs.
 *
 * [vertical]  The contents should be displayed in a vertical column.
 *
 * [window-title]  A paragraph used as the header of a dialog pop-up.
 *
 * [vl]  A @div@ used as a vertical line.
 *
 * TypeScript port
 * ---------------
 * * Conventions of `Network/Webits` (see porting-notes/w1.md): an `Elmer a` function takes the
 *   `ElmerEnv` first, named `elmer` here because the Haskell code calls the gadget environment
 *   `env`: `renderGadget(elmer, env, i, g)`, `createDialog(elmer, env, [key, initial, dialog])`,
 *   `mkWebitPopupSelect(elmer, env, selector, trigger)`. Everything is synchronous except the
 *   daemon threads (`elmerDaemon`, `forkIO`), which are async loops; `deleteTableWebit` and the
 *   re-rendering of an `Exec` gadget await `deleteWebit`.
 * * STM is `@/lib/Control/Concurrent/STM` (an `STM a` is a thunk run inside `atomically`); a
 *   `TState` is `Control/Concurrent/TState`. `liftIO $ atomically` of a transaction that never
 *   retries is `atomicallySync`.
 * * `GadgetOut w o` is a record with the Haskell fields; its `Functor`/`Applicative` instances
 *   are `fmap_GadgetOut`, `pure_GadgetOut`, `ap_GadgetOut` and `liftA2_GadgetOut`. `RemoteMonad ()`
 *   is `RemoteMonad<null>`; `m1 >> m2` is `seqRemote(m1, m2)`.
 * * The clauses of `renderGadget` are module functions named after their Haskell cost centres
 *   (`renderGadget_TextBox`, ...), dispatched from `renderGadget` in the Haskell clause order.
 *   `proc` blocks are desugared by hand (PORTING.md §9); the original is in a comment.
 * * `ToJSON`/`FromJSON` instances: `ToJSON_FancyTreeIcon`, `ToJSON_FancyTree`,
 *   `FromJSON_TreeMoveMode`, `FromJSON_FTSelection`.
 * * The recursive bindings (`mdo`) of `Loop` and `Intercept` have no direct counterpart: `Loop`
 *   feeds the output back through a lazy `TState` that throws "cyclic evaluation in fixIO" if it
 *   is read while the loop body is still being rendered, as the Haskell `fixIO` does; `Intercept`
 *   sets the click attribute of its container right after creating it (the Haskell needs the
 *   container's id to build it).
 * * `LT.decodeLatin1 . encode` (JSON put into pushed JavaScript) is reproduced by `encodeLatin1`:
 *   non-ASCII text arrives as its UTF-8 bytes read as Latin-1, as in the original.
 * * The interpreter is reproduced with the quirks of the original (see porting-notes/w2.md), e.g.
 *   `Box`, `Grid`, `TabForm` and `ValidateText` return their children's views instead of their
 *   own container, and `Enabled`/`Frame`/`Optional DateBox` push JavaScript that fails in the
 *   browser. Each is marked "Faithful:" below.
 */
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as C from "@/lib/Data/Colour";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, fromMaybe, isJust, isNothing, catMaybes, mapMaybe, mapMaybeValue, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, fromRight, isRight, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { Node, flatten, type Forest, type Tree } from "@/lib/Data/Tree";
import { _Just, contains, from, over, preview, review, set, view, withPrism, type Lens, type Prism, type Traversal } from "@/lib/Control/Lens";
import { error, newIORef, readIORef, writeIORef, readInt, round, showBool } from "@/lib/Prelude";
import {
  atomically,
  atomicallySync,
  dupTChan,
  modifyTVar,
  newBroadcastTChanIO,
  newTChanIO,
  newTMVarIO,
  newTQueueIO,
  newTVarIO,
  orElse,
  readTChan,
  readTMVar,
  readTQueue,
  readTVar,
  readTVarIO,
  retry,
  writeTChan,
  writeTQueue,
  writeTVar,
  type STM,
  type TChan,
  type TVar,
} from "@/lib/Control/Concurrent/STM";
import { forever, forkIO, labelThread } from "@/lib/Control/Concurrent";
import * as JS from "@/lib/Network/JavaScript";
import { call, command, pureRemote, seqRemote, value, var_, type JavaScript, type RemoteMonad } from "@/lib/Network/JavaScript";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { getDataFileName } from "@/lib/System/Paths";
import * as FM from "@/banana-ui/webits/src/Data/ForestModel";
import {
  TState,
  fmap_TState,
  ap_TState,
  pure_TState,
  newTState,
  newTStateIO,
  tStateDupIO,
  mapTState1,
  filterTStateMaybe,
} from "@/banana-ui/webits/src/Control/Concurrent/TState";
import {
  addClass,
  addWebitChannel,
  deleteAttribute,
  deleteWebit,
  elmerDaemon,
  elmerSend,
  getIconChoice,
  iconHtml,
  jsValue,
  makeWebit,
  makeWebitContainer,
  makeWebitContainer1,
  makeWebStatic,
  removeClass,
  runElmer,
  setAttribute,
  setWebitHtml,
  showWebit,
  show_Value,
  webitEvent,
  webitEventData,
  webitSelector,
  webitSelector1,
  WebitClass_Webit,
  WebitClass_WebitContainer,
  WebitClass_WebitItem,
  WebitClass_WebStatic,
  WebitItem,
  type ElmerEnv,
  type Webit,
  type WebitContainer,
  type WebitId,
} from "@/banana-ui/webits/src/Network/Webits";
import { iconUrl } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { mkWebitMenu, type WebitMenu } from "@/banana-ui/webits/src/Network/Webits/Menu";
import { mkTableWebit, mkTableWebitWithClicks } from "@/banana-ui/webits/src/Network/Webits/Table";
import {
  GadgetData,
  colourPrism,
  datePrism,
  fmap_GadgetData,
  ap_GadgetData,
  pure_GadgetData,
  forestCatMaybe,
  gdOk,
  gdValue,
  getColour,
  prismToMaybe,
  type Colour,
} from "@/banana-ui/base/Reactive/Banana/Common";
import { fmap_Menu, type Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import * as G from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import {
  Combo,
  ComboItem,
  DisplayText,
  FixedMemo,
  FixedText,
  MemoBox,
  TextBox,
  TickBox,
  arr,
  fmap_ComboItem,
  gDot,
  gFirst,
  gPipe,
  getLens,
  promoteDialogSelector,
  type ClickableItem,
  type Dialog_,
  type DialogSelector_,
  type Gadget,
  type GadgetF_,
  type Lens1,
  type MemoBoxSize,
  type Orientation,
  type PrismaticGadget,
  type TreeOper,
} from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";

/** The gadget input and output streams: a `TState Bool (GadgetData a)`. */
type GadgetState<A> = TState<boolean, GadgetData<A>>;

// ---------------------------------------------------------------------------------------------
// FancyTree

export type FancyTreeIcon =
  /** No icon. */
  | { readonly tag: "FtIconNone" }
  /** Use default FancyTree theme icon. */
  | { readonly tag: "FtIconDefault" }
  /** Either an image URL or a custom JQuery-UI icon tag. */
  | { readonly tag: "FtIcon"; readonly _0: T.Text };

/** No icon. */
export const FtIconNone: FancyTreeIcon = { tag: "FtIconNone" };
/** Use default FancyTree theme icon. */
export const FtIconDefault: FancyTreeIcon = { tag: "FtIconDefault" };
/** Either an image URL or a custom JQuery-UI icon tag. */
export function FtIcon(_0: T.Text): FancyTreeIcon {
  return { tag: "FtIcon", _0 };
}

/** `instance ToJSON FancyTreeIcon` */
export const ToJSON_FancyTreeIcon: J.ToJSON<FancyTreeIcon> = {
  toJSON: (i) => {
    switch (i.tag) {
      case "FtIconNone":
        return false;
      case "FtIconDefault":
        return true;
      case "FtIcon":
        return i._0;
    }
  },
};

/**
 * Fancy Tree display data.
 *
 * The ToJSON instance leaves JSON fields undefined where blank text or @Nothing@ makes that
 * appropriate according to the Fancy Tree API.
 */
export interface FancyTree {
  /** Display name. */
  readonly ftTitle: T.Text;
  /** Key value. */
  readonly ftKey: T.Text;
  /** Hover tooltip. */
  readonly ftToolTip: Maybe<T.Text>;
  /** @Nothing@ = global tree icon. Use @Just FtIconNone@ for no icon. */
  readonly ftIcon: Maybe<FancyTreeIcon>;
  /** Display a checkbox. @Nothing@ = use global. */
  readonly ftCheckBox: Maybe<boolean>;
  /** Initial expanded state. */
  readonly ftExpanded: boolean;
  /** CSS classes for the node. */
  readonly ftExtraClasses: T.Text;
  /** Are the children of this node to be loaded on demand? */
  readonly ftLazy: boolean;
  /** Initial selection state. */
  readonly ftSelected: boolean;
  /** Node type data for icons, tooltips etc. */
  readonly ftType: T.Text;
  /** Node cannot be selected. */
  readonly ftUnselectable: boolean;
  /** @Nothing@ for not yet loaded. */
  readonly ftChildren: Maybe<readonly FancyTree[]>;
}
export function FancyTree(
  ftTitle: T.Text,
  ftKey: T.Text,
  ftToolTip: Maybe<T.Text>,
  ftIcon: Maybe<FancyTreeIcon>,
  ftCheckBox: Maybe<boolean>,
  ftExpanded: boolean,
  ftExtraClasses: T.Text,
  ftLazy: boolean,
  ftSelected: boolean,
  ftType: T.Text,
  ftUnselectable: boolean,
  ftChildren: Maybe<readonly FancyTree[]>,
): FancyTree {
  return {
    ftTitle, ftKey, ftToolTip, ftIcon, ftCheckBox, ftExpanded, ftExtraClasses, ftLazy, ftSelected, ftType,
    ftUnselectable, ftChildren,
  };
}

/** `instance ToJSON FancyTree` */
export const ToJSON_FancyTree: J.ToJSON<FancyTree> = {
  toJSON: (v): J.Value => {
    const opt = <A>(k: string, f: (a: A) => J.Value, m: Maybe<A>): Maybe<[string, J.Value]> =>
      mapMaybeValue((a: A): [string, J.Value] => [k, f(a)], m);
    const when = (b: boolean, k: string, x: J.Value): Maybe<[string, J.Value]> => (b ? Just([k, x]) : Nothing);
    return J.object([
      ["title", v.ftTitle],
      ["key", v.ftKey],
      ...catMaybes<[string, J.Value]>([
        opt("tooltip", (t: T.Text) => t, v.ftToolTip),
        opt("icon", ToJSON_FancyTreeIcon.toJSON, v.ftIcon),
        opt("checkbox", (b: boolean) => b, v.ftCheckBox),
        when(v.ftExpanded, "expanded", true),
        when(v.ftExtraClasses !== "", "extraClasses", v.ftExtraClasses),
        when(v.ftLazy, "lazy", true),
        when(v.ftSelected, "selected", true),
        when(v.ftType !== "", "type", v.ftType),
        when(v.ftUnselectable, "unselectable", true),
        opt("children", (cs: readonly FancyTree[]) => cs.map(ToJSON_FancyTree.toJSON), v.ftChildren),
      ]),
    ]);
  },
};

export type TreeMoveMode = "MoveBefore" | "MoveAfter" | "MoveOver";
export const treeMoveModeValues: readonly TreeMoveMode[] = ["MoveBefore", "MoveAfter", "MoveOver"];

/** `instance FromJSON TreeMoveMode` */
export const FromJSON_TreeMoveMode: J.FromJSON<TreeMoveMode> = {
  parseJSON: (v) => {
    if (v === "before") return "MoveBefore";
    if (v === "after") return "MoveAfter";
    if (v === "over") return "MoveOver";
    if (typeof v === "string") return J.fail("Unrecognised move mode: " + T.showText(v));
    return J.fail("Expected move mode: " + show_Value(v));
  },
};

/** The bundled data files that 'arrowDialogPrelude' may read. */
const preludeFiles = import.meta.glob(["/src/banana-ui/webits/*.js", "/src/banana-ui/webits/JS/arrowDialog.js"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

let arrowDialogPreludeCache: H.Html | null = null;

/**
 * Must be included as a part of every web page using these gadgets.
 *
 * TypeScript: a function (the Haskell `unsafePerformIO` constant), memoised. As in Haskell it
 * reads the data file @arrowDialog.js@ and puts it in a script element as (escaped) text. The
 * Haskell names the file without its @JS/@ directory, so, as in the original, using it fails
 * with a file-not-found error; `elmerScotty` loads @JS/arrowDialog.js@ itself.
 */
export function arrowDialogPrelude(): H.Html {
  if (arrowDialogPreludeCache !== null) return arrowDialogPreludeCache;
  const fn = getDataFileName("webits", "arrowDialog.js");
  const path = "/src/banana-ui/webits/arrowDialog.js";
  const contents = preludeFiles[path];
  if (contents === undefined) throw new Error(fn + ": openFile: does not exist (No such file or directory)");
  arrowDialogPreludeCache = H.with_(H.script(H.text(contents)), HA.type_("text/javascript"));
  return arrowDialogPreludeCache;
}

/**
 * Default values for FancyTree, with only key and title supplied. Use field syntax on this rather
 * than building @FancyTree@ values from scratch to avoid undefined fields in future versions.
 *
 * Fields are set blank, @False@ or @Nothing@.
 */
export function ftDefault(
  /** Key. */
  k: T.Text,
  /** Title */
  txt: T.Text,
): FancyTree {
  return {
    ftTitle: txt,
    ftKey: k,
    ftToolTip: Nothing,
    ftIcon: Nothing,
    ftCheckBox: Nothing,
    ftExpanded: false,
    ftExtraClasses: "",
    ftLazy: false,
    ftSelected: false,
    ftType: "",
    ftUnselectable: false,
    ftChildren: Nothing,
  };
}

/** Raw selection events received from FancyTree. */
export interface FTSelection {
  readonly ftsKey: number;
  readonly ftsSelected: boolean;
}
export function FTSelection(ftsKey: number, ftsSelected: boolean): FTSelection {
  return { ftsKey, ftsSelected };
}

/** `deriving Show` for FTSelection. */
export function show_FTSelection(s: FTSelection): string {
  return "FTSelection {ftsKey = " + String(s.ftsKey) + ", ftsSelected = " + showBool(s.ftsSelected) + "}";
}

/** `instance FromJSON FTSelection` (the key is a string holding an integer; `read` fails hard). */
export const FromJSON_FTSelection: J.FromJSON<FTSelection> = {
  parseJSON: (v) =>
    J.withObject(
      "Fancytree Selection event",
      (o) => {
        const k = J.field(o, "k", J.stringJ);
        const n = readInt(k);
        if (n.tag === "Nothing") throw new Error("Prelude.read: no parse");
        return FTSelection(n.value, J.field(o, "s", J.boolJ));
      },
      v,
    ),
};

// ---------------------------------------------------------------------------------------------
// Dialogs

/**
 * Associate a dialog selector with events on a channel. Each event causes a new dialog
 * to pop up. The @k@ values are used to correlate the input events with the outputs. The output
 * value is @Just@ for clicks on @OK@ and @Apply@, and @Nothing@ for clicks on @Cancel@.
 */
export function mkWebitPopupSelect<E, W, K, A>(
  elmer: ElmerEnv,
  /** Environment value. */
  env: TState<boolean, E>,
  selector: DialogSelector_<E, W, A>,
  /** An event channel. A new popup is created every time this succeeds. (STM.) */
  trigger: STM<readonly [K, A]>,
): TChan<[K, Maybe<A>]> {
  const result = newTChanIO<[K, Maybe<A>]>();
  const outer = elmer.elmerTop; // Only lasts as long as the current parent.
  elmerDaemon(WebitClass_WebitContainer, elmer, outer, async (elmer1) => {
    const [[k, v], e] = await atomically((): [readonly [K, A], E] => [trigger(), env.tStateBehaviour()]);
    const dlg = selector(e, v);
    if (dlg.tag === "Just") {
      const [dialogBox, dialogOut] = createDialog(elmer1, env, [k, v, dlg.value]);
      elmerDaemon(WebitClass_WebitContainer, elmer1, dialogBox, () =>
        forever(() =>
          atomically(() => {
            writeTChan(result, readTChan(dialogOut));
          }),
        ),
      );
    }
  });
  return result;
}

/**
 * Create a dialog box and a channel of outputs from clicks to the \"Close\",
 * \"Apply\" and \"Ok\" buttons.
 *
 * The @WebitContainer@ in the result is created as a child of the @elmerTop@ value. It is
 * automatically deleted when @OK@ or @Cancel@ are clicked.
 */
export function createDialog<E, W, K, A>(
  elmer: ElmerEnv,
  /** The gadget environment. */
  env: TState<boolean, E>,
  /**
   * The dialog to open. @k@ is a key to identify the value being edited. @a@
   * value is the initial value to display.
   */
  [key, initial, d]: readonly [K, A, Dialog_<E, W, A>],
): [WebitContainer, TChan<[K, Maybe<A>]>] {
  const okText: T.Text = "OK";
  const applyText: T.Text = "Apply";
  // Close function sends False *unless* the close was triggered by the OK button.
  const initJS = (wId: WebitId): RemoteMonad<null> =>
    command(
      "$(" + webitSelector(wId) + ").dialog({" +
        "autoOpen:true," +
        "modal:true," +
        "buttons:[" + buttonsJS(wId) + "]," +
        "height:'auto'," +
        "width:'auto'," +
        "close:function(){" +
        "if ($(" + webitSelector(wId) + ").data('okPressed')) { " +
        "$(" + webitSelector(wId) + ").data('okPressed',false);" +
        "} else {" +
        webitEvent(J.boolJ, wId, false) + ";" +
        "}" +
        "$(" + webitSelector(wId) + ").dialog(\"close\");" +
        "}" +
        "});",
    );
  const updateButtons = (elmer1: ElmerEnv, wId: WebitId, ok: boolean): void =>
    ok
      ? elmerSend(
          elmer1,
          "{" +
            "$(" + webitSelector1(wId, "_ok") + ")" +
            ".prop('disabled',false).removeClass( 'ui-state-disabled' );" +
            "$(" + webitSelector1(wId, "_apply") + ")" +
            ".prop('disabled',false).removeClass( 'ui-state-disabled' );" +
            "}",
        )
      : elmerSend(
          elmer1,
          "{" +
            "$(" + webitSelector1(wId, "_ok") + ")" +
            ".prop('disabled',true).addClass( 'ui-state-disabled' );" +
            "$(" + webitSelector1(wId, "_apply") + ")" +
            ".prop('disabled',true).addClass( 'ui-state-disabled' );" +
            "}",
        );
  const buttonsJS = (wId: WebitId): JavaScript => {
    const okButton: JavaScript =
      "{" +
      "id:" + value(wId) + "+'_ok'," +
      "text:" + value(okText) + "," +
      "click:function(ev,ui){" +
      "console.log('OK click event ID =' + ev.target.id);" +
      webitEvent(J.boolJ, wId, true) + ";" +
      "$(" + webitSelector(wId) + ").data('okPressed',true);" +
      "$(" + webitSelector(wId) + ").dialog('close');" +
      "}" +
      "}";
    const applyButton: JavaScript =
      "{" +
      "id:" + value(wId) + "+'_apply'," +
      "text:" + value(applyText) + "," +
      "click:function(){" + webitEvent(J.boolJ, wId, true) + ";}" +
      "}";
    const closeButton = (txt: T.Text): JavaScript =>
      "{" +
      "id:" + value(wId) + "+'_close'," +
      "text:" + value(txt) + "," +
      "click:function(){$(" + webitSelector(wId) + ").dialog(\"close\");}" +
      "}";
    const bs = d.dialogButtons;
    switch (bs.tag) {
      case "OkButton":
        return [okButton, closeButton("Cancel")].join(",");
      case "OkApplyButton":
        return [okButton, applyButton, closeButton("Cancel")].join(",");
      case "CloseButton":
        return [closeButton(bs._0)].join(",");
    }
  };

  const form1 = makeWebitContainer1(elmer, "form", [["title", d.dialogTitle]]);
  const buttonChan = addWebitChannel(J.boolJ, WebitClass_WebitContainer, elmer, form1);
  const [loopStore, loopWriter] = newTStateIO<boolean, A>(initial);
  const gadget = renderGadget(elmer, env, fmap_TState((x: A) => GadgetData(true, x), loopStore), d.dialogGadget);
  for (const w of gadget.gadgetView) showWebit(WebitClass_WebitItem, elmer, form1, w);
  const outChan = newBroadcastTChanIO<[K, Maybe<A>]>();
  const initialValid = atomicallySync(() => gadget.gadgetOutput.tStateBehaviour()._gdOk);
  updateButtons(elmer, WebitClass_WebitContainer.webitId(form1), initialValid);
  const eng = elmer.elmerEngine;
  const currentValid = newIORef(initialValid); // Avoid sending nugatory updates to buttons.
  elmerDaemon(WebitClass_WebitContainer, elmer, form1, async (elmer1) => {
    const newValid = await atomically(() => {
      const [userFlag, st] = gadget.gadgetOutput.tStateEvent();
      if (st._gdOk && userFlag) loopWriter(false, st._gdValue);
      return st._gdOk;
    });
    const oldValid = readIORef(currentValid);
    if (newValid !== oldValid) {
      writeIORef(currentValid, newValid);
      updateButtons(elmer1, WebitClass_WebitContainer.webitId(form1), newValid);
    }
  });
  elmerDaemon(WebitClass_WebitContainer, elmer, form1, () =>
    atomically(() => {
      const btn = readTChan(buttonChan);
      if (btn) {
        const v = gadget.gadgetOutput.tStateBehaviour();
        writeTChan(outChan, [key, Just(v._gdValue)]);
      } else {
        writeTChan(outChan, [key, Nothing]);
      }
    }),
  );
  const top = elmer.elmerTop;
  showWebit(WebitClass_WebitContainer, elmer, top, form1);
  JS.send(eng, gadget.gadgetDomCode);
  JS.send(eng, initJS(WebitClass_WebitContainer.webitId(form1)));
  const out = atomicallySync(() => dupTChan(outChan));
  return [form1, out];
}

// ---------------------------------------------------------------------------------------------
// GadgetOut

/**
 * Data representing a Gadget instantiated as a Webit. The output Boolean flags that this event
 * was triggered by the user, and therefore needs to be fed back into the gadget with the flag
 * set to false.
 *
 * Some gadgets rely on third-party code that can only be initialised after the container is
 * inserted in the DOM (typically they rely in @document.getElementById@). The @gadgetDomCode@
 * field carries the necessary JavaScript to the outermost gadget where it will be executed
 * at the right time.
 */
export interface GadgetOut<W, O> {
  /** Webits at the top level. */
  readonly gadgetView: readonly WebitItem[];
  /** Code to be executed after the view is inserted in the DOM. */
  readonly gadgetDomCode: RemoteMonad<null>;
  /** Data sent by the side channel. Retries until event occurs. (STM.) */
  readonly gadgetEvents: STM<W>;
  /** Gadget output. */
  readonly gadgetOutput: GadgetState<O>;
}
export function GadgetOut<W, O>(
  gadgetView: readonly WebitItem[],
  gadgetDomCode: RemoteMonad<null>,
  gadgetEvents: STM<W>,
  gadgetOutput: GadgetState<O>,
): GadgetOut<W, O> {
  return { gadgetView, gadgetDomCode, gadgetEvents, gadgetOutput };
}

/** `deriving (Functor)` for GadgetOut (maps the output). */
export function fmap_GadgetOut<W, O, R>(f: (o: O) => R, g: GadgetOut<W, O>): GadgetOut<W, R> {
  return GadgetOut(g.gadgetView, g.gadgetDomCode, g.gadgetEvents, fmap_TState((x: GadgetData<O>) => fmap_GadgetData(f, x), g.gadgetOutput));
}

/** `pure v = GadgetOut [] (return ()) retry (pure $ pure v)` */
export function pure_GadgetOut<W, O>(v: O): GadgetOut<W, O> {
  return GadgetOut<W, O>([], pureRemote(null), () => retry(), pure_TState<boolean, GadgetData<O>>(pure_GadgetData(v)));
}

/** `f <*> v` of `instance Applicative (GadgetOut w)` */
export function ap_GadgetOut<W, A, R>(f: GadgetOut<W, (a: A) => R>, v: GadgetOut<W, A>): GadgetOut<W, R> {
  return GadgetOut<W, R>(
    [...f.gadgetView, ...v.gadgetView],
    seqRemote(f.gadgetDomCode, v.gadgetDomCode),
    () => orElse(f.gadgetEvents, v.gadgetEvents),
    // (<*>) <$> gadgetOutput f <*> gadgetOutput v
    ap_TState(
      fmap_TState((gf: GadgetData<(a: A) => R>) => (gv: GadgetData<A>) => ap_GadgetData(gf, gv), f.gadgetOutput),
      v.gadgetOutput,
    ),
  );
}

/** `liftA2 f x y` for GadgetOut (`f <$> x <*> y`). */
export function liftA2_GadgetOut<W, A, B, R>(f: (a: A, b: B) => R, x: GadgetOut<W, A>, y: GadgetOut<W, B>): GadgetOut<W, R> {
  return ap_GadgetOut(fmap_GadgetOut((a: A) => (b: B) => f(a, b), x), y);
}

/** `foldr (liftA2 (.)) (pure id) outs`: combine the outputs of the children of a grouping gadget. */
function composeOutputs<W, A>(outs: readonly GadgetOut<W, (a: A) => A>[]): GadgetOut<W, (a: A) => A> {
  return outs.reduceRight(
    (acc: GadgetOut<W, (a: A) => A>, r: GadgetOut<W, (a: A) => A>) =>
      liftA2_GadgetOut((f: (a: A) => A, g: (a: A) => A) => (x: A) => f(g(x)), r, acc),
    pure_GadgetOut<W, (a: A) => A>((x: A) => x),
  );
}

/**
 * Duplicate  the argument while filtering out invalid events. The initial behaviour may be
 * invalid.
 */
export function cleanOutput<A, B>(_elmer: ElmerEnv, st: TState<A, GadgetData<B>>): TState<A, GadgetData<B>> {
  const [r, st1, writer] = atomicallySync((): [TState<A, GadgetData<B>>, TState<A, GadgetData<B>>, (a: A, b: GadgetData<B>) => void] => {
    const st1 = st.tStateDup();
    const v1 = st.tStateBehaviour();
    const [r, writer] = newTState<A, GadgetData<B>>(v1);
    return [r, st1, writer];
  });
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() => {
        const v = st1.tStateEvent();
        if (v[1]._gdOk) writer(v[0], v[1]);
      }),
    ),
  );
  labelThread(threadId, "cleanOutput");
  return r;
}

/**
 * Make the output validity conditional on an external condition. If the @Bool@ is false then
 * all the gadget values will be flagged as invalid.
 */
export function qualifyOutput<W, O>(ok: boolean, o: GadgetOut<W, O>): GadgetOut<W, O> {
  return { ...o, gadgetOutput: fmap_TState((x: GadgetData<O>) => over(gdOk<O>(), (b: boolean) => ok && b, x), o.gadgetOutput) };
}

/**
 * Merges two streams of GadgetData, typically the gadget input and user actions.
 *
 * Gadgets which receive invalid inputs from upstream should present the data to the user without
 * flagging the invalidity. The output validity should be @AND@ the input validity and the
 * validity of the user data. The initial value of the output is the value of the first argument.
 *
 * The input events are only propogated to the output if they change the value.
 */
export function mergeGadgetData<A>(ts1: GadgetState<A>, ts2: GadgetState<A>): GadgetState<A> {
  const ts1a = tStateDupIO(ts1);
  const ts2a = tStateDupIO(ts2);
  const initial = atomicallySync(() => {
    const i1 = ts1a.tStateBehaviour();
    const i2 = ts2a.tStateBehaviour();
    return GadgetData(i1._gdOk && i2._gdOk, i1._gdValue);
  });
  const [out, writer] = newTStateIO<boolean, GadgetData<A>>(initial);
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() =>
        orElse(
          () => {
            const [userflag, v1] = ts1a.tStateEvent();
            const oldValue = out.tStateBehaviour();
            if (!equals(v1, oldValue)) {
              const v2 = ts2a.tStateBehaviour();
              writer(userflag, GadgetData(v1._gdOk && v2._gdOk, v1._gdValue));
            }
          },
          () => {
            const [userflag, v2] = ts2a.tStateEvent();
            const oldValue = out.tStateBehaviour();
            if (!equals(v2, oldValue)) {
              const v1 = ts1a.tStateBehaviour();
              writer(userflag, GadgetData(v1._gdOk && v2._gdOk, v2._gdValue));
            }
          },
        ),
      ),
    ),
  );
  labelThread(threadId, "mergeGadgetData");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rendering

/** `fmap f <$> i`: map the value inside a gadget data stream. */
function fmapIn<A, B>(f: (a: A) => B, i: GadgetState<A>): GadgetState<B> {
  return fmap_TState((x: GadgetData<A>) => fmap_GadgetData(f, x), i);
}

/** `return ()` in the remote monad. */
const noDomCode: RemoteMonad<null> = pureRemote(null);

/** `retry` as a first-class STM value. */
const retrySTM = <A>(): A => retry();

/** `foldr1 orElse actions`, run in the current transaction. */
function orElseAll<A>(actions: readonly STM<A>[]): A {
  if (actions.length === 0) return error("foldr1: empty list");
  return actions.slice(0, -1).reduceRight<STM<A>>((acc, a) => () => orElse(a, acc), actions[actions.length - 1])();
}

/** Haskell `Vector.!?` / safe list index. */
function index<A>(xs: readonly A[], n: number): Maybe<A> {
  return Number.isInteger(n) && n >= 0 && n < xs.length ? Just(xs[n]) : Nothing;
}

/** `LT.decodeLatin1 . encode`: JSON text whose UTF-8 bytes are read as Latin-1. */
function encodeLatin1(v: J.Value): JavaScript {
  const bytes = U.encodeUtf8(J.encode(v));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * Render a GUI Gadget as Webits.
 *
 * See 'GadgetOut' for the @Bool@ flags on the environment and input.
 *
 * The loop construct employs @mdo@, which may have odd effects on processes. If stuff hangs for
 * no apparent reason, suspect this first.
 */
export function renderGadget<E, W, I, O>(
  elmer: ElmerEnv,
  /** The environment. */
  env: TState<boolean, E>,
  /** The input. */
  i: GadgetState<I>,
  g: Gadget<E, W, I, O>,
): GadgetOut<W, O> {
  const gg = g as Gadget<any, any, any, any>;
  const e: TState<boolean, any> = env;
  const inp: GadgetState<any> = i;
  switch (gg.tag) {
    case "Null":
      return renderGadget_Null(inp);
    case "Pure":
      return renderGadget_Pure(inp, gg._0);
    case "Dot":
      return renderGadget_Dot(elmer, e, inp, gg._0, gg._1);
    case "Prod":
      return renderGadget_Prod(elmer, e, inp, gg._0, gg._1);
    case "Loop":
      return renderGadget_Loop(elmer, e, inp, gg._0);
    case "Focusing":
      return renderGadget_Focusing(elmer, e, inp, gg._0, gg._1);
    case "Prismatic":
      return renderGadget_Prismatic(elmer, e, inp, gg._0, gg._1, gg._2);
    case "PrismaticOver":
      return renderGadget_PrismaticOver(elmer, e, inp, gg._0, gg._1, gg._2);
    case "Traversing":
      return renderGadget_Traversing(elmer, e, inp, gg._0, gg._1, gg._2);
    case "TraversingOver":
      return renderGadget_TraversingOver(elmer, e, inp, gg._0, gg._1, gg._2);
    case "Accum":
      return renderGadget_Accum(elmer, e, inp, gg._0);
    case "Initially":
      return renderGadget_Initially(inp, gg._0);
    case "GetInitial":
      return renderGadget_GetInitial(elmer, e, inp, gg._0);
    case "GetEnv":
      return renderGadget_GetEnv(e);
    case "GetInitialEnv":
      return renderGadget_GetInitialEnv(elmer, e, inp, gg._0);
    case "WithEnv":
      return renderGadget_WithEnv(elmer, e, inp, gg._0, gg._1);
    case "Send":
      return renderGadget_Send(inp, gg._0);
    case "SendMap":
      return renderGadget_SendMap(elmer, e, inp, gg._0, gg._1);
    case "Exec":
      return renderGadget_Exec(elmer, e, inp, gg._0);
    case "Cond":
      return renderGadget_Cond(elmer, e, inp, gg._0);
    case "UnionTab":
      if (gg._0.length === 0) return error("renderGadget UnionTab: empty list.");
      return renderGadget_UnionTab(elmer, e, inp, gg._0);
    case "Enabled":
      return renderGadget_Enabled(elmer, e, inp, gg._0);
    case "Optional":
      return renderGadget_Optional(elmer, e, inp, gg._0, gg._1);
    case "Intercept":
      return renderGadget_Intercept(elmer, e, inp, gg._0, gg._1, gg._2);
    case "Icon":
      return renderGadget_Icon(elmer, e, inp, gg._0, gg._1);
    case "Coloured":
      return renderGadget_Coloured(elmer, e, inp, gg._0, gg._1);
    case "Linked":
      return renderGadget_Linked(elmer, e, inp, gg._0, gg._1);
    case "Styled":
      return renderGadget_Styled(elmer, e, inp, gg._0, gg._1);
    case "Frame":
      return renderGadget_Frame(elmer, e, inp, gg._0, gg._1);
    case "Form":
      return renderGadget_Form(elmer, e, inp, gg._0, gg._1);
    case "TabForm":
      return renderGadget_TabForm(elmer, e, inp, gg._0);
    case "Box":
      return renderGadget_Box(elmer, e, inp, gg._0, gg._1);
    case "Grid":
      return renderGadget_Grid(elmer, e, inp, gg._0, gg._1, gg._2);
    case "Validate":
      return renderGadget_Validate(elmer, e, inp, (e1: any, i1: any, o1: any) => gg._0(e1, i1, o1), gg._1);
    case "ValidateText":
      return renderGadget_ValidateText(elmer, e, inp, (e1: any, i1: any, o1: any) => gg._0(e1, i1, o1), gg._1);
    case "TextBox":
      return renderGadget_TextBox(elmer, e, inp, gg._0);
    case "DisplayText":
      return renderGadget_DisplayText(elmer, inp);
    case "MemoBox":
      return renderGadget_MemoBox(elmer, inp, gg._0);
    case "DisplayMemo":
      return renderGadget_DisplayMemo(elmer, inp);
    case "Combo":
      return renderGadget_Combo(elmer, e, inp, gg._0);
    case "Radio":
      return renderGadget_Radio(elmer, e, inp, gg._0);
    case "TickBox":
      return renderGadget_TickBox(elmer, inp);
    case "Message":
      return renderGadget_Message(elmer, e, inp, gg._0);
    case "FixedText":
      return renderGadget_FixedText(elmer, e, inp, gg._0, gg._1);
    case "FixedMemo":
      return renderGadget_FixedMemo(elmer, e, inp, gg._0, gg._2, gg._3);
    case "ClickableList":
      return renderGadget_ClickableList(elmer, inp);
    case "DateBox":
      return renderGadget_DateBox(elmer, inp);
    case "IconBox":
      return renderGadget_IconBox(elmer, inp);
    case "ColourBox":
      return renderGadget_ColourBox(elmer, inp);
    case "ImageDisplay":
      return renderGadget_ImageDisplay(elmer, inp, gg._0);
    case "TreeSelector":
      return renderGadget_TreeSelector(elmer, e, inp, gg._0);
    case "Table":
      return gg._2.tag === "Nothing"
        ? renderGadget_Table(elmer, inp, gg._0, gg._1)
        : renderGadget_Table_Just(elmer, e, inp, gg._0, gg._1, gg._2.value);
    case "ForestTable":
      return renderGadget_ForestTable(elmer, e, inp, gg._0, gg._1);
    case "ForestEditor":
      return renderGadget_ForestEditor(elmer, e, inp, gg._0, gg._1, gg._2, gg._3);
    case "FilePathSelector":
      return error("Unimplemented FilePathSelector");
    case "Scrolled":
      return renderGadget_Scrolled(elmer, e, inp, gg._0);
    case "ButtonBar":
      return gg._0.length === 0 ? renderGadget_ButtonBar_Empty() : renderGadget_ButtonBar(elmer, gg._0);
    case "ButtonIO":
      return renderGadget_ButtonIO(elmer, e, inp, gg._0, gg._1);
    case "Image":
      return renderGadget_Image(elmer, inp, gg._0);
    case "Trace":
      return renderGadget_Trace(elmer, e, inp, gg._0, gg._1, (i1: any, o1: any) => gg._2(i1, o1), gg._3);
    default:
      return error("renderGadget: unknown gadget " + (gg as { tag: string }).tag);
  }
}

type AnyGadget = Gadget<any, any, any, any>;
type AnyEnv = TState<boolean, any>;
type AnyIn = GadgetState<any>;
type AnyOut = GadgetOut<any, any>;

function renderGadget_Null(i: AnyIn): AnyOut {
  return GadgetOut([], noDomCode, retrySTM, i);
}

function renderGadget_Pure(i: AnyIn, f: (x: any) => any): AnyOut {
  return GadgetOut([], noDomCode, retrySTM, fmapIn(f, i));
}

function renderGadget_Dot(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, g1: AnyGadget, g2: AnyGadget): AnyOut {
  const r2 = renderGadget(elmer, env, i, g2);
  const r1 = renderGadget(elmer, env, r2.gadgetOutput, g1);
  return GadgetOut(
    [...r2.gadgetView, ...r1.gadgetView],
    seqRemote(r2.gadgetDomCode, r1.gadgetDomCode),
    () => orElse(r2.gadgetEvents, r1.gadgetEvents),
    r1.gadgetOutput,
  );
}

function renderGadget_Prod(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, g1: AnyGadget, g2: AnyGadget): AnyOut {
  const r1 = renderGadget(elmer, env, fmapIn((p: readonly [any, any]) => p[0], i), g1);
  const r2 = renderGadget(elmer, env, fmapIn((p: readonly [any, any]) => p[1], i), g2);
  return liftA2_GadgetOut((a: any, b: any): [any, any] => [a, b], r1, r2);
}

// Loop :: Gadget (i, s) (o, s) -> Gadget i o
function renderGadget_Loop(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, g: AnyGadget): AnyOut {
  // mdo
  //   let loopInput = liftA2 (,) <$> i <*> (fmap snd <$> gadgetOutput result)
  //   result <- renderGadget env loopInput g
  //   return $ fst <$> result
  let result: AnyOut | null = null;
  const resultOutput = (): AnyIn => {
    // Haskell fixIO: reading the result before it exists.
    if (result === null) throw new Error("cyclic evaluation in fixIO");
    return result.gadgetOutput;
  };
  const lateOutput: AnyIn = TState(
    () => resultOutput().tStateBehaviour(),
    () => resultOutput().tStateEvent(),
    () => resultOutput().tStateDup(),
  );
  const loopInput: AnyIn = ap_TState(
    fmap_TState((a: GadgetData<any>) => (b: GadgetData<any>) => ap_GadgetData(fmap_GadgetData((x: any) => (y: any) => [x, y], a), b), i),
    fmapIn((p: readonly [any, any]) => p[1], lateOutput),
  );
  result = renderGadget(elmer, env, loopInput, g);
  return fmap_GadgetOut((p: readonly [any, any]) => p[0], result);
}

function renderGadget_Focusing(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, lns: Lens<any, any, any, any>, g: AnyGadget): AnyOut {
  const extract = (x: any): any => view(lns, x);
  const out = renderGadget(elmer, env, fmapIn(extract, i), g);
  return fmap_GadgetOut((v: any) => (s: any) => set(lns, v, s), out);
}

function renderGadget_Prismatic(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, d: any, prsm: Prism<any, any, any, any>, g: AnyGadget): AnyOut {
  return withPrism(prsm, (inject, extract) => {
    const extract1 = (x: any): any => fromRight(d, extract(x));
    const out = renderGadget(elmer, env, fmapIn(extract1, i), g);
    return fmap_GadgetOut(inject, out);
  });
}

function renderGadget_PrismaticOver(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, d: any, prsm: Prism<any, any>, g: AnyGadget): AnyOut {
  const extract = (x: any): any => fromMaybe(d, preview(prsm, x));
  const out = renderGadget(elmer, env, fmapIn(extract, i), g);
  return fmap_GadgetOut((f: (a: any) => any) => (v: any) => review(prsm, f(extract(v))), out);
}

function renderGadget_Traversing(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, d: any, trv: Traversal<any, any, any, any>, g: AnyGadget): AnyOut {
  const extract = (x: any): any => fromMaybe(d, preview(trv, x));
  const out = renderGadget(elmer, env, fmapIn(extract, i), g);
  return fmap_GadgetOut((v: any) => (s: any) => set(trv, v, s), out);
}

function renderGadget_TraversingOver(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, d: any, trv: Traversal<any, any, any, any>, g: AnyGadget): AnyOut {
  const extract = (x: any): any => fromMaybe(d, preview(trv, x));
  const out = renderGadget(elmer, env, fmapIn(extract, i), g);
  return fmap_GadgetOut((f: (a: any) => any) => (s: any) => over(trv, f, s), out);
}

// Accum :: Gadget e w a (a -> a) -> Gadget' e w a
function renderGadget_Accum(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, g: AnyGadget): AnyOut {
  const applyUpdate = (gf: GadgetData<(a: any) => any>, gold: GadgetData<any>): GadgetData<any> => GadgetData(gf._gdOk, gf._gdValue(gold._gdValue));
  const inner = renderGadget(elmer, env, i, g);
  const i1 = tStateDupIO(i);
  const [output, writer] = atomicallySync(() => newTState<boolean, GadgetData<any>>(i.tStateBehaviour()));
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() =>
        // No need to duplicate @gadgetOutput inner@ because this is the only consumer.
        orElse(
          () => {
            const [userflag, f] = inner.gadgetOutput.tStateEvent();
            const nw = applyUpdate(f, output.tStateBehaviour());
            writer(userflag, nw);
          },
          () => {
            const [userflag, v] = i1.tStateEvent();
            writer(userflag, v);
          },
        ),
      ),
    ),
  );
  labelThread(threadId, "renderGadget_Accum");
  return { ...inner, gadgetOutput: output };
}

function renderGadget_Initially(i: AnyIn, v: any): AnyOut {
  const initial = newTMVarIO(GadgetData(true, v));
  // i {tStateBehaviour = readTMVar initial `orElse` tStateBehaviour i}
  return GadgetOut(
    [],
    noDomCode,
    retrySTM,
    TState(
      () => orElse(() => readTMVar(initial), () => i.tStateBehaviour()),
      () => i.tStateEvent(),
      () => i.tStateDup(),
    ),
  );
}

function renderGadget_GetInitial(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => AnyGadget): AnyOut {
  const g = f(atomicallySync(() => i.tStateBehaviour())._gdValue);
  return renderGadget(elmer, env, i, g);
}

function renderGadget_GetEnv(env: AnyEnv): AnyOut {
  return GadgetOut([], noDomCode, retrySTM, fmap_TState((x: any) => GadgetData(true, x), env));
}

function renderGadget_GetInitialEnv(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => AnyGadget): AnyOut {
  const g = f(atomicallySync(() => env.tStateBehaviour()));
  return renderGadget(elmer, env, i, g);
}

function renderGadget_WithEnv(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, engG: AnyGadget, g: AnyGadget): AnyOut {
  const envOut1 = renderGadget(elmer, env, i, engG);
  const envState = cleanOutput(elmer, envOut1.gadgetOutput);
  return renderGadget(elmer, fmap_TState((x: GadgetData<any>) => view(gdValue(), x), envState), i, g);
}

function renderGadget_Send(i: AnyIn, f: (a: any) => Maybe<any>): AnyOut {
  const chan = newTQueueIO<any>();
  const i2 = atomicallySync(() => i.tStateDup());
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() => {
        const v = i2.tStateEvent();
        if (v[1]._gdOk && v[0]) {
          const w = f(v[1]._gdValue);
          if (w.tag === "Just") writeTQueue(chan, w.value);
        }
      }),
    ),
  );
  labelThread(threadId, "renderGadget_Send");
  return GadgetOut([], noDomCode, () => readTQueue(chan), i);
}

function renderGadget_SendMap(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (w: any) => Maybe<any>, g: AnyGadget): AnyOut {
  const inner = renderGadget(elmer, env, i, g);
  const chan = newTQueueIO<any>();
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() => {
        const w = f(inner.gadgetEvents());
        if (w.tag === "Just") writeTQueue(chan, w.value);
      }),
    ),
  );
  labelThread(threadId, "renderGadget_SendMap");
  return { ...inner, gadgetEvents: () => readTQueue(chan) };
}

function renderGadget_Exec(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, gadgetF: (a: any) => AnyGadget): AnyOut {
  // doExec parent v = do
  //   o <- renderGadget env (fmap snd <$> i) $ v ^. gdValue
  //   childs <- liftIO $ readTVarIO $ webitContainerChildren parent
  //   mapM_ deleteWebit childs
  //   mapM_ (showWebit parent) $ gadgetView o
  //   return $ qualifyOutput (v ^. gdOk) o
  // TypeScript: `deleteWebit` is asynchronous, so when there are old children to delete the
  // result is a Promise. (The first rendering has none, so it is synchronous.)
  const doExec = (elmer1: ElmerEnv, parent: WebitContainer, v: GadgetData<AnyGadget>): AnyOut | Promise<AnyOut> => {
    const o = renderGadget(elmer1, env, fmapIn((p: readonly [any, any]) => p[1], i), v._gdValue);
    const childs = readTVarIO(parent.webitContainerChildren);
    const finish = (): AnyOut => {
      for (const w of o.gadgetView) showWebit(WebitClass_WebitItem, elmer1, parent, w);
      return qualifyOutput(v._gdOk, o);
    };
    if (childs.length === 0) return finish();
    return (async () => {
      for (const c of childs) await deleteWebit(WebitClass_WebitItem, elmer1, c);
      return finish();
    })();
  };
  const i1 = tStateDupIO(i);
  const parent = makeWebitContainer(elmer, "no-box");
  const initial = atomicallySync(() => i1.tStateBehaviour());
  const initialContent = doExec(elmer, parent, fmap_GadgetData((p: readonly [any, any]) => gadgetF(p[0]), initial)) as AnyOut;
  const initialOutput = atomicallySync(() => initialContent.gadgetOutput.tStateBehaviour());
  const currentArg = newTVarIO(fmap_GadgetData((p: readonly [any, any]) => p[0], initial));
  const currentContent = newTVarIO<AnyOut>(initialContent);
  const [output, outputWriter] = newTStateIO<boolean, GadgetData<any>>(initialOutput);
  // Update the gadget whenever the first part of the input changes.
  const threadId1 = forkIO(() =>
    forever(async () => {
      const io = await atomically((): (() => Promise<void>) => {
        const [userFlag, newInput] = i1.tStateEvent();
        const newArg = fmap_GadgetData((p: readonly [any, any]) => p[0], newInput);
        const oldArg = readTVar(currentArg);
        if (!equals(newArg, oldArg)) {
          writeTVar(currentArg, newArg);
          return async () => {
            const newOut = await runElmer(elmer, (elmer1) => doExec(elmer1, parent, fmap_GadgetData(gadgetF, newArg)));
            JS.send(elmer.elmerEngine, newOut.gadgetDomCode);
            atomicallySync(() => {
              writeTVar(currentContent, newOut);
              outputWriter(userFlag, newOut.gadgetOutput.tStateBehaviour());
            });
          };
        }
        return async () => {};
      });
      await io();
    }),
  );
  // Write output from the current content to the unified output stream.
  const threadId2 = forkIO(() =>
    forever(() =>
      atomically(() => {
        const c = readTVar(currentContent);
        const v = c.gadgetOutput.tStateEvent();
        outputWriter(v[0], v[1]);
      }),
    ),
  );
  labelThread(threadId1, "renderGadget_Exec1");
  labelThread(threadId2, "renderGadget_Exec2");
  return GadgetOut(
    [WebitItem(WebitClass_WebitContainer, parent)],
    initialContent.gadgetDomCode,
    () => readTVar(currentContent).gadgetEvents(),
    output,
  );
}

/** `hideGadget` of `Cond` and `UnionTab`. */
function hideGadget(elmer: ElmerEnv, g: AnyOut): void {
  for (const w of g.gadgetView) elmerSend(elmer, var_(WebitClass_WebitItem.webitHandle(w)) + ".hidden=true");
}

/** `displayGadget` of `Cond` and `UnionTab`. */
function displayGadget(elmer: ElmerEnv, g: AnyOut): void {
  for (const w of g.gadgetView) elmerSend(elmer, var_(WebitClass_WebitItem.webitHandle(w)) + ".hidden=false");
}

/** `getter1` of `Cond` and `UnionTab`: the prism match applied to gadget data. */
function prismGetter1(getter: (s: any) => Either<any, any>): (gd: GadgetData<any>) => Maybe<GadgetData<any>> {
  return (gd) => {
    const r = getter(gd._gdValue);
    return r.tag === "Left" ? Nothing : Just(GadgetData(gd._gdOk, r.value));
  };
}

function renderGadget_Cond(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, opts: readonly PrismaticGadget<any, any, any, any>[]): AnyOut {
  // outputs :: [(predicate, (gadget, index))]
  const outputs: [(x: any) => boolean, [AnyOut, number]][] = opts.map((pg, k) => {
    const n = k + 1;
    const d = pg._0, p = pg._1, g = pg._2;
    return withPrism(p, (setter, getter) => {
      const getter1 = prismGetter1(getter);
      const i1 = filterTStateMaybe(GadgetData(true, d), fmap_TState(getter1, i));
      const o = renderGadget(elmer, env, i1, gPipe(g, arr(setter)));
      return [(x: any) => isRight(getter(x)), [o, n]];
    });
  });
  const parent = makeWebitContainer(elmer, "no-box");
  const defaultOutput = (): [AnyOut, number] =>
    outputs.length > 0 ? outputs[0][1] : error("Gadget cond with empty option list.");
  const chooseOutput = (v: GadgetData<any>): [AnyOut, number] => {
    const found = outputs.find((o) => o[0](v._gdValue));
    return found !== undefined ? found[1] : defaultOutput();
  };
  // Put all the gadgets into the DOM with the hidden flag set.
  for (const [, [g]] of outputs) {
    hideGadget(elmer, g);
    for (const w of g.gadgetView) showWebit(WebitClass_WebitItem, elmer, parent, w);
  }
  const [startOutput, i1] = atomicallySync((): [[AnyOut, number], AnyIn] => [chooseOutput(i.tStateBehaviour()), i.tStateDup()]);
  displayGadget(elmer, startOutput[0]);
  // Collate the output as it changes.
  const [o, writer] = atomicallySync(() => {
    const initOut = startOutput[0].gadgetOutput.tStateBehaviour();
    return newTState<boolean, GadgetData<any>>(initOut);
  });
  const currentChoice = newTVarIO<[AnyOut, number]>(startOutput);
  // Update the displayed Webit when the input changes.
  elmerDaemon(WebitClass_WebitContainer, elmer, parent, async (elmer1) => {
    const [prev, nxt] = await atomically((): [AnyOut, AnyOut] => {
      const [userflag, inp] = i1.tStateEvent();
      const nxt1 = chooseOutput(inp);
      const cur = readTVar(currentChoice);
      if (nxt1[1] !== cur[1]) {
        writeTVar(currentChoice, nxt1);
        writer(userflag, nxt1[0].gadgetOutput.tStateBehaviour());
      }
      return [cur[0], nxt1[0]];
    });
    hideGadget(elmer1, prev);
    displayGadget(elmer1, nxt);
  });
  elmerDaemon(WebitClass_WebitContainer, elmer, parent, () =>
    atomically(() => {
      const cur = readTVar(currentChoice);
      const v = cur[0].gadgetOutput.tStateEvent();
      writer(v[0], v[1]);
    }),
  );
  return GadgetOut(
    [WebitItem(WebitClass_WebitContainer, parent)],
    seqRemote(...outputs.map((o1) => o1[1][0].gadgetDomCode)),
    () => readTVar(currentChoice)[0].gadgetEvents(),
    o,
  );
}

function renderGadget_UnionTab(
  elmer: ElmerEnv,
  env: AnyEnv,
  i: AnyIn,
  tabs: readonly (readonly [T.Text, PrismaticGadget<any, any, any, any>])[],
): AnyOut {
  type Tab = readonly [Webit<null>, AnyOut];
  const receiveClick = (tab: Tab): Maybe<[boolean, Tab]> => {
    tab[0].webitState.tStateEvent();
    return Just([true, tab]); // True for user action.
  };
  const btnHtml = (lbl: T.Text, wId: WebitId): H.Html =>
    H.with_(H.button(H.toHtml(lbl)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.unitJ, wId, null))));
  // Javascript to set the button to "active" and remove active status from the other buttons.
  const setButton = (container: WebitContainer, _u: null, button: JS.RemoteValue<H.Html>, _wId: WebitId): JavaScript =>
    "for(" +
    "var c=" + var_(WebitClass_WebitContainer.webitHandle(container)) + ".firstChild;" +
    "c!==null;" +
    "c=c.nextSibling) {" +
    'c.className=c.className.replace(" active", "");' +
    "}" +
    var_(button) + '.className += " active";';

  const elmer0 = elmer;
  const i1 = atomicallySync(() => i.tStateDup());
  const tabHeader = makeWebitContainer(elmer, "tab-header");
  // tabWebits contains list of ((button, body output), selection predicate)
  const tabWebits: [Tab, (x: GadgetData<any>) => boolean][] = tabs.map(([lbl, pg]) => {
    const d = pg._0, p = pg._1, g = pg._2;
    return withPrism(p, (setter, getter) => {
      const btn = makeWebit<null>(J.unitJ, elmer, (wId) => btnHtml(lbl, wId), (u, button, wId) => setButton(tabHeader, u, button, wId), null);
      const getter1 = prismGetter1(getter);
      const i2 = filterTStateMaybe(GadgetData(true, d), fmap_TState(getter1, i));
      const page = renderGadget(elmer, env, i2, gPipe(g, arr(setter)));
      return [[btn, page] as const, (x: GadgetData<any>) => isJust(getter1(x))];
    });
  });
  // Construct the Webit
  for (const [[btn]] of tabWebits) showWebit(WebitClass_Webit, elmer, tabHeader, btn);
  const pageParent = makeWebitContainer(elmer, "tab-body");
  for (const [[btn, page]] of tabWebits) {
    hideGadget(elmer, page);
    showWebit(WebitClass_Webit, elmer, tabHeader, btn);
    for (const w of page.gadgetView) showWebit(WebitClass_WebitItem, elmer, pageParent, w);
  }
  const outer = makeWebitContainer(elmer, "no-box");
  showWebit(WebitClass_WebitContainer, elmer, outer, tabHeader);
  showWebit(WebitClass_WebitContainer, elmer, outer, pageParent);
  const initialInput = atomicallySync(() => i.tStateBehaviour());
  const initialSelection: Tab = (tabWebits.find((t) => t[1](initialInput)) ?? tabWebits[0])[0];
  const [output, writer] = atomicallySync(() => {
    initialSelection[0].webitIn(null);
    const initialOut = initialSelection[1].gadgetOutput.tStateBehaviour();
    return newTState<boolean, GadgetData<any>>(initialOut);
  });
  displayGadget(elmer, initialSelection[1]);
  const currentSelection = newTVarIO<Tab>(initialSelection);
  // Update display when a new input changes the selection or a tab is clicked.
  elmerDaemon(WebitClass_WebitContainer, elmer, outer, async () => {
    const [old, selected] = await atomically((): [Tab, Maybe<[boolean, Tab]>] => {
      // foldr1 is safe because tabs is not empty.
      const selected = orElse(
        () => orElseAll(tabWebits.map((t) => () => receiveClick(t[0]))),
        (): Maybe<[boolean, Tab]> => {
          const [userflag, v] = i1.tStateEvent();
          const found = tabWebits.find((t) => t[1](v));
          return found !== undefined ? Just([userflag, found[0]]) : Nothing;
        },
      );
      const old = readTVar(currentSelection);
      const oldId = Just(WebitClass_Webit.webitId(old[0]));
      const newId = mapMaybeValue((s: [boolean, Tab]) => WebitClass_Webit.webitId(s[1][0]), selected);
      if (!equals(oldId, newId)) {
        if (selected.tag === "Just") {
          const [userflag, [, page]] = selected.value;
          writeTVar(currentSelection, selected.value[1]);
          const newOut = page.gadgetOutput.tStateBehaviour();
          writer(userflag, newOut);
          writeTVar(currentSelection, selected.value[1]);
        }
      }
      return [old, selected];
    });
    if (selected.tag === "Just") {
      const [, [btn, page]] = selected.value;
      await runElmer(elmer0, (elmer1) => {
        hideGadget(elmer1, old[1]);
        displayGadget(elmer1, page);
        atomicallySync(() => btn.webitIn(null));
      });
    }
  });
  // Update the output when the output of the currently selected page changes.
  elmerDaemon(WebitClass_WebitContainer, elmer, outer, () =>
    atomically(() => {
      const cs = readTVar(currentSelection);
      const v = cs[1].gadgetOutput.tStateEvent();
      writer(v[0], v[1]);
    }),
  );
  return GadgetOut(
    [WebitItem(WebitClass_WebitContainer, outer)],
    seqRemote(...tabWebits.map((t) => t[0][1].gadgetDomCode)),
    () => readTVar(currentSelection)[1].gadgetEvents(),
    output,
  );
}

function renderGadget_Enabled(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, g: AnyGadget): AnyOut {
  const i1 = tStateDupIO(i);
  const result = renderGadget(elmer, env, fmapIn((p: readonly [any, boolean]) => p[0], i), g);
  const initEnabled = atomicallySync(() => (i.tStateBehaviour()._gdValue as readonly [any, boolean])[1]);
  const parent = makeWebitContainer1(elmer, "fieldset", initEnabled ? [] : [["disabled", "disabled"]]);
  for (const w of result.gadgetView) showWebit(WebitClass_WebitItem, elmer, parent, w);
  // Add or remove the "disabled" attribute as the input changes.
  // Faithful: the attribute name is pushed as the raw JavaScript text @disabled@ (an undefined
  // variable), as in the original, so the change fails in the browser.
  void forkIO(() =>
    forever(() =>
      atomically(() => {
        const enabledFlag = (i1.tStateEvent()[1]._gdValue as readonly [any, boolean])[1];
        elmer.elmerSendJS(
          var_(WebitClass_WebitContainer.webitHandle(parent)) + "." +
            (enabledFlag ? call("removeAttribute", ["disabled"]) : call("setAttribute", ["disabled", "disabled"])),
        );
      }),
    ),
  );
  return { ...result, gadgetView: [WebitItem(WebitClass_WebitContainer, parent)] };
}

function renderGadget_Optional(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, d: any, g: AnyGadget): AnyOut {
  switch (g.tag) {
    case "TextBox": {
      const p = g._0;
      return renderGadget(elmer, env, i, TextBox((e1: any) => prismToMaybe(p(e1))));
    }
    case "DisplayText":
      return renderGadget(
        elmer,
        env,
        i,
        gPipe(
          arr((m: Maybe<T.Text>) => fromMaybe("", m)),
          DisplayText(),
          arr((t: T.Text): Maybe<T.Text> => (T.null(t) ? Nothing : Just(t))),
        ),
      );
    case "MemoBox": {
      const outF = (txt: T.Text): Maybe<T.Text> => (txt === "" ? Nothing : Just(txt));
      return fmap_GadgetOut(outF, renderGadget(elmer, env, fmapIn((m: Maybe<T.Text>) => fromMaybe("", m), i), MemoBox(g._0, g._1)));
    }
    case "Combo": {
      const itemF = g._0;
      const nothingItem = ComboItem<Maybe<any>>("", Nothing, Nothing, Nothing);
      return renderGadget(
        elmer,
        env,
        i,
        Combo((e1: any) => [nothingItem, ...itemF(e1).map((c: ComboItem<any>) => fmap_ComboItem((x: any) => Just(x), c))]),
      );
    }
    case "TickBox":
      return renderGadget(
        elmer,
        env,
        i,
        Combo(() => [
          ComboItem<Maybe<boolean>>("", Nothing, Nothing, Nothing),
          ComboItem("Yes", Just("object-select-symbolic"), Nothing, Just(true)), // Green tick
          ComboItem("No", Just("list-remove-symbolic"), Nothing, Just(false)), // Red cross
        ]),
      );
    case "FixedText": {
      const textF = g._0;
      const maybeText = (e1: any, m: Maybe<any>): T.Text => (m.tag === "Nothing" ? "" : textF(e1, m.value));
      if (g._1.tag === "Nothing") return renderGadget(elmer, env, i, FixedText(maybeText, Nothing));
      const selector2 = promoteDialogSelector(d, _Just(), g._1.value);
      return renderGadget(elmer, env, i, FixedText(maybeText, Just(selector2)));
    }
    case "FixedMemo": {
      const textF = g._2;
      const maybeText = (e1: any, m: Maybe<any>): T.Text => (m.tag === "Nothing" ? "" : textF(e1, m.value));
      if (g._3.tag === "Nothing") return renderGadget(elmer, env, i, FixedMemo(g._0, g._1, maybeText, Nothing));
      const selector2 = promoteDialogSelector(d, _Just(), g._3.value);
      return renderGadget(elmer, env, i, FixedMemo(g._0, g._1, maybeText, Just(selector2)));
    }
    case "DateBox":
      return renderGadget_Opt_DateBox(elmer, i);
    default:
      // ToDo: Fill in the other Optional special cases.
      return renderGadget_Optional_General(elmer, env, i, d, g);
  }
}

function renderGadget_Opt_DateBox(elmer: ElmerEnv, i: AnyIn): AnyOut {
  // This ignores the date format in the argument because HTML delegates that to the browser.
  const dateFmt = "%Y-%m-%d"; // Standard browser date format.
  // Faithful: the handler defines an arrow function without calling it, so no event is sent.
  const dateHtml = (wId: WebitId): H.Html =>
    H.with_(
      H.input(),
      HA.type_("date"),
      HA.onchange(jsValue("() => {" + call("jsb.event", ["{d:" + value(wId) + ",v:this.value}"]) + ";}")),
    );
  // Faithful: @value@ is pushed as raw JavaScript text (an undefined variable).
  const updateValue = (txt: T.Text, ref: JS.RemoteValue<H.Html>): JavaScript => var_(ref) + "." + call("setAttribute", ["value", value(txt)]);
  const initVal = atomicallySync(() => i.tStateBehaviour());
  const prsm = prismToMaybe(datePrism(dateFmt));
  const i1 = tStateDupIO(i);
  const entry = makeWebit(J.textJ, elmer, dateHtml, updateValue, review(prsm, initVal._gdValue));
  const [output, writer] = newTStateIO<boolean, GadgetData<any>>(initVal);
  elmerDaemon(WebitClass_Webit, elmer, entry, () =>
    atomically(() =>
      orElse(
        () => {
          const [userflag, newVal] = i1.tStateEvent();
          const oldVal = output.tStateBehaviour();
          if (!equals(oldVal._gdValue, newVal._gdValue)) {
            entry.webitIn(review(prsm, newVal._gdValue));
            writer(userflag, newVal);
          }
        },
        () => {
          const [, newText] = entry.webitState.tStateEvent();
          const oldVal = output.tStateBehaviour();
          const newVal = preview(prsm, newText);
          if (!equals(Just(oldVal._gdValue), newVal) && newVal.tag === "Just") writer(true, GadgetData(true, newVal.value));
        },
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, entry)], noDomCode, retrySTM, output);
}

function renderGadget_Optional_General(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, d: any, g: AnyGadget): AnyOut {
  // proc v -> do
  //   -- The general case for Optional decorates the inner widget with a check button. If there
  //   -- are no inner widgets then it passes its input straight through.
  //   ticked <- TickBox -< isJust v
  //   innerVal <- g -< fromMaybe d v
  //   returnA -< if ticked then Just innerVal else Nothing
  return renderGadget(
    elmer,
    env,
    i,
    gPipe(
      arr((v: Maybe<any>): [boolean, Maybe<any>] => [isJust(v), v]),
      gFirst(TickBox()),
      arr(([ticked, v]: readonly [boolean, Maybe<any>]): [any, boolean] => [fromMaybe(d, v), ticked]),
      gFirst(g),
      arr(([innerVal, ticked]: readonly [any, boolean]): Maybe<any> => (ticked ? Just(innerVal) : Nothing)),
    ),
  );
}

function renderGadget_Intercept(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, dblClick: boolean, dSel: DialogSelector_<any, any, any>, g: AnyGadget): AnyOut {
  const [innerInput, writeInner] = atomicallySync(() => newTState<boolean, GadgetData<any>>(i.tStateBehaviour()));
  const i1 = atomicallySync(() => i.tStateDup());
  const inner = renderGadget(elmer, env, innerInput, g);
  const prop = dblClick ? "ondblclick" : "onclick";
  // Web: the Haskell builds the attribute from the id of the container it is creating (mdo); the
  // attribute is set right after creating the container instead.
  const box = makeWebitContainer1(elmer, "div", []);
  const script = webitEvent(J.unitJ, WebitClass_WebitContainer.webitId(box), null);
  JS.send(elmer.elmerEngine, command(var_(WebitClass_WebitContainer.webitHandle(box)) + "." + call("setAttribute", [value(prop), value(script)])));
  const clickChan: TChan<null> = addWebitChannel(J.unitJ, WebitClass_WebitContainer, elmer, box);
  // Faithful: the box is never shown, so the clicks never come.
  const vEvent = (): [null, any] => {
    const v = inner.gadgetOutput.tStateBehaviour();
    readTChan(clickChan);
    return [null, v._gdValue];
  };
  const clickResult = mkWebitPopupSelect(elmer, env, dSel, vEvent);
  elmerDaemon(WebitClass_WebitContainer, elmer, box, () =>
    atomically(() => {
      const v = orElse(
        (): Maybe<[boolean, GadgetData<any>]> => Just(i1.tStateEvent()),
        (): Maybe<[boolean, GadgetData<any>]> => {
          const r = readTChan(clickResult);
          return r[1].tag === "Just" ? Just([true, GadgetData(true, r[1].value)]) : Nothing;
        },
      );
      if (v.tag === "Just") writeInner(v.value[0], v.value[1]);
    }),
  );
  return inner;
}

function renderGadget_Icon(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => T.Text, g: AnyGadget): AnyOut {
  const img = (nm: T.Text): H.Html => H.with_(H.img(), HA.src(H.textValue(iconUrl(nm))), HA.class_("icon-inline"));
  const updateIcon = (nm: T.Text, ref: JS.RemoteValue<H.Html>): JavaScript => var_(ref) + ".innerHTML=" + value(H.renderHtml(img(nm)));
  const inner = renderGadget(elmer, env, i, g);
  const i1 = atomicallySync(() => i.tStateDup());
  const startIcon = atomicallySync(() => f(i.tStateBehaviour()._gdValue));
  const icon1 = makeWebit(J.textJ, elmer, () => img(startIcon), updateIcon, startIcon);
  elmerDaemon(WebitClass_Webit, elmer, icon1, () =>
    atomically(() => {
      icon1.webitIn(f(i1.tStateEvent()[1]._gdValue));
    }),
  );
  const hbox = makeWebitContainer(elmer, "horizontal");
  showWebit(WebitClass_Webit, elmer, hbox, icon1);
  for (const w of inner.gadgetView) showWebit(WebitClass_WebitItem, elmer, hbox, w);
  return { ...inner, gadgetView: [WebitItem(WebitClass_WebitContainer, hbox)] };
}

function renderGadget_Coloured(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => Maybe<Colour>, g: AnyGadget): AnyOut {
  const setColours = (c: Maybe<Colour>, w: WebitItem): JavaScript => {
    const h = var_(WebitClass_WebitItem.webitHandle(w));
    if (c.tag === "Nothing") return h + ".style.color=null;" + h + ".style.backgroundColor=null;";
    const bg = c.value;
    const bg1 = review(colourPrism, bg);
    const fg1: T.Text = C.luminance(getColour(bg)) > 0.5 ? "Black" : "White";
    return h + ".style.color=" + value(fg1) + ";" + h + ".style.backgroundColor=" + value(bg1) + ";";
  };
  const inner = renderGadget(elmer, env, i, g);
  const i1 = atomicallySync(() => i.tStateDup());
  const s = elmer;
  atomicallySync(() => {
    const c = f(i.tStateBehaviour()._gdValue);
    s.elmerSendJS(inner.gadgetView.map((w) => setColours(c, w)).join(""));
  });
  // Thread to update colours is owned by the first webit in "inner".
  // If no inner webits then thread is not needed.
  if (inner.gadgetView.length > 0) {
    const view1 = inner.gadgetView[0];
    elmerDaemon(WebitClass_WebitItem, elmer, view1, () =>
      atomically(() => {
        const c = f(i1.tStateEvent()[1]._gdValue);
        s.elmerSendJS(inner.gadgetView.map((w) => setColours(c, w)).join(""));
      }),
    );
  }
  return inner;
}

function renderGadget_Linked(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => Maybe<T.Text>, g: AnyGadget): AnyOut {
  const s = elmer;
  const i1 = atomicallySync(() => i.tStateDup());
  const inner = renderGadget(elmer, env, i, g);
  const initial = atomicallySync(() => f(i1.tStateBehaviour()._gdValue));
  const attrs: [string, string][] =
    initial.tag === "Nothing" ? [["target", "_blank"]] : [["target", "_blank"], ["href", initial.value]];
  const link = makeWebitContainer1(elmer, "a", attrs);
  for (const w of inner.gadgetView) showWebit(WebitClass_WebitItem, elmer, link, w);
  elmerDaemon(WebitClass_WebitContainer, elmer, link, () =>
    atomically(() => {
      const v = f(i1.tStateEvent()[1]._gdValue);
      s.elmerSendJS(
        v.tag === "Just"
          ? setAttribute(WebitClass_WebitContainer, J.textJ, link, "href", v.value)
          : deleteAttribute(WebitClass_WebitContainer, link, "href"),
      );
    }),
  );
  return { ...inner, gadgetView: [WebitItem(WebitClass_WebitContainer, link)] };
}

function renderGadget_Styled(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => Maybe<T.Text>, g: AnyGadget): AnyOut {
  const s = elmer;
  const inner = renderGadget(elmer, env, i, g);
  const [i1, initial] = atomicallySync((): [AnyIn, Maybe<T.Text>] => {
    const i1 = i.tStateDup();
    const initial = f(i1.tStateBehaviour()._gdValue);
    if (initial.tag === "Just") {
      const sty = initial.value;
      s.elmerSendJS(inner.gadgetView.map((w) => addClass(WebitClass_WebitItem, w, sty)).join(""));
    }
    return [i1, initial];
  });
  // styleUpdate oldStyle = do { newStyle <- atomically ...; styleUpdate newStyle }
  // TypeScript: each daemon iteration is one step of the recursion, so that the daemon can be
  // killed; the previous style is kept in a variable.
  let oldStyle = initial;
  const styleUpdate = async (): Promise<void> => {
    const newStyle = await atomically(() => {
      const newStyle1 = f(i1.tStateEvent()[1]._gdValue);
      if (!equals(oldStyle, newStyle1)) {
        const js1 = oldStyle.tag === "Nothing" ? "" : inner.gadgetView.map((w) => removeClass(WebitClass_WebitItem, w, (oldStyle as { value: T.Text }).value)).join("");
        const js2 = newStyle1.tag === "Nothing" ? "" : inner.gadgetView.map((w) => addClass(WebitClass_WebitItem, w, newStyle1.value)).join("");
        s.elmerSendJS(js1 + js2);
      }
      return newStyle1;
    });
    oldStyle = newStyle;
  };
  if (inner.gadgetView.length > 0) {
    const view1 = inner.gadgetView[0];
    elmerDaemon(WebitClass_WebitItem, elmer, view1, styleUpdate);
  }
  return inner;
}

function renderGadget_Frame(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (x: any) => Maybe<T.Text>, g: AnyGadget): AnyOut {
  const s = elmer;
  const inner = renderGadget(elmer, env, i, g);
  const [i1, initial] = atomicallySync((): [AnyIn, GadgetData<any>] => [i.tStateDup(), i.tStateBehaviour()]);
  const initialText = f(initial._gdValue);
  const legend =
    initialText.tag === "Nothing" ? H.with_(H.legend(H.text("")), HA.hidden("1")) : H.legend(H.text(initialText.value));
  const current = newTVarIO(initialText);
  const frameBox = makeWebitContainer1(elmer, "fieldset", []);
  JS.send(s.elmerEngine, command(setWebitHtml(legend, WebitClass_WebitContainer.webitHandle(frameBox))));
  // Can't wrap legend in div, so can't make it a webit.
  // Must use send here because showWebit uses it, leading to a race condition with elmerSend.
  for (const w of inner.gadgetView) showWebit(WebitClass_WebitItem, elmer, frameBox, w);
  const h = var_(WebitClass_WebitContainer.webitHandle(frameBox));
  elmerDaemon(WebitClass_WebitContainer, elmer, frameBox, () =>
    atomically(() => {
      const newText = f(i1.tStateEvent()[1]._gdValue);
      const oldText = readTVar(current);
      // Faithful: @current@ is never updated, and the label update lacks a "." after the handle.
      if (!equals(oldText, newText)) {
        s.elmerSendJS(
          newText.tag === "Nothing"
            ? h + '.childNodes[0].setAttribute("hidden", "1");'
            : "{" +
                h + "childNodes[0].innerText=" + value(newText.value) + ";" +
                h + 'childNodes[0].removeAttribute("hidden");' +
                "}",
        );
      }
    }),
  );
  return { ...inner, gadgetView: [WebitItem(WebitClass_WebitContainer, frameBox)] };
}

function renderGadget_Form(
  elmer: ElmerEnv,
  env: AnyEnv,
  i: AnyIn,
  orient: Orientation,
  labelled: readonly (readonly [T.Text, GadgetF_<any, any, any>])[],
): AnyOut {
  const mkRows = (o: Orientation, tbl: WebitContainer): AnyOut[] => {
    if (o === "Vertical") {
      return labelled.map(([txt, field]) => {
        const row = makeWebitContainer1(elmer, "tr", []);
        const cell1 = makeWebitContainer1(elmer, "td", []);
        const lbl = makeWebStatic(elmer, H.text(txt));
        const cell2 = makeWebitContainer1(elmer, "td", []);
        const inner = renderGadget(elmer, env, i, field);
        for (const w of inner.gadgetView) showWebit(WebitClass_WebitItem, elmer, cell2, w);
        showWebit(WebitClass_WebStatic, elmer, cell1, lbl);
        showWebit(WebitClass_WebitContainer, elmer, row, cell1);
        showWebit(WebitClass_WebitContainer, elmer, row, cell2);
        showWebit(WebitClass_WebitContainer, elmer, tbl, row);
        return inner;
      });
    }
    const lbls = labelled.map((l) => l[0]);
    const gs = labelled.map((l) => l[1]);
    const r1 = makeWebitContainer1(elmer, "tr", []);
    for (const txt of lbls) {
      const c1 = makeWebitContainer1(elmer, "td", []);
      const t1 = makeWebStatic(elmer, H.text(txt));
      showWebit(WebitClass_WebStatic, elmer, c1, t1);
      showWebit(WebitClass_WebitContainer, elmer, r1, c1);
    }
    const r2 = makeWebitContainer1(elmer, "tr", []);
    const inners = gs.map((g) => {
      const cell = makeWebitContainer1(elmer, "td", []);
      const inner = renderGadget(elmer, env, i, g);
      for (const w of inner.gadgetView) showWebit(WebitClass_WebitItem, elmer, cell, w);
      showWebit(WebitClass_WebitContainer, elmer, r2, cell);
      return inner;
    });
    showWebit(WebitClass_WebitContainer, elmer, tbl, r1);
    showWebit(WebitClass_WebitContainer, elmer, tbl, r2);
    return inners;
  };
  const tbl = makeWebitContainer1(elmer, "table", []);
  const rowOuts = mkRows(orient, tbl);
  const result = composeOutputs(rowOuts);
  return { ...result, gadgetView: [WebitItem(WebitClass_WebitContainer, tbl)] };
}

function renderGadget_TabForm(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, tabs: readonly (readonly [T.Text, GadgetF_<any, any, any>])[]): AnyOut {
  const tabContainer = makeWebitContainer(elmer, "tab-form");
  const tabHeader = makeWebitContainer(elmer, "tab-header");
  showWebit(WebitClass_WebitContainer, elmer, tabContainer, tabHeader);
  const tabOuts = tabs.map((t) => makeTab(elmer, env, i, tabHeader, tabContainer, t));
  if (tabOuts.length > 0) {
    elmerSend(elmer, var_(WebitClass_WebitContainer.webitHandle(tabHeader)) + ".firstElementChild.click()");
  }
  // Faithful: the result shows the tab bodies, not the tab container.
  return composeOutputs(tabOuts);
}

function renderGadget_Box(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, orient: Orientation, gadgetss: readonly (readonly GadgetF_<any, any, any>[])[]): AnyOut {
  const container = makeWebitContainer(elmer, orient === "Horizontal" ? "horizontal" : "vertical");
  const separator = (): Either<ReturnType<typeof makeWebStatic>, AnyOut> =>
    Left(makeWebStatic(elmer, orient === "Horizontal" ? H.hr() : H.with_(H.div(""), HA.class_("vr"))));
  // sequence (intercalate [Left <$> separator] $ map (map (fmap Right . renderGadget env i)) gadgetss)
  const webits: Either<ReturnType<typeof makeWebStatic>, AnyOut>[] = [];
  gadgetss.forEach((gs, n) => {
    if (n > 0) webits.push(separator());
    for (const g of gs) webits.push(Right(renderGadget(elmer, env, i, g)));
  });
  const webitOuts = webits.flatMap((w) => (w.tag === "Right" ? [w.value] : []));
  for (const w of webits) {
    if (w.tag === "Left") showWebit(WebitClass_WebStatic, elmer, container, w.value);
    else for (const v of w.value.gadgetView) showWebit(WebitClass_WebitItem, elmer, container, v);
  }
  // Faithful: the result shows the children, not the container.
  return composeOutputs(webitOuts);
}

function renderGadget_Grid(
  elmer: ElmerEnv,
  env: AnyEnv,
  i: AnyIn,
  columnHeads: readonly T.Text[],
  rowHeads: readonly T.Text[],
  gss: readonly (readonly GadgetF_<any, any, any>[])[],
): AnyOut {
  const makeRow = (rowHead: T.Text, gs: readonly GadgetF_<any, any, any>[]): [WebitContainer, AnyOut[]] => {
    const row = makeWebitContainer1(elmer, "tr", []);
    const headWebit = makeWebStatic(elmer, H.th(H.text(rowHead)));
    showWebit(WebitClass_WebStatic, elmer, row, headWebit);
    const outs = gs.map((g) => {
      const out = renderGadget(elmer, env, i, g);
      const cell = makeWebitContainer1(elmer, "tc", []);
      for (const w of out.gadgetView) showWebit(WebitClass_WebitItem, elmer, cell, w);
      return out;
    });
    return [row, outs];
  };
  const gridBox = makeWebitContainer1(elmer, "table", [["style", "gridBox"]]);
  const hRow = makeWebStatic(elmer, H.tr(H.mconcat_Html([H.th(H.mempty_Html), ...columnHeads.map((c) => H.th(H.text(c)))])));
  showWebit(WebitClass_WebStatic, elmer, gridBox, hRow);
  const n = Math.min(rowHeads.length, gss.length);
  const made: [WebitContainer, AnyOut[]][] = [];
  for (let k = 0; k < n; k++) made.push(makeRow(rowHeads[k], gss[k]));
  const rows = made.map((m) => m[0]);
  const rowOuts = made.map((m) => m[1]);
  for (const r of rows) showWebit(WebitClass_WebitContainer, elmer, gridBox, r);
  // Faithful: the result shows the cell contents, not the grid.
  return composeOutputs(rowOuts.flat());
}

function renderGadget_Validate(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (e: any, i: any, o: any) => boolean, g: AnyGadget): AnyOut {
  // Faithful: the "invalid" class is added when the value is valid, and removed when it is not.
  const setJS = (b: boolean, w: WebitItem): JavaScript =>
    b
      ? var_(WebitClass_WebitItem.webitHandle(w)) + '.classList.add("invalid");'
      : var_(WebitClass_WebitItem.webitHandle(w)) + '.classList.remove("invalid")';
  const setStyle = (elmer1: ElmerEnv, g1: AnyOut, b: boolean): void => elmerSend(elmer1, g1.gadgetView.map((w) => setJS(b, w)).join(""));
  const inner = renderGadget(elmer, env, i, g);
  // checkOk = f <$> env <*> (view gdValue <$> i) <*> (view gdValue <$> gadgetOutput inner)
  const checkOk: TState<boolean, boolean> = ap_TState(
    ap_TState(
      fmap_TState((e1: any) => (i1: any) => (o1: any) => f(e1, i1, o1), env),
      fmap_TState((x: GadgetData<any>) => view(gdValue(), x), i),
    ),
    fmap_TState((x: GadgetData<any>) => view(gdValue(), x), inner.gadgetOutput),
  );
  const output = ap_TState(
    fmap_TState((ok: boolean) => (x: GadgetData<any>) => over(gdOk(), (b: boolean) => ok && b, x), checkOk),
    inner.gadgetOutput,
  );
  const initialOk = atomicallySync(() => checkOk.tStateBehaviour());
  setStyle(elmer, inner, initialOk);
  if (inner.gadgetView.length > 0) {
    const view1 = inner.gadgetView[0];
    elmerDaemon(WebitClass_WebitItem, elmer, view1, async (elmer1) => {
      const okFlag = (await atomically(() => checkOk.tStateEvent()))[1];
      setStyle(elmer1, inner, okFlag);
    });
  }
  return { ...inner, gadgetOutput: output };
}

function renderGadget_ValidateText(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, f: (e: any, i: any, o: any) => Maybe<T.Text>, g: AnyGadget): AnyOut {
  const setStyle = (elmer1: ElmerEnv, w: ReturnType<typeof makeWebStatic>, b: boolean): void =>
    b
      ? elmerSend(elmer1, var_(WebitClass_WebStatic.webitHandle(w)) + '.style.display="none";')
      : elmerSend(elmer1, var_(WebitClass_WebStatic.webitHandle(w)) + '.style.display="block";');
  const box1 = makeWebitContainer(elmer, "vertical");
  const inner = renderGadget(elmer, env, i, g);
  const warning = makeWebStatic(elmer, H.with_(H.p(H.mempty_Html), HA.style("backgroundColor:LightCoral;text-align:center;")));
  for (const w of inner.gadgetView) showWebit(WebitClass_WebitItem, elmer, box1, w);
  showWebit(WebitClass_WebStatic, elmer, box1, warning);
  const checkOk: TState<boolean, Maybe<T.Text>> = ap_TState(
    ap_TState(
      fmap_TState((e1: any) => (i1: any) => (o1: any) => f(e1, i1, o1), env),
      fmap_TState((x: GadgetData<any>) => view(gdValue(), x), i),
    ),
    fmap_TState((x: GadgetData<any>) => view(gdValue(), x), inner.gadgetOutput),
  );
  const output = ap_TState(
    fmap_TState((ok: Maybe<T.Text>) => (x: GadgetData<any>) => over(gdOk(), (b: boolean) => isNothing(ok) && b, x), checkOk),
    inner.gadgetOutput,
  );
  const initialOk = atomicallySync(() => isNothing(checkOk.tStateBehaviour()));
  setStyle(elmer, warning, initialOk);
  elmerDaemon(WebitClass_WebitContainer, elmer, box1, async (elmer1) => {
    const okFlag = isNothing((await atomically(() => checkOk.tStateEvent()))[1]);
    setStyle(elmer1, warning, okFlag);
  });
  // Faithful: the result shows the inner gadget, not the box with the warning.
  return { ...inner, gadgetOutput: output };
}

function renderGadget_TextBox(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, prismFunc: (e: any) => Prism<T.Text, any>): AnyOut {
  const boxHtml = (wId: WebitId): H.Html =>
    H.with_(H.input(), HA.type_("text"), HA.onchange(jsValue(call("jsb.event", ['{"d":' + value(wId) + ",v:this.value}"]))));
  const processOutput = (v0: GadgetData<any>, p: Prism<T.Text, any>, txt: GadgetData<T.Text>): GadgetData<any> => {
    const r = preview(p, txt._gdValue);
    return r.tag === "Just" ? set(gdValue(), r.value, txt) : set(gdOk(), false, v0);
  };
  const updateJS = (v: T.Text, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[0].value=" + value(v) + ";";
  const msg = (b: boolean): T.Text => (b ? "" : "Invalid");
  // See https://stackoverflow.com/questions/7609130/set-the-value-of-an-input-field
  const [prism1, initial] = atomicallySync((): [Prism<T.Text, any>, GadgetData<any>] => {
    const prism1 = prismFunc(env.tStateBehaviour());
    const initial1 = i.tStateBehaviour();
    return [prism1, initial1];
  });
  const webit = makeWebit(J.textJ, elmer, boxHtml, updateJS, review(prism1, initial._gdValue));
  const i1 = tStateDupIO(fmap_TState((x: GadgetData<any>) => over(gdValue(), (a: any) => review(prism1, a), x), i));
  const out1 = mergeGadgetData<T.Text>(i1, mapTState1(() => true, fmap_TState((t: T.Text) => GadgetData(true, t), webit.webitState)));
  const out2 = fmap_TState((t: GadgetData<T.Text>) => processOutput(initial, prism1, t), out1);
  const out3 = tStateDupIO(out2);
  elmerDaemon(WebitClass_Webit, elmer, webit, async (elmer1) => {
    const ok = (await atomically(() => out3.tStateEvent()))[1]._gdOk;
    const h = var_(WebitClass_Webit.webitHandle(webit));
    elmerSend(
      elmer1,
      "{" +
        h + ".childNodes[0].setCustomValidity(" + value(msg(ok)) + ");" +
        h + ".childNodes[0].classList." + (ok ? 'remove("invalid");}' : 'add("invalid");}'),
    );
  });
  elmerDaemon(WebitClass_Webit, elmer, webit, () =>
    atomically(() => {
      const [, v] = i1.tStateEvent();
      webit.webitIn(v._gdValue);
    }),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, out2);
}

/** `displayId` of `DisplayText` and `DisplayMemo`. */
function displayId(wId: WebitId): string {
  return wId + "_dsp";
}

/** `popupId` of `DisplayText` and `DisplayMemo`. */
function popupId(wId: WebitId): string {
  return wId + "_pop";
}

/** `updateDisplay` of `DisplayText` and `DisplayMemo`. */
function updateDisplay(v: T.Text, _h: JS.RemoteValue<H.Html>, wId: WebitId): JavaScript {
  return "{" + "$(" + webitSelector1(wId, "_dsp") + ").text(" + value(v) + ");" + "$(" + webitSelector1(wId, "_pop") + ").val(" + value(v) + ");" + "}";
}

/** `initJS` of `DisplayText` and `DisplayMemo`. */
function displayInitJS(wId: WebitId): JavaScript {
  const sel = '"#' + popupId(wId) + '"';
  return (
    "$(" + sel + ").dialog({" +
    "title:'Enter text:'," +
    "position:{of:(" + webitSelector1(wId, "_dsp") + ")}," +
    "height:'auto'," +
    "width:'auto'," +
    'buttons:[{text:"OK",click:function () {' +
    webitEventData(wId, "this.value") +
    "$(" + webitSelector1(wId, "_dsp") + ").text(this.value);" +
    "$(" + webitSelector1(wId, "_pop") + ").dialog('close');" +
    "}}]," +
    "modal:true," +
    "autoOpen:false" +
    "});" +
    "$(" + webitSelector(wId) + ').on("click", function () {' +
    "$(" + sel + ').dialog("open");})'
  );
}

function renderGadget_DisplayText(elmer: ElmerEnv, i: AnyIn): AnyOut {
  const displayHtml = (txt: T.Text, wId: WebitId): H.Html =>
    H.mconcat_Html([
      H.with_(H.p(H.text(txt)), HA.class_("no-box"), HA.id(H.lazyTextValue(displayId(wId)))),
      H.with_(H.input(), HA.id(H.lazyTextValue(popupId(wId))), HA.type_("text"), HA.value(H.textValue(txt))),
    ]);
  const initial = atomicallySync(() => i.tStateBehaviour());
  const display = makeWebit(J.textJ, elmer, (wId) => displayHtml(initial._gdValue, wId), updateDisplay, initial._gdValue);
  const i1 = atomicallySync(() => i.tStateDup());
  elmerDaemon(WebitClass_Webit, elmer, display, () =>
    atomically(() => {
      const [, v] = i1.tStateEvent();
      display.webitIn(v._gdValue);
    }),
  );
  const out = mergeGadgetData<T.Text>(i1, mapTState1(() => true, fmap_TState((t: T.Text) => GadgetData(true, t), display.webitState)));
  return GadgetOut(
    [WebitItem(WebitClass_Webit, display)],
    command(displayInitJS(WebitClass_Webit.webitId(display))),
    retrySTM,
    out,
  );
}

/** `boxClass` of `MemoBox` and `FixedMemo`. */
function memoBoxClass(size: MemoBoxSize): string {
  switch (size) {
    case "MemoSmall":
      return "memo-small";
    case "MemoMedium":
      return "memo-medium";
    case "MemoLarge":
      return "memo-large";
  }
}

function renderGadget_MemoBox(elmer: ElmerEnv, i: AnyIn, size: MemoBoxSize): AnyOut {
  const boxHtml = (wId: WebitId): H.Html =>
    H.with_(
      H.textarea(""),
      HA.onchange(jsValue(call("jsb.event", ['{"d":' + value(wId) + ",v:this.value}"]))),
      HA.class_(memoBoxClass(size)),
    );
  const updateJS = (v: T.Text, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[0].value=" + value(v) + ";";
  const initial = atomicallySync(() => i.tStateBehaviour());
  const input = makeWebit(J.textJ, elmer, boxHtml, updateJS, initial._gdValue);
  const i1 = atomicallySync(() => i.tStateDup());
  elmerDaemon(WebitClass_Webit, elmer, input, () =>
    atomically(() => {
      const v = i1.tStateEvent();
      input.webitIn(v[1]._gdValue);
    }),
  );
  const out = mergeGadgetData<T.Text>(i, mapTState1(() => true, fmap_TState((t: T.Text) => GadgetData(true, t), input.webitState)));
  return GadgetOut([WebitItem(WebitClass_Webit, input)], noDomCode, retrySTM, out);
}

function renderGadget_DisplayMemo(elmer: ElmerEnv, i: AnyIn): AnyOut {
  const displayHtml = (txt: T.Text, wId: WebitId): H.Html =>
    H.mconcat_Html([
      H.with_(H.p(H.text(txt)), HA.class_("no-box"), HA.id(H.lazyTextValue(displayId(wId))), HA.style("white-space:pre-wrap")),
      H.with_(H.textarea(H.text(txt)), HA.id(H.lazyTextValue(popupId(wId))), HA.style("resize:none;"), HA.rows("5"), HA.cols("50")),
    ]);
  const initial = atomicallySync(() => i.tStateBehaviour());
  const display = makeWebit(J.textJ, elmer, (wId) => displayHtml(initial._gdValue, wId), updateDisplay, initial._gdValue);
  const i1 = atomicallySync(() => i.tStateDup());
  elmerDaemon(WebitClass_Webit, elmer, display, () =>
    atomically(() => {
      const [, v] = i1.tStateEvent();
      display.webitIn(v._gdValue);
    }),
  );
  const out = mergeGadgetData<T.Text>(i, mapTState1(() => true, fmap_TState((t: T.Text) => GadgetData(true, t), display.webitState)));
  return GadgetOut(
    [WebitItem(WebitClass_Webit, display)],
    command(displayInitJS(WebitClass_Webit.webitId(display))),
    retrySTM,
    out,
  );
}

function renderGadget_Combo(elmer: ElmerEnv, e: AnyEnv, i: AnyIn, choiceF: (e: any) => readonly ComboItem<any>[]): AnyOut {
  const optionHtml = (n: number, item: ComboItem<any>): H.Html => {
    const c = item.menuItemColour;
    const attrs = c.tag === "Just" ? [HA.style(H.textValue("background-color:" + review(colourPrism, c.value) + ";"))] : [];
    return H.with_(
      H.option(
        H.mconcat_Html([
          item.menuItemIcon.tag === "Just"
            ? H.mconcat_Html([H.with_(H.img(), HA.src(H.textValue(iconUrl(item.menuItemIcon.value))), HA.height("16"), HA.width("16")), " "])
            : H.mempty_Html,
          H.text(item.menuItemLabel),
        ]),
      ),
      HA.value(H.stringValue(String(n))),
      ...attrs,
    );
  };
  const comboHtml = (choices: readonly ComboItem<any>[], wId: WebitId): H.Html =>
    H.with_(
      H.select(H.mconcat_Html(choices.map((c, n) => optionHtml(n, c)))),
      HA.oninput(jsValue(call("jsb.event", ['{"d":' + value(wId) + ',"v":this.selectedIndex}']))),
    );
  const updateJS = (v: number, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[0].value=" + value(v) + ";";
  const [env, initial] = atomicallySync((): [any, GadgetData<any>] => [e.tStateBehaviour(), i.tStateBehaviour()]);
  const choices = choiceF(env);
  const valueIndex = (v: GadgetData<any>): number => choices.findIndex((c) => equals(v._gdValue, c.menuItemValue));
  const initialN = valueIndex(initial);
  const input = makeWebit(J.intJ, elmer, (wId) => comboHtml(choices, wId), updateJS, initialN);
  const i1 = atomicallySync(() => i.tStateDup());
  elmerDaemon(WebitClass_Webit, elmer, input, () =>
    atomically(() => {
      input.webitIn(valueIndex(i1.tStateEvent()[1]));
    }),
  );
  const out = mergeGadgetData<any>(
    i,
    mapTState1(
      () => true,
      fmap_TState((n: number) => {
        const c = index(choices, n);
        return c.tag === "Just" ? GadgetData(true, c.value.menuItemValue) : initial;
      }, input.webitState),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, input)], noDomCode, retrySTM, out);
}

function renderGadget_Radio(elmer: ElmerEnv, e: AnyEnv, i: AnyIn, choiceF: (e: any) => readonly (readonly [T.Text, any])[]): AnyOut {
  const optionHtml = (wId: WebitId, n: number, [txt]: readonly [T.Text, any]): H.Html =>
    H.mconcat_Html([
      H.with_(
        H.input(),
        HA.type_("radio"),
        HA.id(H.stringValue(String(n))),
        HA.name(H.stringValue(wId)),
        HA.onclick(jsValue(call("jsb.event", ['{"d":' + value(wId) + ',"v":' + value(n) + "}"]))),
      ),
      H.with_(H.label(H.text(txt)), HA.for(H.stringValue(String(n)))),
    ]);
  const radioHtml = (choices: readonly (readonly [T.Text, any])[], wId: WebitId): H.Html =>
    H.mconcat_Html(choices.map((c, n) => optionHtml(wId, n, c)));
  const updateJS = (v: number, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[" + value(v * 2) + "].checked=true;";
  // The "v*2" refers to the alternating input and label elements. The first input is
  // childNodes[0], the second is childNodes[2], and so on.
  const [env, initial] = atomicallySync((): [any, GadgetData<any>] => [e.tStateBehaviour(), i.tStateBehaviour()]);
  const choices = choiceF(env);
  const valueIndex = (v: GadgetData<any>): number => choices.findIndex((c) => equals(v._gdValue, c[1]));
  const initialN = valueIndex(initial);
  const input = makeWebit(J.intJ, elmer, (wId) => radioHtml(choices, wId), updateJS, initialN);
  const i1 = atomicallySync(() => i.tStateDup());
  elmerDaemon(WebitClass_Webit, elmer, input, () =>
    atomically(() => {
      input.webitIn(valueIndex(i1.tStateEvent()[1]));
    }),
  );
  const out = mergeGadgetData<any>(
    i,
    mapTState1(
      () => true,
      fmap_TState((n: number) => {
        const c = index(choices, n);
        return c.tag === "Just" ? GadgetData(true, c.value[1]) : initial;
      }, input.webitState),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, input)], noDomCode, retrySTM, out);
}

function renderGadget_TickBox(elmer: ElmerEnv, i: AnyIn): AnyOut {
  const tickHtml = (wId: WebitId): H.Html =>
    H.with_(H.input(), HA.type_("checkbox"), HA.oninput(jsValue(call("jsb.event", ['{"d":' + value(wId) + ',"v":this.checked}']))));
  const updateJS = (v: boolean, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[0].checked=" + (v ? "true;" : "false;");
  const initial = atomicallySync(() => i.tStateBehaviour());
  const input = makeWebit(J.boolJ, elmer, tickHtml, updateJS, initial._gdValue as boolean);
  const i1 = atomicallySync(() => i.tStateDup());
  elmerDaemon(WebitClass_Webit, elmer, input, () =>
    atomically(() => {
      input.webitIn(i1.tStateEvent()[1]._gdValue);
    }),
  );
  const out = mergeGadgetData<boolean>(i, mapTState1(() => true, fmap_TState((b: boolean) => GadgetData(true, b), input.webitState)));
  return GadgetOut([WebitItem(WebitClass_Webit, input)], noDomCode, retrySTM, out);
}

function renderGadget_Message(elmer: ElmerEnv, e: AnyEnv, i: AnyIn, messageF: (e: any, a: any) => T.Text): AnyOut {
  const msgHtml = (): H.Html => H.p("");
  const updateJS = (v: T.Text, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[0].innerText=" + value(v) + ";";
  const [env, initial] = atomicallySync((): [any, GadgetData<any>] => [e.tStateBehaviour(), i.tStateBehaviour()]);
  const webit = makeWebit(J.textJ, elmer, msgHtml, updateJS, messageF(env, initial._gdValue));
  const i1 = atomicallySync(() => i.tStateDup());
  const o1 = atomicallySync(() => i.tStateDup());
  const msg = atomicallySync(() =>
    ap_TState(
      fmap_TState((e1: any) => (a: any) => messageF(e1, a), e),
      fmap_TState((x: GadgetData<any>) => view(gdValue(), x), i1),
    ).tStateDup(),
  );
  elmerDaemon(WebitClass_Webit, elmer, webit, () =>
    atomically(() => {
      const [, txt] = msg.tStateEvent();
      webit.webitIn(txt);
    }),
  );
  // Pass through the behaviour, but no user-initiated events.
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, o1);
}

/**
 * The common part of `FixedText` and `FixedMemo`: a read-only webit, with an optional dialog
 * popped up when it is clicked.
 */
function renderFixed(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  textFunc: (e: any, a: any) => T.Text,
  mSel: Maybe<DialogSelector_<any, any, any>>,
  boxHtml: (wId: WebitId) => H.Html,
): AnyOut {
  const updateJS = (v: T.Text, h: JS.RemoteValue<H.Html>): JavaScript => var_(h) + ".childNodes[0].value=" + value(v) + ";";
  const [env, initial] = atomicallySync((): [any, GadgetData<any>] => [e.tStateBehaviour(), i.tStateBehaviour()]);
  const webit = makeWebit(J.textJ, elmer, boxHtml, updateJS, textFunc(env, initial._gdValue));
  const i1 = atomicallySync(() => i.tStateDup());
  if (mSel.tag === "Just") {
    const dSel = mSel.value;
    const vEvent = (): [null, any] => {
      const v = i.tStateBehaviour();
      webit.webitState.tStateEvent();
      return [null, v._gdValue];
    };
    const clickResult = mkWebitPopupSelect(elmer, e, dSel, vEvent);
    const [out, outWriter] = newTStateIO<boolean, GadgetData<any>>(initial);
    elmerDaemon(WebitClass_Webit, elmer, webit, () =>
      atomically(() => {
        const r = orElse(
          (): Maybe<[boolean, GadgetData<any>]> => Just(i1.tStateEvent()),
          (): Maybe<[boolean, GadgetData<any>]> => {
            const c = readTChan(clickResult);
            return c[1].tag === "Just" ? Just([true, GadgetData(true, c[1].value)]) : Nothing;
          },
        );
        if (r.tag === "Just") {
          const [userflag, v] = r.value;
          const env1 = e.tStateBehaviour();
          webit.webitIn(textFunc(env1, v._gdValue));
          outWriter(userflag, v);
        }
      }),
    );
    return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, out);
  }
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, i1);
}

function renderGadget_FixedText(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  textFunc: (e: any, a: any) => T.Text,
  mSel: Maybe<DialogSelector_<any, any, any>>,
): AnyOut {
  // The event has to send text but we only want the click, so just send "".
  const boxHtml = (wId: WebitId): H.Html =>
    H.with_(H.input(), HA.type_("text"), HA.readonly("true"), HA.onclick(jsValue(webitEvent(J.textJ, wId, ""))));
  return renderFixed(elmer, e, i, textFunc, mSel, boxHtml);
}

function renderGadget_FixedMemo(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  size: MemoBoxSize,
  textFunc: (e: any, a: any) => T.Text,
  mSel: Maybe<DialogSelector_<any, any, any>>,
): AnyOut {
  // The event has to send text but we only want the click, so just send "".
  const boxHtml = (wId: WebitId): H.Html =>
    H.with_(H.textarea(""), HA.class_(memoBoxClass(size)), HA.readonly("true"), HA.onclick(jsValue(webitEvent(J.textJ, wId, ""))));
  return renderFixed(elmer, e, i, textFunc, mSel, boxHtml);
}

function renderGadget_ClickableList(elmer: ElmerEnv, i: AnyIn): AnyOut {
  type Item = [T.Text, number];
  const itemsJ = J.listJ(J.tuple2J(J.textJ, J.intJ));
  const itemList = (cs: readonly ClickableItem<any>[]): Item[] => cs.map((c, n) => [c.clickText, n]);
  const bodyHtml = (wId: WebitId, items: readonly Item[]): H.Html => {
    // Have to send input type, so use first field to flag click count.
    const itemHtml = ([txt, n]: Item): H.Html =>
      H.with_(
        H.span(H.text(txt)),
        HA.onclick(jsValue(webitEvent(itemsJ, wId, [["1", n]]))),
        HA.ondblclick(jsValue(webitEvent(itemsJ, wId, [["2", n]]))),
      );
    const hs: H.Html[] = [];
    items.forEach((it, k) => {
      if (k > 0) hs.push(H.text(", "));
      hs.push(itemHtml(it));
    });
    return H.mconcat_Html(hs);
  };
  const updateJS = (items: readonly Item[], h: JS.RemoteValue<H.Html>, wId: WebitId): JavaScript =>
    var_(h) + ".innerHTML=" + value(H.renderHtml(bodyHtml(wId, items)));
  const procInput = (webit: Webit<Item[]>, store: TVar<readonly ClickableItem<any>[]>, i1: AnyIn): void => {
    const newVec: readonly ClickableItem<any>[] = i1.tStateEvent()[1]._gdValue;
    const oldVec = readTVar(store);
    const newList = itemList(newVec);
    if (!equals(newList, itemList(oldVec))) {
      writeTVar(store, newVec);
      webit.webitIn(newList);
    }
  };
  const procClick = (
    webit: Webit<Item[]>,
    store: TVar<readonly ClickableItem<any>[]>,
    write: (b: boolean, v: GadgetData<Maybe<any>>) => void,
  ): void => {
    const [, ev] = webit.webitState.tStateEvent();
    if (ev.length === 1) {
      const [t, n] = ev[0];
      const s = readTVar(store);
      const c = index(s, n);
      const bindC = (f: (x: ClickableItem<any>) => Maybe<any>): Maybe<any> => (c.tag === "Just" ? f(c.value) : Nothing);
      if (t === "1") write(true, GadgetData(true, bindC((x) => x.clickSingle)));
      if (t === "2") write(true, GadgetData(true, bindC((x) => x.clickDouble)));
    }
  };
  const initial: readonly ClickableItem<any>[] = atomicallySync(() => i.tStateBehaviour()._gdValue);
  const store = newTVarIO(initial);
  const webit = makeWebit<Item[]>(itemsJ, elmer, (wId) => bodyHtml(wId, itemList(initial)), updateJS, itemList(initial));
  const i1 = tStateDupIO(i);
  const [out, writeOut] = newTStateIO<boolean, GadgetData<Maybe<any>>>(GadgetData(true, Nothing));
  elmerDaemon(WebitClass_Webit, elmer, webit, () =>
    atomically(() =>
      orElse(
        () => procInput(webit, store, i1),
        () => procClick(webit, store, writeOut),
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, out);
}

function renderGadget_DateBox(elmer: ElmerEnv, i: AnyIn): AnyOut {
  // This ignores the date format in the argument because HTML delegates that to the browser.
  const prsm = datePrism("%Y-%m-%d"); // Standard browser date format.
  const dateHtml = (wId: WebitId): H.Html =>
    H.with_(H.input(), HA.type_("date"), HA.oninput(jsValue(call("jsb.event", ["{d:" + value(wId) + ",v:this.value}"]))));
  const updateValue = (txt: T.Text, ref: JS.RemoteValue<H.Html>): JavaScript => var_(ref) + ".childNodes[0].value=" + value(txt);
  const initVal = atomicallySync(() => i.tStateBehaviour());
  const sendJS = elmer.elmerSendJS;
  const i1 = tStateDupIO(i);
  const entry = makeWebit(J.textJ, elmer, dateHtml, updateValue, review(prsm, initVal._gdValue));
  const h = var_(WebitClass_Webit.webitHandle(entry));
  const [output, writer] = newTStateIO<boolean, GadgetData<any>>(initVal);
  elmerDaemon(WebitClass_Webit, elmer, entry, () =>
    atomically(() =>
      orElse(
        () => {
          const [userflag, newVal] = i1.tStateEvent();
          const oldVal = output.tStateBehaviour();
          if (!equals(oldVal, newVal)) {
            entry.webitIn(review(prsm, newVal._gdValue));
            writer(userflag, newVal);
          }
        },
        () => {
          const [, newVal] = entry.webitState.tStateEvent();
          const d = preview(prsm, newVal);
          if (d.tag === "Just") {
            writer(true, GadgetData(true, d.value));
            sendJS("{" + h + '.childNodes[0].setCustomValidity("");' + h + '.childNodes[0].classList.remove("invalid");}');
          } else {
            writer(true, set(gdOk(), false, initVal));
            sendJS("{" + h + '.childNodes[0].setCustomValidity("Invalid date");' + h + '.childNodes[0].classList.add("invalid");}');
          }
        },
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, entry)], noDomCode, retrySTM, output);
}

function renderGadget_IconBox(elmer: ElmerEnv, i: AnyIn): AnyOut {
  // Ignore the group predicate: its not needed on the Webit version.
  const updateValue = (txt: T.Text, ref: JS.RemoteValue<H.Html>): JavaScript =>
    var_(ref) + call(".childNodes[0].setAttribute", [value("src"), value(iconUrl(txt))]);
  const initVal = atomicallySync(() => i.tStateBehaviour());
  const box1 = makeWebitContainer(elmer, "no-box");
  const webit = makeWebit(J.textJ, elmer, (wId) => iconHtml("icon-inline", initVal._gdValue, Just(wId)), updateValue, initVal._gdValue as T.Text);
  showWebit(WebitClass_Webit, elmer, box1, webit);
  const i1 = tStateDupIO(i);
  const [output, outputWriter] = newTStateIO<boolean, GadgetData<any>>(initVal);
  elmerDaemon(WebitClass_WebitContainer, elmer, box1, async (elmer1) => {
    const oldIcon = await atomically(() => {
      webit.webitState.tStateEvent(); // Icon clicked: pop up menu.
      return i.tStateBehaviour();
    });
    const r = await getIconChoice(elmer1, oldIcon._gdValue);
    if (r.tag === "Just") {
      const newIcon = r.value;
      atomicallySync(() => {
        webit.webitIn(newIcon);
        outputWriter(true, GadgetData(true, newIcon));
      });
    }
  });
  elmerDaemon(WebitClass_WebitContainer, elmer, box1, () =>
    atomically(() => {
      const [userflag, newVal] = i1.tStateEvent();
      const oldVal = output.tStateBehaviour();
      if (!equals(oldVal, newVal)) {
        webit.webitIn(newVal._gdValue);
        outputWriter(userflag, newVal);
      }
    }),
  );
  return GadgetOut([WebitItem(WebitClass_WebitContainer, box1)], noDomCode, retrySTM, output);
}

function renderGadget_ColourBox(elmer: ElmerEnv, i: AnyIn): AnyOut {
  const colourHtml = (wId: WebitId): H.Html =>
    H.with_(H.input(), HA.type_("color"), HA.onchange(jsValue(call("jsb.event", ["{d:" + value(wId) + ",v:this.value}"]))));
  const updateValue = (txt: T.Text, ref: JS.RemoteValue<H.Html>): JavaScript => var_(ref) + ".childNodes[0].value=" + value(txt);
  const initVal = atomicallySync(() => i.tStateBehaviour());
  const sendJS = elmer.elmerSendJS;
  const i1 = tStateDupIO(i);
  const entry = makeWebit(J.textJ, elmer, colourHtml, updateValue, review(colourPrism, initVal._gdValue));
  const h = var_(WebitClass_Webit.webitHandle(entry));
  const [output, writer] = newTStateIO<boolean, GadgetData<any>>(initVal);
  void forkIO(() =>
    forever(() =>
      atomically(() =>
        orElse(
          () => {
            const [userflag, newVal] = i1.tStateEvent();
            const oldVal = output.tStateBehaviour();
            if (!equals(oldVal, newVal)) {
              entry.webitIn(review(colourPrism, newVal._gdValue));
              writer(userflag, newVal);
            }
          },
          () => {
            const [, newVal] = entry.webitState.tStateEvent();
            const d = preview(colourPrism, newVal);
            if (d.tag === "Just") {
              writer(true, GadgetData(true, d.value));
              sendJS("{" + h + '.childNodes[0].setCustomValidity("");' + h + '.childNodes[0].classList.remove("invalid");}');
            } else {
              writer(true, set(gdOk(), false, initVal));
              sendJS("{" + h + '.childNodes[0].setCustomValidity("Invalid colour");' + h + '.childNodes[0].classList.add("invalid");}');
            }
          },
        ),
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, entry)], noDomCode, retrySTM, output);
}

/** `Codec.ImageType` tests used by `ImageDisplay` (as Python's @imghdr@). */
function testJpeg(b: Uint8Array): Maybe<string> {
  const s = String.fromCharCode(...b.subarray(6, 10));
  if (s === "JFIF" || s === "Exif") return Just("jpeg");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] === 0xdb) return Just("jpeg");
  return Nothing;
}
function testPng(b: Uint8Array): Maybe<string> {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return b.length >= 8 && sig.every((x, k) => b[k] === x) ? Just("png") : Nothing;
}
function testGif(b: Uint8Array): Maybe<string> {
  const s = String.fromCharCode(...b.subarray(0, 6));
  return s === "GIF87a" || s === "GIF89a" ? Just("gif") : Nothing;
}
function testTiff(b: Uint8Array): Maybe<string> {
  const s = String.fromCharCode(...b.subarray(0, 2));
  return s === "MM" || s === "II" ? Just("tiff") : Nothing;
}
function testBmp(b: Uint8Array): Maybe<string> {
  return String.fromCharCode(...b.subarray(0, 2)) === "BM" ? Just("bmp") : Nothing;
}

function renderGadget_ImageDisplay(elmer: ElmerEnv, i: AnyIn, size: MemoBoxSize): AnyOut {
  // Assume that any XML image file is an SVG. The browser can sort it out.
  const testSvg = (bytes: Uint8Array): Maybe<string> =>
    String.fromCharCode(...bytes.subarray(0, 5)) === "<?xml" ? Just("svg+xml") : Nothing;
  const mimeSubtype = (bytes: Uint8Array): Maybe<string> => {
    for (const t of [testJpeg, testPng, testSvg, testGif, testTiff, testBmp]) {
      const r = t(bytes);
      if (r.tag === "Just") return r;
    }
    return Nothing;
  };
  const encoded = (bytes: Uint8Array): string => {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return "data:image/" + fromMaybe("*", mimeSubtype(bytes)) + ";base64," + btoa(bin);
  };
  const displayImage = (elmer1: ElmerEnv, box1: WebitContainer, m: Maybe<Uint8Array>): void =>
    m.tag === "Nothing"
      ? elmerSend(elmer1, var_(WebitClass_WebitContainer.webitHandle(box1)) + '.innerHTML=""')
      : elmerSend(elmer1, var_(WebitClass_WebitContainer.webitHandle(box1)) + ".innerHTML=" + value('<img src="' + encoded(m.value) + '">'));
  const initVal = atomicallySync(() => i.tStateBehaviour());
  const box1 = makeWebitContainer(elmer, "no-box");
  elmerSend(
    elmer,
    addClass(WebitClass_WebitContainer, box1, size === "MemoSmall" ? "image-small" : size === "MemoMedium" ? "image-medium" : "image-large"),
  );
  displayImage(elmer, box1, initVal._gdValue);
  const i1 = tStateDupIO(i);
  elmerDaemon(WebitClass_WebitContainer, elmer, box1, async (elmer1) => {
    const [, newBytes] = await atomically(() => i1.tStateEvent());
    displayImage(elmer1, box1, newBytes._gdValue);
  });
  const output = tStateDupIO(i);
  return GadgetOut([WebitItem(WebitClass_WebitContainer, box1)], noDomCode, retrySTM, output);
}

function renderGadget_TreeSelector(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  forestFunc: (e: any) => Forest<readonly [T.Text, Maybe<T.Text>, Maybe<any>]>,
): AnyOut {
  type Item = readonly [T.Text, Maybe<T.Text>, Maybe<any>];
  const trimTree = (t: Tree<Item>): Maybe<Tree<Item>> => {
    const sub = trimForest(t.subForest);
    if (sub.length === 0) return isJust(t.rootLabel[2]) ? Just(Node(t.rootLabel, [])) : Nothing;
    return Just(Node(t.rootLabel, sub));
  };
  const trimForest = (f: Forest<Item>): Tree<Item>[] => mapMaybe(trimTree, f);
  // tag = mapM $ \v -> do { n <- get; modify succ; return (n, v) }
  const tag = (st: { state: number }, t: Tree<Item>): Tree<readonly [number, Item]> => {
    const n = st.state;
    st.state = n + 1;
    return Node([n, t.rootLabel] as const, t.subForest.map((c) => tag(st, c)));
  };
  const invertId = ([n, [, , idx]]: readonly [number, Item]): Maybe<[any, T.Text]> => mapMaybeValue((x: any): [any, T.Text] => [x, String(n)], idx);
  const treeConvert = (t: Tree<readonly [number, Item]>): FancyTree => {
    const [n, [nm, tip, k]] = t.rootLabel;
    return { ...ftDefault(String(n), nm), ftToolTip: tip, ftUnselectable: isNothing(k), ftChildren: Just(t.subForest.map(treeConvert)) };
  };
  const setSelected = (elmer1: ElmerEnv, h: JS.RemoteValue<H.Html>, idTable: M.Map<any, T.Text>, selection: S.Set<any>): void => {
    const remoteSelection = mapMaybe((x: any) => M.lookup(x, idTable), S.toList(selection));
    elmerSend(
      elmer1,
      "{" +
        "let selSet=new " + call("Set", [value(remoteSelection)]) + ";" +
        "let tree=" + call("$.ui.fancytree.getTree", [var_(h)]) + ";" +
        "tree.visit(function(node){node.setSelected(" +
        "selSet.has(node.key)," +
        '{"noEvents":true}' +
        ");});" +
        "}",
    );
  };
  const trees1 = forestFunc(atomicallySync(() => e.tStateBehaviour()));
  // Build indexes for the tree values, because type "a" is not "ToJSON".
  const counter = { state: 1 }; // Node zero is root.
  const trees2 = trimForest(trees1).map((t) => tag(counter, t));
  const tagTable = M.fromList(trees2.flatMap((t) => flatten(t)));
  const idTable = M.fromList(catMaybes(trees2.flatMap((t) => flatten(t).map(invertId))));
  const initial = atomicallySync(() => i.tStateBehaviour());
  const webit = makeWebitContainer(elmer, "");
  const wId = WebitClass_WebitContainer.webitId(webit);
  const h = WebitClass_WebitContainer.webitHandle(webit);
  elmerSend(
    elmer,
    "$(" + var_(h) + ").fancytree({" +
      'extensions: ["multi"],' +
      "expanded: true," +
      "select: function(event,data){" +
      "jsb.event({" +
      "d:" + value(wId) + "," +
      "v:{k:data.node.key,s:data.node.isSelected()}" +
      "});" +
      "}," +
      "source:" + encodeLatin1(trees2.map((t) => ToJSON_FancyTree.toJSON(treeConvert(t)))) +
      "})",
  );
  const i1 = tStateDupIO(i);
  const [out, outWriter] = newTStateIO<boolean, GadgetData<any>>(initial);
  const selectClicks = addWebitChannel(FromJSON_FTSelection, WebitClass_WebitContainer, elmer, webit);
  elmerDaemon(WebitClass_WebitContainer, elmer, webit, async (elmer1) => {
    const v = await atomically(() => {
      const [userFlag, v1] = i1.tStateEvent();
      const oldVal = out.tStateBehaviour();
      if (!equals(oldVal, v1)) outWriter(userFlag, v1);
      return v1;
    });
    setSelected(elmer1, h, idTable, v._gdValue);
  });
  elmerDaemon(WebitClass_WebitContainer, elmer, webit, () =>
    atomically(() => {
      const ev = readTChan(selectClicks);
      const entry = M.lookup(ev.ftsKey, tagTable);
      if (entry.tag === "Just" && entry.value[2].tag === "Just") {
        const key = entry.value[2].value;
        const oldVal = out.tStateBehaviour();
        outWriter(true, set(gdValue<S.Set<any>>().dot(contains(key)), ev.ftsSelected, oldVal));
      }
    }),
  );
  setSelected(elmer, h, idTable, initial._gdValue);
  return GadgetOut([WebitItem(WebitClass_WebitContainer, webit)], noDomCode, retrySTM, out);
}

function renderGadget_Table(elmer: ElmerEnv, i: AnyIn, editing: readonly any[], spec: readonly any[]): AnyOut {
  const initial = atomicallySync(() => i.tStateBehaviour());
  const [webit, domJS] = mkTableWebit<any>(elmer, editing, spec, initial._gdValue);
  const i1 = tStateDupIO(i);
  const [out, outWriter] = newTStateIO<boolean, GadgetData<any>>(initial);
  elmerDaemon(WebitClass_Webit, elmer, webit, () =>
    atomically(() =>
      orElse(
        () => {
          const [userFlag, v] = i1.tStateEvent();
          const oldVal = out.tStateBehaviour();
          if (!equals(oldVal, v)) {
            webit.webitIn(v._gdValue);
            outWriter(userFlag, v);
          }
        },
        () => {
          const [, newVal] = webit.webitState.tStateEvent();
          outWriter(true, GadgetData(true, newVal));
        },
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], domJS, retrySTM, out);
}

function renderGadget_Table_Just(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  editing: readonly any[],
  spec: readonly any[],
  selector: DialogSelector_<any, any, any>,
): AnyOut {
  const initial = atomicallySync(() => i.tStateBehaviour());
  const [webit, domJS, clickRows] = mkTableWebitWithClicks<any>(elmer, editing, spec, initial._gdValue);
  const rowUpdates = mkWebitPopupSelect(elmer, e, selector, (): [number, any] => {
    const row = readTChan(clickRows);
    const v = webit.webitState.tStateBehaviour();
    if (row < 0 || row >= v.length) return error("Prelude.!!: index too large");
    return [row, v[row]];
  });
  const i1 = tStateDupIO(i);
  const [out, outWriter] = newTStateIO<boolean, GadgetData<any>>(initial);
  elmerDaemon(WebitClass_Webit, elmer, webit, () =>
    atomically(() =>
      orElse(
        () => {
          const [userFlag, v] = i1.tStateEvent();
          const oldVal = out.tStateBehaviour();
          if (!equals(v, oldVal)) {
            webit.webitIn(v._gdValue);
            outWriter(userFlag, v);
          }
        },
        () => {
          const oldVal = webit.webitState.tStateBehaviour();
          const [row, v] = readTChan(rowUpdates);
          if (v.tag === "Just") {
            const newVal = oldVal.map((x, k) => (k === row ? v.value : x)); // ix row .~ v1
            webit.webitIn(newVal);
            outWriter(true, GadgetData(true, newVal));
          }
        },
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], domJS, retrySTM, out);
}

function renderGadget_ForestTable(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  headerGroups: readonly (readonly [T.Text, readonly (readonly [T.Text, GadgetF_<any, any, any>])[]])[],
  lensForest: (e: any) => Forest<readonly [any, Lens1<any, any>]>,
): AnyOut {
  const headerRows = (groups: readonly (readonly [T.Text, readonly (readonly [T.Text, any])[]])[]): H.Html => {
    if (groups.length === 0) return H.mempty_Html;
    if (groups.length === 1) return H.tr(H.mconcat_Html(groups[0][1].map((c) => H.th(H.text(c[0])))));
    const [[, group1], ...rest] = groups;
    return H.mconcat_Html([
      H.tr(
        H.mconcat_Html([
          ...group1.map((c) => H.with_(H.th, HA.rowspan("2"))(H.text(c[0]))),
          ...rest.map(headerSpan),
        ]),
      ),
      H.tr(H.mconcat_Html(rest.flatMap((g) => g[1]).map((c) => H.th(H.text(c[0]))))),
    ]);
  };
  const headerSpan = ([grpHead, items]: readonly [T.Text, readonly unknown[]]): H.Html =>
    items.length === 0 ? H.mempty_Html : H.with_(H.th(H.text(grpHead)), HA.colspan(H.toValue(items.length)));
  // webitTree1 :: [GadgetF' e w a] -> [[GadgetF' e w a]] -> Tree (k, Lens1 s a)
  //    -> Elmer (Tree [GadgetOut (Either w1 (k, a -> a)) s])
  const gadgetTree1 = (
    gs: readonly GadgetF_<any, any, any>[],
    gss: readonly (readonly GadgetF_<any, any, any>[])[],
    node: Tree<readonly [any, Lens1<any, any>]>,
  ): Tree<AnyOut[]> => {
    const [k, lns1] = node.rootLabel;
    const subRows = gadgetForest(gss, node.subForest);
    const n = subRows.map(leafCount).reduce((a, b) => a + b, 0);
    const attribs: [string, string][] = n > 1 ? [["rowspan", String(n)]] : [];
    const cells = gs.map((g) => {
      const cell = makeWebitContainer1(elmer, "td", attribs);
      const g2 = G.focusingOver(
        getLens(lns1),
        gDot(
          G.send((f: (a: any) => any) => Just(Right([k, f]))),
          G.sendMap((w: any) => Just(Left(w)), g),
        ),
      );
      const contents = renderGadget(elmer, e, i, g2);
      for (const w of contents.gadgetView) showWebit(WebitClass_WebitItem, elmer, cell, w);
      return { ...contents, gadgetView: [WebitItem(WebitClass_WebitContainer, cell)] };
    });
    return Node(cells, subRows);
  };
  // webitForest :: [[GadgetF' e w a]] -> Forest (k, Lens1 s a) ->
  //    Elmer (Forest [GadgetOut (Either w1 (k, a -> a)) s])
  const gadgetForest = (
    gss: readonly (readonly GadgetF_<any, any, any>[])[],
    nodes: Forest<readonly [any, Lens1<any, any>]>,
  ): Tree<AnyOut[]>[] => {
    if (gss.length === 0) return [];
    const [gs, ...rest] = gss;
    return nodes.map((nd) => gadgetTree1(gs, rest, nd));
  };
  const assembleTreeRows = <A>(t: Tree<A[]>): A[][] => {
    const rs = t.subForest.flatMap(assembleTreeRows);
    if (rs.length === 0) return [t.rootLabel];
    const [r, ...rest] = rs;
    return [[...t.rootLabel, ...r], ...rest];
  };
  const leafCount = <A>(t: Tree<A>): number =>
    t.subForest.length === 0 ? 1 : t.subForest.map(leafCount).reduce((a, b) => a + b, 0);

  const eng = elmer.elmerEngine;
  // Create the table and header.
  const table1 = makeWebitContainer1(elmer, "table", [["class", "matrix"]]);
  const initialEnv = atomicallySync(() => e.tStateBehaviour());
  const headerBlock = H.renderHtml(H.thead(headerRows(headerGroups)));
  JS.send(eng, command(var_(WebitClass_WebitContainer.webitHandle(table1)) + ".innerHTML=" + value(headerBlock) + ";"));
  // Create the body.
  const gadgets = gadgetForest(
    headerGroups.map((g) => g[1].map((c) => c[1])),
    lensForest(initialEnv),
  );
  const bodyBlock = makeWebitContainer1(elmer, "tbody", []);
  for (const cells of gadgets.flatMap(assembleTreeRows)) {
    const row = makeWebitContainer1(elmer, "tr", []);
    for (const c of cells) for (const w of c.gadgetView) showWebit(WebitClass_WebitItem, elmer, row, w);
    // Each GadgetOut in 'cells' has exactly one <td> webit created by gadgetTree1
    showWebit(WebitClass_WebitContainer, elmer, bodyBlock, row);
  }
  showWebit(WebitClass_WebitContainer, elmer, table1, bodyBlock);
  // Assemble the resulting GadgetOut.
  const result = composeOutputs(gadgets.flatMap((t) => flatten(t).flat()));
  return { ...result, gadgetView: [WebitItem(WebitClass_WebitContainer, table1)] };
}

function renderGadget_ForestEditor(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  labelFunc: (e: any, a: any) => T.Text,
  menuFunc: (m: Maybe<any>) => Menu<TreeOper<any>>,
  legalParent: (a: any) => boolean,
  dSel: Maybe<DialogSelector_<any, any, any>>,
): AnyOut {
  type Opr = readonly [FM.ModelIndex, TreeOper<any>];
  const jsonForest = (env: any, nodes: Forest<readonly [FM.ModelIndex, any]>): [J.Value[], WebitMenu<Opr>[]] => {
    const rs = nodes.map((nd) => jsonTree(env, nd));
    return [rs.map((r) => r[0]), rs.flatMap((r) => r[1])];
  };
  const jsonTree = (env: any, nd: Tree<readonly [FM.ModelIndex, any]>): [J.Value, WebitMenu<Opr>[]] => {
    const [k, v] = nd.rootLabel;
    const cs = nd.subForest;
    const menu = mkWebitMenu(elmer, fmap_Menu((op: TreeOper<any>): Opr => [k, op], menuFunc(Just(v))));
    if (cs.length === 0) {
      return [
        J.object([
          ["title", labelFunc(env, v)],
          ["key", String(k)],
          [
            "data",
            J.object([
              ["legalParent", legalParent(v)],
              ["menu", WebitClass_WebitContainer.webitId(menu.webitMenuDisplay)],
            ]),
          ],
        ]),
        [menu],
      ];
    }
    const [cs1, menus] = jsonForest(env, cs);
    return [
      J.object([
        ["title", labelFunc(env, v)],
        ["key", String(k)],
        [
          "data",
          J.object([
            ["legalParent", true],
            ["menu", WebitClass_WebitContainer.webitId(menu.webitMenuDisplay)],
          ]),
        ],
        ["folder", true],
        ["children", cs1],
      ]),
      [menu, ...menus],
    ];
  };
  const jsonModel = (env: any, m: FM.Model<any>): [J.Value[], WebitMenu<Opr>[]] =>
    jsonForest(env, FM.evalEdit((st) => FM.getForest(st), FM.mapWithIndex((n, a): readonly [FM.ModelIndex, any] => [n, a], m)));
  const jsSetup = (h: JS.RemoteValue<H.Html>, wId: WebitId, bgH: JS.RemoteValue<H.Html>, initialJS: J.Value[]): JavaScript =>
    "{" +
    "$(" + var_(h) + ").fancytree({" +
    "extensions: ['dnd5']," +
    "expanded: true," +
    "nodata: false," +
    "dnd5: {" +
    "effectAllowed: 'move'," +
    "preventForeignNodes: true," +
    "preventNoneNodes: true," +
    "dragStart: function (){return true;}," +
    "dragEnter: function (node,data){return(legalDrop (node, data));}," +
    "dragDrop: function(node,data){" +
    "if (legalDrop (node, data)) {" +
    "data.otherNode.moveTo(node, data.hitMode);" +
    webitEventData(wId, "fancyToForest(data.tree.rootNode.getChildren())") +
    "} else {return(false);}" +
    "}" +
    "}," +
    "source:" + encodeLatin1(initialJS) + "," +
    "create: function (ev,data){" +
    "this.addEventListener('contextmenu',function(event){" +
    "event.preventDefault();" +
    // `value h` encodes a RemoteValue as its variable.
    "let z=ancestorZ(" + var_(h) + ");" +
    "$(" + var_(bgH) + ").finish().toggle(100).css({" +
    "top:event.pageY+'px'," +
    "left:event.pageX+'px'," +
    "zIndex: z+1" +
    "});" +
    "});" +
    "}," +
    "createNode: function(ev,data){" +
    (dSel.tag === "Nothing"
      ? ""
      : "data.node.span.addEventListener('dblclick',function(clickEvent){" +
        "clickEvent.preventDefault();" +
        webitEventData(wId, "data.node.key") + ";" +
        "});") +
    "data.node.span.addEventListener('contextmenu',function(event){" +
    "event.preventDefault();" +
    "let z=ancestorZ(data.node.span);" +
    "$('#'+data.node.data.menu).finish().toggle(100).css({" +
    "top:event.pageY+'px'," +
    "left:event.pageX+'px'," +
    "zIndex: z+1" +
    "});" +
    "});" +
    "}" +
    "});" +
    "}";

  const env = atomicallySync(() => e.tStateBehaviour());
  const initial = atomicallySync(() => i.tStateBehaviour());
  const webit = makeWebitContainer(elmer, "forest-editor");
  const bgMenu = mkWebitMenu(elmer, fmap_Menu((op: TreeOper<any>): Opr => [FM.rootIndex, op], menuFunc(Nothing)));
  const initialModel = FM.makeModel(initial._gdValue as Forest<any>);
  const wId = WebitClass_WebitContainer.webitId(webit);
  const h = WebitClass_WebitContainer.webitHandle(webit);
  const bgH = WebitClass_WebitContainer.webitHandle(bgMenu.webitMenuDisplay);
  const i1 = tStateDupIO(i);
  const dnd = addWebitChannel(treeListJ, WebitClass_WebitContainer, elmer, webit); // Gets the whole updated tree.
  const [initialJS, ms] = jsonModel(env, initialModel);
  const currentModel = newTVarIO(initialModel);
  const currentMenus = newTVarIO<WebitMenu<Opr>[]>(ms);
  const [output, outWriter] = newTStateIO<boolean, GadgetData<any>>(initial);
  const sel = webitSelector(wId);
  elmerSend(elmer, jsSetup(h, wId, bgH, initialJS));
  // If a DialogSelector is provided then process double-click events.
  if (dSel.tag === "Just") {
    const selector = dSel.value;
    const dblClicks = addWebitChannel(J.stringJ, WebitClass_WebitContainer, elmer, webit); // Gets the ModelIndex of the double-clicked item.
    const getClick = (): [FM.ModelIndex, any] => {
      for (;;) {
        const click = readTChan(dblClicks);
        const click2 = readInt(click);
        if (click2.tag === "Just") {
          const mdl = readTVar(currentModel);
          const v = preview(FM.ix_Model(click2.value), mdl);
          if (v.tag === "Just") return [click2.value, v.value];
        }
      }
    };
    const dialogOutputs = mkWebitPopupSelect(elmer, e, selector, getClick);
    elmerDaemon(WebitClass_WebitContainer, elmer, webit, async (elmer1) => {
      const [k, v1] = await atomically(() => readTChan(dialogOutputs));
      if (v1.tag === "Just") {
        const v2 = v1.value;
        const oldModel = readTVarIO(currentModel);
        const newModel = set(FM.ix_Model(k), v2, oldModel);
        elmerSend(
          elmer1,
          "{" +
            "let n = $.ui.fancytree.getTree(" + sel + ")." +
            "getNodeByKey(" + value(String(k)) + ");" +
            "if (n) {n.setTitle(" + value(labelFunc(env, v2)) + ")};" +
            "}",
        );
        atomicallySync(() => {
          writeTVar(currentModel, newModel);
          outWriter(true, GadgetData(true, view(from(FM.modelIso()), newModel)));
        });
      }
    });
  }
  // Process context menu clicks.
  elmerDaemon(WebitClass_WebitContainer, elmer, webit, async (elmer1) => {
    const [idx, opr] = await atomically((): Opr => {
      const oldMenus = readTVar(currentMenus);
      return [bgMenu, ...oldMenus].reduceRight<STM<Opr>>(
        (acc, m) => () => orElse(() => readTChan(m.webitMenuOutput), acc),
        () => retry(),
      )();
    });
    const newJS = encodeLatin1;
    const oldModel = readTVarIO(currentModel);
    const addNode = (newVal: any, ins: FM.Insertion, jsRoot: (x: JavaScript) => JavaScript, jsNode: (x: JavaScript) => JavaScript): void => {
      const [mIdx, newModel] = FM.runEdit((st) => FM.insert(st, ins, idx, newVal), oldModel);
      if (mIdx.tag === "Just") {
        const newIdx = mIdx.value;
        const [newNode, newMenu] = jsonTree(env, Node([newIdx, newVal] as const, []));
        elmerSend(elmer1, idx === FM.rootIndex ? jsRoot(newJS(newNode)) : jsNode(newJS(newNode)));
        atomicallySync(() => {
          writeTVar(currentModel, newModel);
          modifyTVar(currentMenus, (ms1) => [...newMenu, ...ms1]);
          outWriter(true, GadgetData(true, view(from(FM.modelIso()), newModel)));
        });
      }
    };
    switch (opr.tag) {
      case "TreeAddBefore":
        addNode(
          opr._0,
          "InsertBefore",
          (x) =>
            "{" +
            "let n = $.ui.fancytree.getTree(" + sel + ")." +
            "getRootNode();" +
            "if (n.hasChildren()) {" +
            "n.addChildren(" + x + ",0);" +
            "} else {" +
            "n.addChildren(" + x + ");" +
            "};" +
            "}",
          (x) =>
            "{" +
            "let n=$.ui.fancytree.getTree(" + sel + ")." +
            "getNodeByKey(" + value(String(idx)) + ");" +
            "if (n) {n.parent.addChildren(" + x + ",n);};" +
            "}",
        );
        break;
      case "TreeAddAfter":
        addNode(
          opr._0,
          "InsertAfter",
          (x) =>
            "{" +
            "$.ui.fancytree.getTree(" + sel + ")." +
            "getRootNode().addChildren(" + x + ");};" +
            "}",
          (x) =>
            "{" +
            "let n=$.ui.fancytree.getTree(" + sel + ")." +
            "getNodeByKey(" + value(String(idx)) + ");" +
            "if (n) {" +
            "let s=n.getNextSibling();" +
            "if (s) {s.parent.addChildren(" + x + ", s);}" +
            "else {n.parent.addChildren(" + x + ");};" +
            "};" +
            "}",
        );
        break;
      case "TreeAddIn":
        addNode(
          opr._0,
          "AppendChild",
          (x) => "$.ui.fancytree.getTree(" + sel + ")." + "getRootNode().addChildren(" + x + ");",
          (x) =>
            "{" +
            "let n=$.ui.fancytree.getTree(" + sel + ")." +
            "getNodeByKey(" + value(String(idx)) + ");" +
            "if (n) {n.addChildren(" + x + ");};" +
            "}",
        );
        break;
      case "TreeDelete": {
        elmerSend(
          elmer1,
          "{" +
            "let n=$.ui.fancytree.getTree(" + sel + ")." +
            "getNodeByKey(" + value(String(idx)) + ");" +
            "if (n) {n.remove();};" +
            "}",
        );
        const newModel = FM.execEdit((st) => FM.delete_(st, idx), oldModel);
        const newForest = view(from(FM.modelIso()), newModel);
        atomicallySync(() => {
          writeTVar(currentModel, newModel);
          outWriter(true, GadgetData(true, newForest));
        });
        break;
      }
    }
  });
  // Process D&D updates.
  elmerDaemon(WebitClass_WebitContainer, elmer, webit, () =>
    atomically(() => {
      const newIdxForest = forestCatMaybe(readTChan(dnd).map((t) => fmapTree(readInt, t)));
      const oldModel = readTVar(currentModel);
      const newModel = FM.stableUpdate(newIdxForest, oldModel);
      const newForest = view(from(FM.modelIso()), newModel);
      writeTVar(currentModel, newModel);
      outWriter(true, GadgetData(true, newForest));
    }),
  );
  // Process inputs from application.
  elmerDaemon(WebitClass_WebitContainer, elmer, webit, async (elmer1) => {
    const [newForest, oldModel] = await atomically((): [GadgetData<any>, FM.Model<any>] => [i1.tStateEvent()[1], readTVar(currentModel)]);
    const changed = !equals(newForest._gdValue, view(from(FM.modelIso()), oldModel));
    if (changed) {
      const oldMenus = readTVarIO(currentMenus);
      for (const m of oldMenus) await deleteWebit(WebitClass_WebitContainer, elmer1, m.webitMenuDisplay);
      const newModel = FM.makeModel(newForest._gdValue as Forest<any>);
      const [newJs, newMenus] = jsonModel(env, newModel);
      // Faithful: the selector string is called as if it were the tree.
      elmerSend(elmer1, "(" + sel + ")." + "reload(" + encodeLatin1(newJs) + ")");
      atomicallySync(() => {
        writeTVar(currentModel, newModel);
        writeTVar(currentMenus, newMenus);
      });
    }
  });
  return GadgetOut([WebitItem(WebitClass_WebitContainer, webit)], noDomCode, retrySTM, output);
}

/** `fmap` over a tree. */
function fmapTree<A, B>(f: (a: A) => B, t: Tree<A>): Tree<B> {
  return Node(f(t.rootLabel), t.subForest.map((c) => fmapTree(f, c)));
}

/** aeson's `FromJSON (Tree String)` (a tree is the array @[label, [children]]@), for a list of trees. */
const treeListJ: J.FromJSON<Tree<string>[]> = {
  parseJSON: (v) => J.withArray("[Tree]", (a) => a.map(parseTree), v),
};
function parseTree(v: J.Value): Tree<string> {
  return J.withArray(
    "Tree",
    (a) => {
      if (a.length !== 2) return J.fail("expected a pair for Tree");
      return Node(J.stringJ.parseJSON(a[0]), J.withArray("Forest", (cs) => cs.map(parseTree), a[1]));
    },
    v,
  );
}

function renderGadget_Scrolled(elmer: ElmerEnv, env: AnyEnv, i: AnyIn, g: AnyGadget): AnyOut {
  const result = renderGadget(elmer, env, i, g);
  const items = result.gadgetView;
  if (items.length === 0) return result;
  if (items.length === 1) {
    elmerSend(elmer, addClass(WebitClass_WebitItem, items[0], "scrolled"));
    return result;
  }
  const r = makeWebitContainer(elmer, "scrolled");
  for (const w of items) showWebit(WebitClass_WebitItem, elmer, r, w);
  return { ...result, gadgetView: [WebitItem(WebitClass_WebitContainer, r)] };
}

function renderGadget_ButtonBar_Empty(): AnyOut {
  // let st = TState (pure $ GadgetData True id) retry $ return st
  const st: AnyIn = TState(
    () => GadgetData(true, (x: any) => x),
    () => retry(),
    () => st,
  );
  return GadgetOut([], noDomCode, retrySTM, st);
}

function renderGadget_ButtonBar(elmer: ElmerEnv, buttons: readonly (readonly [T.Text, (a: any) => any])[]): AnyOut {
  const btnHtml = (lbl: T.Text, wId: WebitId): H.Html =>
    H.with_(H.button(H.toHtml(lbl)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.unitJ, wId, null))));
  const webit = makeWebitContainer(elmer, "horizontal");
  const outChan = newBroadcastTChanIO<[boolean, GadgetData<any>]>();
  const clicks: STM<(a: any) => any>[] = buttons.map(([lbl, updateF]) => {
    const btn = makeWebit<null>(J.unitJ, elmer, (wId) => btnHtml(lbl, wId), () => "", null);
    showWebit(WebitClass_Webit, elmer, webit, btn);
    return () => {
      btn.webitState.tStateEvent();
      return updateF;
    };
  });
  elmerDaemon(WebitClass_WebitContainer, elmer, webit, () =>
    atomically(() => {
      const clicks2 = orElseAll(clicks); // Safe because buttons /= [], so clicks /= []
      writeTChan(outChan, [true, GadgetData(true, clicks2)]);
    }),
  );
  const outChan1 = atomicallySync(() => dupTChan(outChan));
  const dup = (): AnyIn => {
    const newE = dupTChan(outChan);
    return { ...st, tStateEvent: () => readTChan(newE) };
  };
  const st: AnyIn = TState(() => GadgetData(true, (x: any) => x), () => readTChan(outChan1), dup);
  return GadgetOut([WebitItem(WebitClass_WebitContainer, webit)], noDomCode, retrySTM, st);
}

function renderGadget_ButtonIO(elmer: ElmerEnv, e: AnyEnv, i: AnyIn, lbl: T.Text, actionF: (e: any, i: any) => any): AnyOut {
  const btnHtml = (wId: WebitId): H.Html =>
    H.with_(H.button(H.toHtml(lbl)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.unitJ, wId, null))));
  const webit = makeWebit<null>(J.unitJ, elmer, btnHtml, () => "", null);
  const [output, outWriter] = newTStateIO<boolean, GadgetData<Maybe<any>>>(GadgetData(true, Nothing));
  elmerDaemon(WebitClass_Webit, elmer, webit, async () => {
    const act = await atomically(() => {
      webit.webitState.tStateEvent();
      const env = e.tStateBehaviour();
      const inp = i.tStateBehaviour();
      return () => actionF(env, inp._gdValue);
    });
    const r = await act();
    atomicallySync(() => outWriter(true, GadgetData(true, Just(r))));
  });
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, output);
}

function renderGadget_Image(elmer: ElmerEnv, i: AnyIn, path: string): AnyOut {
  const imgHtml = (): H.Html => H.with_(H.img(), HA.src(H.stringValue(path)));
  const i1 = tStateDupIO(i);
  const webit = makeWebit<[number, number]>(J.tuple2J(J.doubleJ, J.doubleJ), elmer, imgHtml, () => "", [0, 0]);
  elmerSend(
    elmer,
    var_(WebitClass_Webit.webitHandle(webit)) + ".addEventListener('click', function(ev){" +
      webitEventData(WebitClass_Webit.webitId(webit), "[ev.offsetX, ev.offsetY]") +
      "})",
  );
  const [output, outWriter] = newTStateIO<boolean, GadgetData<any>>(GadgetData(true, [0, 0]));
  elmerDaemon(WebitClass_Webit, elmer, webit, () =>
    atomically(() =>
      orElse(
        () => {
          const [dx, dy] = webit.webitState.tStateEvent()[1];
          // Can't be sure web client will send Ints, so allow for decimals.
          outWriter(true, GadgetData(true, [round(dx), round(dy)]));
        },
        () => {
          const [userFlag, v] = i1.tStateEvent();
          outWriter(userFlag, v);
        },
      ),
    ),
  );
  return GadgetOut([WebitItem(WebitClass_Webit, webit)], noDomCode, retrySTM, output);
}

function renderGadget_Trace(
  elmer: ElmerEnv,
  e: AnyEnv,
  i: AnyIn,
  msg: string,
  inF: (i: any) => string,
  outF: (i: any, o: any) => string,
  g: AnyGadget,
): AnyOut {
  const inner = renderGadget(elmer, e, i, g);
  const i1 = atomicallySync(() => i.tStateDup());
  const o1 = atomicallySync(() => inner.gadgetOutput.tStateDup());
  const top = elmer.elmerTop;
  elmerDaemon(WebitClass_WebitContainer, elmer, top, async () => {
    type TraceData = Either<[boolean, GadgetData<any>], [GadgetData<any>, [boolean, GadgetData<any>]]>;
    const dat = await atomically(
      (): TraceData =>
        orElse<TraceData>(
          () => Left(i1.tStateEvent()),
          () => Right([i1.tStateBehaviour(), o1.tStateEvent()]),
        ),
    );
    if (dat.tag === "Left") {
      const [b, v] = dat.value;
      console.log(msg + " input = " + "(" + showBool(b) + "," + T.showText(inF(v._gdValue)) + ")");
    } else {
      const [iv, [b, ov]] = dat.value;
      console.log(msg + " output = " + "(" + showBool(b) + "," + T.showText(outF(iv._gdValue, ov._gdValue)) + ")");
    }
  });
  return inner;
}

/** Create a tab within a tabbed form and add it to the argument containers. */
export function makeTab<E, W, I, O>(
  elmer: ElmerEnv,
  /** Environment */
  env: TState<boolean, E>,
  /** Input */
  i: GadgetState<I>,
  /** Header container. */
  tabHeader: WebitContainer,
  /** Tab body container. */
  tabContainer: WebitContainer,
  /** Tab label and gadget pair. */
  [lbl, g]: readonly [T.Text, Gadget<E, W, I, O>],
): GadgetOut<W, O> {
  const tab = renderGadget(elmer, env, i, g);
  let tabWebit: WebitItem;
  if (tab.gadgetView.length === 0) {
    tabWebit = WebitItem(WebitClass_WebStatic, makeWebStatic(elmer, H.text("")));
    // Empty tab; should not happen, but play it straight.
  } else if (tab.gadgetView.length === 1) {
    tabWebit = tab.gadgetView[0];
  } else {
    const c = makeWebitContainer(elmer, "tab-body");
    for (const w of tab.gadgetView) showWebit(WebitClass_WebitItem, elmer, c, w);
    tabWebit = WebitItem(WebitClass_WebitContainer, c);
  }
  // Faithful: `openTab` (JS/arrowDialog.js) expects the button but is given the event.
  const btn = makeWebStatic(
    elmer,
    H.with_(
      H.button(H.text(lbl)),
      HA.type_("button"),
      HA.onclick(
        jsValue(
          "openTab(event, " +
            value(WebitClass_WebitItem.webitId(tabWebit)) + "," +
            var_(WebitClass_WebitContainer.webitHandle(tabHeader)) + "," +
            var_(WebitClass_WebitContainer.webitHandle(tabContainer)) + ")",
        ),
      ),
    ),
  );
  showWebit(WebitClass_WebStatic, elmer, tabHeader, btn);
  showWebit(WebitClass_WebitItem, elmer, tabContainer, tabWebit);
  return tab;
}

/** Debugging function. */
export function showOpr<A>(f: (a: A) => T.Text, op: TreeOper<A>): string {
  switch (op.tag) {
    case "TreeAddBefore":
      return "TreeAddBefore " + T.showText(f(op._0));
    case "TreeAddAfter":
      return "TreeAddAfter " + T.showText(f(op._0));
    case "TreeAddIn":
      return "TreeAddIn " + T.showText(f(op._0));
    case "TreeDelete":
      return "TreeDelete";
  }
}
