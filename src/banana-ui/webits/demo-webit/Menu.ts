// Ported from banana-ui/webits/demo-webit/Menu.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The right-click popup menu of the @demo-webit@ front page.
 *
 * TypeScript port: an @Elmer@ action takes the `ElmerEnv` as its first argument
 * (porting-notes/w1.md); `putStrLn` writes to the browser console.
 */
import * as J from "@/lib/Data/Aeson";
import { atomically, readTChan } from "@/lib/Control/Concurrent/STM";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  elmerDaemon,
  jsNoOp,
  makeWebit,
  WebitClass_Webit,
  WebitItem,
  type ElmerEnv,
} from "@/banana-ui/webits/src/Network/Webits";
import { mkWebitMenu, popupMenuOn, WebitClass_WebitMenu } from "@/banana-ui/webits/src/Network/Webits/Menu";
import { showInt } from "@/lib/Prelude";

export const demoMenu: Menu<number> = Menu([
  [
    menuItem("Ten", 10),
    subMenu(
      "Tens",
      Menu([[
        menuItem("Eleven", 11),
        menuItem("Twelve", 12),
        menuItem("Thirteen", 13),
        menuItem("Fourteen", 14),
      ]]),
    ),
    menuItem("Twenty", 20),
  ],
  [
    menuItem("Thirty", 30),
    menuItem("Fourty", 40),
  ],
]);


/** (Elmer.) */
export function demoMenuButton(env: ElmerEnv): WebitItem {
  const buttonContents = (_wId: string): H.Html => H.with_(H.button("Right-click Menu"), HA.type_("button"));
  const menu = mkWebitMenu(env, demoMenu);
  elmerDaemon(WebitClass_WebitMenu, env, menu, async () => {
    const v = await atomically(() => readTChan(menu.webitMenuOutput));
    console.log("Menu option " + showInt(v) + " clicked."); // putStrLn
  });
  const btn = makeWebit<string>(J.textJ, env, buttonContents, () => jsNoOp, "Menu");
  popupMenuOn(WebitClass_Webit, env, btn, "OnRightClick", menu);
  return WebitItem(WebitClass_Webit, btn);
}
