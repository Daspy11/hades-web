# QA1 (diagrams and editing): toolkit fixes

Small additive toolkit changes made while testing the diagram editors in the running app.
Regression tests: `src/lib/GI/Gtk/Qa1Behaviours.test.ts`.

* `Gtk.notebookPopupPageMenu(nb): Menu | null` (Widgets.ts). GTK `enable-popup`: a right click
  in a notebook's tab area pops up a menu of the pages (menu label, else tab label text, else
  "Page N") that switches page. Wired in `NotebookView` (`onContextMenu` on the tab list). The
  Hades books set `notebookEnablePopup := True` (Model/GI/Notebooks).
* `Toolbar.showArrow` (default `true`, as GTK), `Gtk.toolbarSetShowArrow`, `Gtk.toolbarGetShowArrow`;
  Builder `show_arrow` is now honoured. `ToolbarView` (RenderBars.tsx) measures its items and puts
  those that do not fit behind an overflow arrow button (`.gtk-toolbar-arrow`, "More tools") whose
  menu holds GTK-style proxies (tool button → menu item, menu tool button → submenu, drawn
  separator → separator). Before this, the right-hand diagram tools (align, distribute, diagram
  style) were unreachable in a narrow (split) notebook.
* `GridView`: an expanding (vexpand) row is `minmax(auto, 1fr)` instead of `minmax(0, 1fr)`, so it
  keeps its children's minimum height as in GTK. A squeezed grid (e.g. the Hazard properties dialog
  in example 4) collapsed the Description memo row to 0 px and the memo covered the Title row.
* `gtk-entry-select-on-focus`: `widgetGrabFocus` on an Entry selects its text, and a dialog's
  initial focus entry (RenderRoot `onOpenAutoFocus`) has its text selected, so typing replaces a
  default name ("Package 1", "G2.3") as in GTK instead of appending to it.
