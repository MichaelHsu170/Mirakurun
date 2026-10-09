const { describe, it } = require("node:test");
const assert = require("assert");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
const db = require("../lib/Mirakurun/db");
const Program = require("../lib/Mirakurun/Program").default;

describe("[Program.spec] Program.save()", () => {
  it("saves within 5 minutes even while changes keep arriving", t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    let saved = 0;
    const originalSave = db.savePrograms;
    db.savePrograms = async () => { saved++; };
    t.after(() => { db.savePrograms = originalSave; });

    const program = Object.create(Program.prototype);
    program._itemMap = new Map();
    program._saveDeadline = 0;
    program._emit = () => {};

    // an EIT update every 20 s, shorter than the 30 s debounce
    for (let i = 0; i < 15; i++) {
      program.save();
      t.mock.timers.tick(20 * 1000);
    }

    assert.strictEqual(saved, 1);
  });
});

describe("[Program.spec] Program.flush()", () => {
  const setup = t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const saves = [];
    const originalSave = db.savePrograms;
    db.savePrograms = async data => { saves.push(data); };
    t.after(() => { db.savePrograms = originalSave; });

    const program = Object.create(Program.prototype);
    program._itemMap = new Map([[1, { id: 1 }]]);
    program._saveDeadline = 0;
    program._emit = () => {};
    return { program, saves };
  };

  it("saves the pending changes at once, and not again when their timer would have run", async t => {
    const { program, saves } = setup(t);

    program.save();
    await program.flush();
    t.mock.timers.tick(5 * 60 * 1000);

    assert.deepStrictEqual(saves, [[{ id: 1 }]]);
  });

  it("saves nothing when nothing is pending", async t => {
    const { program, saves } = setup(t);

    program.save();
    t.mock.timers.tick(30 * 1000); // saved by its timer
    await program.flush();

    assert.strictEqual(saves.length, 1);
  });

  it("waits for a save already in progress, which cleared the pending marker when it started", async t => {
    const { program } = setup(t);
    let finishWrite;
    db.savePrograms = () => new Promise(resolve => { finishWrite = resolve; });
    program.save();
    t.mock.timers.tick(30 * 1000); // the timer starts the save
    let flushed = false;

    const flush = program.flush().then(() => { flushed = true; });
    await new Promise(setImmediate);
    assert.strictEqual(flushed, false);
    finishWrite();
    await flush;
    assert.strictEqual(flushed, true);
  });
});
