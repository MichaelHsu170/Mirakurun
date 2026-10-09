const { describe, it } = require("node:test");
const assert = require("assert");
const { EventEmitter } = require("events");

const _ = require("../lib/Mirakurun/_").default;
const { Event } = require("../lib/Mirakurun/Event");
_.event = new Event();
const log = require("../lib/Mirakurun/log");
const eventsStream = require("../lib/Mirakurun/api/events/stream");
const logStream = require("../lib/Mirakurun/api/log/stream");

// a response whose client has stopped reading, with `buffered` bytes waiting in memory
const fakeRes = buffered => ({
  writableLength: buffered,
  written: [],
  destroyed: false,
  setHeader() {},
  status() { return this; },
  write(data) { this.written.push(data); return true; },
  destroy() { this.destroyed = true; }
});
const fakeReq = () => Object.assign(new EventEmitter(), { query: {}, setTimeout() {} });

const MiB = 1024 * 1024;

describe("[streamApi.spec] GET /api/events/stream", () => {
  const run = buffered => {
    const req = fakeReq();
    const res = fakeRes(buffered);
    eventsStream.get(req, res);
    res.written.length = 0; // the opening "[\n"
    Event.emit("tuner", "update", { index: 0 });
    req.emit("close");
    return res;
  };

  it("disconnects a client with more than 16 MiB waiting", () => {
    const res = run(16 * MiB + 1);

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.written, []);
  });

  it("keeps writing to a client with 16 MiB waiting", () => {
    const res = run(16 * MiB);

    assert.strictEqual(res.destroyed, false);
    assert.strictEqual(res.written.length, 1);
  });
});

describe("[streamApi.spec] GET /api/log/stream", () => {
  const run = buffered => {
    const req = fakeReq();
    const res = fakeRes(buffered);
    logStream.get(req, res);
    log.info("a log line");
    req.emit("close");
    return res;
  };

  it("disconnects a client with more than 16 MiB waiting", () => {
    const res = run(16 * MiB + 1);

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.written, []);
  });

  it("keeps writing to a client with 16 MiB waiting", () => {
    const res = run(16 * MiB);

    assert.strictEqual(res.destroyed, false);
    assert.strictEqual(res.written.length, 1);
    assert.match(res.written[0], / info: a log line\n$/);
  });
});
