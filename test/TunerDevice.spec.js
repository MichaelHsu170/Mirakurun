const { describe, it } = require("node:test");
const assert = require("assert");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const child_process = require("child_process");

// fake tuner processes: the first fails to spawn (error, then close), later ones keep running
const spawned = [];
const fakeChild = fail => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = fail ? undefined : 1000 + spawned.length;
  child.kill = () => setImmediate(() => { child.emit("exit", null, "SIGTERM"); child.emit("close", null, "SIGTERM"); });
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
