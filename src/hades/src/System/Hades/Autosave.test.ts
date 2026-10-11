import { describe, expect, test } from "vitest";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import {
  autosaveExpire,
  autosaveExtension,
  autosaveFiles,
  autosaveFolder,
  autosaveGetContents,
  autosaveNewPath,
  autosaveProcess,
  type AutosaveFile,
} from "./Autosave";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until the autosave folder for the app holds the given number of files. */
async function waitForFiles(app: string, pred: (fs: AutosaveFile[]) => boolean): Promise<AutosaveFile[]> {
  for (let i = 0; i < 200; i++) {
    const fs = await autosaveFiles(app);
    if (pred(fs)) return fs;
    await sleep(5);
  }
  throw new Error("timed out waiting for autosave files");
}

const objCodec: J.JSONCodec<{ n: number }> = J.codec(
  (v) => J.object([["n", v.n]]),
  (v) => J.withObject("Obj", (o) => ({ n: J.field(o, "n", J.intJ) }), v),
);

describe("Autosave", () => {
  test("folder and new path naming", async () => {
    expect(autosaveExtension).toBe(".asv");
    expect(await autosaveFolder("naming")).toBe("~/.naming");
    // V5 UUID of "file://" ++ path in the URL namespace (checked against Python's uuid5).
    expect(await autosaveNewPath("naming", "/home/user/My Model.dsm")).toBe(
      "~/.naming/db5d2e7d-4a63-5354-8d9e-3d0712c66874X0.asv",
    );
    expect(await autosaveNewPath("naming", "")).toBe("~/.naming/7318ab59-d837-5001-a5a4-5ce37d678167X0.asv");
    expect(await autosaveFiles("naming")).toEqual([]);
  });

  test("saves, sequence numbers, contents and expiry", async () => {
    const app = "process";
    const write = autosaveProcess(objCodec, app, -1, 2);
    const pathA = "/models/a.dsm";
    const pathB = "/models/été.dsm";
    for (let i = 1; i <= 3; i++) {
      write(pathA, { n: i });
      // Wait for the save to land (and the clock to move) so that timestamps differ.
      await waitForFiles(app, (fs) => fs.some((f) => f.autosaveSeq === i - 1));
      await sleep(3);
    }
    write(pathB, { n: 99 });
    const files = await waitForFiles(app, (fs) => fs.length === 3);
    const hashA = U.generateNamed(U.namespaceURL, U.encodeUtf8("file://" + pathA));
    const hashB = U.generateNamed(U.namespaceURL, U.encodeUtf8("file://" + pathB));
    const aFiles = files.filter((f) => f.autosaveHash === hashA).sort((x, y) => x.autosaveSeq - y.autosaveSeq);
    const bFiles = files.filter((f) => f.autosaveHash === hashB);
    // Only the latest 2 copies of A are kept.
    expect(aFiles.map((f) => f.autosaveSeq)).toEqual([1, 2]);
    expect(aFiles[0].autosavePath).toBe(`~/.${app}/${hashA}X1.asv`);
    expect(aFiles[0].autosaveWhen).toBeLessThan(aFiles[1].autosaveWhen);
    expect(bFiles.map((f) => f.autosaveSeq)).toEqual([0]);
    const contents = await autosaveGetContents(aFiles[1].autosavePath);
    expect(contents.tag).toBe("Just");
    if (contents.tag === "Just") {
      expect(contents.value.autosaveFor).toBe(pathA);
      expect(J.eitherDecode(objCodec, U.decodeUtf8(contents.value.autosaveData))).toEqual({
        tag: "Right",
        value: { n: 3 },
      });
    }
    const contentsB = await autosaveGetContents(bFiles[0].autosavePath);
    expect(contentsB.tag === "Just" && contentsB.value.autosaveFor).toBe(pathB);
    // The next path for A continues the sequence.
    expect(await autosaveNewPath(app, pathA)).toBe(`~/.${app}/${hashA}X3.asv`);
    // Expire down to one copy per file.
    await autosaveExpire(app, 1);
    const remaining = await autosaveFiles(app);
    expect(remaining.map((f) => f.autosaveSeq).sort()).toEqual([0, 2]);
  });

  test("saves are throttled", async () => {
    const app = "throttle";
    const write = autosaveProcess(objCodec, app, 3600, 5);
    write("", { n: 1 });
    write("", { n: 2 });
    write("", { n: 3 });
    const files = await waitForFiles(app, (fs) => fs.length === 1);
    await sleep(30);
    expect((await autosaveFiles(app)).length).toBe(1);
    const c = await autosaveGetContents(files[0].autosavePath);
    expect(c.tag === "Just" && c.value.autosaveFor).toBe("");
    expect(c.tag === "Just" && U.decodeUtf8(c.value.autosaveData)).toBe('{"n":1}');
  });

  test("missing files have no contents", async () => {
    expect(await autosaveGetContents("~/.nothing/none.asv")).toEqual({ tag: "Nothing" });
  });
});
