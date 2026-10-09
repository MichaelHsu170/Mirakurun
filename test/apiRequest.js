const http = require("http");

/**
 * Runs an API handler on a real http.ServerResponse, which (unlike a stub) throws on an invalid status
 * message, and returns the status code and the parsed JSON body. A request left open fails after 3 s.
 */
module.exports = async function request(handler, req = {}) {
  const server = http.createServer((_req, res) => handler({ query: {}, ...req }, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(3000) });
    return { status: res.status, body: await res.json() };
  } finally {
    server.closeAllConnections();
    server.close();
  }
};
