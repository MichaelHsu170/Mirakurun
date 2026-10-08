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
