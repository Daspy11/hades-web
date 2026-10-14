# Launch video plan: HADES / DSM on the web

**What it is:** the Diametric Safety Case Manager, a GTK desktop app written in Haskell (HADES:
the Haskell Diagram Editing System), rebuilt module by module as a TypeScript single-page app.
It runs in a browser tab and looks and behaves like the desktop original.

**Who it's for:** safety engineers building safety cases (GSN goal structures, hazard bow ties,
risk matrices), and anyone who wanted to use the open-sourced DSM without building a Haskell
GTK app.

**What sets it apart:** it isn't a rewrite "inspired by" the original. Each of the 41,280 lines
of Haskell has a TypeScript counterpart with the same names and behaviour, and the bundled
example models load and save back byte-for-byte.

**Hook:** a GTK desktop window, Adwaita grey, menus and all, sitting in a browser tab. The
address bar reads `localhost`.

**One-line share caption:** see `share-copy.txt`.

**Tone:** `polished`, with a dry edge. Long holds, soft fades, the real UI doing the work.

**Visual identity:** the app's own Adwaita palette (`#f6f5f4` window background, `#3584e4`
selection blue, `#2e3436` text), Cantarell for UI type, Roboto as the diagram font. The captions
use Cantarell on the window background, so the video feels like the app.

## Storyboard (about 20 s, 1920×1080, 30 fps)

| # | Time | Scene | On screen |
|---|------|-------|-----------|
| 1 | 0.0–2.5 | Hook | A browser frame slides up showing the DSM main window (menu bar, toolbar, package tree). Caption: **"A Haskell desktop app."** then **"In a browser tab."** |
| 2 | 2.5–6.5 | Reveal: open an example | The real app recording: File menu / welcome screen → "1 Quick Guide to the DSM" opens; the package tree fills in; a GSN diagram opens in its notebook tab. Caption: **"The Diametric Safety Case Manager, rebuilt for the web."** |
| 3 | 6.5–10.5 | Highlight 1: real editing | Cursor drags a GSN goal box; double-click opens its properties dialog; text edited; undo. Caption: **"Same diagrams. Same dialogs. Same undo."** |
| 4 | 10.5–14 | Highlight 2: browser-native | Opening a second diagram, then the browser Back button returns to the first. Caption: **"Back and forward move between diagrams."** |
| 5 | 14–17.5 | Highlight 3: the port | Split: a Haskell source file on the left, its TypeScript twin on the right, scrolling in sync; counter **"41,280 lines of Haskell → TypeScript, module by module."** |
| 6 | 17.5–20.5 | Outro | The app window settles; title **"HADES, on the web"**; sub-line with the repository name. |

Durations add up to 20.5 s. Every caption holds for at least 0.3 s per word once fully visible.

## Build approach

* Record the real app with Playwright (headless Chromium, 1920×1080) while a script drives it
  (cursor overlay injected into the page so clicks are visible). No mock-ups: every UI frame is
  the running port.
* Compose scenes in an HTML page where every frame is a pure function of time; app footage
  plays as `<video>` elements seeked frame by frame. Capture PNG frames, encode with ffmpeg.
* Sound: a short synthesised piece (numpy) in one key, soft pad plus a light pulse, with UI
  "click" sounds tuned to the key and mixed under the music.
* Poster: the strongest settled frame, baked in as frame 0.

Steps 2 to 4 depend on the happy path working in the real app; if any step does not work, it is
cut from the video rather than faked.
