const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Service reads LOGO_DATA_DIR_PATH when it is loaded
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-service-"));
process.env.LOGO_DATA_DIR_PATH = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
_.event = { emit: () => true };
const db = require("../lib/Mirakurun/db");
const { Service } = require("../lib/Mirakurun/Service");

describe("[Service.spec] Service.saveLogoData()", () => {
  it("replaces the file instead of rewriting it in place", async () => {
    const logoPath = path.join(dir, "1_1.png");
    fs.writeFileSync(logoPath, "old logo");
    // a reader that opened the old file (e.g. GET /api/services/{id}/logo) must never see a partial file
    const fd = fs.openSync(logoPath, "r");

    try {
      await Service.saveLogoData(1, 1, Buffer.from("new logo"));

      assert.strictEqual(fs.readFileSync(fd, "utf8"), "old logo");
      assert.strictEqual(fs.readFileSync(logoPath, "utf8"), "new logo");
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe("[Service.spec] Service.load(): migration of the deprecated `logoData`", () => {
  const originalLoadServices = db.loadServices;
  before(() => {
    _.channel = { get: (type, channel) => ({ type, channel }) };
  });
  after(() => { db.loadServices = originalLoadServices; });

  const dbService = props => ({
    id: 100002,
    networkId: 1,
    serviceId: 2,
    name: "service",
    channel: { type: "GR", channel: "27" },
    logoData: Buffer.from("logo").toString("base64"),
    ...props
  });
  const load = async (t, services) => {
    t.mock.timers.enable({ apis: ["setTimeout"] }); // the save and the service jobs that load() schedules
    db.loadServices = async () => services;
    const service = new Service();
    await service.load();
    return service;
  };

  it("has written the logo file when load() resolves", async t => {
    const services = [dbService({ logoId: 5 })];

    await load(t, services);

    assert.strictEqual(fs.readFileSync(path.join(dir, "1_5.png"), "utf8"), "logo");
    assert.strictEqual(services[0].logoData, undefined);
  });

  it("starts when a service has `logoData` but no valid `logoId`", async t => {
    const service = await load(t, [dbService({ logoId: undefined }), dbService({ id: 100003, serviceId: 3, logoId: -1 })]);

    assert.strictEqual(service.items.length, 2);
  });

  it("keeps `logoData` and starts when the logo file cannot be written", async t => {
    fs.mkdirSync(path.join(dir, "1_6.png")); // a directory in the way makes the write fail
    const services = [dbService({ logoId: 6 })];

    const service = await load(t, services);

    assert.strictEqual(service.items.length, 1);
    assert.strictEqual(services[0].logoData, Buffer.from("logo").toString("base64"));
  });
});

describe("[Service.spec] Service.flush()", () => {
  const setup = t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const saves = [];
    const originalSave = db.saveServices;
    db.saveServices = async data => { saves.push(data); };
    t.after(() => { db.saveServices = originalSave; });

    const service = Object.create(Service.prototype);
    service._items = [{ export: () => ({ id: 1 }) }];
    return { service, saves };
  };

  it("saves the pending changes at once, and not again when their timer would have run", async t => {
    const { service, saves } = setup(t);

    service.save();
    await service.flush();
    t.mock.timers.tick(10 * 1000);

    assert.deepStrictEqual(saves, [[{ id: 1 }]]);
  });

  it("saves nothing when nothing is pending", async t => {
    const { service, saves } = setup(t);

    await service.flush();
    service.save();
    t.mock.timers.tick(10 * 1000); // saved by its timer
    await service.flush();

    assert.strictEqual(saves.length, 1);
  });
});
