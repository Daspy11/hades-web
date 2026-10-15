# qa2: data features QA (reports, matrices, queries, lookups, file menu, property dialogs)

Driven in headless Chrome over all four examples. Fixes (all small, see the `// Web:`/doc comments):

* `lib/System/Paths.ts`: `devCssUrl` — under the Vite dev server a data-file `.css` URL gets
  `?direct`, otherwise fetching it returns the HMR JavaScript module (the HTML report embedded
  that module instead of `report.css`). Production URLs unchanged.
* `Model/GI/Export.ts` (`binaryResourceFunc`, SVG target) and `Model/GI/ModelDiagrams.ts`
  (Export Diagram → SVG): the SVG text goes through `svgWithFonts` so the bundled Roboto is
  embedded (`<img>`-loaded SVG cannot use page fonts). `SvgFonts.svgWithFonts` now also
  recognises a quoted font list in a `font-family="'Roboto', ..."` attribute (Cairo SVG surface).
* `lib/GI/Gtk/Widgets.ts`: `layoutNew(h, v)` / `scrolledWindowNew(h, v)` keep the adjustments
  they are given (`Layout.hadj/vadj`, `ScrolledWindow.hadj/vadj` are now assignable);
  `scrollableGetHadjustment(layout)` returns the layout's own. `Render.tsx` LayoutView: a layout
  that is not inside a scrolled window is drawn translated by its adjustment values — the
  ForestTable (matrix on screen) header now scrolls horizontally with the body, as in GTK.
* `lib/GI/Cairo.ts` PDF recorder: images are written (soft-masked image XObjects, previously
  dropped), text is WinAnsi-encoded (non-ASCII was "?") and each run is scaled (`Tz`) to the
  measured width of the drawing font, so Helvetica text no longer overflows boxes.
* `lib/GI/Gtk/RenderTree.tsx`: a mouse press on the blank area of a tree view (below the rows)
  emits "button-press-event", as GTK does — the right-click menu of an empty report/matrix
  structure editor (ForestEditor, `menuFunc Nothing`) was unreachable.
* `lib/GI/Gtk/Choosers.ts`: the in-page save-name dialog uses the chooser's `acceptLabel`
  ("Export" for Export Diagram / Export Data / matrix export) instead of always "Save".

Tests: `lib/GI/Cairo.test.ts`, `lib/GI/Gtk/Qa2Behaviours.test.ts`, additions to
`SvgFonts.test.ts` and `lib/System/Paths.test.ts`.

Faithful Haskell quirks seen (not changed): Excel import with an unrecognised header column
shifts the following columns (`goodHeaderRow` drops unknown names before `zip [s ..]`); a
formula column evaluates with ancestor values winning on screen but the current entity winning
in Excel; Help ▸ Credits opens `documentation/Credits.html`, which the original does not ship.
