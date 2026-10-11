// Ported from hades/src/System/Hades/DataFiles.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Import and re-export the OS function for finding the users name, depending on the platform.
 *
 * In the browser there is no operating system user. The user name is a per-browser setting
 * kept in `localStorage` under the key `"hades.userName"` (see `setUserName`); when it has not
 * been set the name is `"user"`. `getUserName` stays synchronous because it is used to compute
 * a global constant (the change stamp in `Model.Abstract.PackageTree`).
 */

/** The `localStorage` key holding the user name. */
export const userNameKey = "hades.userName";

/** The user name used when none has been set. */
export const defaultUserName = "user";

/**
 * The name of the user running the program as provided by the operating system.
 *
 * Browser version: the name stored by `setUserName`, or `"user"` if there is none (or storage
 * is unavailable).
 */
export function getUserName(): string {
  try {
    const name = globalThis.localStorage?.getItem(userNameKey);
    if (name !== null && name !== undefined && name !== "") return name;
  } catch {
    // Storage blocked (e.g. privacy settings). Fall through to the default.
  }
  return defaultUserName;
}

/**
 * Set the user name returned by `getUserName`. An empty name removes the setting. Has no effect
 * if storage is unavailable.
 */
export function setUserName(name: string): void {
  try {
    if (name === "") globalThis.localStorage?.removeItem(userNameKey);
    else globalThis.localStorage?.setItem(userNameKey, name);
  } catch {
    // Storage blocked. Nothing we can do.
  }
}
