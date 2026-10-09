const { describe, it } = require("node:test");
const assert = require("assert");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const docs = {
  basePath: "/api",
  paths: {
    "/channels/{type}/{channel}/stream": {
      parameters: [{ in: "path", name: "type", required: true }, { in: "path", name: "channel", required: true }],
      get: { operationId: "getChannelStream", tags: ["stream"], parameters: [{ in: "query", name: "decode" }] }
    }
  }
};

describe("[remote.spec] lib/remote (the process of a remote tuner)", () => {
  it("exits with an error when the remote stream is aborted", { timeout: 10000 }, async t => {
    // a remote Mirakurun that sends some TS packets and then drops the connection (e.g. it restarts)
    const server = http.createServer((req, res) => {
      if (req.url.startsWith("/api/docs")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(docs));
        return;
      }
      res.writeHead(200, { "Content-Type": "video/MP2T" });
      res.write(Buffer.alloc(188 * 10, 0x47));
      setTimeout(() => res.socket.destroy(), 300);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const child = spawn(process.execPath, [path.join(__dirname, "..", "lib", "remote"), "127.0.0.1", String(server.address().port), "GR", "27"], {
      stdio: ["pipe", "pipe", "ignore"]
    });
    t.after(() => child.kill("SIGKILL"));
    let bytes = 0;
    child.stdout.on("data", data => bytes += data.length);

    const code = await new Promise(resolve => child.once("exit", resolve));

    assert.strictEqual(code, 1);
    assert.strictEqual(bytes, 188 * 10);
  });
});
