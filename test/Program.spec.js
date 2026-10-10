const { describe, it } = require("node:test");
const assert = require("assert");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
const db = require("../lib/Mirakurun/db");
const Program = require("../lib/Mirakurun/Program").default;
const Event = require("../lib/Mirakurun/Event").default;

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

  it("rejects when the save in progress fails", async t => {
    const { program } = setup(t);
    let failWrite;
    db.savePrograms = () => new Promise((resolve, reject) => { failWrite = reject; });
    program.save();
    t.mock.timers.tick(30 * 1000); // the timer starts the save

    const flush = program.flush();
    failWrite(new Error("ENOSPC"));
    await assert.rejects(flush, { message: "ENOSPC" });
  });

  it("does not report an old failed save when nothing is pending", async t => {
    const { program, saves } = setup(t);
    db.savePrograms = async data => { saves.push(data); throw new Error("ENOSPC"); };
    program.save();
    t.mock.timers.tick(30 * 1000); // the timer's save fails
    await program._savePromise.catch(() => {}); // logged as unhandledRejection in the server

    await program.flush();
    assert.strictEqual(saves.length, 1);
  });
});

describe("[Program.spec] Program.remove()", () => {
  const hour = 60 * 60 * 1000;
  const setup = t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const originalSave = db.savePrograms;
    db.savePrograms = async () => {};
    t.after(() => { db.savePrograms = originalSave; });
    const originalJob = _.job;
    _.job = { add() {}, addSchedule() {} };
    t.after(() => { _.job = originalJob; });
    const events = [];
    t.mock.method(Event, "emit", (resource, type, data) => { events.push(`${type} ${data.id}`); return true; });
    return { program: new Program(), events };
  };
  // runs the 1 s debounce of the queued events and the 10 ms pause after each one
  const emitQueued = async t => {
    t.mock.timers.tick(1000);
    for (let i = 0; i < 10; i++) {
      await new Promise(setImmediate);
      t.mock.timers.tick(10);
    }
  };

  it("does not emit a queued update of a program after it was removed as a conflict", async t => {
    const { program, events } = setup(t);
    program.add({ id: 1, networkId: 4, serviceId: 101, eventId: 1, startAt: hour, duration: hour }, true);
    program.set(1, { duration: hour / 2 }); // queues "update 1"
    // before the queued events are sent, a new event overlapping it arrives
    program.add({ id: 2, networkId: 4, serviceId: 101, eventId: 2, startAt: hour + hour / 4, duration: hour });

    await emitQueued(t);
    assert.deepStrictEqual(events, ["remove 1", "create 2"]);
    assert.strictEqual(program.isLogicallyDeleted(1), true);
  });

  it("does not emit a queued update of a program removed by a replace", async t => {
    const { program, events } = setup(t);
    program.add({ id: 1, networkId: 4, serviceId: 101, eventId: 1, startAt: hour, duration: hour }, true);
    program.set(1, { duration: hour / 2 }); // queues "update 1"
    program.findByNetworkIdAndReplace(4, []);

    await emitQueued(t);
    assert.deepStrictEqual(events, []);
    assert.strictEqual(program.exists(1), false);
  });
});
