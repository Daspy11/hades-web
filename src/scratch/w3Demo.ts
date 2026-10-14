/**
 * Scratch demo for the port of the `demo-webit` program (`src/banana-ui/webits/demo-webit`):
 * open with `?demo=w3`. It runs the program's `main` exactly as `?demo-webit` does, with a few
 * test conveniences:
 *
 *  * `&seed=<n>`: QuickCheck's `generate` uses fixed seeds, so the random matrix model and the
 *    random forest of the forest editor are the same on every load;
 *  * `&open=dialog|matrix|menu|forest|image`: clicks (or, for `menu`, right-clicks) the
 *    corresponding front page button once the page is up;
 *  * `&icons=diametric`: also registers the DSM Diametric icon theme, from which the random
 *    icon names of the matrix model are taken (the original served only the Adwaita icons, so
 *    those images are broken in the program itself);
 *  * `&log=1`: shows the program's console output (`putStrLn`, `elmerLog`, `traceM`, without the
 *    JavaScript bridge's `eval`/`event` echo) in a panel at the right of the page.
 *
 * `window.w3.log` holds the captured console lines.
 */
import { setQCGenSeed } from "@/lib/Test/QuickCheck";
import { getDataDir } from "@/lib/System/Paths";
import { elmerStatic } from "@/banana-ui/webits/src/Network/Webits";
import { getIconData, mergeIconGroups } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { main as demoWebitMain } from "@/banana-ui/webits/demo-webit/Main";

const buttonLabels: Record<string, string> = {
  dialog: "Dialog Demo",
  matrix: "Matrix Demo",
  menu: "Right-click Menu",
  forest: "Forest Editor Demo",
  image: "Clickable Image Demo",
};

/** Capture console output (and optionally show it in a panel). */
function captureConsole(show: boolean): string[] {
  const lines: string[] = [];
  let panel: HTMLPreElement | null = null;
  if (show) {
    panel = document.createElement("pre");
    panel.id = "w3-log";
    panel.style.cssText =
      "position:fixed;top:0;right:0;bottom:0;width:290px;overflow:auto;margin:0;padding:4px 8px;" +
      "font:10px/1.3 monospace;background:#fffbe6;border-left:1px solid #c9b458;z-index:100000;white-space:pre-wrap";
    document.body.appendChild(panel);
  }
  for (const level of ["log", "info", "debug", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
      if (text.startsWith("eval ") || text.startsWith("event ") || text.startsWith("[vite]")) return;
      lines.push("[" + level + "] " + text);
      if (panel !== null) {
        panel.textContent = lines.slice(-40).join("\n");
        panel.scrollTop = panel.scrollHeight;
      }
    };
  }
  return lines;
}

/** Click a front page button as soon as it exists. */
function clickWhenReady(label: string, right: boolean): void {
  const tryClick = (n: number): void => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === label);
    if (btn === undefined) {
      if (n > 0) setTimeout(() => tryClick(n - 1), 100);
      return;
    }
    if (right) btn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 70, button: 2 }));
    else btn.click();
  };
  tryClick(100);
}

export async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = params.get("seed");
  if (seed !== null) setQCGenSeed(Number(seed));
  const log = captureConsole(params.get("log") !== null);
  (window as unknown as { w3: { log: string[] } }).w3 = { log };
  if (params.get("icons") === "diametric") {
    elmerStatic(
      mergeIconGroups([
        ...getIconData(getDataDir("dsm") + "/Diametric/scalable"),
        ...getIconData(getDataDir("dsm") + "/Diametric/48x48"),
      ]),
    );
  }
  const open = params.get("open");
  if (open !== null && buttonLabels[open] !== undefined) clickWhenReady(buttonLabels[open], open === "menu");
  await demoWebitMain();
}
