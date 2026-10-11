import { afterEach, describe, expect, test, vi } from "vitest";
import { dropEditLock, tryEditLock, type EditLock, type EditLockResult } from "./EditLock";

function lockOf(r: EditLockResult): EditLock {
  if (r.tag !== "EditLockSuccessful") throw new Error("expected a lock, got " + r.tag);
  return r._0;
}

/** A minimal in-process `LockManager` with the semantics of the Web Locks API used here. */
function fakeLockManager() {
  const held = new Set<string>();
  return {
    held,
    request(name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => unknown): Promise<unknown> {
      if (held.has(name)) {
        if (!opts.ifAvailable) throw new Error("not supported by the fake");
        return Promise.resolve().then(() => cb(null));
      }
      held.add(name);
      return Promise.resolve()
        .then(() => cb({ name, mode: "exclusive" }))
        .finally(() => held.delete(name));
    },
  };
}

describe("EditLock (localStorage fallback)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("lock, conflict and release", async () => {
    const r1 = await tryEditLock("/models/foo.dsm");
    const l1 = lockOf(r1);
    expect(l1._0).toBe("/models/$foo.dsm$");
    const stored = JSON.parse(localStorage.getItem("hades-edit-lock:/models/$foo.dsm$")!);
    expect(stored.user).toBe("user");
    const r2 = await tryEditLock("/models/foo.dsm");
    expect(r2).toEqual({ tag: "EditLockFailed", _0: "/models/foo.dsm is currently being edited." });
    // A different file is independent.
    const l3 = lockOf(await tryEditLock("/models/bar.dsm"));
    await dropEditLock(l1);
    expect(localStorage.getItem("hades-edit-lock:/models/$foo.dsm$")).toBeNull();
    const l4 = lockOf(await tryEditLock("/models/foo.dsm"));
    await dropEditLock(l4);
    await dropEditLock(l3);
    // Dropping twice is harmless.
    await dropEditLock(l3);
  });

  test("lock file name for a relative path", async () => {
    const l = lockOf(await tryEditLock("foo.dsm"));
    expect(l._0).toBe("./$foo.dsm$");
    await dropEditLock(l);
  });

  test("read-only files and errors", async () => {
    expect(await tryEditLock("/ro.dsm", () => false)).toEqual({
      tag: "EditLockFailed",
      _0: "/ro.dsm is not writeable by you",
    });
    const r = await tryEditLock("/err.dsm", async () => {
      throw new Error("permission query failed");
    });
    expect(r.tag).toBe("EditLockError");
    expect(r.tag === "EditLockError" && r._0.message).toBe("permission query failed");
  });

  test("a lock held by another tab, fresh or abandoned", async () => {
    const key = "hades-edit-lock:/x/$other.dsm$";
    localStorage.setItem(key, JSON.stringify({ token: "t1", user: "fred", heartbeat: Date.now() }));
    expect((await tryEditLock("/x/other.dsm")).tag).toBe("EditLockFailed");
    // A stale record whose holder does not answer a ping is taken over.
    localStorage.setItem(key, JSON.stringify({ token: "t1", user: "fred", heartbeat: Date.now() - 60000 }));
    const l = lockOf(await tryEditLock("/x/other.dsm"));
    expect(JSON.parse(localStorage.getItem(key)!).token).not.toBe("t1");
    await dropEditLock(l);
  });
});

describe("EditLock (Web Locks)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses navigator.locks when available", async () => {
    const locks = fakeLockManager();
    vi.stubGlobal("navigator", { locks });
    const l1 = lockOf(await tryEditLock("/m/a.dsm"));
    expect(l1._0).toBe("/m/$a.dsm$");
    expect([...locks.held]).toEqual(["hades-edit-lock:/m/$a.dsm$"]);
    expect(await tryEditLock("/m/a.dsm")).toEqual({
      tag: "EditLockFailed",
      _0: "/m/a.dsm is currently being edited.",
    });
    await dropEditLock(l1);
    expect(locks.held.size).toBe(0);
    const l2 = lockOf(await tryEditLock("/m/a.dsm"));
    await dropEditLock(l2);
  });

  test("a failing lock manager is reported as an error", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: () => Promise.reject(new Error("SecurityError")),
      },
    });
    const r = await tryEditLock("/m/b.dsm");
    expect(r.tag).toBe("EditLockError");
  });
});
