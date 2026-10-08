const { describe, it } = require("node:test");
const assert = require("assert");
const { PassThrough } = require("stream");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
_.service = { get: () => null, findByNetworkId: () => [] };
const TSFilter = require("../lib/Mirakurun/TSFilter").default;

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
});
