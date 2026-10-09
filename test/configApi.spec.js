const { describe, it, after } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// config.ts reads the paths when it is loaded. Each file is broken YAML, and a directory in the way of
// its `.tmp` file makes every save fail.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-config-api-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
for (const name of ["server", "tuners", "channels"]) {
  const file = path.join(dir, `${name}.yml`);
  fs.writeFileSync(file, "key: [unclosed\n");
  fs.mkdirSync(`${file}.tmp`);
  process.env[`${name.toUpperCase()}_CONFIG_PATH`] = file;
}

const fakeRes = () => ({
  code: null,
  setHeader() {},
  status(code) { this.code = code; return this; },
  writeHead(code) { this.code = code; return this; },
  end() { this.ended = true; }
});

for (const name of ["server", "tuners", "channels"]) {
  const handler = require(`../lib/Mirakurun/api/config/${name}`);

  describe(`[configApi.spec] /api/config/${name}`, () => {
    it("GET answers 500 when the config file cannot be read, instead of leaving the request open", async () => {
      const res = fakeRes();

      await handler.get({ query: {} }, res);

      assert.strictEqual(res.code, 500);
      assert.strictEqual(res.ended, true);
    });

    it("PUT answers 500 when the config file cannot be written, instead of leaving the request open", async () => {
      const res = fakeRes();

      await handler.put({ query: {}, body: name === "server" ? {} : [] }, res);

      assert.strictEqual(res.code, 500);
      assert.strictEqual(res.ended, true);
    });
  });
}
