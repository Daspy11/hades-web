// Ported from hades/src/System/Hades/EditLock.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Lock files for editing.
 *
 * Editing is a long transaction, so there are no blocking or \"with\" functions
 *
 * This works by creating a temporary lock file and getting an exclusive lock on that file. The
 * lock file contains the name of the user with the lock so that attempting to get the lock on
 * a file locked by someone else lets the application give a useful message to the user.
 *
 * There is a very narrow race condition when a lock is released: it is possible for another
 * process to see that the file already exists but then attempt to get the exclusive lock after
 * it has been deleted, leading to a "File not found" error.
 *
 * Browser port. Other "processes" are other tabs or windows of the application in the same
 * browser (same origin). The lock file `$foo.dsm$` becomes a named lock:
 *
 *  - When the Web Locks API (`navigator.locks`) is available the lock is an exclusive Web Lock
 *    named `hades-edit-lock:<lock file name>`, requested with `ifAvailable` so that the attempt
 *    fails immediately if another tab holds it. The browser releases it if the tab closes or
 *    crashes.
 *  - Otherwise a record in `localStorage` under the same name plays the part of the lock file.
 *    It holds the user name, a token and a heartbeat time that the holder refreshes every few
 *    seconds. A record whose heartbeat is stale is checked over a `BroadcastChannel` (holders
 *    answer pings for the locks they hold); if nobody answers it is considered abandoned and is
 *    taken over. Without storage the lock only protects against the same file being opened
 *    twice within one tab.
 *
 * The Haskell code requests the file lock in `Shared` mode, contrary to the documentation above
 * (a shared lock never excludes another shared lock, so it detected nothing). The port
 * implements the documented exclusive behaviour.
 *
 * `tryEditLock` and `dropEditLock` are asynchronous; `await dropEditLock` before trying to lock
 * the same file again.
 */
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { getUserName } from "./DataFiles";

type Text = T.Text;

/** Haskell `FilePath`. */
export type FilePath = string;

/** Haskell `IOException`: the error raised by a failed operation. */
export type IOException = Error;

/**
 * Replacement for `System.FileLock.FileLock`: a lock held by this tab, released by `unlockFile`.
 */
export interface FileLock {
  /** The name of the lock (the lock file name). */
  readonly lockName: string;
  /** Release the lock. Resolves once the lock is available to other tabs. */
  readonly unlockFile: () => Promise<void>;
  /** Delete the lock file (the `localStorage` record), if there is one. */
  readonly removeFile: () => void;
}

export interface EditLock {
  readonly _0: FilePath;
  readonly _1: FileLock;
}
export function EditLock(_0: FilePath, _1: FileLock): EditLock {
  return { _0, _1 };
}

export type EditLockResult =
  | { readonly tag: "EditLockSuccessful"; readonly _0: EditLock }
  /** Message explaining why the lock acquisition failed. */
  | { readonly tag: "EditLockFailed"; readonly _0: Text }
  | { readonly tag: "EditLockError"; readonly _0: IOException };
export function EditLockSuccessful(_0: EditLock): EditLockResult {
  return { tag: "EditLockSuccessful", _0 };
}
/** Message explaining why the lock acquisition failed. */
export function EditLockFailed(_0: Text): EditLockResult {
  return { tag: "EditLockFailed", _0 };
}
export function EditLockError(_0: IOException): EditLockResult {
  return { tag: "EditLockError", _0 };
}

function toIOException(e: unknown): IOException {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * To gain an edit lock on a file \"foo.txt\" this will:
 *
 * 1. Check that \"foo.txt\" is writable.
 *
 * 2. Create a lockfile \"$foo.txt$\" if it does not already exist.
 *
 * 3. Get an exclusive lock on that file. If no lock is available then the attempt fails.
 *
 * 4. Write the user name in it.
 *
 * If the lock is obtained then it returns an "EditLock" value. If the lock is not obtained then
 * it returns the name of the user holding the lock. If it cannot create the lock file (e.g. because
 * the directory is read-only) then it returns an "IOException".
 *
 * Browser version: a browser cannot inspect file permissions, so the file is taken to be
 * writable unless the optional `isWritable` check (e.g. a File System Access permission query
 * made by the caller) says otherwise.
 */
export async function tryEditLock(
  p: FilePath,
  isWritable: (p: FilePath) => boolean | Promise<boolean> = () => true,
): Promise<EditLockResult> {
  try {
    const writable = await isWritable(p);
    if (writable) {
      const p1 = lockFileName(p);
      const l = await tryLockFile(p1);
      switch (l.tag) {
        case "Nothing": // File is already locked.
          return EditLockFailed(T.pack(p) + " is currently being edited.");
        case "Just":
          return EditLockSuccessful(EditLock(p1, l.value));
      }
    } else {
      return EditLockFailed(T.pack(p) + " is not writeable by you");
    }
  } catch (e) {
    return EditLockError(toIOException(e));
  }
}

/** Drop the lock on the file and delete the lockfile. */
export async function dropEditLock(l: EditLock): Promise<void> {
  // Ignore any errors here; probably the file doesn't exist, or permissions have changed
  // or something. The worst that can happen is that a stale lock file is left hanging around.
  try {
    await l._1.unlockFile();
    l._1.removeFile();
  } catch {
    // Ignored.
  }
}

/** The name of the lock file. */
function lockFileName(p: FilePath): FilePath {
  const [d, f] = splitFileName(p);
  return combine(d, "$" + f + "$");
}

/** `System.FilePath.splitFileName` (POSIX). */
function splitFileName(p: FilePath): [FilePath, FilePath] {
  const i = p.lastIndexOf("/");
  return i < 0 ? ["./", p] : [p.slice(0, i + 1), p.slice(i + 1)];
}

/** `System.FilePath.</>` (POSIX). */
function combine(a: FilePath, b: FilePath): FilePath {
  if (b.startsWith("/") || a === "") return b;
  return a.endsWith("/") ? a + b : a + "/" + b;
}

// ---------------------------------------------------------------------------------------------
// Lock implementations.

const lockPrefix = "hades-edit-lock:";

/** `tryLockFile path Exclusive`: get the lock if nobody else holds it. */
function tryLockFile(name: string): Promise<Maybe<FileLock>> {
  const locks: LockManager | undefined = (globalThis as any).navigator?.locks;
  if (locks !== undefined && typeof locks.request === "function") return tryWebLock(locks, name);
  return tryStorageLock(name);
}

/** Exclusive Web Lock, held until `unlockFile` is called. */
function tryWebLock(locks: LockManager, name: string): Promise<Maybe<FileLock>> {
  return new Promise((resolve, reject) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let done: Promise<unknown> | null = null;
    done = locks.request(lockPrefix + name, { mode: "exclusive", ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(Nothing);
        return undefined;
      }
      resolve(
        Just({
          lockName: name,
          unlockFile: async () => {
            release();
            await done;
          },
          removeFile: () => {},
        }),
      );
      return held;
    });
    done.catch(reject);
  });
}

