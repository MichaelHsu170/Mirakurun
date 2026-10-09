const { describe, it } = require("node:test");
const assert = require("assert");
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("[server.spec] startup with an empty tuners config", () => {
  it("exits with an error so the container can be restarted", { timeout: 30000 }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-server-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "tuners.yml"), "");

    const child = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
      env: {
        ...process.env,
        SERVER_CONFIG_PATH: path.join(dir, "server.yml"),
        TUNERS_CONFIG_PATH: path.join(dir, "tuners.yml"),
        CHANNELS_CONFIG_PATH: path.join(dir, "channels.yml"),
        SERVICES_DB_PATH: path.join(dir, "services.json"),
        PROGRAMS_DB_PATH: path.join(dir, "programs.json"),
        LOGO_DATA_DIR_PATH: path.join(dir, "logo-data")
      },
      stdio: "ignore"
    });
    t.after(() => child.kill("SIGKILL"));

    const code = await new Promise(resolve => child.once("exit", resolve));

    assert.strictEqual(code, 1);
  });
});

describe("[server.spec] SIGTERM", () => {
  // Starts lib/server.js on scratch files in which load() leaves a pending change: a program that has
  // ended (dropped; saved by the 30 s timer) and a service whose channel is not configured (dropped;
  // saved by the 10 s timer). `failSave` names the files whose save fails: their `.tmp` file is a
  // directory, so writing it fails with EISDIR, also as root. `hangSave` names the files whose save
  // never finishes: their `.tmp` file is a FIFO with no reader, so opening it blocks. Sends SIGTERM once
  // the server listens.
  async function stopServer(t, failSave = [], hangSave = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-server-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const socketPath = path.join(dir, "mirakurun.sock");
    fs.writeFileSync(path.join(dir, "server.yml"), `path: ${socketPath}\n`);
    fs.writeFileSync(path.join(dir, "tuners.yml"), "[]\n");
    fs.writeFileSync(path.join(dir, "channels.yml"), "[]\n");
    const programsPath = path.join(dir, "programs.json");
    fs.writeFileSync(programsPath, JSON.stringify([
      { id: 1, eventId: 1, serviceId: 1, networkId: 1, startAt: 0, duration: 1000, isFree: true }
    ]));
    const servicesPath = path.join(dir, "services.json");
    fs.writeFileSync(servicesPath, JSON.stringify([
      { id: 100001, serviceId: 1, networkId: 1, name: "S", type: 1, logoId: -1, channel: { type: "GR", channel: "27" } }
    ]));
    for (const name of failSave) {
      fs.mkdirSync(path.join(dir, `${name}.tmp`));
    }
    for (const name of hangSave) {
      execFileSync("mkfifo", [path.join(dir, `${name}.tmp`)]);
    }

    const child = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
      env: {
        ...process.env,
        SERVER_CONFIG_PATH: path.join(dir, "server.yml"),
        TUNERS_CONFIG_PATH: path.join(dir, "tuners.yml"),
        CHANNELS_CONFIG_PATH: path.join(dir, "channels.yml"),
        SERVICES_DB_PATH: servicesPath,
        PROGRAMS_DB_PATH: programsPath,
        LOGO_DATA_DIR_PATH: path.join(dir, "logo-data")
      },
      stdio: ["ignore", "ignore", "pipe"]
    });
    t.after(() => child.kill("SIGKILL"));
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const exited = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));

    // the server listens once the programs are loaded
    while (!fs.existsSync(socketPath)) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    child.kill("SIGTERM");

    const exit = await exited;
    const saved = file => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).filter(item => !item.__integrity__);
    return { exit, stderr, saved, dir };
  }

  it("saves the pending program and service changes, then exits", { timeout: 30000 }, async t => {
    const { exit, saved } = await stopServer(t);

    assert.deepStrictEqual(exit, { code: 0, signal: null });
    assert.deepStrictEqual(saved("programs.json"), []);
    assert.deepStrictEqual(saved("services.json"), []);
  });

  it("still saves the programs when the services save fails, and logs the failure", { timeout: 30000 }, async t => {
    const { exit, stderr, saved, dir } = await stopServer(t, ["services.json"]);

    assert.deepStrictEqual(exit, { code: 0, signal: null });
    assert.deepStrictEqual(saved("programs.json"), []);
    assert.ok(stderr.includes(`EISDIR: illegal operation on a directory, open '${dir}/services.json.tmp'`), stderr);
  });

  it("logs both failures when both saves fail", { timeout: 30000 }, async t => {
    const { exit, stderr, dir } = await stopServer(t, ["services.json", "programs.json"]);

    assert.deepStrictEqual(exit, { code: 0, signal: null });
    assert.ok(stderr.includes(`open '${dir}/services.json.tmp'`), stderr);
    assert.ok(stderr.includes(`open '${dir}/programs.json.tmp'`), stderr);
  });

  it("kills itself after 25 s when a save hangs", { timeout: 90000 }, async t => {
    const started = Date.now();
    const { exit, stderr } = await stopServer(t, [], ["programs.json"]);

    assert.deepStrictEqual(exit, { code: null, signal: "SIGKILL" });
    assert.ok(stderr.includes("saving pending changes timed out, exiting without them"), stderr);
    assert.ok(Date.now() - started >= 25000, "waited for the save for 25 s");
  });
});
