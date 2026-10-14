// Ported from banana-ui/gtk/demo-arrow/Demo/Cond.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The \"Conditional Test\" dialog of the @demo-arrow@ program: a combo box chooses which side of
 * an @Either Integer Text@ is edited, and a "cond" gadget shows the editor for that side.
 *
 * TypeScript port
 * ---------------
 * * `Side` is a string enumeration (`sideValues`, `show_Side`); `Eq` is `===`.
 * * The `Default` dictionaries of `makeSelection` are the default values themselves, passed
 *   first (as in `Model.Reflection.Dialogs`): `makeSelection(def_A, def_B, side, x)`.
 * * @Integer@ is a JavaScript `number`.
 */
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Nothing } from "@/lib/Data/Maybe";
import { _Left, _Right, identity } from "@/lib/Control/Lens";
import { readInteger, showInt } from "@/lib/Prelude";
import type { Text } from "@/lib/Data/Text";
import { def_Text } from "@/banana-ui/base/Data/Default/Orphan";
import {
  ComboItem, Dialog, OkApplyButton, PrismaticGadget, accum, arr, comboBox, cond, focusing, form, gFanout, gId,
  gPipe, simpleTextBox, typedTextBox, type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";

/** `data Side = LeftSide | RightSide deriving (Eq, Show)` */
export type Side = "LeftSide" | "RightSide";
export const sideValues: readonly Side[] = ["LeftSide", "RightSide"];

/** Derived `Show Side`. */
export function show_Side(s: Side): string {
  return s;
}

/**
 * Switch the value to the chosen side, using the default value of that side when the value is on
 * the other one.
 *
 * TypeScript: the `Default a` and `Default b` dictionaries are the default values `defA`, `defB`.
 */
export function makeSelection<A, B>(defA: A, defB: B, side: Side, x: Either<A, B>): Either<A, B> {
  if (side === "LeftSide" && x.tag === "Right") return Left(defA);
  if (side === "RightSide" && x.tag === "Left") return Right(defB);
  return x;
}

export const itemDialogs: Gadget_<null, null, Either<number, Text>> = cond<null, null, Either<number, Text>, Either<number, Text>>([
  PrismaticGadget(0, _Left<number, Text>(),
    accum(form<null, null, number>("Vertical", [["Number:", focusing(identity<number>(), typedTextBox<null, null, number>(showInt, readInteger))]]))),
  PrismaticGadget("", _Right<number, Text>(),
    accum(form<null, null, Text>("Vertical", [["Text:", focusing(identity<Text>(), simpleTextBox<null, null>())]]))),
]);

export const sideMenu: Gadget_<null, null, Side> = comboBox<null, null, Side>((_: null) => [
  ComboItem("Number", Nothing, Nothing, "LeftSide"),
  ComboItem("Text", Nothing, Nothing, "RightSide"),
]);

export const condDialog: Dialog<null, null, Either<number, Text>, Either<number, Text>> = Dialog(
  "Conditional Test",
  OkApplyButton,
  // proc input -> do
  //   s <- sideMenu -< case input of {Left {} -> LeftSide; Right {} -> RightSide}
  //   itemDialogs -< makeSelection s input
  gPipe(
    gFanout(
      gPipe(
        arr<null, null, Either<number, Text>, Side>((input) => (input.tag === "Left" ? "LeftSide" : "RightSide")),
        sideMenu,
      ),
      gId<null, null, Either<number, Text>>(),
    ),
    arr<null, null, [Side, Either<number, Text>], Either<number, Text>>(([s, input]) => makeSelection<number, Text>(0, def_Text, s, input)),
    itemDialogs,
  ),
);
