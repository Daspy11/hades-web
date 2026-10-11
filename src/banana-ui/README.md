# Reactive Widgets with an Arrow API

Apart from the top level application window, the DSM user interface is built on this library.
In the web port it uses the web GTK toolkit in `src/lib/GI/Gtk` in place of GTK3.

The folders here are:

base
: The `banana-ui-base` library. It is the abstract definition of the user interface "gadgets",
   and does not depend on GTK. (The term "widget" is reserved for GTK entities.) Application
   developers import `Reactive/Banana/ArrowDialog`, which defines composable UIs as
   [arrows](https://en.wikibooks.org/wiki/Haskell/Understanding_arrows). In TypeScript the arrow
   combinators are functions (`gPipe`, `gProd`, `gFanout`, ...); see `PORTING.md` §9.

gtk
: The GTK implementation of the features of the `banana-ui-base` library, ported to the web
   toolkit. `gtk/demo-arrow` is a demo and test harness for the features of
   `Reactive/Banana/ArrowDialog`. Open it with `?demo-arrow` in the app URL.

webits
: A web-based implementation of `Reactive/Banana/ArrowDialog`. The original pushed JavaScript
   from a Haskell server to the browser over web sockets. In the port, the "server" side runs in
   the same page and talks to the client code through an in-page channel. `webits/demo-webit`
   is its demo. Open it with `?demo-webit`.

(The original README also listed `demo-dialog`, the demo of the older `Reactive.Banana.Dialog`
module. That folder is not in the open source repository.)
