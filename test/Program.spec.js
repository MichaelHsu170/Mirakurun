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
