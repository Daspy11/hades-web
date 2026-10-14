/**
 * The `dsm` program: the Diametric Safety Case Manager.
 *
 * Web: `src/main.ts` calls `main()` once the page and its fonts have loaded (the Haskell
 * executable's `main`). The data directory is the bundled virtual directory `/src/dsm/share`
 * (`Paths_dsm.getDataDir` → `getDataDir("dsm")`, see `@/lib/System/Paths`).
 */
// Ported from dsm/Main.hs. Copyright © Paul Johnson. See LICENSE.

import * as Gtk from "@/lib/GI/Gtk";
import { Just } from "@/lib/Data/Maybe";
import { getDataDir } from "@/lib/System/Paths";
import { joinPath } from "@/lib/System/IO";
import { getDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { MainDescriptor, modelMain } from "@/hades/src/App/ModelMain";
import { type SafetyModel, entityIcon, safetyModelClass } from "@/dsm/DSM/SafetyCase";


export function modelDescriptor(): MainDescriptor<SafetyModel> {
  const baseFolder = getDataDir("dsm");
  return MainDescriptor<SafetyModel>(
    /* programName */ "dsm",
    /* programTitle */ "Diametric Safety Case Manager",
    /* programXtn */ "dsm",
    /* programStock */ entityIcon,
    /* programIconDirs */ [baseFolder],
    /* programAfterLoad */ (_ctx) => {},  // return ()
    /* programDocs */ joinPath(baseFolder, "documentation"),
    /* programSamples */ Just(joinPath(baseFolder, "examples")),
  );
}


/**
 * Web: `modelMain` is asynchronous (the welcome screen and the initial file read are awaited);
 * `main` returns its Promise, which resolves once the program's network is running.
 */
export function main(): Promise<void> {
  const dataTheme = getDataIconTheme();
  const dataDir = getDataDir("dsm");
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [dataDir]);
  return modelMain(safetyModelClass, modelDescriptor());
}
