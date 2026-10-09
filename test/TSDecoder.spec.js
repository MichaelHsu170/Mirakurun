const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
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

describe("[TSDecoder.spec] a decoder that dies before it answers", () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const decoderScript = (t, body) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-decoder-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "decoder.sh");
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };

  it("is counted once when it is killed for not answering", { timeout: 10000 }, async t => {
    const output = new PassThrough();
    output.resume();
    const decoder = new TSDecoder({ command: decoderScript(t, "exec cat > /dev/null"), output });
    const writer = setInterval(() => decoder.write(Buffer.alloc(188 * 10, 0x47)), 100);
    t.after(() => { clearInterval(writer); decoder.end(); });

    await sleep(2200); // killed after 1.5 s, respawned 1.5 s after that

    assert.strictEqual(decoder._deadCount, 1);
  });

  it("is counted once when it exits by itself", { timeout: 10000 }, async t => {
    const output = new PassThrough();
    output.resume();
    // exits after 1 s, before the 1.5 s no-answer timeout of the first write; respawned at 2.5 s
    const decoder = new TSDecoder({ command: decoderScript(t, "sleep 1"), output });
    t.after(() => decoder.end());
    decoder.write(Buffer.alloc(188 * 10, 0x47));

    await sleep(2000);

    assert.strictEqual(decoder._deadCount, 1);
  });
});
