const { describe, it } = require("node:test");
const assert = require("assert");
const { EventEmitter } = require("events");
const http = require("http");
const net = require("net");

const _ = require("../lib/Mirakurun/_").default;
const { Event } = require("../lib/Mirakurun/Event");
_.event = new Event();
const log = require("../lib/Mirakurun/log");
const eventsStream = require("../lib/Mirakurun/api/events/stream");
const logStream = require("../lib/Mirakurun/api/log/stream");
const programStream = require("../lib/Mirakurun/api/programs/{id}/stream");

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

describe("[streamApi.spec] GET /api/programs/{id}/stream", () => {
  const TEN_MINUTES = 1000 * 60 * 10;
  const SCALED_TEN_MINUTES = 200; // the socket's idle timeout runs for real, scaled down to 200 ms

  /**
   * Runs the real handler on a real http server and client. `feed(output)` stands in for TSFilter: like the real one
   * it writes nothing to the response until the program has started (the event is seen in EIT p/f), and its close()
   * ends the response. Returns what the client saw and whether the handler closed the TSFilter.
   */
  const run = async (program, feed) => {
    const timeouts = [];
    const socketSetTimeout = net.Socket.prototype.setTimeout;
    net.Socket.prototype.setTimeout = function (ms, ...args) {
      timeouts.push(ms);
      return socketSetTimeout.call(this, ms === TEN_MINUTES ? SCALED_TEN_MINUTES : ms, ...args);
    };
    const filter = { closed: false };
    _.program = { get: () => program };
    _.tuner = {
      initProgramStream: async (_program, _user, output) => {
        filter.close = () => {
          filter.closed = true;
          if (output.writableEnded === false) {
            output.end();
          }
        };
        feed(output, filter);
        return filter;
      }
    };
    const server = http.createServer((req, res) => {
      req.params = { id: "3273601024" };
      req.query = {};
      req.get = name => req.headers[name.toLowerCase()];
      res.status = code => { res.statusCode = code; return res; };
      programStream.get(req, res);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const started = Date.now();
    try {
      return await new Promise(resolve => {
        const seen = { status: null, body: "", ended: false, error: null };
        // the server sees the disconnect a moment after the client
        const done = () => resolve({ ...seen, ms: Date.now() - started, filterClosed: filter.closed, timeouts });
        const safety = setTimeout(done, 3000);
        http.get({ host: "127.0.0.1", port: server.address().port, path: "/" }, res => {
          seen.status = res.statusCode;
          res.setEncoding("latin1");
          res.on("data", chunk => seen.body += chunk);
          res.on("end", () => seen.ended = true);
          res.on("error", e => seen.error = e.code || e.message);
          res.on("close", () => { clearTimeout(safety); setTimeout(done, 100); });
        }).on("error", e => { seen.error = e.code || e.message; clearTimeout(safety); setTimeout(done, 100); });
      });
    } finally {
      net.Socket.prototype.setTimeout = socketSetTimeout;
      server.closeAllConnections();
      server.close();
    }
  };

  it("keeps a stream that waits more than 10 minutes for a delayed program open until the program starts", async () => {
    const now = Date.now();
    // scheduled 5 s ago for 30 minutes, but not on air yet: the program starts after 5 idle timeouts
    const result = await run({ startAt: now - 5000, duration: 1000 * 60 * 30 }, (output, filter) => {
      setTimeout(() => {
        output.write("TS-PACKETS");
        filter.close();
      }, SCALED_TEN_MINUTES * 5);
    });

    assert.deepStrictEqual(
      { status: result.status, body: result.body, ended: result.ended, error: result.error },
      { status: 200, body: "TS-PACKETS", ended: true, error: null }
    );
    assert.ok(result.timeouts.includes(TEN_MINUTES), String(result.timeouts));
  });

  it("still cuts a stream that has sent data and then nothing for 10 minutes", async () => {
    const now = Date.now();
    const result = await run({ startAt: now - 1000 * 60 * 10, duration: 1000 * 60 * 60 }, output => {
      setTimeout(() => output.write("TS-PACKETS"), 10); // on air, then the tuner stops sending
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body, "TS-PACKETS");
    assert.strictEqual(result.ended, false);
    assert.strictEqual(result.filterClosed, true);
    assert.ok(result.ms < SCALED_TEN_MINUTES * 4, `cut after ${result.ms} ms`);
  });

  it("cuts a stream still waiting 5 minutes after the program's end", async () => {
    const now = Date.now();
    // ended 6 minutes ago, and its event never appears
    const result = await run({ startAt: now - 1000 * 60 * 66, duration: 1000 * 60 * 60 }, () => {});

    assert.strictEqual(result.status, null);
    assert.strictEqual(result.error, "ECONNRESET");
    assert.strictEqual(result.filterClosed, true);
    assert.ok(result.ms < SCALED_TEN_MINUTES * 4, `cut after ${result.ms} ms`);
  });
});
