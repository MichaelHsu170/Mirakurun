const { describe, it, afterEach } = require("node:test");
const assert = require("assert");
const http = require("http");

const { Client } = require("../lib/client");

const docs = {
  basePath: "/api",
  paths: {
    "/channels/{type}/{channel}/stream": {
      parameters: [{ in: "path", name: "type", required: true }, { in: "path", name: "channel", required: true }],
      get: { operationId: "getChannelStream", tags: ["stream"], parameters: [{ in: "query", name: "decode" }] }
    }
  }
};

// a stub Mirakurun: serves /api/docs and answers everything else with handler
let server;
let agent;
const listen = handler => new Promise(resolve => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/docs")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(docs));
      return;
    }
    handler(req, res);
  }).listen(0, "127.0.0.1", () => {
    const client = new Client();
    client.host = "127.0.0.1";
    client.port = server.address().port;
    // one socket: a response that is not consumed keeps it, and the next request then never starts
    client.agent = agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    resolve(client);
  });
});
afterEach(() => {
  agent.destroy();
  server.closeAllConnections();
  server.close();
});

describe("[client.spec] Client.request()", () => {
  it("rejects a JSON body that does not parse instead of throwing an uncaught exception", { timeout: 5000 }, async () => {
    const client = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("<html>proxy error</html>");
    });

    await assert.rejects(client.request("GET", "/status"), err => {
      assert.strictEqual(err.status, 200);
      assert.strictEqual(err.isSuccess, false);
      assert.ok(err.body instanceof SyntaxError, String(err.body));
      return true;
    });
  });

  it("rejects when the response is aborted", { timeout: 5000 }, async () => {
    const client = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      res.write("[{\"id\":1");
      setTimeout(() => res.socket.destroy(), 50);
    });

    await assert.rejects(client.request("GET", "/programs"), err => {
      assert.strictEqual(err.isSuccess, false);
      assert.strictEqual(err.body.code, "ECONNRESET");
      return true;
    });
  });

  it("follows a redirect after consuming the redirect response", { timeout: 5000 }, async () => {
    const client = await listen((req, res) => {
      if (req.url === "/api/a") {
        res.writeHead(302, { Location: "/b", "Content-Type": "text/plain" });
        res.end("moved");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{\"url\":\"" + req.url + "\"}");
      }
    });

    const res = await client.request("GET", "/a");

    assert.deepStrictEqual(res.body, { url: "/api/b" });
  });

  it("stops following a redirect loop", { timeout: 5000 }, async () => {
    let requests = 0;
    const client = await listen((req, res) => {
      requests++;
      res.writeHead(302, { Location: "/loop" });
      res.end();
    });

    await assert.rejects(client.request("GET", "/loop"), err => {
      assert.match(err.body.message, /Too many redirects/);
      return true;
    });
    assert.strictEqual(requests, 6); // the request and 5 redirects
  });
});

describe("[client.spec] Client.call()", () => {
  it("frees the socket of a stream request that is refused", { timeout: 5000 }, async () => {
    const client = await listen((req, res) => {
      res.writeHead(503, "No tuner", { "Content-Type": "application/json" });
      res.end("{\"reason\":\"no tuner\"}");
    });

    await assert.rejects(client.getChannelStream("GR", "27"), /Bad status respond \(503 No tuner\)/);
    await assert.rejects(client.getChannelStream("GR", "27"), /Bad status respond \(503 No tuner\)/);
  });

  it("encodes path parameters", { timeout: 5000 }, async () => {
    const urls = [];
    const client = await listen((req, res) => {
      urls.push(req.url);
      res.writeHead(200, { "Content-Type": "video/MP2T" });
      res.end();
    });

    const stream = await client.getChannelStream("GR", "../a b?#%");
    stream.resume();

    assert.deepStrictEqual(urls, ["/api/channels/GR/..%2Fa%20b%3F%23%25/stream?decode=0"]);
  });
});
