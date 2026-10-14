# wel: App.Welcome

File: `src/hades/src/App/Welcome.ts` (tests: `Welcome.test.ts` next to it, 10 tests, driving the real
dialog under jsdom). Every definition of `hades/src/App/Welcome.hs` is ported. Demo:
`src/scratch/welDemo.ts` (`?demo=wel`; `&force=1` forces the screen). The demo calls
`welcomeScreen` at start-up as `App.ModelMain` does and shows the result, read back with
`readFileText`. `window.wel` exposes `results`, `flag()` and `show(force)`.

## API

* `welcomeScreen(parent: Gtk.Widget, force: boolean, docFolder: FilePath, sampleFolder: Maybe<FilePath>): Promise<Maybe<FilePath>>`.
  It is async because it awaits `runDialog`. ModelMain:
  `const initialFilePath = fileToLoad.tag === "Just" ? fileToLoad : await welcomeScreen(window, false, descriptor.programDocs, descriptor.programSamples)`.
* The folders are virtual data directories: DSM `Main` passes `getDataDir("dsm") + "/documentation"`
  and `Just(getDataDir("dsm") + "/examples")` (`baseFolder </> ...` with `joinPath`).
* **The result is a `/builtin/<asset url>` virtual path** (`builtinDataPath(sampleFolder </> name)`).
  `readFileBytes`/`readFileText` from `@/lib/System/IO` can read it, so ModelMain's
  `LB.readFile target` works unchanged. `takeFileName` of it is still the real file name (e.g.
  `"2 FMEA.dsm"`). When the asset URL does not end with the name (it is URL-encoded, or has a hash
  in a production build), the name is appended as a `#/<name>` fragment, which `fetch` ignores.
  Example in dev: `/builtin//src/dsm/share/examples/2%20FMEA.dsm#/2 FMEA.dsm`.
* `WelcomeResult(don_tShow, example)` record `{ _welcomeDon_tShow, _welcomeExample: Maybe<FilePath> }`.
  The lenses `welcomeDon_tShow` and `welcomeExample` are constants. `show_WelcomeResult` is the
  derived Show, with the path shown as Haskell shows a `String` (`\233`, `\&`, `\DEL`, ...; a
  local helper, since `T.showText` is `JSON.stringify`).
* `manualFile = "Manual.pdf"` (the non-Windows choice, because browsers show PDFs). ModelMain's
  `actionDisplayFile "helpManual" $ dataDir </> "documentation" </> manualFile` should use
  `GLib.filenameToUri(path, null)` and `Gtk.showUriOnWindow(null, uri, 0)`, as Welcome does.
* `welcomeFlagFile(): FilePath` is synchronous and returns `"/config/DiametricSoftware/DSM/welcome-seen"`.
  Web: the XDG config directory is the virtual `/config` (`xdgConfigDirectory`), and its files are
  `localStorage` entries with the key `configFileKey(path)` = `"hades:" + path`. The flag is the
  key `"hades:/config/DiametricSoftware/DSM/welcome-seen"`, whose value `""` means "do not show".
* Also exported (internal in Haskell): `welcomeDialog(imageFile, manualUri, examples)` and the web
  helpers `builtinDataPath`, `configFileKey`, `xdgConfigDirectory`.

## Library and toolkit additions

* `src/lib/System/Paths.ts`: `listDataDirectory(dir)` is `listDirectory` for a bundled data folder.
  It returns the names directly inside the folder, unsorted, and throws an `IOError` if the folder
  does not exist. Tested in `Paths.test.ts`.
* New `src/lib/GI/GLib.ts` (+ `GLib.test.ts`): `filenameToUri(filename, hostname)`. A data file
  path or a `/builtin/<url>` path gives its absolute URL. Another absolute path gives a
  `file://[hostname]` URI escaped exactly as `g_filename_to_uri` escapes it (checked against
  libglib 2.80), and a relative path throws GLib's error text
  `The pathname “…” is not an absolute path`. Model.GI.Export and ModelMain also use `GLib.filenameToUri`.
  Export's preview of a `/memory/` file would need an object URL, which the async
  `IO.fileUrl` gives.
* `src/lib/GI/Gtk/index.ts`: `Gtk.showUriOnWindow` is re-exported from `Gio`, because gi-gtk has it in
  `GI.Gtk`.
* `Render.tsx` `ImageView`, file images: an image whose allocation grows along a box (an expanding
  box child) used to be scaled up as an `<img>`, keeping its aspect ratio, so the welcome artwork
  grew to about 520×770 px and overflowed the dialog. Now, as in GTK, the image keeps its natural
  size, centred in a slot that takes the layout.
* `Render.tsx` `LabelView`: a plain label whose text ends in `\n` gets a zero-width space after it.
  Pango gives such text an empty last line (`"\n"` is two lines high), but CSS does not. The
  welcome screen's spacing labels `"\n"` and `"\n\n"` rely on this.
* New `src/lib/GI/Gtk/SvgFonts.ts` (+ test), used by `ImageView` for SVG files: an SVG shown
  through `<img>` cannot use the page's web fonts, so `font-family:Roboto` with no fallback (the
  welcome artwork's title) was drawn in the browser's serif font. librsvg would use the system
  fonts. `svgUrlWithFonts(url)` embeds `@font-face` rules, with inline woff2 data, for the bundled
  families the SVG names (Roboto, Cantarell; weights 400 and 700, Latin subset) and returns a blob
  URL. It is cached per URL. The image shows the original URL until the new one is ready.
* README: notes on `listDataDirectory`, `GLib.filenameToUri`, `showUriOnWindow` and file images.

## Behaviour checked in the browser

The dialog has the title "Welcome to the Diametric Safety Case Manager" and a "Continue" button.
The artwork is 399×587 at natural size, centred on the left. The dark blue "Click here for the User
Manual" button is stretched to the height of its "\n\n" spacer row, as GTK's grid does. Under
"Open a worked example" are the radio buttons "Empty model", "1 Quick Guide to the DSM",
"2 FMEA", "3 Managing Risks" and "4 Managing Hazards". At the bottom is "Don't show this again"
with a tick box.

* Continue returns the chosen example, which can be read back. Ticking the box sets the flag.
  After that, the start-up call returns `Nothing` without a dialog. A forced call shows the box
  ticked, and unticking it removes the flag.
* Escape or the close button returns `Nothing` and leaves the flag as it was.
* The manual button opens `.../documentation/Manual.pdf` in a new tab. It is served as
  `application/pdf`.

## Known gaps

* The artwork's Arial texts use the browser's Arial substitute; librsvg would use fontconfig's.
* No GTK screenshot of the original was available for comparison. The layout follows the GTK
  packing rules: the box children expand, the grid lines do not, and the image is centred in its
  allocation.