/** How often a holder refreshes the heartbeat of a `localStorage` lock record. */
const heartbeatMs = 5000;
/** A record whose heartbeat is older than this may have been abandoned. */
const staleMs = 4 * heartbeatMs;
/** How long to wait for a holder to answer a ping. */
const pingTimeoutMs = 300;

/** The contents of a `localStorage` lock record (the lock file). */
interface LockRecord {
  readonly token: string;
  readonly user: string;
  readonly heartbeat: number;
}

/** Locks held by this tab with the fallback implementation, by name, with their tokens. */
const heldHere = new Map<string, string>();

let channel: BroadcastChannel | null | undefined;

/** The channel used to ask other tabs whether they still hold a lock. */
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(lockPrefix + "channel");
      ch.onmessage = (ev: MessageEvent) => {
        const m = ev.data;
        if (m && m.type === "ping" && heldHere.get(m.name) === m.token) {
          ch.postMessage({ type: "pong", name: m.name, token: m.token });
        }
      };
      channel = ch;
    }
  } catch {
    channel = null;
  }
  return channel;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRecord(storage: Storage, key: string): LockRecord | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const r = JSON.parse(raw);
    return typeof r?.token === "string" && typeof r?.heartbeat === "number" ? (r as LockRecord) : null;
  } catch {
    return null;
  }
}

/** Ask the other tabs whether the holder of the record is still alive. */
function pingHolder(name: string, token: string): Promise<boolean> {
  const ch = getChannel();
  if (ch === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const listener = (ev: MessageEvent) => {
      const m = ev.data;
      if (m && m.type === "pong" && m.name === name && m.token === token) finish(true);
    };
    const timer = setTimeout(() => finish(false), pingTimeoutMs);
    const finish = (alive: boolean) => {
      clearTimeout(timer);
      ch.removeEventListener("message", listener);
      resolve(alive);
    };
    ch.addEventListener("message", listener);
    ch.postMessage({ type: "ping", name, token });
  });
}

/** The `localStorage` (and `BroadcastChannel`) fallback for when there are no Web Locks. */
async function tryStorageLock(name: string): Promise<Maybe<FileLock>> {
  if (heldHere.has(name)) return Nothing;
  const storage = getStorage();
  const key = lockPrefix + name;
  getChannel(); // Start answering pings.
  if (storage !== null) {
    const existing = readRecord(storage, key);
    if (existing !== null) {
      const fresh = Date.now() - existing.heartbeat < staleMs;
      if (fresh || (await pingHolder(name, existing.token))) return Nothing;
    }
  }
  if (heldHere.has(name)) return Nothing; // Locked by this tab while we waited for a ping.
  const token = U.nextRandom();
  const user = getUserName();
  const writeRecord = () => {
    storage?.setItem(key, JSON.stringify({ token, user, heartbeat: Date.now() } satisfies LockRecord));
  };
  if (storage !== null) {
    writeRecord(); // May throw (e.g. storage full): reported as an EditLockError.
    // Another tab may have written its record at the same moment. Last writer wins.
    if (readRecord(storage, key)?.token !== token) return Nothing;
  }
  heldHere.set(name, token);
  const timer = storage !== null ? setInterval(() => {
    try {
      // Refresh our record, or restore it if it vanished (e.g. removed on "pagehide" before
      // the page was restored from the back-forward cache).
      const r = readRecord(storage, key);
      if (r === null || r.token === token) writeRecord();
    } catch {
      // Ignore: the next heartbeat may succeed.
    }
  }, heartbeatMs) : null;
  const removeFile = () => {
    if (storage !== null && readRecord(storage, key)?.token === token) storage.removeItem(key);
  };
  const onPageHide = () => removeFile();
  globalThis.addEventListener?.("pagehide", onPageHide);
  return Just({
    lockName: name,
    unlockFile: async () => {
      if (timer !== null) clearInterval(timer);
      globalThis.removeEventListener?.("pagehide", onPageHide);
      if (heldHere.get(name) === token) heldHere.delete(name);
    },
    removeFile,
  });
}
