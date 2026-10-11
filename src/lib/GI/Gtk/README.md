# Web GTK toolkit (`src/lib/GI/Gtk`)

This directory replaces `gi-gtk` (and, with its siblings `../Gdk.ts`, `../Gio.ts`, `../Cairo.ts`
and `../Pango.ts`, `gi-gdk`, `gi-gio`, `gi-cairo` and `gi-pango`). Haskell modules that build GTK
user interfaces are ported *against this API*, so that the TypeScript reads line for line like
the Haskell.

```ts
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Gio from "@/lib/GI/Gio";
import * as Cairo from "@/lib/GI/Cairo";
import * as Pango from "@/lib/GI/Pango";
```

## Model

* Widgets are **retained objects** (classes such as `Gtk.Box`, `Gtk.TreeView`, `Gtk.Dialog`).
  Ported code creates and mutates them imperatively, exactly as the Haskell does with `gi-gtk`.
* Each widget has a version counter. Mutators call `w.changed()`, and a React view, subscribed
  through `useSyncExternalStore`, re-renders it. Ported code never touches React or the DOM.
* Toplevels are windows, dialogs, popup menus and popovers. They render once `Gtk.main()` has
  mounted `GtkRoot` into `#root`. A toplevel shows when you call `widgetShowAll`,
  `windowPresent` or `dialogRun`.
* Rendering uses Radix primitives where a widget has an accessible equivalent: Menubar and
  DropdownMenu for menus and popup menus, Select for combo boxes, Tabs for notebooks, Dialog and
  AlertDialog for dialogs, Checkbox, RadioGroup, Slider, Toolbar, Tooltip and Popover. The tree
  view, icon view, calendar and paned handle are hand-written.
* Styling is Adwaita light, in `theme.css`. It includes translations of `banana-gtk.css` and
  `hades-gtk.css`. A `cssProviderLoadFromPath` call on those files is accepted and ignored.

## Naming

The names are those of `gi-gtk`, without the module prefix:

| Haskell                                   | TypeScript                                       |
|-------------------------------------------|--------------------------------------------------|
| `Gtk.boxNew Gtk.OrientationVertical 3`    | `Gtk.boxNew(Gtk.OrientationVertical, 3)`         |
| `Gtk.new Gtk.Label [#label := "x"]`       | `Gtk.new_(Gtk.Label, { label: "x" })`            |
| `Gtk.set w [#sensitive := False]`         | `Gtk.set(w, { sensitive: false })`               |
| `Gtk.setWidgetSensitive w False`          | `Gtk.setWidgetSensitive(w, false)`               |
| `Gtk.castTo Gtk.Entry w`                  | `Gtk.castTo(Gtk.Entry, w)` (returns `null` or the widget) |
| `Gtk.toWidget w`                          | `Gtk.toWidget(w)` (identity)                     |
| `Gtk.on w #clicked act`                   | `Gtk.onButtonClicked(w, act)`, or `w.connect("clicked", act)` |
| `Gtk.after w #toggled act`                | `Gtk.afterToggleButtonToggled(w, act)`, or `w.connect("toggled", act, true)` |
| `Gtk.signalHandlerDisconnect w h`         | `Gtk.signalHandlerDisconnect(w, h)`              |

* An argument that `gi-gtk` types as `Maybe a` becomes `a | null`, for example
  `Gtk.menuPopupAtPointer(menu, null)`.
* Enumerations are string constants (`Gtk.OrientationVertical === "OrientationVertical"`).
  `ResponseType` is the exception: it uses the numeric GTK values, because `dialogRun`
  returns an `Int32` that the Haskell converts with `toEnum`. Compare responses directly,
  as in `r === Gtk.ResponseTypeOk`. To convert a Haskell `fromIntegral`, write
  `Number(x)`, or just `x`.
