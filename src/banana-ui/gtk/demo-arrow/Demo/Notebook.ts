// Ported from banana-ui/gtk/demo-arrow/Demo/Notebook.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The \"Notebook Test\" dialog of the @demo-arrow@ program: a "unionTab" gadget editing an
 * @Either Integer Text@, with one notebook tab for each side.
 *
 * TypeScript port: @Integer@ is a JavaScript `number`; the environment and writer types @()@ are
 * `null`.
 */
import type { Either } from "@/lib/Data/Either";
import { _Left, _Right, identity } from "@/lib/Control/Lens";
import { readInteger, showInt } from "@/lib/Prelude";
import type { Text } from "@/lib/Data/Text";
import {
  Dialog, OkApplyButton, PrismaticGadget, accum, focusing, form, simpleTextBox, typedTextBox, unionTab,
  type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";

export const itemDialog: Gadget_<null, null, Either<number, Text>> = unionTab<null, null, Either<number, Text>, Either<number, Text>>([
  ["Left", PrismaticGadget(0, _Left<number, Text>(),
    accum(form<null, null, number>("Vertical", [["Number:", focusing(identity<number>(), typedTextBox<null, null, number>(showInt, readInteger))]])))],
  ["Right", PrismaticGadget("", _Right<number, Text>(),
    accum(form<null, null, Text>("Vertical", [["Text:", focusing(identity<Text>(), simpleTextBox<null, null>())]])))],
]);

export const notebookDialog: Dialog<null, null, Either<number, Text>, Either<number, Text>> = Dialog(
  "Notebook Test",
  OkApplyButton,
  itemDialog,
);
