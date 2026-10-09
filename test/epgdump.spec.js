const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

describe("[epgdump.spec] mirakurun-epgdump", () => {
  it("prints the usage when only one path is given", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-epgdump-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const ts = path.join(dir, "src.ts");
    fs.writeFileSync(ts, "recorded TS");

    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "lib", "epgdump.js"), ts], { encoding: "utf8" });

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage: mirakurun-epgdump \[-f\] src\.ts dest\.json/);
    assert.strictEqual(fs.readFileSync(ts, "utf8"), "recorded TS");
  });
});
