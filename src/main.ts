/**
 * Application entry point. In the Haskell original the `dsm` executable's `Main.main` starts
 * the program; here `src/dsm/Main.ts` exports `main`, which is run once the page has loaded.
 *
 * The desktop application uses the system fonts (Cantarell for the GTK user interface, Roboto
 * for diagrams). They are bundled here and loaded before start-up, because diagram layout
 * measures text and would otherwise be computed with a fallback font.
 */
import "@fontsource/cantarell/400.css";
import "@fontsource/cantarell/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/400-italic.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/700-italic.css";

async function loadFonts(): Promise<void> {
  const faces = ["400 12px Cantarell", "700 12px Cantarell", "400 12px Roboto", "italic 400 12px Roboto", "700 12px Roboto", "italic 700 12px Roboto"];
  try {
    await Promise.all(faces.map((f) => document.fonts.load(f)));
  } catch {
    // Carry on with fallback fonts.
  }
}

const demo = new URLSearchParams(location.search).get("toolkit-demo") !== null;
loadFonts()
  .then(() => (demo ? import("./scratch/toolkitDemo") : import("./dsm/Main")))
  .then((m) => m.main())
  .catch((err) => {
    console.error(err);
    document.body.textContent = "Failed to start: " + String(err);
  });
