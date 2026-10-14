// Ported from banana-ui/webits/demo-webit/Dialog.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The \"Demo Dialog\" of the @demo-webit@ program and its parts: the table of @DemoTable@ rows,
 * the tree selection popup and a test page.
 *
 * TypeScript port
 * ---------------
 * * Gadgets and dialogs that are polymorphic in the side channel type @w@ (and in @e@ where it
 *   is free) are constants typed with @any@ for those parameters.
 * * The `Show`/`Read`/`Bounded`/`Enum` instances used by the gadgets are passed explicitly
 *   (`typedTextBox(showInt, readInteger)`, `boundedRadio(demoEnumValues, show_DemoEnum)`).
 * * The @proc@ block of `demoDialog` is desugared by hand (PORTING.md §9); the original is kept in
 *   a comment above it.
 * * `System.Random.randomRIO` is the local `randomRIO` (`Math.random`).
 * * `loremIpsum` and `demoSetPopup` are defined before the constants that use them, because
 *   TypeScript constants are evaluated in order (Haskell's are lazy).
 */
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import type { Forest } from "@/lib/Data/Tree";
import { readDouble, readInteger, showDouble, showInt } from "@/lib/Prelude";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { standardHeader } from "@/banana-ui/webits/src/Network/Webits/StyleSheets";
import {
  Dialog,
  OkApplyButton,
  accum,
  arr,
  boundedRadio,
  box,
  buttonBar,
  buttonIO,
  clickableSingle,
  colourBox,
  coloured,
  dateBox,
  displayMemo,
  focusing,
  form,
  gDot,
  gFirst,
  gPipe,
  icon,
  iconBox,
  message,
  simpleFrame,
  table,
  textPopup,
  tickBox,
  treeSelector,
  typedTextBox,
  type Dialog_,
  type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Colour, noIconName, shortDate, textPrismDouble, type IconName } from "@/banana-ui/base/Reactive/Banana/Common";
import { EditBool, EditEntry, EditIcon, TableAdd, TableDelete, TableShuffle, mkField, type Table } from "@/banana-ui/base/Reactive/Banana/Table";
import {
  DemoTable,
  boolField,
  demoBool,
  demoColour,
  demoDate,
  demoEnum,
  demoEnumValues,
  demoIcon,
  demoNum,
  demoSet,
  demoTable,
  demoText,
  iconField,
  numberField,
  show_DemoEnum,
  type DemoData,
} from "./Types";

/** The environment of the demo dialog: the forest offered by the tree selector. */
type DemoForest = Forest<readonly [T.Text, Maybe<T.Text>, Maybe<number>]>;

/** `System.Random.randomRIO`: a random integer in the inclusive range. (IO.) */
function randomRIO([lo, hi]: readonly [number, number]): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}


/**
 * (Defined before `demoDialogPage`, which uses it: TypeScript constants are evaluated in order.)
 */
export const loremIpsum: T.Text =
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, " +
  "totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae " +
  "dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, " +
  "sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam " +
  "est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius " +
  "modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima " +
  "veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea " +
  "commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam " +
  "nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?";


export const demoDialogPage: H.Html = H.mconcat_Html([
  H.head(
    H.title("Demo Webits"),
    H.with_(H.link(), HA.rel("shortcut icon"), HA.type_("image/x-icon"), HA.href("/favicon.ico")),
    standardHeader,
  ),
  H.body(H.p(H.text(loremIpsum))),
]);


export const demoTableColumns: Table<DemoTable> = [
  mkField("Boolean", boolField, Just(boolIcon), EditBool, Just(boolColour)),
  mkField("Number", numberField, Nothing, EditEntry(textPrismDouble), Nothing),
  mkField("Icon", iconField, Nothing, EditIcon(() => true), Nothing),
];


export function boolIcon(b: boolean): IconName {
  return b ? "computer-add" : "computer-application-exit";
}


export function boolColour(b: boolean): Colour {
  return b ? Colour(C.darkgreen) : Colour(C.darkred);
}


export const demoTableForm: Dialog_<any, any, DemoTable> = Dialog(
  "Edit table row",
  OkApplyButton,
  accum(
    form<any, any, DemoTable>("Vertical", [
      ["Boolean", focusing(boolField, coloured((b: boolean) => Just(boolColour(b)), icon(boolIcon, tickBox())))],
      ["Number", focusing(numberField, typedTextBox(showDouble, readDouble))],
      ["Icon", focusing(iconField, iconBox(() => true))],
    ]),
  ),
);


/** (Defined before `demoDialog`, which uses it: TypeScript constants are evaluated in order.) */
export const demoSetPopup: Gadget_<DemoForest, any, S.Set<number>> = (() => {
  const showSet = (s: S.Set<number>): T.Text => T.intercalate(", ", S.toList(s).map((n) => showInt(n)));
  return textPopup((_e: DemoForest, s: S.Set<number>) => showSet(s), () => Just(demoForestSelection));
})();


