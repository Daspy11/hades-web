import { describe, expect, it } from "vitest";
import * as J from "@/lib/Data/Aeson";
import { call, command, constructor, delete_, event, JavaScriptException, listen, procedure, send, seqRemote, start, value, var_, type Engine } from "./JavaScript";

async function engine(): Promise<Engine> {
  let eng: Engine | null = null;
  await start((e) => {
    eng = e;
  });
  return eng!;
}

describe("Network.JavaScript loopback engine", () => {
  it("builds JavaScript text as javascript-bridge does", () => {
    expect(call("f", [value(1), value("a")])).toBe('f(1,"a")');
    expect(event({ d: "x", v: [1, 2] })).toBe('jsb.event({"d":"x","v":[1,2]})');
  });

  it("evaluates commands, constructors and procedures in the page", async () => {
    const eng = await engine();
    const rv = send(eng, (f) => {
      const r = constructor<HTMLElement>(call("document.createElement", [value("p")]))(f);
      command(var_(r) + ".textContent=" + value("hello"))(f);
      command("document.body.appendChild(" + var_(r) + ")")(f);
      return r;
    });
    expect(document.body.lastElementChild?.textContent).toBe("hello");
    expect(send(eng, procedure(J.textJ, var_(rv) + ".textContent"))).toBe("hello");
    send(eng, seqRemote(command(var_(rv) + ".remove()"), delete_(rv)));
    expect(send(eng, procedure(J.boolJ, "jsb.rs[" + rv._0 + "] === undefined"))).toBe(true);
  });

  it("reports failed procedures as JavaScriptException; failed commands are logged", async () => {
    const eng = await engine();
    expect(() => send(eng, procedure(J.valueJ, "noSuchFunction()"))).toThrow(JavaScriptException);
    const errors: unknown[] = [];
    const old = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      let after = false;
      send(eng, (f) => {
        command("noSuchFunction()")(f);
        command("window.__ranAfter = true")(f);
        after = true;
        return null;
      });
      expect(after).toBe(true);
      expect((globalThis as any).__ranAfter).toBeUndefined();
    } finally {
      console.error = old;
    }
    expect(errors.length).toBe(1);
  });

  it("delivers jsb.event calls to the event channel as JSON", async () => {
    const eng = await engine();
    const next = listen(eng);
    send(eng, command(event({ a: 1 })));
    expect(await next).toEqual({ a: 1 });
    const next2 = listen(eng);
    (globalThis as any).jsb.event({ f: () => 1, n: 2 }); // functions are dropped by JSON
    expect(await next2).toEqual({ n: 2 });
  });
});
