const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

// stubs for what the UI modules get from the browser, the server and React
const rpc = new EventEmitter();
rpc.methods = new Map();
rpc.isConnected = () => true;
rpc.results = { getStatus: { version: "1" }, getServices: [], getTuners: [], getJobs: [], getJobSchedules: [] };
rpc.call = async method => {
  const result = rpc.results[method];
  if (result instanceof Error) {
    throw result;
  }
  return result;
};
globalThis.location = { pathname: "/", protocol: "http:", host: "mirakurun:40772", href: "http://mirakurun:40772/" };
globalThis.document = { hidden: false, querySelector: () => null };
let storage;
const stubModule = (name, exports) => {
  const id = require.resolve(name);
  const stub = new Module(id);
  stub.exports = exports;
  stub.loaded = true;
  require.cache[id] = stub;
};
stubModule("jsonrpc2-ws", { Client: function () { return rpc; } });
stubModule("react", { useState: init => [init, () => {}], useCallback: fn => fn });

// the UI is built by webpack only; transpile the modules under test to CommonJS for node
// (into test/tmp, so that they find the UI's packages in node_modules)
let ui;
let common;
let state;
let hooks;
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(__dirname, "tmp", "ui-"));
  for (const name of ["modules/ui", "modules/common", "modules/regexp", "modules/at", "modules/state", "hooks/useWebStorageState"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "ui", `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
    fs.mkdirSync(path.dirname(path.join(dir, `${name}.js`)), { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.js`), outputText);
  }
  for (const icon of ["icon.svg", "icon-gray.svg", "icon-active.svg"]) {
    fs.writeFileSync(path.join(dir, icon), `module.exports = "${icon}";`);
  }
  ui = require(path.join(dir, "modules", "ui.js"));
  common = require(path.join(dir, "modules", "common.js"));
  state = require(path.join(dir, "modules", "state.js")).state;
  hooks = require(path.join(dir, "hooks", "useWebStorageState.js"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("[ui.spec] ui.ts: autoLink()", () => {
  it("escapes HTML in broadcast text", () => {
    assert.strictEqual(ui.autoLink("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  });

  it("does not let a quote in a URL leave the href attribute", () => {
    const html = ui.autoLink('https://a.example/"onmouseover="alert(1)');

    assert.ok(!/href="[^"]*"onmouseover/.test(html), html);
    assert.ok(html.includes('href="https://a.example/&quot;onmouseover=&quot;alert(1)"'), html);
  });

  it("does not let a full-width quote normalize into the href attribute", () => {
    const html = ui.autoLink("ｈｔｔｐｓ：／／ａ．ｅｘ／＂ｏｎｆｏｃｕｓ＝＂ａｌｅｒｔ（１）");

    assert.ok(!html.includes('"onfocus='), html);
    assert.ok(html.includes("&quot;onfocus=&quot;alert(1)"), html);
  });

  it("still links plain URLs", () => {
    assert.strictEqual(
      ui.autoLink("詳しくは https://www.nhk.jp/p/ts/ まで"),
      '詳しくは <a referrerpolicy="no-referrer" target="_blank" href="https://www.nhk.jp/p/ts/" title="外部サイト">https://www.nhk.jp/p/ts/</a> まで'
    );
  });

  it("does not put an account link inside a URL link", () => {
    assert.strictEqual(
      ui.autoLink("https://example.com/@user"),
      '<a referrerpolicy="no-referrer" target="_blank" href="https://example.com/@user" title="外部サイト">https://example.com/@user</a>'
    );
    assert.strictEqual(
      ui.autoLink("https://www.instagram.com/@user"),
      '<a referrerpolicy="no-referrer" target="_blank" href="https://www.instagram.com/@user" title="外部サイト">https://www.instagram.com/@user</a>'
    );
  });

  it("still links X and Instagram accounts", () => {
    assert.strictEqual(
      ui.autoLink("X @nhk_pr Instagram @nhk"),
      'X <a referrerpolicy="no-referrer" target="_blank" href="https://x.com/nhk_pr" title="X">@nhk_pr</a> ' +
      'Instagram <a referrerpolicy="no-referrer" target="_blank" href="https://instagram.com/nhk" title="Instagram">@nhk</a>'
    );
  });
});

describe("[ui.spec] common.ts: isHttpURL()", () => {
  it("accepts http(s) URLs, also relative ones", () => {
    assert.strictEqual(common.isHttpURL("https://mirakurun-secure-contexts-api.pages.dev/tsplay/"), true);
    assert.strictEqual(common.isHttpURL("http://192.168.0.2/tsplay/"), true);
    assert.strictEqual(common.isHttpURL("/tsplay/"), true);
  });

  it("refuses other schemes", () => {
    assert.strictEqual(common.isHttpURL("javascript:alert(1)//"), false);
    assert.strictEqual(common.isHttpURL(" JavaScript:alert(1)"), false);
    assert.strictEqual(common.isHttpURL("data:text/html,<script>alert(1)</script>"), false);
  });
});

describe("[ui.spec] common.ts: fetchJSON()", () => {
  const response = (status, body) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

  it("returns the parsed body of a successful response", async t => {
    t.mock.method(globalThis, "fetch", async () => response(200, '[{"name":"adapter0"}]'));

    assert.deepStrictEqual(await common.fetchJSON("/api/config/tuners"), [{ name: "adapter0" }]);
    assert.strictEqual(globalThis.fetch.mock.calls[0].arguments[0], "/api/config/tuners");
  });

  it("throws on an error response instead of returning the error body as the data", async t => {
    t.mock.method(globalThis, "fetch", async () => response(500, '{"code":500,"reason":"bad indentation","errors":[]}'));

    await assert.rejects(common.fetchJSON("/api/config/server"), {
      message: '500 {"code":500,"reason":"bad indentation","errors":[]}'
    });
  });
});

describe("[ui.spec] common.ts: LazyCaller", () => {
  it("runs a call made while running again later, passing setTimeout a function", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const callbacks = [];
    const originalSetTimeout = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (fn, ms) => {
      callbacks.push(typeof fn);
      return originalSetTimeout(fn, ms);
    });
    const calls = [];
    let finish;
    const lazy = new common.LazyCaller(10, 0, arg => {
      calls.push(arg);
      return new Promise(resolve => finish = resolve);
    });

    lazy.caller("a");
    t.mock.timers.tick(10);
    lazy.caller("b"); // while "a" runs
    finish();
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setImmediate(resolve));
      t.mock.timers.tick(10);
    }

    assert.deepStrictEqual(calls, ["a", "b"]);
    assert.ok(callbacks.every(type => type === "function"), callbacks.join());
  });
});

describe("[ui.spec] useWebStorageState.ts", () => {
  before(() => {
    globalThis.localStorage = globalThis.sessionStorage = {
      getItem: key => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: key => storage.removeItem(key)
    };
  });

  for (const hook of ["useLocalStorageState", "useSessionStorageState"]) {
    it(`${hook}: falls back to the initial state when the stored value is corrupt`, () => {
      storage = { getItem: () => "{corrupt" };

      assert.deepStrictEqual(hooks[hook]("key", "GR")[0], "GR");
    });

    it(`${hook}: works when the storage is blocked`, () => {
      const blocked = () => { throw new Error("SecurityError"); };
      storage = { getItem: blocked, setItem: blocked, removeItem: blocked };

      const [value, setValue] = hooks[hook]("key", "GR");
      assert.strictEqual(value, "GR");
      setValue("BS");
      setValue(undefined);
    });

    it(`${hook}: reads the stored value`, () => {
      storage = { getItem: key => key === "mirakurun:state:key" ? "\"BS\"" : null };

      assert.strictEqual(hooks[hook]("key", "GR")[0], "BS");
    });
  }
});

describe("[ui.spec] state.ts", () => {
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  before(() => process.on("unhandledRejection", onUnhandled));
  after(() => process.off("unhandledRejection", onUnhandled));

  it("handles a failing RPC call on connect and in the periodic refresh", async t => {
    t.mock.method(console, "error", () => {});
    t.mock.timers.enable({ apis: ["setInterval"] });
    unhandled.length = 0;
    rpc.results.getServices = new Error("services failed");
    rpc.results.getStatus = new Error("status failed");

    rpc.emit("connected");
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    t.mock.timers.tick(60 * 1000); // the status (every 5 s) and services (every 60 s) refreshes
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    rpc.emit("disconnect");
    rpc.results.getServices = [];
    rpc.results.getStatus = { version: "1" };

    assert.deepStrictEqual(unhandled, []);
    assert.ok(console.error.mock.calls.length >= 2);
  });

  it("applies the program events that arrive while the programs are fetched to the fetched programs", async t => {
    let respond;
    t.mock.method(globalThis, "fetch", async () => ({ json: () => new Promise(resolve => respond = resolve) }));
    state.programs = [];

    await state.subscribePrograms();
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    await rpc.methods.get("events")(null, {
      array: [
        { resource: "program", type: "create", data: { id: 2 } },
        { resource: "program", type: "remove", data: { id: 1 } }
      ]
    });
    respond([{ id: 1 }, { id: 3 }]);
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    await state.unsubscribePrograms();

    assert.deepStrictEqual(state.programs.map(p => p.id), [3, 2]);
  });

  it("fetchServerConfig() keeps an error response out of the server config, so that the next call fetches again", async t => {
    t.mock.method(globalThis, "fetch", async () => new Response('{"code":500,"reason":"bad indentation"}', { status: 500 }));
    state.serverConfig = undefined;

    await assert.rejects(state.fetchServerConfig(), { message: '500 {"code":500,"reason":"bad indentation"}' });
    assert.strictEqual(state.serverConfig, undefined);
    assert.strictEqual(globalThis.fetch.mock.calls[0].arguments[0], "/api/config/server");
  });

  it("fetchServerConfig() stores and returns the server config", async t => {
    t.mock.method(globalThis, "fetch", async () => new Response('{"allowPNA":true}', { status: 200 }));

    assert.deepStrictEqual(await state.fetchServerConfig(), { allowPNA: true });
    assert.deepStrictEqual(state.serverConfig, { allowPNA: true });
  });

  it("adds a tuner that it does not know yet", async () => {
    state.tuners.splice(0);

    await rpc.methods.get("events")(null, { array: [{ resource: "tuner", type: "update", data: { index: 3, isUsing: false, users: [] } }] });

    assert.deepStrictEqual(state.tuners.map(t => t.index), [3]);
  });
});
