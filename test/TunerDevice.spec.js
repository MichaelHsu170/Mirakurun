const { describe, it } = require("node:test");
const assert = require("assert");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const child_process = require("child_process");

// fake tuner processes: the first fails to spawn (error, then close), later ones keep running;
// each records the signals it is sent, and one that has exited ignores them
const spawned = [];
const fakeChild = fail => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = fail ? undefined : 1000 + spawned.length;
  child.exited = false;
  child.signals = [];
  child.kill = signal => {
    child.signals.push(signal);
    if (child.exited) {
      return false;
    }
    child.exited = true;
    setImmediate(() => { child.emit("exit", null, signal); child.emit("close", null, signal); });
    return true;
  };
  if (fail) {
    setImmediate(() => {
      child.emit("error", Object.assign(new Error("spawn recpt1 ENOENT"), { code: "ENOENT" }));
      child.emit("close", -2, null);
    });
  }
  return child;
};
child_process.spawn = () => {
  const child = fakeChild(spawned.length === 0);
  spawned.push(child);
  return child;
};

const _ = require("../lib/Mirakurun/_").default;
_.event = { emit: () => true };
const TunerDevice = require("../lib/Mirakurun/TunerDevice").default;

describe("[TunerDevice.spec] a failed tuner process spawn", () => {
  it("is respawned once, and the device keeps the respawned process", async () => {
    const device = new TunerDevice(0, { name: "t0", types: ["GR"], command: "recpt1 <channel> - -" });
    const stream = new EventEmitter();
    stream.closed = false;
    stream.write = () => {};
    stream.end = () => {};

    await device.startStream({ id: "u", priority: 0 }, stream, { type: "GR", channel: "27" });
    await new Promise(resolve => setTimeout(resolve, 500));

    assert.strictEqual(spawned.length, 2);
    assert.ok(spawned[1].listenerCount("close") > 0, "the running process has no listeners: it is orphaned");
  });
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fakeStream = () => {
  const stream = new EventEmitter();
  stream.closed = false;
  stream.write = () => {};
  stream.end = () => { stream.closed = true; };
  return stream;
};
// the tuner process ends on its own (a recpt1 error, a signal drop)
const exitByItself = child => {
  child.exited = true;
  child.emit("exit", 1, null);
  child.emit("close", 1, null);
};

describe("[TunerDevice.spec] a tuner process that exits while a user streams", () => {
  it("is respawned, and the device can be shared and taken over again", async () => {
    const device = new TunerDevice(1, { name: "t1", types: ["GR"], command: "recpt1 <channel> - -" });
    await device.startStream({ id: "viewer", priority: 0 }, fakeStream(), { type: "GR", channel: "27" });
    const first = spawned[spawned.length - 1];

    exitByItself(first);
    await sleep(300);

    assert.notStrictEqual(device.pid, first.pid);
    assert.strictEqual(device.isAvailable, true);
    assert.strictEqual(device.isUsing, true);
  });
});

describe("[TunerDevice.spec] stopping a tuner process that has just exited by itself", () => {
  it("does not kill the next process of the device 6 s later", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const device = new TunerDevice(2, { name: "t2", types: ["GR"], command: "recpt1 <channel> - -" });
    const ch = { type: "GR", channel: "27" };
    const viewer = fakeStream();
    await device.startStream({ id: "viewer", priority: 0 }, viewer, ch);
    const first = spawned[spawned.length - 1];

    viewer.emit("close"); // the last user leaves: the device stops its process after 3 s
    t.mock.timers.tick(2950);
    exitByItself(first); // released 100 ms later
    t.mock.timers.tick(50); // the idle stop runs against the exited process
    t.mock.timers.tick(50); // released
    assert.strictEqual(device.isFree, true);

    await device.startStream({ id: "recording", priority: 2 }, fakeStream(), ch);
    const next = spawned[spawned.length - 1];
    t.mock.timers.tick(6000);

    assert.deepStrictEqual(next.signals, []);
    assert.strictEqual(device.pid, next.pid);
  });
});
