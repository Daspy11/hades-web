# da: banana-ui GTK demo program `demo-arrow`

Files: `src/banana-ui/gtk/demo-arrow/Main.ts` and `Demo/{Cond,Dialog,Notebook,Table}.ts`, tests next to
them (`Main.test.ts`, `Demo/{Cond,Dialog,Table}.test.ts`; Notebook is tested in `Cond.test.ts`).
Every definition of the Haskell files is ported (where-bound helpers stay local; the
commented-out tree/tree-table parts of `Main.hs` are kept as comments). Run it with
`http://localhost:5173/?demo-arrow` (`src/main.ts` calls `main()`) or `?demo=da`
(`src/scratch/daDemo.ts` re-exports `main`).

## API / representation

* `E` and `W` of every gadget are `()` → `null`: `Gadget_<null, null, A>`, `Dialog<null, null, I, O>`.
  `Integer`/`Int` are `number` (`readInteger`/`readInt`, `showInt`).
* Table: `DemoEnum` string enum + `demoEnumValues`, `show_/read_/compare_DemoEnum`; `enumColour`,
  `enumIcon`; `TableData(...)` record with the Haskell field names, `show_TableData`; constant
  lenses `tableText` … `tableCombo`; `blankTableRow`, `comboOptions`, `demoTableSpec`, `testTable`.
* Dialog: `MRange<A> = readonly [Maybe<A>, Maybe<A>]`; `DemoData(...)` record, `show_DemoData`
  (derived `Show`, used by the `print`s); `def_DemoData()` is a function (today's date), memoised
  like the Haskell `unsafePerformIO` CAF; constant lenses `demoRange` … `demoComment`;
  `validRange(r)` (structural `Ord`); `mRangeGadget(show, read)` (`Show`/`Read` explicit, `Num` =
  JS arithmetic); `demoDialog`, `initialValue`, `testValues`.
* Cond: `Side` string enum (`sideValues`, `show_Side`); `makeSelection(defA, defB, side, x)` — the
  `Default` dictionaries are the default values, first (as `multiMod` in Model.Reflection.Dialogs);
  `itemDialogs`, `sideMenu`, `condDialog` (the `proc` block desugared with `gFanout`/`gPipe`, kept as a comment).
* Notebook: `itemDialog`, `notebookDialog`. Main: `main()`, `loopDialog1` (`buttonBar btns <<< typedTextBox`
  as `gDot`).
* Web: `getArgs` is `[]`; `putStrLn`/`print` write to the browser console (`print` shows the
  Haskell `show`, e.g. `(1,Left (-42))`, `(1,DemoData {...})`).

## Faithfully kept behaviour of the original

* "Range size:" in `mRangeGadget` is `focusing id $ readOnlyText …` inside a `form`, so (see g2
  notes, `mergeOutputs`) its unchanged value is merged into every edit: **the range bounds of the
  Demo Dialog cannot be changed** — typed bounds are discarded and OK returns the old range, as in
  the GTK program. Tested.
* Loop dialog: typing invalid text leaves the value unchanged and OK stays sensitive.

## Toolkit changes

* `src/lib/Data/Colour.ts`: named colours `coral`, `indigo`, `mediumspringgreen`, `salmon`.
* `src/lib/GI/Gtk/Render.tsx` `childLayout`: an expanding child of a **vertical** box only gets
  `min-height: 0` if its subtree holds a widget GTK can shrink (`ScrolledWindow`, `DrawingArea`,
  `Layout`; helper `mayShrinkVertically`), and a `ScrolledWindow` child itself gets no inline
  `min-height` (as a scroll container its automatic minimum is already 0, and CSS such as
  `.memo-medium { min-height: 4em }` now applies). Before, frames and forms in a dialog taller than
  the viewport were squashed below their content and overlapped (Demo Dialog: frames over the
  table); GTK never allocates less than a child's minimum, so the scrolled table shrinks instead.
  Horizontal boxes are unchanged (`min-width: 0`).
* `src/lib/GI/Gtk/TreeModel.ts`: `TreeModel.listOnly()` (`GTK_TREE_MODEL_LIST_ONLY`), true for
  `ListStore` and `SeqStore` (gi-gtk-hs reports `TreeModelFlagsListOnly`), delegated by
  `TreeModelSort`. `RenderTree.tsx` draws no expander (and reserves no 16 px indent) in the first
  column of a list-only model, as GTK — table gadgets' first column is no longer indented.
* Review: `src/lib/GI/Gtk/Render.tsx` `keepBoxMinimums(root)` (exported), attached by `RenderRoot.tsx`
  (`useBoxMinimums`) to the content element of every dialog and non-main window. The
  `mayShrinkVertically` rule above still let a box child that holds a scrolled window with a CSS
  minimum (`.hades-table { min-height: 200px }`) be squeezed below its content, so at viewport
  heights below ~800 px the Demo Dialog's memo overlapped the table and its buttons. After each
  layout (ResizeObserver + animation frame) every vertical-box child with an inline
  `min-height: 0` whose content overflows it gets its content height as `min-height`, innermost
  first; the dialog content then scrolls, as a GTK window taller than the screen. The minimums are
  recomputed on resize and released when there is room (tested in `BoxMinimums.test.ts`; no-op
  without `ResizeObserver`, e.g. jsdom).

## Known gaps

* The GTK main window would carry the program name ("demo-arrow") as its WM title; the floating
  toolkit window shows an empty title bar (no title is set in the Haskell).
