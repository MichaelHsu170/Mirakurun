const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const db = require("../lib/Mirakurun/db");
const { writeFileAtomic } = require("../lib/Mirakurun/fileUtil");

const tmpDir = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-db-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

describe("[db.spec] db.ts: save", () => {
  it("creates a missing directory and saves", { timeout: 5000 }, async t => {
    const dir = tmpDir(t);
    process.env.SERVICES_DB_PATH = path.join(dir, "sub", "services.json");

    await db.saveServices([{ id: 1 }], "x");

    assert.deepStrictEqual(await db.loadServices("x"), [{ id: 1 }]);
  });

  it("a write that keeps failing rejects instead of blocking every later save and load", { timeout: 5000 }, async t => {
    const dir = tmpDir(t);
    // a directory where the file should be: every write fails, the parent exists
    process.env.SERVICES_DB_PATH = path.join(dir, "services.json");
    fs.mkdirSync(process.env.SERVICES_DB_PATH);

    await assert.rejects(db.saveServices([{ id: 1 }], "x"));

    process.env.PROGRAMS_DB_PATH = path.join(dir, "programs.json");
    await db.savePrograms([{ id: 2 }], "y");
    assert.deepStrictEqual(await db.loadPrograms("y"), [{ id: 2 }]);
  });
});

describe("[db.spec] fileUtil.ts: writeFileAtomic()", () => {
  it("replaces the file and leaves no temporary file", async t => {
    const file = path.join(tmpDir(t), "a.json");
    fs.writeFileSync(file, "old");

    await writeFileAtomic(file, "new");

    assert.strictEqual(fs.readFileSync(file, "utf8"), "new");
    assert.strictEqual(fs.existsSync(file + ".tmp"), false);
  });

  it("keeps the old content when the write fails", async t => {
    const file = path.join(tmpDir(t), "a.json");
    fs.writeFileSync(file, "old");
    fs.mkdirSync(file + ".tmp"); // the temporary file cannot be created

    await assert.rejects(writeFileAtomic(file, "new"));

    assert.strictEqual(fs.readFileSync(file, "utf8"), "old");
  });
});