* Event signal handlers (`onWidgetButtonPressEvent`, `onWidgetKeyPressEvent`, `onWidgetDraw`, ...)
  return `boolean`. `true` stops propagation, as in GTK. Event fields are read with the `Gdk`
  accessors: `Gdk.getEventButtonX(ev)`, `Gdk.getEventButtonButton(ev)`,
  `Gdk.getEventButtonType(ev)` (`Gdk.EventType2buttonPress` for double clicks),
  `Gdk.getEventKeyKeyval(ev)`, `Gdk.getEventScrollDeltaY(ev)` and so on.
  `Gdk.modifiersOf(state)` returns the modifier list.

## Blocking calls become Promises

Calls that block in GTK waiting for the user return a `Promise`, so their Haskell `IO` callers
become `async`:

* `Gtk.dialogRun(d): Promise<number>`, which resolves when the dialog emits `response`.
* `Gtk.nativeDialogRun(chooser): Promise<number>` for `FileChooserNative`. Opening uses the File
  System Access API `showOpenFilePicker`, falling back to `<input type=file>`. Saving uses
  `showSaveFilePicker` and falls back to a small in-app "Save as" name dialog, after which the
  file downloads. `fileChooserGetFilename` returns a **virtual path**, described below.
* `Gtk.main()` mounts the UI and returns immediately. `Gtk.mainQuit()` closes all toplevels.
  Code after `Gtk.main` in the Haskell runs straight away. `Gtk.init(null)` does nothing.

Code that runs `dialogRun` inside a reactive-banana `reactimate` must not rely on the result
synchronously. Fire a follow-up event from the `.then` callback instead (see
`Reactive/Banana/GI/Common`).

## Files

Desktop file paths are virtual paths from `src/lib/System/IO.ts`:

* `/handle/<id>/name`: a File System Access handle, readable and writable in place.
* `/upload/<id>/name`: a picked or dropped file, read-only.
* `/download/name`: writing it downloads the file.
* `/builtin/<url>`: a bundled asset, fetched.
* `/memory/name`: an in-memory file, for example an HTML export opened in a new tab.

Use `readFileBytes`, `readFileText`, `writeFileData`, `doesFileExist`, `fileUrl`, `takeFileName`
and `replaceExtension` from `@/lib/System/IO`. Every reader and writer is `async`.

Data files from the original `share` directories are bundled. Use
`System/Hades/DataFiles` and `lib/System/Paths.ts` (`getDataDir`, `dataFileUrl`).
`Gtk.builderNewFromFile` resolves `.glade` files that were registered with
`Gtk.registerBuilderText(path, xml)` (import the file with `?raw`).

## Tree models and cell layouts

* `TreeStore` and `ListStore` take `GValue` columns. Use `Gtk.toGValue(x)` and
  `Gtk.fromGValue(v)`.
* `SeqStore<A>` and `ForestStore<A>` replace `gi-gtk-hs`'s `SeqStore` and `ForestStore`
  (`Data.GI.Gtk.ModelView.*`). The function names are the same: `seqStoreNew`,
  `forestStoreInsert`, `forestStoreGetValue` and so on. Iterators are `TreeIter`, and paths are
  `TreePath` or `number[]` wherever the Haskell uses `[Int32]`.
* `TreeModelSort` wraps any model. Use `treeModelSortConvertIterToChildIter` and related
  functions.
* `Gtk.mvCellLayoutSetAttributes(layout, cell, model, (row) => [ attrs ])` returns attribute
  objects such as `{ text: ... }`, `{ pixbuf: ... }`, `{ iconName: ... }` or `{ active: ... }`.
  It replaces `cellLayoutSetAttributes cell model $ \row -> [#text := ...]`.
  `Gtk.mvCellLayoutSetDataFunction` is similar.
* `cellLayoutPackStart`, `cellLayoutAddAttribute` and the other layout functions work on both
  `TreeViewColumn` and `ComboBox`.
* Editing works as in GTK. Set `editable: true` on a `CellRendererText`, then connect
  `onCellRendererTextEdited(cell, (pathStr, newText) => ...)`. The editable passed to
  `onCellRendererEditingStarted` is a `Gtk.CellEditable`: a `ComboBox` for a `CellRendererCombo`
  (with the renderer's model, a text cell on its `textColumn`, and its own cell layout, so
  renderers and data functions added there are drawn in the popup), an `Entry` otherwise. Tell
  them apart with `Gtk.castTo`.
