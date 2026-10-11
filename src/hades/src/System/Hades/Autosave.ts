// Ported from hades/src/System/Hades/Autosave.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Folders and file names for autosave files.
 *
 * Browser port: there is no file system, so the autosave "folder" is a virtual directory in
 * an IndexedDB database called `hades-autosave` (object store `meta` holds the modification
 * time of each file, `data` its bytes, both keyed by the full virtual path). The folder for an
 * application is `~/.<appName>`, mirroring `getAppUserDataDirectory`, and autosave files are
 * named exactly as in the Haskell version: `<hash>X<n>.asv` where the hash is the version 5
 * UUID of `"file://" ++ path`. The file contents are also the same: the UTF-8 file name,
 * an STX (ctrl-B) byte, and the JSON encoding of the model.
 *
 * Everything that touches storage is `async`. When IndexedDB is unavailable (old browsers,
 * some private browsing modes, or tests under jsdom) an in-memory store is used instead, so
 * autosaves then last only as long as the page.
 *
 * `autosaveProcess` replaces the Haskell save thread and `TQueue` with an asynchronous loop
 * reading from an in-memory queue; the function it returns is synchronous so that it can be
 * called from `reactimate`.
 */
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { readInt } from "@/lib/Prelude";
import { fromMaybe, Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { getCurrentTime, posixSecondsToUTCTime, type UTCTime } from "@/lib/Data/Time";

/** Haskell `FilePath`. */
export type FilePath = string;

/** Haskell `NominalDiffTime`: a time interval in seconds. */
export type NominalDiffTime = number;

/** The Application Name is used to determine the autosave folder. */
export type AppName = string;

/** Metadata for autosave files. */
export interface AutosaveFile {
  /** Filename within "autosaveFolder". */
  readonly autosavePath: FilePath;
  /** Hashcode component of the filename. */
  readonly autosaveHash: string;
  /** Sequence number component of the filename. */
  readonly autosaveSeq: number;
  /** Timestamp of the file. */
  readonly autosaveWhen: UTCTime;
}
export function AutosaveFile(
  autosavePath: FilePath,
  autosaveHash: string,
  autosaveSeq: number,
  autosaveWhen: UTCTime,
): AutosaveFile {
  return { autosavePath, autosaveHash, autosaveSeq, autosaveWhen };
}

/** The extension for autosave files. This is constant ".asv" regardless of the program. */
export const autosaveExtension = ".asv";

// ---------------------------------------------------------------------------------------------
// System.FilePath helpers (POSIX semantics).

function takeFileName(path: FilePath): FilePath {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function takeExtension(path: FilePath): string {
  const f = takeFileName(path);
  const i = f.lastIndexOf(".");
  return i < 0 ? "" : f.slice(i);
}

function dropExtension(path: FilePath): FilePath {
  const ext = takeExtension(path);
  return ext === "" ? path : path.slice(0, path.length - ext.length);
}

/** Haskell `</>`. */
function combine(a: FilePath, b: FilePath): FilePath {
  if (b.startsWith("/") || a === "") return b;
  return a.endsWith("/") ? a + b : a + "/" + b;
}

/** Haskell `<.>`. */
function addExtension(path: FilePath, ext: string): FilePath {
  if (ext === "") return path;
  return ext.startsWith(".") ? path + ext : path + "." + ext;
}

// ---------------------------------------------------------------------------------------------
// Storage: a tiny promise-based key-value store over IndexedDB, with an in-memory fallback.

interface AutosaveStore {
  /** Paths (keys) starting with the prefix, with their modification times. */
  list(prefix: string): Promise<[FilePath, UTCTime][]>;
  /** The contents of the file, or `undefined` if it does not exist. */
  read(path: FilePath): Promise<Uint8Array | undefined>;
  write(path: FilePath, bytes: Uint8Array, when: UTCTime): Promise<void>;
  remove(path: FilePath): Promise<void>;
}

const dbName = "hades-autosave";
const metaStore = "meta";
const dataStore = "data";

function requestP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionP(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(metaStore)) db.createObjectStore(metaStore);
      if (!db.objectStoreNames.contains(dataStore)) db.createObjectStore(dataStore);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB database " + dbName + " is blocked"));
  });
}

