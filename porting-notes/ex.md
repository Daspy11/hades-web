# ex: Model.GI.Export

File: `src/hades/src/Model/GI/Export.ts` (tests: `Export.test.ts` next to it, 3 tests: null PNG
decoding, image file naming, a self-contained HTML report written through a mocked
`@/lib/System/IO`). Every definition of `hades/src/Model/GI/Export.hs` is ported, including the
`where` helpers (`imagePath`, `writeImage`, `binaryResourceFunc`, exported for tests). Demo:
`src/scratch/exDemo.ts` (`?demo=ex`, `&file=1..4` picks the example model): image resources of
two icons, a missing icon and the first two diagrams of the model, the HTML report in an iframe,
and `window.ex.actions` (`Preview`, `Save HTML`, `Save Word`, `Export matrix`). All four were run in
headless Chrome (preview opened as a blob URL with 4 embedded images; `.docx` and `.html`
downloads; the matrix `.xlsx` written through a stubbed `showSaveFilePicker`).

## API (all async; the `HasDiagrams HadesRender v` dictionary first)

* `previewFolder(): Promise<FilePath>` → `"/memory/.dsmPreviews"`.
* `previewReport(cls: HasDiagrams<HadesRender, V>, model, title, blks, imgs): Promise<void>`.
  BasicTypes: `performIO(ctx, () => previewReport(cls, model, title, blks, imgs))` (performIO
  thunks may return a Promise). It opens the report in a new tab (`Gtk.showUriOnWindow` with a
  blob URL), so call it soon after the user's click (the run dialog's OK) to stay inside the
  browser's popup allowance.
* `previewFolderClean(): Promise<void>` (ModelMain calls it at start-up; harmless, never throws
  IO errors).
* `getImageResources(cls, model, refs): Promise<ImageMap>`; `ImageMap` =
  `M.Map<ImageRef, readonly [Uint8Array /* PNG */, Maybe<Uint8Array> /* SVG */]>` (the same type
  as `Model.Report.Docx.ImageFiles`). Uses `getDataIconTheme()`: the application must have called
  `setDataIconTheme` (DSM's main does) or icons resolve to the 1-pixel null PNG / `Nothing`.
* `formatReportHtml(title, path, blks, imageMap): Promise<void>`; ".html" is appended when the
  path has no extension.
* `writeReportToFile(cls, format: ReportFormat, title, model, blks, imgs): Promise<void>`.
  BasicTypes: `performIO(ctx, () => writeReportToFile(cls, view(reportFormat, params), title, model, blks, imgs))`.
* `writeMatrixToFile(book: Xlsx): Promise<void>` (save picker titled "Export matrix as", ".xlsx"
  appended by `checkExtension`). BasicTypes: build the book inside the `performIO` thunk (see mx.md):
  `performIO(ctx, () => writeMatrixToFile(matrixBook(cls, model, matrix, title, cells)))`.
* Also exported: `binaryResourceFunc(cls, model, iconTheme, ref, target: RelTargetType)`,
  `imagePath(ref, files)`, `writeImage(base, files)`, `imageDataUri(name, bytes)`,
  `base64DecodeLenient(s)`.

## Web deviations (`// Web:` in the code)

* **HTML reports are one self-contained file.** The desktop wrote `<name>.html` as a redirect
  stub plus a folder `<name>/` holding `index.html` and the image files. A browser save picker or
  download writes one file, so the report itself is written to the chosen path, and each image the
  desktop wrote into the folder (`imagePath`/`writeImage`: SVG when there is one, else PNG) is
  embedded as a `data:` URI. The HTML is otherwise the same (`mkHtmlDocument`, `report.css`
  inline, nested `<head>` as in the original).
* Previews are in-memory files (`/memory/.dsmPreviews/preview<n>.html`), opened in a new tab via
  an object URL (the desktop used `file://` URIs and an external browser). `previewFolderClean`
  removes previews (and revokes their URLs) older than 8 hours; the folder listing is a
  module-level record because `@/lib/System/IO` cannot list or date memory files.
* Diagram SVGs come straight from `Cairo.withSVGSurface` (no temporary file).
* `getPOSIXTime` is `Date.now() / 1000`.

## Toolkit additions

* `Cairo.surfaceFinish(surface)` (calls `Surface.finish()`, a no-op for the browser surfaces).
* `Gtk.IconTheme`: `IconLookupFlagsNoSvg` and `IconLookupFlagsForceSvg` are now honoured by
  `iconThemeLookupIcon` (NoSvg skips SVG files, ForceSvg prefers them), as in GTK. Other flags are
  still ignored, and calls without these flags behave as before.
* `Gtk.iconInfoGetFilename(info)` now returns the icon file's *virtual path* (e.g.
  `/src/dsm/share/Diametric/48x48/general/general-tick.png`; read it with `dataFileUrl`) instead
  of its URL, so its extension is the file's (production builds may inline small icons as `data:`
  URLs). `IconInfo` gained a `filename` field; `info.url` is unchanged and still used for loading.
  Nothing else in the code base called `iconInfoGetFilename`.

## Known gaps

* `writeReportToFile` with `ReportHtml` cannot produce the desktop's folder layout (see above).
* Not tested with the real `BasicTypes` / `ModelMain` (not ported yet); exercised through the
  demo with `Causality.BowTieTestModel` and `Model.Matrices.testing.RiskModel`.
