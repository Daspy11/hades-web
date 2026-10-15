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

// Development entry points: `?demo=<name>` runs `src/scratch/<name>Demo.ts` instead of the app.
// Scratch demos are development aids and are left out of production builds.
const scratchDemos: Record<string, () => Promise<{ main(): void }>> = import.meta.env.DEV
  ? import.meta.glob<{ main(): void }>("./scratch/*Demo.ts")
  : {};
const params = new URLSearchParams(location.search);
const demo = params.get("demo") ?? (params.get("toolkit-demo") !== null ? "toolkit" : null);
// The demo programs of the original repository: `?demo-arrow` and `?demo-webit`.
const packageDemos = import.meta.glob<{ main(): void }>("./banana-ui/*/demo-*/Main.ts");
const packageDemo = ["demo-arrow", "demo-webit"].find((d) => params.has(d));
const loader =
  (demo !== null && scratchDemos[`./scratch/${demo}Demo.ts`]) ||
  (packageDemo !== undefined && Object.entries(packageDemos).find(([k]) => k.includes(`/${packageDemo}/`))?.[1]);
loadFonts()
  .then(() => (loader ? loader() : import("./dsm/Main")))
  .then((m) => m.main())
  .catch((err) => {
    console.error(err);
    document.body.textContent = "Failed to start: " + String(err);
  });
