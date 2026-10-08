const { describe, it } = require("node:test");
const assert = require("assert");
const child_process = require("child_process");

child_process.exec = (cmd, opts, cb) => {
  const callback = typeof opts === "function" ? opts : cb;
  setImmediate(() => callback(new Error("npm ERR! network")));
};
const { get } = require("../lib/Mirakurun/api/version");

describe("[version.spec] GET /api/version", () => {
  it("answers 500 when npm cannot be reached, instead of leaving the request open", { timeout: 5000 }, async () => {
    const res = {
      code: null,
      setHeader() {},
      status(code) { this.code = code; return this; },
      writeHead(code) { this.code = code; return this; },
      end() { this.ended = true; }
    };

    await get({ query: {} }, res);

    assert.strictEqual(res.code, 500);
    assert.strictEqual(res.ended, true);
  });
});
