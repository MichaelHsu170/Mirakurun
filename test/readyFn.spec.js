const { describe, it } = require("node:test");
const assert = require("assert");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
_.config.channels = [];
const Channel = require("../lib/Mirakurun/Channel").default;
const Service = require("../lib/Mirakurun/Service").default;

const channel = { type: "GR", channel: "27" };

/** Captures the jobs added while fn runs, with a tuner whose readyForJob reports the signal it got. */
const captureJobs = async fn => {
  const jobs = [];
  _.job = { add: job => jobs.push(job), addSchedule: () => {}, jobs: [] };
  _.tuner = { readyForJob: async (ch, signal) => signal };
  await fn();
  return jobs;
};

describe("[readyFn.spec] jobs pass their abort signal on to the tuner wait", () => {
  it("service checks and scans", async () => {
    const service = Object.create(Service.prototype);
    const jobs = await captureJobs(() => {
      service._queueCheckToAdd(channel, 1024);
      service._queueScanToAdd(channel);
      service._queueScanToUpdate(channel);
    });
    const ac = new AbortController();

    assert.strictEqual(jobs.length, 3);
    for (const job of jobs) {
      assert.strictEqual(await job.readyFn(ac.signal), ac.signal, job.key);
    }
  });

  it("EPG gathering", async () => {
    _.service = {
      items: [{ networkId: 1 }],
      findByNetworkId: () => [{ channel, epgReady: false }]
    };
    const ch = Object.create(Channel.prototype);
    ch._startup = false;
    const jobs = await captureJobs(() => ch._epgGatherer());
    const ac = new AbortController();

    const gather = jobs.find(job => job.key === "EPG.Gather.NID.1");
    assert.strictEqual(await gather.readyFn(ac.signal), ac.signal);
  });

  it("the service scan waiting for service checks gives up when aborted", { timeout: 5000 }, async () => {
    _.channel = { items: [], get: () => null };
    const service = Object.create(Service.prototype);
    const jobs = await captureJobs(() => service._initJobs());
    _.job.jobs = [{ key: "Service.Add.Check.GR.27.1024", status: "running" }]; // never finishes
    const ac = new AbortController();
    ac.abort();

    const find = jobs.find(job => job.key === "Service.Add.Scan.Find-Channels");
    assert.strictEqual(await find.readyFn(ac.signal), false);
  });
});