* Drag and drop uses HTML5 drag events. The GTK names are kept:
  `treeViewEnableModelDragSource` and `...Dest`, `widgetDragDestSet`, `onWidgetDragMotion`,
  `onWidgetDragDrop`, `onWidgetDragDataReceived`, `widgetDragDestFindTarget`,
  `treeViewSetDragDestRow`, `Gtk.dragFinish`, `Gdk.dragStatus` and `Gdk.dragContextListTargets`.
  The selection data is passed as text.

## Drawing

* `DrawingArea` emits `draw` with a `Cairo.Context` (`onWidgetDraw(w, (cr) => { ...; return true; })`).
  The context is already scaled for the device pixel ratio. `widgetQueueDraw` schedules a
  repaint. Inside a scrolled window the canvas only covers the visible part of the widget (the
  context is translated to match, like GTK's clipped exposes), so draw in widget coordinates
  and do not assume the whole widget is painted. Event coordinates are widget coordinates.
  Window accelerators take priority over the drawing area's `key-press-event`, as in GTK.
* A `Cairo.Render<A>` is `(cr: Context) => A`, and `Cairo.renderWithContext(r, cr)` runs it.
* Pango: `Pango.createContext(cr)` (PangoCairo), then `Pango.layoutNew(ctx)`,
  `layoutSetText`, `layoutSetMarkup`, `layoutSetWidth` (in Pango units), `layoutGetExtents`, and
  `Pango.showLayout(cr, layout)`.
* SVG images (`GI.Rsvg`): `import * as SVG from "@/lib/GI/Rsvg"`. `SVG.handleNewFromStreamSync(bytes,
  null, flags, null)` (or `handleNewFromData`) parses the document and its intrinsic dimensions
  synchronously; `handleRenderDocument(h, cr, viewport)` draws it once the browser has decoded
  it (`Gdk.onImagesLoaded` fires then). `GI.new SVG.Rectangle [...]` is `SVG.rectangleNew({...})`.
* Without a 2D canvas (unit tests under jsdom) Pango measures text with the deterministic
  `Pango.fallbackMeasurer`, so layout code can be tested.
* `Gtk.renderBackground(styleContext, cr, x, y, w, h)` paints the widget's CSS background, so
  the `hades-diagram` and `active-diagram` classes work.
* Offscreen surfaces for export are `Cairo.withImageSurface`, `withSVGSurface`,
  `withPSSurface` and `withPdfSurface`. Each returns the encoded file data.

## Windows, actions and menus

* `Gtk.applicationWindowNew()` or `Gtk.windowNew(Gtk.WindowTypeToplevel)` creates a window. The
  first window that is shown fills the browser viewport, and its title becomes `document.title`.
  Other windows are rendered as floating panels.
* Actions use `Gio.simpleActionNew("save", null)`, `Gio.onSimpleActionActivate(a, () => ...)`,
  `Gio.actionMapAddAction(window, a)` and `Gio.setAccelsForAction(window, "win.save", ["<Control>s"])`.
  Menu items and tool buttons take `actionName: "win.save"` through `Gtk.set` or `new_`. Keyboard
  accelerators are handled at the window level, and the browser defaults (Ctrl+S, Ctrl+O, ...)
  are suppressed.
* A browser tab cannot run a "save changes?" dialog when it is closed. A main window's
  `delete-event` handler is therefore paired with `Gtk.windowSetUnloadGuard(window, () => dirty)`.
  On `beforeunload`, if the guard returns `true`, the browser shows its own "leave site?" prompt.
  The application's Quit command still emits `delete-event` (`Gtk.windowClose`), as in GTK.
* To use browser history for in-app navigation, push entries with
  `history.pushState` and listen for `popstate` in the ported module itself. The toolkit does not
  do this automatically.
