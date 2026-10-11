// Ported from banana-ui/webits/src/Network/Webits/Menu.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Popup menus for webits, built from the static menus of "Reactive.Banana.Menu" with the jQuery UI
 * menu widget.
 *
 * TypeScript port: follows the conventions of `Network/Webits` (dictionary, then `env`, then the
 * Haskell arguments). `WebitMenu`'s `WebitClass` instance is `WebitClass_WebitMenu`;
 * `PopupTrigger` is a string enumeration. The `State Int` of `menuHtml` is a `StateCell<number>`.
 */
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import { preview, ix, type StateCell } from "@/lib/Control/Lens";
import { atomically, atomicallySync, dupTChan, newBroadcastTChanIO, readTChan, writeTChan, type TChan } from "@/lib/Control/Concurrent/STM";
import { value, var_ } from "@/lib/Network/JavaScript";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import type { Menu, MenuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  addWebitChannel,
  elmerDaemon,
  elmerSend,
  jsValue,
  makeWebitContainer1,
  showWebit,
  webitEvent,
  webitSelector,
  WebitClass_WebitContainer,
  type ElmerEnv,
  type WebitClass,
  type WebitContainer,
  type WebitId,
} from "@/banana-ui/webits/src/Network/Webits";

/** Webit Menu type. */
export interface WebitMenu<A> {
  readonly webitMenuDisplay: WebitContainer;
  readonly webitMenuOutput: TChan<A>;
}
export function WebitMenu<A>(webitMenuDisplay: WebitContainer, webitMenuOutput: TChan<A>): WebitMenu<A> {
  return { webitMenuDisplay, webitMenuOutput };
}

export const WebitClass_WebitMenu: WebitClass<WebitMenu<any>> = {
  webitHandle: (m) => WebitClass_WebitContainer.webitHandle(m.webitMenuDisplay),
  webitId: (m) => WebitClass_WebitContainer.webitId(m.webitMenuDisplay),
  webitParent: (m) => WebitClass_WebitContainer.webitParent(m.webitMenuDisplay),
  webitChildren: () => [],
  webitFinalise: (env, m) => WebitClass_WebitContainer.webitFinalise(env, m.webitMenuDisplay),
  webitAddFinaliser: (env, m, act) => WebitClass_WebitContainer.webitAddFinaliser(env, m.webitMenuDisplay, act),
};

/**
 * Create a menu on the client browser. Add the @WebitItem@ to whatever point in the DOM is
 * appropriate.
 *
 * The menu is attached to the 'elmerTop' and will remain there until deleted. Webits that
 * dynamically create menus should reattach the menu to themselves using 'showWebit'.
 */
export function mkWebitMenu<A>(env: ElmerEnv, menu: Menu<A>): WebitMenu<A> {
  const result = makeWebitContainer1(env, "ul", [
    ["class", "popup-menu"],
    ["style", "display:none;"],
  ]);
  const [hMenu, tbl] = menuHtml<A>({ state: 0 }, WebitClass_WebitContainer.webitId(result), menu);
  elmerSend(env, var_(WebitClass_WebitContainer.webitHandle(result)) + ".innerHTML=" + value(H.renderHtml(hMenu)));
  const clickChan = addWebitChannel(J.intJ, WebitClass_WebitContainer, env, result);
  const outChan = newBroadcastTChanIO<A>();
  elmerDaemon(WebitClass_WebitContainer, env, result, () =>
    atomically(() => {
      const n = readTChan(clickChan);
      const v = preview(ix<number, A>(n), tbl);
      if (v.tag === "Just") writeTChan(outChan, v.value);
    }),
  );
  const outChan1 = atomicallySync(() => dupTChan(outChan));
  const top = env.elmerTop;
  showWebit(WebitClass_WebitContainer, env, top, result);
  elmerSend(env, "$(" + webitSelector(WebitClass_WebitContainer.webitId(result)) + ").menu()");
  return WebitMenu(result, outChan1);
}

/**
 * Generate the HTML for a menu. The menu items emit ints when clicked, which are keys
 * to the map returned alongside the result.
 */
function menuHtml<A>(st: StateCell<number>, wId: WebitId, menu: Menu<A>): [H.Html, M.Map<number, A>] {
  const xss = menu._0;
  const sepItem = H.li("-");
  const menuItemHtml = (i: MenuItem<A>): [H.Html, M.Map<number, A>] => {
    const mv = i.menuValue;
    if (mv.tag === "Left") {
      const [r, m] = menuHtml(st, wId, mv.value);
      const h = H.mconcat_Html([H.div(H.toMarkup(i.menuLabel)), H.ul(r)]);
      return [H.li(h), m];
    } else {
      const n = st.state;
      st.state = n + 1;
      return [
        H.li(
          H.with_(
            H.div(H.toMarkup(i.menuLabel)),
            HA.onclick(jsValue("{" + webitEvent(J.intJ, wId, n) + ";" + "$('.popup-menu').hide(100);}")),
          ),
        ),
        M.singleton(n, mv.value),
      ];
    }
  };
  // mconcat over (Html, Map) pairs.
  const menuListHtml = (xs: readonly MenuItem<A>[]): [H.Html, M.Map<number, A>] => {
    const ps = xs.map(menuItemHtml);
    return [H.mconcat_Html(ps.map((p) => p[0])), M.unions(ps.map((p) => p[1]))];
  };
  const [rs, ms] = L.unzip(xss.map(menuListHtml));
  return [H.mconcat_Html(L.intersperse(sepItem, rs)), M.unions(ms)];
}

/**
 * Pop up the menu at the given location on the web page. This does not set the Z index
 * of the menu to ensure it is on top of anything else.
 */
export function popupMenuAt<A>(env: ElmerEnv, [x, y]: readonly [number, number], menu: WebitMenu<A>): void {
  elmerSend(
    env,
    "$(" + webitSelector(WebitClass_WebitMenu.webitId(menu)) + ").finish().toggle(100).css({" +
      "top:" + value(y) + " + 'px'," +
      "left:" + value(x) + " + 'px'" +
      "});",
  );
}

/** Browser Event types on which a menu could pop up. */
export type PopupTrigger = "OnLeftClick" | "OnRightClick";
export const popupTriggerValues: readonly PopupTrigger[] = ["OnLeftClick", "OnRightClick"];

/**
 * Attach a popup menu to a Webit. On the specified event the menu will pop up with a Z index
 * just above the event target.
 */
export function popupMenuOn<W, A>(cls: WebitClass<W>, env: ElmerEnv, webit: W, trigger: PopupTrigger, menu: WebitMenu<A>): void {
  const wId = cls.webitId(webit);
  const mId = WebitClass_WebitMenu.webitId(menu);
  const evtName = trigger === "OnLeftClick" ? "click" : "contextmenu";
  elmerSend(
    env,
    "$(" + webitSelector(wId) + ").on(" + value(evtName) + ", function (event) {" +
      "event.preventDefault();" +
      "let z=ancestorZ(event.target);" +
      "console.log('target z index = ' + z);" +
      "$(" + webitSelector(mId) + ").finish().toggle(100).css({" +
      "top: event.pageY + 'px'," +
      "left: event.pageX + 'px'," +
      "zIndex: z+1" +
      "});" +
      "});",
  );
}
