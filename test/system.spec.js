const { describe, it } = require("node:test");
const assert = require("assert");
const child_process = require("child_process");

// getLatestVersion runs `npm view` through child_process.exec; replace it before system.ts is loaded
let execCalls = 0;
let execResult = { stdout: "4.1.5\n" };
child_process.exec = (cmd, opts, cb) => {
  execCalls++;
  const callback = typeof opts === "function" ? opts : cb;
  // util.promisify of this plain function resolves with the second argument, like the real exec's { stdout, stderr }
  setImmediate(() => execResult instanceof Error ? callback(execResult) : callback(null, { stdout: execResult.stdout, stderr: "" }));
};
const system = require("../lib/Mirakurun/system");

describe("[system.spec] system.ts: getLatestVersion()", () => {
  it("runs npm once for concurrent and repeated calls", async () => {
    execCalls = 0;
    const versions = await Promise.all([system.getLatestVersion(), system.getLatestVersion()]);
    assert.deepStrictEqual(versions, ["4.1.5", "4.1.5"]);
    assert.strictEqual(await system.getLatestVersion(), "4.1.5");
    assert.strictEqual(execCalls, 1);
  });
});

describe("[system.spec] system.ts: isPermittedHost()", () => {
  it("treats a null or malformed origin as not permitted instead of throwing", () => {
    assert.strictEqual(system.isPermittedHost("null", "mirakurun"), false);
    assert.strictEqual(system.isPermittedHost("http://[bad", "mirakurun"), false);
    assert.strictEqual(system.isPermittedHost("http://localhost:40772", "mirakurun"), true);
  });
});
