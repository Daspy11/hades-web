// Ported from banana-ui/webits/demo-webit/Matrix.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The \"Matrix Demo\" of the @demo-webit@ program: a forest table showing rows of a model of
 * @DemoData@ values, with sub-rows, edited in place.
 *
 * TypeScript port
 * ---------------
 * * An @Elmer@ action takes the `ElmerEnv` first; `demoMatrixAction` never returns (it loops
 *   `forever`), so it is an async function whose Promise never resolves.
 * * The STM model writer is `(b, m) => void` (called inside a transaction); STM transactions are
 *   thunks run by `atomically` (porting-notes/w1.md).
 * * `traceM` (Debug.Trace) writes to the browser console with `console.debug`.
 * * QuickCheck generators come from `@/lib/Test/QuickCheck`; `defaultIso` takes the default value
 *   and compares with the structural `equals` (`Eq a`).
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as QC from "@/lib/Test/QuickCheck";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { Node, type Tree } from "@/lib/Data/Tree";
import { at, iso, ix, over, view, type Iso } from "@/lib/Control/Lens";
import { readInteger, showInt } from "@/lib/Prelude";
import { atomically } from "@/lib/Control/Concurrent/STM";
import { forever } from "@/lib/Control/Concurrent";
import { send } from "@/lib/Network/JavaScript";
import { fmap_TState, pure_TState, type TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import { showWebit, WebitClass_WebitItem, type ElmerEnv } from "@/banana-ui/webits/src/Network/Webits";
import { renderGadget } from "@/banana-ui/webits/src/Network/Webits/ArrowDialog";
import {
  Lens1,
  accum,
  boundedCombo,
  colourBox,
  dateBox,
  displayMemo,
  focusing,
  forestTable,
  iconBox,
  tickBox,
  typedTextBox,
  type Gadget_,
  type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { GadgetData, gdValue, shortDate } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Either } from "@/lib/Data/Either";
import {
  Arbitrary_DemoData,
  demoBool,
  demoColour,
  demoDate,
  demoDefault,
  demoEnum,
  demoEnumValues,
  demoIcon,
  demoNum,
  demoText,
  show_DemoEnum,
  type DemoData,
} from "./Types";


export const matrixColumns: readonly (readonly [T.Text, readonly (readonly [T.Text, GadgetF_<any, any, DemoData>])[]])[] = [
  [
    "Group One",
    [
      ["Text", focusing(demoText, displayMemo())],
      ["Number", focusing(demoNum, typedTextBox(showInt, readInteger))],
      ["Choice", focusing(demoEnum, boundedCombo(demoEnumValues, show_DemoEnum))],
      ["Boolean", focusing(demoBool, tickBox())],
    ],
  ],
  [
    "Group Two",
    [
      ["Text", focusing(demoText, displayMemo())],
      ["Date", focusing(demoDate, dateBox(shortDate))],
      ["Icon", focusing(demoIcon, iconBox(() => true))],
      ["Colour", focusing(demoColour, colourBox())],
    ],
  ],
];


export type Model = M.Map<number, DemoData>;

export type MatrixItems = readonly (readonly [number, readonly number[]])[];


/** (Elmer. Never returns.) */
export async function demoMatrixAction(
  env: ElmerEnv,
  modelState: TState<boolean, Model>,
  modelWriter: (b: boolean, m: Model) => void,
  keys: MatrixItems,
): Promise<void> {
  const top = env.elmerTop;
  const eng = env.elmerEngine;
  const gOut = renderGadget(
    env,
    pure_TState<boolean, null>(null),
    fmap_TState((m: Model) => GadgetData(true, m), modelState), // GadgetData True <$> modelState
    demoMatrix(keys),
  );
  for (const w of gOut.gadgetView) showWebit(WebitClass_WebitItem, env, top, w);
  send(eng, gOut.gadgetDomCode);
  await forever(() =>
    atomically(() => {
      const update = gOut.gadgetEvents();
      switch (update.tag) {
        case "Left":
          return;
        case "Right": {
          const [k, updateF] = update.value;
          console.debug("demoMatrixAction: got an event on row " + showInt(k)); // traceM
          const oldVal = gOut.gadgetOutput.tStateBehaviour();
          const newVal = over(ix<number, DemoData>(k), updateF, view(gdValue<Model>(), oldVal));
          modelWriter(false, newVal);
          return;
        }
      }
    }),
  );
}


/** Generate a model with N items, and a random selection of rows and sub-rows to display. */
export function arbitraryMatrix(n: number): QC.Gen<[Model, MatrixItems]> {
  return (r, size) => {
    const ds = QC.vector(Arbitrary_DemoData, n)(r, size);
    const ns = Array.from({ length: Math.max(0, n) }, (_, k) => k); // [0 .. n-1]
    const mdl = M.fromList(ns.map((k, j): [number, DemoData] => [k, ds[j]]));
    const subs = QC.vectorOf(n, QC.sublistOf(ns))(r, size);
    return [mdl, ns.map((k, j): readonly [number, readonly number[]] => [k, subs[j]])];
  };
}


/** Display a selection of keys taken from the model. */
export function demoMatrix(keys: MatrixItems): Gadget_<any, Either<any, [number, (d: DemoData) => DemoData]>, Model> {
  const mknod = (k: number, ks: readonly number[]): Tree<readonly [number, Lens1<Model, DemoData>]> =>
    Node([k, Lens1(at<number, DemoData>(k).dot(defaultIso(demoDefault)))] as const, ks.map((k1) => mknod(k1, [])));
  // accum . forestTable matrixColumns . const . map (uncurry mknod)
  return accum(forestTable(matrixColumns, () => keys.map(([k, ks]) => mknod(k, ks))));
}


/**
 * Create an "Iso'" betweeen a @Maybe@ value and a plain value by using a
 * default that equates to @Nothing@. Useful for things like
 *
 * > optionalText = defaultIso ""
 *
 * which will equate an empty string with @Nothing@.
 *
 * This is not quite a true Iso because @Just d@ will round-trip to @Nothing@ when
 * @d@ is the default value.
 */
export function defaultIso<A>(d: A): Iso<Maybe<A>, A> {
  const f = (m: Maybe<A>): A => (m.tag === "Nothing" ? d : m.value);
  const b = (v: A): Maybe<A> => (equals(v, d) ? Nothing : Just(v));
  return iso(f, b);
}
