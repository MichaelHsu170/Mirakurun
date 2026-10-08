const { describe, it } = require("node:test");
const assert = require("assert");
const { PassThrough } = require("stream");

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
const TSDecoder = require("../lib/Mirakurun/TSDecoder").default;

describe("[TSDecoder.spec] TSDecoder", () => {
  it("a decoder command that cannot be started does not raise an uncaught exception", async () => {
    const uncaught = [];
    const onUncaught = err => uncaught.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      const decoder = new TSDecoder({ command: "/nonexistent-decoder", output: new PassThrough() });
      await new Promise(resolve => setTimeout(resolve, 300));
      decoder.end();
    } finally {
      process.off("uncaughtException", onUncaught);
    }

    assert.deepStrictEqual(uncaught, []);
  });

  it("closing removes only its own listeners from the output", async () => {
    const output = new PassThrough();
    const others = () => {}; // e.g. Node's own handlers on an http.ServerResponse
    output.on("finish", others);
    output.on("close", others);
    const decoder = new TSDecoder({ command: "cat", output });

    decoder.end();
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.deepStrictEqual(output.listeners("finish"), [others]);
    assert.deepStrictEqual(output.listeners("close"), [others]);
  });
});
