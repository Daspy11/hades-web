// Ported from banana-ui/gtk/demo-arrow/Main.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The @demo-arrow@ program: a window with one button per demonstration dialog. Each button pops
 * up a gadget dialog through "Reactive.Banana.GI.ArrowDialog"; the result of each dialog is
 * printed.
 *
 * TypeScript port
 * ---------------
 * * Open with `http://localhost:5173/?demo-arrow` (`src/main.ts` runs `main`) or `?demo=da`
 *   (`src/scratch/daDemo.ts`).
 * * Web: there are no command-line arguments, so `getArgs` is the empty list. Standard output
 *   (`putStrLn`, `print`) is the browser console (`console.log`); `print` shows the Haskell
 *   `show` of the value.
 * * `Gtk.main` mounts the user interface and returns at once (see the toolkit README).
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as T from "@/lib/Data/Text";
import { Right, type Either } from "@/lib/Data/Either";
import { Just, type Maybe } from "@/lib/Data/Maybe";
import { drawTree } from "@/lib/Data/Tree";
import { readInt, showInt } from "@/lib/Prelude";
import { pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  Dialog, OkApplyButton, accum, buttonBar, constantDialog, gDot, getInitial, showGadget, typedTextBox,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { registerIOSignal } from "@/banana-ui/gtk/src/Reactive/Banana/GI";
import * as AD from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { condDialog } from "./Demo/Cond";
import { initialValue, demoDialog, show_DemoData, type DemoData } from "./Demo/Dialog";
import { notebookDialog } from "./Demo/Notebook";
// import Demo.Tree
// import Demo.TreeTable


/** Haskell `show` of an @Either Integer Text@ (at precedence 0, e.g. a tuple component). */
function showEither(v: Either<number, T.Text>): string {
  return v.tag === "Left"
    ? "Left " + (v.value < 0 ? "(" + showInt(v.value) + ")" : showInt(v.value))
    : "Right " + T.showText(v.value);
}

/** Haskell `print`: the browser console is standard output. */
function print(s: string): void {
  console.log(s);
}

/** Haskell `putStrLn`: the browser console is standard output. */
function putStrLn(s: string): void {
  console.log(s);
}


export function main(): void {
  // Web: no command-line arguments in a browser.
  const args: string[] = [];
  Gtk.init(Just(args.map(T.pack)));
  const window = Gtk.windowNew(Gtk.WindowTypeToplevel);
  Gtk.onWidgetDestroy(window, Gtk.mainQuit);
  const buttons = Gtk.boxNew(Gtk.OrientationVertical, 5);
  const showDialogButton = Gtk.buttonNewWithLabel("Show test dialog");
  // const showTreeDialogButton = Gtk.buttonNewWithLabel("Show tree dialog");
  const showNotebookDialogButton = Gtk.buttonNewWithLabel("Show notebook dialog");
  const showCondDialogButton = Gtk.buttonNewWithLabel("Show Conditional dialog");
  const showLoopDialogButton = Gtk.buttonNewWithLabel("Show Loop dialog");
  // const showTreeTableButton = Gtk.buttonNewWithLabel("Show tree table dialog");
  Gtk.containerAdd(buttons, showDialogButton);
  // Gtk.containerAdd(buttons, showTreeDialogButton);
  Gtk.containerAdd(buttons, showNotebookDialogButton);
  Gtk.containerAdd(buttons, showCondDialogButton);
  Gtk.containerAdd(buttons, showLoopDialogButton);
  // Gtk.containerAdd(buttons, showTreeTableButton);
  Gtk.containerAdd(window, buttons);
  Gtk.widgetShowAll(window);
  const iconTheme = Gtk.iconThemeGetDefault();
  // where
  const popupParameters = (n: number): readonly [number, DemoData] => [n, initialValue];
  // treeParameters n = (True, n, nullTreeData, treeDialog n)
  const notebookParameters = (n: number): readonly [number, Either<number, T.Text>] => [n, Right("Foo!")];
  // treeTableParameters n = (True, n, testTreeTable, treeTableDialog n)
  const net = B.compile(() => { // MomentIO
    // Connect the test dialog button.
    const testCount = registerIOSignal(showDialogButton, Gtk.onButtonClicked, () => [null, (n: number) => n + 1] as const);
    const activateDialog = B.mapE(popupParameters, B.accumE(0, testCount));
    const resultE = AD.mkGtkPopupSelect(
      window,
      iconTheme,
      pure_Changes(null),
      constantDialog(demoDialog),
      activateDialog,
    );
    B.reactimate(B.mapE(([n, mValue]: [number, Maybe<DemoData>]) => () => {
      switch (mValue.tag) {
        case "Nothing": putStrLn("Dialog cancelled."); break;
        case "Just": print("(" + showInt(n) + "," + show_DemoData(mValue.value) + ")"); break;
      }
    }, resultE));
    /*
    // Connect the tree dialog button.
    treeCount <- registerIOSignal showTreeDialogButton Gtk.onButtonClicked $ return ((), (+1))
    treeActivate <- accumE 0 treeCount <&> fmap treeParameters
    resultTree <- mkGtkPopup window treeActivate
    reactimate $ resultTree <&> \(n, mSetter) ->
      case mSetter of
        Nothing -> putStrLn "Tree dialog cancelled."
        Just setter -> print (n, setter nullTreeData)
    */
    // Connect the notebook dialog button.
    const notebookCount = registerIOSignal(showNotebookDialogButton, Gtk.onButtonClicked, () =>
      [null, (n: number) => n + 1] as const);
    const notebookActivate = B.mapE(notebookParameters, B.accumE(0, notebookCount));
    const resultUnion = AD.mkGtkPopupSelect(
      window,
      iconTheme,
      pure_Changes(null),
      constantDialog(notebookDialog),
      notebookActivate,
    );
    B.reactimate(B.mapE(([n, mVal]: [number, Maybe<Either<number, T.Text>>]) => () => {
      switch (mVal.tag) {
        case "Nothing": putStrLn("Notebook dialog cancelled."); break;
        case "Just": print("(" + showInt(n) + "," + showEither(mVal.value) + ")"); break;
      }
    }, resultUnion));
    // Connect the Cond dialog button
    const condCount = registerIOSignal(showCondDialogButton, Gtk.onButtonClicked, () =>
      [null, (n: number) => n + 1] as const);
    const condActivate = B.mapE(notebookParameters, B.accumE(0, condCount)); // Same data as notebook
    const resultUnion1 = AD.mkGtkPopupSelect(
      window,
      iconTheme,
      pure_Changes(null),
      constantDialog(condDialog),
      condActivate,
    );
    B.reactimate(B.mapE(([n, mVal]: [number, Maybe<Either<number, T.Text>>]) => () => {
      switch (mVal.tag) {
        case "Nothing": putStrLn("Cond dialog cancelled."); break;
        case "Just": print("(" + showInt(n) + "," + showEither(mVal.value) + ")"); break;
      }
    }, resultUnion1));
    // Connect the Loop dialog button
    const loopCount = registerIOSignal(showLoopDialogButton, Gtk.onButtonClicked, () =>
      [null, (n: number) => n + 1] as const);
    const loopActivate = B.mapE((n: number): readonly [number, number] => [n, 0], B.accumE(0, loopCount));
    const resultLoop = AD.mkGtkPopupSelect(
      window,
      iconTheme,
      pure_Changes(null),
      constantDialog(loopDialog1),
      loopActivate,
    );
    B.reactimate(B.mapE(([n, mVal]: [number, Maybe<number>]) => () => {
      switch (mVal.tag) {
        case "Nothing": putStrLn("Loop dialog cancelled"); break;
        case "Just": print("(" + showInt(n) + "," + showInt(mVal.value) + ")"); break;
      }
    }, resultLoop));
    B.reactimate(B.mapE(() => () => putStrLn(drawTree(showGadget(loopDialog1.dialogGadget))), loopCount));
    /*
    // Connect the tree table dialog button.
    treeTableCount <- registerIOSignal showTreeTableButton Gtk.onButtonClicked $
        return ((), (+1))
    treeTableActivate <- accumE 0 treeTableCount <&> fmap treeTableParameters
    resultForest <- mkGtkPopup window treeTableActivate
    reactimate $ resultForest <&> \(n, mSetter) ->
      case mSetter of
        Nothing -> putStrLn "Tree Table cancelled."
        Just setter -> print (n, setter testTreeTable)
    */
  });
  B.actuate(net);
  Gtk.main();
}


export const loopDialog1: Dialog<null, null, number, number> = Dialog("Loop Demo 1", OkApplyButton, getInitial((n0: number) => {
  const btns: readonly (readonly [T.Text, (n: number) => number])[] = [
    ["+1", (n) => n + 1], ["+5", (n) => n + 5], ["+10", (n) => n + 10], ["Reset", (_) => n0],
  ];
  // accum (buttonBar btns <<< typedTextBox)
  return accum(gDot(buttonBar<null, null, number>(btns), typedTextBox<null, null, number>(showInt, readInt)));
}));
