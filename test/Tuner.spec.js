const { describe, it } = require("node:test");
const assert = require("assert");

const Tuner = require("../lib/Mirakurun/Tuner").default;

describe("[Tuner.spec] Tuner.ts: readyForJob()", () => {
  it("gives up when the job is aborted while it waits for a tuner", { timeout: 5000 }, async () => {
    const tuner = Object.create(Tuner.prototype);
    tuner._readyForJobPickedDeviceSet = new Set();
    tuner._getDevicesByType = () => [{ index: 0 }];
    tuner._pickTunerDevice = () => null; // every tuner is busy

    const ac = new AbortController();
    const ready = tuner.readyForJob({ type: "GR", channel: "27" }, ac.signal);
    ac.abort();

    assert.strictEqual(await ready, false);
  });
});