/*
demoDialog = Dialog "Demo Dialog" OkApplyButton $
  proc dat -> do
    out <- accum $ box Vertical [[
        form Vertical [ ... ],
        focusing demoTable $ table [...] demoTableColumns Nothing
      ]]  -< dat
    _ <- simpleFrame "Clickable" $
          clickableSingle (T.pack . show) >>>
          message (\_ v -> "Clicked = " <> T.pack (show v))
        -< [1..10 :: Int]
    _ <- displayMemo <<< arr (\v -> T.pack $
        "The secret code is: " <> show (v ^. demoEnum) <> show (v ^. demoNum)) -< out
    _ <- displayMemo
        <<< arr (\(v :: Maybe Int) -> T.pack $ "The random value is: " <> maybe "" show v)
        <<< buttonIO "Randomise" (const $ const $ randomRIO (0,100)) -< ()
    returnA -< out
*/
export const demoDialog: Dialog_<DemoForest, any, DemoData> = Dialog(
  "Demo Dialog",
  OkApplyButton,
  gPipe(
    // dat -> (dat, dat)
    arr((dat: DemoData): [DemoData, DemoData] => [dat, dat]),
    // out <- accum $ box Vertical [[ ... ]] -< dat
    gFirst<DemoForest, any, DemoData, DemoData, DemoData>(
      accum(
        box<DemoForest, any, DemoData>("Vertical", [
          [
            form<DemoForest, any, DemoData>("Vertical", [
              ["Demo Text:", focusing(demoText, displayMemo())],
              [
                "Demo Number:",
                focusing(
                  demoNum,
                  gDot(
                    accum(buttonBar<DemoForest, any, number>([["Increment", (x) => x + 1], ["Decrement", (x) => x - 1]])),
                    typedTextBox<DemoForest, any, number>(showInt, readInteger),
                  ),
                ),
              ],
              ["Demo Choice:", focusing(demoEnum, boundedRadio(demoEnumValues, show_DemoEnum))],
              ["Demo Boolean:", focusing(demoBool, tickBox())],
              ["Demo Date:", focusing(demoDate, dateBox(shortDate))],
              ["Demo Icon:", focusing(demoIcon, iconBox(() => true))],
              ["Demo Colour:", focusing(demoColour, colourBox())],
              ["Demo Set:", focusing(demoSet, demoSetPopup)],
            ]),
            focusing(
              demoTable,
              table(
                [TableAdd("new row", DemoTable(false, 0, noIconName)), TableDelete, TableShuffle],
                demoTableColumns,
                Nothing,
                //  (Just $ constantDialog demoTableForm)
              ),
            ),
          ],
        ]),
      ),
    ),
    // ([1..10], out)
    arr(([out]: readonly [DemoData, DemoData]): [readonly number[], DemoData] => [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], out]),
    // _ <- simpleFrame "Clickable" $ clickableSingle ... >>> message ... -< [1..10 :: Int]
    gFirst<DemoForest, any, readonly number[], Maybe<number>, DemoData>(
      simpleFrame(
        "Clickable",
        gPipe(
          clickableSingle<DemoForest, any, number>((n) => showInt(n)),
          message<DemoForest, any, Maybe<number>>((_e, v) => "Clicked = " + showMaybeInt(v)),
        ),
      ),
    ),
    // (out, out)
    arr(([, out]: readonly [Maybe<number>, DemoData]): [DemoData, DemoData] => [out, out]),
    // _ <- displayMemo <<< arr (\v -> "The secret code is: " ...) -< out
    gFirst<DemoForest, any, DemoData, T.Text, DemoData>(
      gDot(
        displayMemo<DemoForest, any>(),
        arr((v: DemoData) => "The secret code is: " + show_DemoEnum(v._demoEnum) + showInt(v._demoNum)),
      ),
    ),
    // ((), out)
    arr(([, out]: readonly [T.Text, DemoData]): [null, DemoData] => [null, out]),
    // _ <- displayMemo <<< arr (...) <<< buttonIO "Randomise" ... -< ()
    gFirst<DemoForest, any, null, T.Text, DemoData>(
      gDot(
        displayMemo<DemoForest, any>(),
        gDot(
          arr((v: Maybe<number>) => "The random value is: " + (v.tag === "Just" ? showInt(v.value) : "")),
          buttonIO<DemoForest, any, null, number>("Randomise", () => randomRIO([0, 100])),
        ),
      ),
    ),
    // returnA -< out
    arr(([, out]: readonly [T.Text, DemoData]) => out),
  ),
);

/** `show :: Maybe Int -> String` */
function showMaybeInt(v: Maybe<number>): string {
  return v.tag === "Just" ? "Just " + (v.value < 0 ? "(" + showInt(v.value) + ")" : showInt(v.value)) : "Nothing";
}



export const demoForestSelection: Dialog_<DemoForest, any, S.Set<number>> = Dialog(
  "Demo Tree Selection",
  OkApplyButton,
  treeSelector((e: DemoForest) => e),
);
