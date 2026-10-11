# The Haskell Diagram Editing System (HADES), for the web

This is a browser port of [HADES](https://github.com/PaulJohnson/hades) and the Diametric Safety
Case Manager (DSM) built on it. Every Haskell module has been rebuilt one to one as a TypeScript
module in a Vite single-page application. The original module structure, names, behaviour and
look are kept. Each `X/Y.hs` in the original lives at `src/X/Y.ts` here.

HADES is a library for structured diagrams backed by models. A diagram in HADES is more than a
picture with lines and boxes: it is one view of entities within a wider model of some kind.
Several diagrams can present overlapping views of the same model. If an entity appears in
several diagrams, a change to the entity is reflected in all of them.

The modelling functions also include powerful querying and reporting features.

## History

The HADES library was originally created for the Diametric Safety Case Manager (DSM), a
commercial product. The DSM was not successful, Diametric Software Limited ceased trading in
January 2022, and the software was made open source.

The open source version is not identical to the commercial product:

* The commercial version used a private GTK theme for its look and feel. The open source version
  uses the locally configured theme. This web port uses the GTK3 default theme, Adwaita.

* The commercial version included a number of licensed graphics, particularly an icon library.
  These cannot be included in an open source version.

* The commercial version required a license purchase. The open source version removed all code
  for purchasing and verifying licenses.

* The commercial version included credits for the open source libraries incorporated in the
  product. These are no longer necessary.

## Using the Library

HADES is a platform for building new modelling and diagramming tools. The DSM and its diagrams
are examples. A tutorial on creating new types of diagram would be a useful addition, if anyone
wants to write one.

## Building and Running

You need Node.js 18 or later.

    npm install
    npm run dev        # development server at http://localhost:5173
    npm run build      # type-check and build the static site into dist/
    npm test           # run the unit tests (vitest)

`dist/` is a static site that can be served from any web server. A path prefix is fine, because
asset URLs are relative.

## How the Port Works

[`PORTING.md`](PORTING.md) is the rulebook used for the translation. It covers how Haskell types,
type classes, lenses, monads, arrows and FRP map onto TypeScript. The main substitutions are:

* **GTK3, Cairo and Pango** are replaced by a small web toolkit in `src/lib/GI/`, with the same
  function names as `gi-gtk`. It keeps retained widget objects and renders them with React.
  Where a widget has an accessible equivalent (menus, combo boxes, notebooks, dialogs, sliders,
  check boxes and so on), it uses [Radix](https://www.radix-ui.com/) primitives. Cairo and Pango
  drawing goes to an HTML canvas, or to SVG, PostScript or PDF for exports. See
  [`src/lib/GI/Gtk/README.md`](src/lib/GI/Gtk/README.md).
* **Files** use the browser. *Open* uses the file picker, and you can also drop a `.dsm` file
  onto the window. *Save* writes back to the same file where the browser supports the File
  System Access API, and otherwise downloads it. The bundled example models open directly.
* **Native application behaviour** maps onto browser features. The menus are in-app menus,
  keyboard accelerators work as on the desktop, closing a tab with unsaved changes asks for
  confirmation, and the browser's back and forward buttons move between the diagrams you
  have visited.

## The Reactive Banana Fork

HADES depends on the [reactive-banana](https://hackage.haskell.org/package/reactive-banana)
library, with some extensions. The port includes a small reimplementation of reactive-banana in
[`src/lib/Reactive/Banana.ts`](src/lib/Reactive/Banana.ts) that keeps those extensions:

* `switchE` takes an initial event stream (a bit like `switchB`). In the original fork this
  function was `switchE1`.

* When an event stream is passed to `execute`, any `reactimate` calls in its events run and
  then keep running indefinitely. HADES uses `execute` to refresh user interface elements in
  response to new data. The `reactimate` calls from the old elements therefore stay active
  even though their effects can no longer be seen. Over time they build up, so the
  application slows down and leaks memory (a "space-time leak"). To fix this, the fork added a
  version of `reactimate` that returns a "stop" action:

      reactimate_ :: Event (IO ()) -> MomentIO (IO ())

  The returned `IO` action stops the event action, so any widgets associated with it can be
  garbage collected.

## Licence

As for the original: see [`LICENSE`](LICENSE) and the licence files in each package directory.
The bundled Adwaita icons are under CC-BY-SA 3.0 / LGPL 3 (see
`src/lib/GI/Gtk/icons/Adwaita/COPYING.txt`). The Cantarell and Roboto fonts are bundled from
Fontsource under the SIL Open Font License and the Apache License 2.0 respectively.
