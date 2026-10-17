const { describe, it, after } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");

// read by Service when it is loaded
const logoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-logo-"));
process.env.LOGO_DATA_DIR_PATH = logoDir;
after(() => fs.rmSync(logoDir, { recursive: true, force: true }));

const _ = require("../lib/Mirakurun/_").default;
_.config.server = {};
_.service = { get: () => null, findByNetworkId: () => [] };
const TSFilter = require("../lib/Mirakurun/TSFilter").default;

const dii = (downloadId, moduleSize) => ({
  table_id: 0x3B,
  message: {
    downloadId,
    modules: [{ moduleId: 1, moduleVersion: 0, moduleSize, moduleInfo: [{ descriptor_tag: 0x02, text_char: Buffer.from("LOGO-05") }] }]
  }
});
const ddb = (downloadId, blockNumber) => ({
  table_id: 0x3C,
  message: { downloadId, moduleId: 1, moduleVersion: 0, blockNumber, blockDataByte: Buffer.alloc(4066, 1) }
});

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

  it("logo download counts a repeated carousel block once", () => {
    const filter = new TSFilter({});
    filter._onDSMCC(0, dii(7, 4066 * 2));

    filter._onDSMCC(0, ddb(7, 0));
    filter._onDSMCC(0, ddb(7, 0));

    assert.strictEqual(filter._dlDataMap.get(7).loadedBytes, 4066);
    filter.close();
  });

  it("logo download refuses a module size far beyond logo data", () => {
    const filter = new TSFilter({});

    filter._onDSMCC(0, dii(8, 64 * 1024 * 1024));

    assert.strictEqual(filter._dlDataMap.has(8), false);
    filter.close();
  });

  describe("service stream of a sub-channel whose PMT changes", () => {
    // BS sub-channel 142 (PMT PID 0x1F2): first the main channel 141's simulcast PIDs, then its own
    const packet = pid => {
      const p = Buffer.alloc(188, 0);
      p[0] = 0x47;
      p.writeUInt16BE(pid, 1);
      p[3] = 0x10;
      return p;
    };
    const pmt = (version, pcr, pids) => ({
      program_number: 142,
      version_number: version,
      PCR_PID: pcr,
      program_info: [],
      streams: pids.map(pid => ({ stream_type: 0x02, elementary_PID: pid, ES_info: [] }))
    });
    // PIDs of the packets the stream passes on, of those written after the PMT was taken
    const providedAfter = (filter, output, pids) => {
      const got = new Set();
      const onData = chunk => {
        for (let i = 0; i < chunk.length; i += 188) {
          got.add(chunk.readUInt16BE(i + 1) & 0x1FFF);
        }
      };
      output.on("data", onData);
      filter.write(Buffer.concat(pids.map(packet)));
      output.off("data", onData);
      return [...got].sort((a, b) => a - b);
    };
    const start = () => {
      const output = new PassThrough();
      const filter = new TSFilter({ output, networkId: 4, serviceId: 142 });
      filter._onPAT(0, {
        transport_stream_id: 0x40F1,
        programs: [{ program_number: 142, program_map_PID: 0x1F2 }],
        _raw: Buffer.alloc(8)
      });
      filter._onPMT(0x1F2, pmt(0, 0x1FF, [0x140, 0x141]));
      return { output, filter };
    };
    const written = [0x0000, 0x0012, 0x1F2, 0x1FF, 0x140, 0x141, 0x240, 0x241];

    it("passes only the PIDs of the current PMT, so the main channel's stop at the switch", () => {
      const { output, filter } = start();
      assert.deepStrictEqual(providedAfter(filter, output, written), [0x0000, 0x0012, 0x140, 0x141, 0x1F2, 0x1FF]);

      filter._onPMT(0x1F2, pmt(1, 0x2FF, [0x240, 0x241]));

      assert.deepStrictEqual(providedAfter(filter, output, [...written, 0x2FF]), [0x0000, 0x0012, 0x1F2, 0x240, 0x241, 0x2FF]);
      filter.close();
    });

    it("keeps passing the same PIDs when only the PMT version changes", () => {
      const { output, filter } = start();

      filter._onPMT(0x1F2, pmt(1, 0x1FF, [0x140, 0x141]));

      assert.deepStrictEqual(providedAfter(filter, output, written), [0x0000, 0x0012, 0x140, 0x141, 0x1F2, 0x1FF]);
      filter.close();
    });
  });

  describe("logo freshness check of a BS service stream, which also covers the CS networks 6 and 7", () => {
    // whether the stream starts listening to the logo carousel, with these logo files written just now
    const waitsForLogos = async (services, files) => {
      for (const file of fs.readdirSync(logoDir)) {
        fs.rmSync(path.join(logoDir, file));
      }
      for (const file of files) {
        fs.writeFileSync(path.join(logoDir, file), "png");
      }
      _.service.findByNetworkId = networkId => services.filter(service => service.networkId === networkId);
      const filter = new TSFilter({ output: new PassThrough(), networkId: 4, serviceId: 101 });
      filter._essMap.set(929, 0x1FC8); // the TS carries an ESS

      await filter._standbyLogoData();
      const waiting = filter._parser.listenerCount("dsmcc") !== 0;

      filter.close();
      _.service.findByNetworkId = () => [];
      return waiting;
    };

    it("finds a CS logo fresh under its own network id", async () => {
      const services = [{ networkId: 4, logoId: 5 }, { networkId: 7, logoId: 25 }];

      assert.strictEqual(await waitsForLogos(services, ["4_5.png", "7_25.png"]), false);
    });

    it("does not take a BS logo with the same logo id for a CS one", async () => {
      const services = [{ networkId: 4, logoId: 5 }, { networkId: 7, logoId: 5 }];

      assert.strictEqual(await waitsForLogos(services, ["4_5.png"]), true);
    });
  });
});
