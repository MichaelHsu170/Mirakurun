const { describe, it } = require("node:test");
const assert = require("assert");
const { spawn } = require("child_process");
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
  it("saves the pending program changes, then exits", { timeout: 30000 }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-server-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const socketPath = path.join(dir, "mirakurun.sock");
    fs.writeFileSync(path.join(dir, "server.yml"), `path: ${socketPath}\n`);
    fs.writeFileSync(path.join(dir, "tuners.yml"), "[]\n");
    fs.writeFileSync(path.join(dir, "channels.yml"), "[]\n");
    // a program that has ended: load() drops it, and the change waits for the 30 s save timer
    const programsPath = path.join(dir, "programs.json");
    fs.writeFileSync(programsPath, JSON.stringify([
      { id: 1, eventId: 1, serviceId: 1, networkId: 1, startAt: 0, duration: 1000, isFree: true }
    ]));

    const child = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
      env: {
        ...process.env,
        SERVER_CONFIG_PATH: path.join(dir, "server.yml"),
        TUNERS_CONFIG_PATH: path.join(dir, "tuners.yml"),
        CHANNELS_CONFIG_PATH: path.join(dir, "channels.yml"),
        SERVICES_DB_PATH: path.join(dir, "services.json"),
        PROGRAMS_DB_PATH: programsPath,
        LOGO_DATA_DIR_PATH: path.join(dir, "logo-data")
      },
      stdio: "ignore"
    });
    t.after(() => child.kill("SIGKILL"));
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));

    // the server listens once the programs are loaded
    while (!fs.existsSync(socketPath)) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    child.kill("SIGTERM");

    assert.deepStrictEqual(await exited, { code: 0, signal: null });
    const saved = JSON.parse(fs.readFileSync(programsPath, "utf8"));
    assert.deepStrictEqual(saved.filter(item => !item.__integrity__), []);
  });
});
