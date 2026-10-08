const { describe, it, beforeEach, after } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// config.ts reads the path once when it is loaded
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-config-"));
const tunersPath = path.join(dir, "tuners.yml");
process.env.TUNERS_CONFIG_PATH = tunersPath;
const config = require("../lib/Mirakurun/config");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("[config.spec] config.ts: save", () => {
  beforeEach(() => {
    fs.rmSync(tunersPath + ".tmp", { recursive: true, force: true });
    fs.writeFileSync(tunersPath, "- name: old\n");
  });

  it("keeps the old file when the new one cannot be written", async () => {
    fs.mkdirSync(tunersPath + ".tmp"); // the temporary file cannot be created

    await assert.rejects(config.saveTuners([{ name: "new" }]), /EISDIR/);

    assert.strictEqual(fs.readFileSync(tunersPath, "utf8"), "- name: old\n");
  });

  it("writes the new content", async () => {
    await config.saveTuners([{ name: "new" }]);

    assert.strictEqual(fs.readFileSync(tunersPath, "utf8"), "- name: new\n");
  });
});
