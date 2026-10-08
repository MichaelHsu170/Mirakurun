const { describe, it } = require("node:test");
const assert = require("assert");
const { PassThrough } = require("stream");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
_.service = { get: () => null, findByNetworkId: () => [] };
const TSFilter = require("../lib/Mirakurun/TSFilter").default;

const dii = (downloadId, moduleSize) => ({
  table_id: 0x3B,
  message: {
    downloadId,
    modules: [{ moduleId: 1, moduleVersion: 0, moduleSize, moduleInfo: [{ descriptor_tag: 0x02, text_char: Buffer.from("LOGO-05") }] }]
  }
});
const ddb = (downloadId, blockNumber) => ({
  table_id: 0x3C,
  message: { downloadId, moduleId: 1, moduleVersion: 0, blockNumber, blockDataByte: Buffer.alloc(4066, 1) }
});

describe("[TSFilter.spec] TSFilter", () => {
  it("closing removes only its own listeners from the output", () => {
    const output = new PassThrough();
    const others = () => {}; // e.g. Node's own handlers on an http.ServerResponse
    output.on("finish", others);
    output.on("close", others);
    const filter = new TSFilter({ output });

    filter.close();

    assert.deepStrictEqual(output.listeners("finish"), [others]);
    assert.deepStrictEqual(output.listeners("close"), [others]);
  });

  it("logo download counts a repeated carousel block once", () => {
    const filter = new TSFilter({});
    filter._onDSMCC(0, dii(7, 4066 * 2));

    filter._onDSMCC(0, ddb(7, 0));
    filter._onDSMCC(0, ddb(7, 0));

    assert.strictEqual(filter._dlDataMap.get(7).loadedBytes, 4066);
    filter.close();
  });

  it("logo download refuses a module size far beyond logo data", () => {
    const filter = new TSFilter({});

    filter._onDSMCC(0, dii(8, 64 * 1024 * 1024));

    assert.strictEqual(filter._dlDataMap.has(8), false);
    filter.close();
  });
});