function indexedDbStore(db: IDBDatabase): AutosaveStore {
  return {
    async list(prefix) {
      const tx = db.transaction(metaStore, "readonly");
      const range = IDBKeyRange.bound(prefix, prefix + "￿");
      const store = tx.objectStore(metaStore);
      const [keys, values] = await Promise.all([
        requestP(store.getAllKeys(range)),
        requestP(store.getAll(range)),
      ]);
      return keys.map((k, i) => [String(k), Number(values[i])] as [FilePath, UTCTime]);
    },
    async read(path) {
      const tx = db.transaction(dataStore, "readonly");
      const v = await requestP(tx.objectStore(dataStore).get(path));
      if (v === undefined) return undefined;
      return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
    },
    async write(path, bytes, when) {
      const tx = db.transaction([metaStore, dataStore], "readwrite");
      tx.objectStore(dataStore).put(bytes, path);
      tx.objectStore(metaStore).put(when, path);
      await transactionP(tx);
    },
    async remove(path) {
      const tx = db.transaction([metaStore, dataStore], "readwrite");
      tx.objectStore(dataStore).delete(path);
      tx.objectStore(metaStore).delete(path);
      await transactionP(tx);
    },
  };
}

function memoryStore(): AutosaveStore {
  const files = new Map<FilePath, { readonly when: UTCTime; readonly bytes: Uint8Array }>();
  return {
    async list(prefix) {
      const r: [FilePath, UTCTime][] = [];
      for (const [k, v] of files) if (k.startsWith(prefix)) r.push([k, v.when]);
      return r;
    },
    async read(path) {
      return files.get(path)?.bytes;
    },
    async write(path, bytes, when) {
      files.set(path, { when, bytes: bytes.slice() });
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

let storePromise: Promise<AutosaveStore> | null = null;

/** The store holding autosave files, opened (and created) on first use. */
function getStore(): Promise<AutosaveStore> {
  if (storePromise === null) {
    storePromise = (async () => {
      if (typeof indexedDB === "undefined") return memoryStore();
      try {
        return indexedDbStore(await openDatabase());
      } catch {
        return memoryStore();
      }
    })();
  }
  return storePromise;
}

// ---------------------------------------------------------------------------------------------

/** Extract the hash and serial number components from an autosave pathname. */
function splitAutosave(path: FilePath): [string, number] {
  const fn = dropExtension(takeFileName(path));
  const i = fn.indexOf("X");
  const hash = i < 0 ? fn : fn.slice(0, i);
  const serial = i < 0 ? "" : fn.slice(i);
  const n = fromMaybe(0, readInt(serial.slice(1)));
  return [hash, n];
}

/**
 * Folder where autosave files will go. The argument is the application name.
 * The program will also attempt to create the folder if it
 * does not exist.
 *
 * Browser version: the virtual folder `~/.<appName>` in the autosave store. Opening the store
 * creates the database if necessary.
 */
export async function autosaveFolder(appName: AppName): Promise<FilePath> {
  await getStore();
  return combine("~", "." + appName);
}

/** Returns a list of known autosave files in no particular order. */
export async function autosaveFiles(appName: AppName): Promise<AutosaveFile[]> {
  const folder = await autosaveFolder(appName);
  const store = await getStore();
  const prefix = folder + "/";
  // listDirectory: only the entries directly within the folder.
  const entries = (await store.list(prefix)).filter(([p]) => !p.slice(prefix.length).includes("/"));
  const files = entries.filter(([p]) => takeExtension(p) === autosaveExtension);
  return files.map(([path, when]) => {
    const [hash, seqNum] = splitAutosave(takeFileName(path));
    return AutosaveFile(path, hash, seqNum, when);
  });
}

/**
 * Autosave files are named with a hash of their pathname followed by a serial number. This
 * allows autosave versions of the same file to be tracked while avoiding the problem of
 * escaping the pathname. However it does mean that different paths that reach the same file
 * will have different autosave sequences.
 */
export async function autosaveNewPath(appName: AppName, path: FilePath): Promise<FilePath> {
  const folder = await autosaveFolder(appName);
  const uuid = U.generateNamed(U.namespaceURL, U.encodeUtf8("file://" + path));
  const hash = U.toString(uuid);
  const newName = (fldr: FilePath, h: string, n: number): FilePath =>
    combine(fldr, h + "X" + addExtension(String(n), autosaveExtension));
  const existing = (await autosaveFiles(appName)).filter((f) => f.autosaveHash === hash);
  if (existing.length === 0) {
    return newName(folder, hash, 0);
  } else {
    const n = Math.max(...existing.map((f) => f.autosaveSeq)); // Safe because existing /= []
    return newName(folder, hash, n + 1);
  }
}

/** Trim the autosave folder so that only the latest N files are kept for each hash code. */
export async function autosaveExpire(appName: AppName, n: number): Promise<void> {
  // sortOn autosaveHash: a stable sort on the hash.
  const files = (await autosaveFiles(appName))
    .map((f, i) => [f, i] as const)
    .sort(([a, i], [b, j]) => (a.autosaveHash < b.autosaveHash ? -1 : a.autosaveHash > b.autosaveHash ? 1 : i - j))
    .map(([f]) => f);
  // groupBy ((==) `on` autosaveHash)
  const groups: AutosaveFile[][] = [];
  for (const f of files) {
    const g = groups[groups.length - 1];
    if (g !== undefined && g[0].autosaveHash === f.autosaveHash) g.push(f);
    else groups.push([f]);
  }
  // concatMap (drop n . sortOn (Down . autosaveWhen))
  const expired = groups.flatMap((g) =>
    g
      .map((f, i) => [f, i] as const)
      .sort(([a, i], [b, j]) => b.autosaveWhen - a.autosaveWhen || i - j)
      .map(([f]) => f)
      .slice(Math.max(0, n)),
  );
  const store = await getStore();
  for (const f of expired) await store.remove(f.autosavePath);
}

/**
 * The contents of an autosave file are the filename encoded in UTF8 and terminated by an
 * STX (ctrl-B) character, and a lazy bytestring containing the saved data.
 */
export interface AutosaveContents {
  readonly autosaveFor: FilePath;
  readonly autosaveData: Uint8Array;
}
export function AutosaveContents(autosaveFor: FilePath, autosaveData: Uint8Array): AutosaveContents {
  return { autosaveFor, autosaveData };
}

/** If the original filepath can be decoded then return the contents. Otherwise return Nothing. */
export async function autosaveGetContents(path: FilePath): Promise<Maybe<AutosaveContents>> {
  let raw: Uint8Array | undefined;
  try {
    raw = await (await getStore()).read(path);
  } catch {
    return Nothing;
  }
  if (raw === undefined) return Nothing; // File does not exist.
  // Protect from corrupt files which don't have the STX character.
  // 4096 is the Linux MAX_PATH. Windows MAX_PATH is much smaller.
  const limited = raw.subarray(0, 4096);
  const headerEnd = limited.indexOf(2);
  const header = headerEnd < 0 ? limited : limited.subarray(0, headerEnd);
  const stx = raw.indexOf(2);
  const saved = stx < 0 ? new Uint8Array(0) : raw.slice(stx + 1);
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(header);
  } catch {
    return Nothing;
  }
  return Just(AutosaveContents(name, saved));
}

/**
 * Forks off a thread which will autosave values sent using an IO action. The rate of
 * saves is throttled. Values sent before the timeout are discarded. Each value is saved
 * in a separate file. Once the number of files exceeds a given value the old files are deleted.
 *
 * The return value is an IO function which takes the pathname of the file and a value to save.
 * If the pathname is unknown then an empty string may be used.
 *
 * Browser version: the "thread" is an asynchronous loop. If it fails it is restarted after one
 * minute, as in the original.
 */
export function autosaveProcess<A>(
  cls: J.ToJSON<A>,
  appName: AppName,
  /** Minimum interval between autosaves, in seconds. */
  interval: NominalDiffTime,
  /** Maximum number of files to keep. */
  copies: number,
): (path: FilePath, value: A) => void {
  // The TQueue.
  const values: [FilePath, A][] = [];
  let waiting: (() => void) | null = null;
  const writeTQueue = (item: [FilePath, A]): void => {
    values.push(item);
    const w = waiting;
    waiting = null;
    if (w !== null) w();
  };
  const readTQueue = (): Promise<[FilePath, A]> => {
    if (values.length > 0) return Promise.resolve(values.shift()!);
    return new Promise((resolve) => {
      waiting = () => resolve(values.shift()!);
    });
  };
  // A long time ago, in a galaxy far, far away.
  const zeroTime: UTCTime = posixSecondsToUTCTime(-40587 * 86400); // ModifiedJulianDay 0
  const saveThread = async (): Promise<void> => {
    let lastSaveTime = zeroTime;
    for (;;) {
      const [path, value] = await readTQueue();
      const now = getCurrentTime();
      const prevTime = lastSaveTime;
      if ((now - prevTime) / 1000 > interval) {
        lastSaveTime = now;
        const savePath = await autosaveNewPath(appName, path);
        const header = U.encodeUtf8(path);
        // The '2' marks the end of the header (ASCII STX).
        const body = U.encodeUtf8(J.encode(cls.toJSON(value)));
        const bytes = new Uint8Array(header.length + 1 + body.length);
        bytes.set(header, 0);
        bytes[header.length] = 2;
        bytes.set(body, header.length + 1);
        await (await getStore()).write(savePath, bytes, getCurrentTime());
        await autosaveExpire(appName, copies);
      }
    }
  };
  const handleFailure = (): void => {
    // 1 minute. Throttles restart.
    setTimeout(() => forkFinally(), 60 * 1000);
  };
  const forkFinally = (): void => {
    saveThread().then(handleFailure, handleFailure);
  };
  forkFinally();
  return (path, value) => writeTQueue([path, value]);
}
