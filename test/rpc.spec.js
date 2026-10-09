const { describe, it } = require("node:test");
const assert = require("assert");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
_.event = { on: () => {} };
const log = require("../lib/Mirakurun/log");
const status = require("../lib/Mirakurun/status").default;
const { initRPCNotifier } = require("../lib/Mirakurun/rpc");

describe("[rpc.spec] RPC notifications", () => {
  it("disconnects a client that does not read its notifications, and keeps notifying the others", async () => {
    const socket = (id, bufferedAmount) => ({
      id,
      ws: { bufferedAmount },
      data: new Map([["ip", "192.168.0.2"]]),
      terminated: false,
      terminate() { this.terminated = true; }
    });
    const stalled = socket("stalled", 17 * 1024 * 1024);
    const reading = socket("reading", 16 * 1024 * 1024);
    const notified = [];
    const rpc = {
      sockets: new Map([[stalled.id, stalled], [reading.id, reading]]),
      notifyTo: (room, method, params) => notified.push(room)
    };
    status.rpcCount = 2;
    initRPCNotifier(new Set([rpc]));

    log.info("a log line for the logs room");
    await new Promise(resolve => setTimeout(resolve, 100)); // notifications are sent in batches every 8 ms

    assert.strictEqual(stalled.terminated, true);
    assert.strictEqual(reading.terminated, false);
    assert.deepStrictEqual(notified, ["logs"]);
  });
});
