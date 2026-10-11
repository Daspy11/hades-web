// Ported from banana-ui/base/Data/Default/Orphan.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Orphan "Default" instances
 *
 * > instance Default Bool where def = False
 *
 * > instance Default Text where def = ""
 *
 * "Day" instance returns current date through "unsafePerformIO".
 *
 * TypeScript port: `def_Day` is a function so that it returns the date it is called on.
 */
import type { Text } from "@/lib/Data/Text";
import { getCurrentTime, utctDay, type Day } from "@/lib/Data/Time";

/** `instance Default Bool` */
export const def_Bool: boolean = false;

/** `instance Default Text` */
export const def_Text: Text = "";

/** `instance Default Day`: the current (UTC) date, as `utctDay <$> getCurrentTime`. */
export function def_Day(): Day {
  return utctDay(getCurrentTime());
}
