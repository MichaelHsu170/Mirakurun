const { describe, it } = require("node:test");
const assert = require("assert");

const _ = require("../lib/Mirakurun/_").default;
_.event = { emit: () => true };
_.config.server = {};
const Job = require("../lib/Mirakurun/Job").default;

describe("[Job.spec] a job waiting in readyFn", () => {
  it("receives its abort signal, so aborting it ends the wait", { timeout: 5000 }, async () => {
    const job = new Job();
    let received;
    const waited = new Promise(resolve => {
      job.add({
        key: "Test.Wait",
        name: "Test Wait",
        fn: async () => {},
        readyFn: signal => {
          received = signal;
          return new Promise(r => signal.addEventListener("abort", () => r(false), { once: true })).finally(resolve);
        }
      });
    });
    await new Promise(r => setTimeout(r, 200));

    const [queued] = job.jobs.filter(j => j.key === "Test.Wait");
    assert.ok(received instanceof AbortSignal);
    job.abort(queued.id, "test");
    await waited;
  });
});

describe("[Job.spec] Job#_checkQueue()", () => {
  it("moves every queued job to standby while standby has room", () => {
    const job = new Job();
    job.maxStandby = 10;
    const waiting = () => new Promise(() => {}); // e.g. readyForJob while every tuner is busy
    job._queuedJobItems.push(...["A", "B", "C", "D"].map((key, i) => ({
      key, name: key, fn: async () => {}, readyFn: waiting, id: `test${i}`, ac: new AbortController(), createdAt: 0, retryCount: 0
    })));

    job._checkQueue();

    assert.deepStrictEqual(job._standbyJobItems.map(item => item.key), ["A", "B", "C", "D"]);
    assert.deepStrictEqual(job._queuedJobItems, []);
    job.close();
  });
});
