const { describe, it } = require("node:test");
const assert = require("assert");
const child_process = require("child_process");
const request = require("./apiRequest");

child_process.exec = (cmd, opts, cb) => {
  const callback = typeof opts === "function" ? opts : cb;
  setImmediate(() => callback(new Error("Command failed: npm view mirakurun version\nnpm ERR! network")));
};
const { get } = require("../lib/Mirakurun/api/version");

describe("[version.spec] GET /api/version", () => {
  it("answers 500 with the multi-line exec error when npm cannot be reached, instead of leaving the request open", { timeout: 5000 }, async () => {
    const { status, body } = await request(get);

    assert.strictEqual(status, 500);
    assert.strictEqual(body.reason, "Command failed: npm view mirakurun version\nnpm ERR! network");
  });
});
