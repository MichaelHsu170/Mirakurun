const { describe, it } = require("node:test");
const assert = require("assert");
const sift = require("sift").default;

const api = require("../lib/Mirakurun/api");
const request = require("./apiRequest");

describe("[api.spec] api.ts: stripQueryOperators()", () => {
  it("removes sift operators at any depth, so $where cannot run code", () => {
    let ran = false;
    globalThis.__siftRan = () => { ran = true; };
    const query = { $where: "globalThis.__siftRan() || true", name: { $regex: "(a+)+$" }, networkId: 1 };

    const stripped = api.stripQueryOperators(query);

    assert.deepStrictEqual(stripped, { name: {}, networkId: 1 });
    [{ name: "a", networkId: 1 }].filter(sift(stripped));
    assert.strictEqual(ran, false);
    delete globalThis.__siftRan;
  });

  it("keeps plain equality filters, including undeclared and dotted keys", () => {
    const query = { serviceId: 1024, "channel.type": "GR", name: ["a", "b"] };

    assert.deepStrictEqual(api.stripQueryOperators(query), query);
  });
});

describe("[api.spec] GET /api/programs passes no operators to findByQuery", () => {
  it("strips $where from the request query", async () => {
    const _ = require("../lib/Mirakurun/_").default;
    const received = [];
    _.program = { findByQuery: q => (received.push(q), []), itemMap: new Map() };
    const { get } = require("../lib/Mirakurun/api/programs");
    const res = { setHeader() {}, status() { return this; }, end() {} };

    await get({ query: { $where: "true", networkId: 1 } }, res);

    assert.deepStrictEqual(received, [{ networkId: 1 }]);
  });
});

describe("[api.spec] channel and service lists ignore query operators", () => {
  const _ = require("../lib/Mirakurun/_").default;
  // the list a handler responds with
  const call = async (handler, req) => {
    let body;
    const original = api.responseJSON;
    api.responseJSON = (res, value) => { body = value; };
    try {
      await handler(req, {});
    } finally {
      api.responseJSON = original;
    }
    return body;
  };
  const channelItem = { type: "GR", channel: "27", name: "ch", getServices: () => [] };

  it("GET /api/channels", async () => {
    _.channel = { items: [channelItem] };
    const { get } = require("../lib/Mirakurun/api/channels");

    assert.strictEqual((await call(get, { query: { $where: "false" } })).length, 1);
  });

  it("GET /api/channels/{type}", async () => {
    _.channel = { findByType: () => [channelItem] };
    const { get } = require("../lib/Mirakurun/api/channels/{type}");

    assert.strictEqual((await call(get, { params: { type: "GR" }, query: { $where: "false" } })).length, 1);
  });

  it("GET /api/services", async () => {
    _.service = { items: [{ networkId: 1, logoId: -1, getOrder: () => 0, export: () => ({ id: 1 }) }] };
    const { get } = require("../lib/Mirakurun/api/services");

    assert.strictEqual((await call(get, { query: { $where: "false" } })).length, 1);
  });
});

describe("[api.spec] PUT /api/job-schedules/{key}/run", () => {
  const _ = require("../lib/Mirakurun/_").default;
  const requested = [];
  // Job#runSchedule() queues the schedule's job and returns true, or returns false for an unknown key
  const job = { schedules: [{ key: "EPG.Gatherer" }], runSchedule: key => (requested.push(key), key === "EPG.Gatherer") };
  const { put } = require("../lib/Mirakurun/api/job-schedules/{key}/run");

  it("answers 404 for an unknown key, as documented", async () => {
    _.job = job;
    requested.length = 0;

    const { status, body } = await request(put, { params: { key: "unknown" } });

    assert.strictEqual(status, 404);
    assert.strictEqual(body.code, 404);
    assert.deepStrictEqual(requested, ["unknown"]);
  });

  it("answers 202 after requesting a known schedule", async () => {
    _.job = job;
    requested.length = 0;
    let status;
    const res = { status(code) { status = code; return this; }, end() {} };

    await put({ params: { key: "EPG.Gatherer" } }, res);

    assert.strictEqual(status, 202);
    assert.deepStrictEqual(requested, ["EPG.Gatherer"]);
  });
});
