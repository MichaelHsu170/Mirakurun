const { describe, it, beforeEach } = require("node:test");
const assert = require("assert");

const _ = require("../lib/Mirakurun/_").default;
const EPG = require("../lib/Mirakurun/EPG").default;
const TsDescriptorEventGroup = require("@chinachu/aribts/lib/descriptor/event_group");

// a program store with the parts of Program that EPG uses
let store;
beforeEach(() => {
  store = new Map();
  _.program = {
    exists: id => store.has(id),
    add: item => store.set(item.id, { ...item }),
    set: (id, props) => Object.assign(store.get(id), props)
  };
});

// start_time: MJD 60000 (2023-02-25) + BCD hh mm 00; duration: BCD hh mm 00
const startTime = (h, m) => Buffer.from([0xEA, 0x60, parseInt(String(h), 16), parseInt(String(m), 16), 0x00]);
const duration = (h, m) => Buffer.from([parseInt(String(h), 16), parseInt(String(m), 16), 0x00]);
const eit = (version, events) => ({
  table_id: 0x50,
  section_number: 0,
  original_network_id: 32736,
  service_id: 1024,
  version_number: version,
  events
});
const event = (eventId, start, dur, descriptors = []) => ({
  event_id: eventId,
  start_time: start,
  duration: dur,
  free_CA_mode: 0,
  descriptors
});

describe("[EPG.spec] EPG.write()", () => {
  it("applies a new start time to a program stored by an earlier gathering", () => {
    let epg = new EPG();
    epg.write(eit(1, [event(100, startTime(20, 0), duration(1, 0))]));
    epg.end();

    // the next gathering: the broadcaster moved the event to 21:30 and shortened it
    epg = new EPG();
    epg.write(eit(2, [event(100, startTime(21, 30), duration(0, 30))]));
    epg.write(eit(2, [event(100, startTime(21, 30), duration(0, 30))]));

    assert.strictEqual(store.size, 1);
    const program = [...store.values()][0];
    assert.strictEqual(program.startAt, new Date("2023-02-25T21:30:00+09:00").getTime());
    assert.strictEqual(program.duration, 30 * 60 * 1000);
  });

  it("keeps a stored program whose start time is not known yet", () => {
    let epg = new EPG();
    epg.write(eit(1, [event(100, startTime(20, 0), duration(1, 0))]));

    epg = new EPG();
    epg.write(eit(2, [event(100, Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF]), duration(1, 0))]));

    assert.strictEqual([...store.values()][0].startAt, new Date("2023-02-25T20:00:00+09:00").getTime());
  });

  it("skips an event_group descriptor of a reserved group_type instead of dropping the rest of the section", () => {
    // descriptor_tag 0xD6, length 3, group_type 6 (reserved), event_count 0, 2 private bytes
    const group = new TsDescriptorEventGroup(Buffer.from([0xD6, 0x03, 0x60, 0xAA, 0xBB])).decode();
    const content = { descriptor_tag: 0x54, contents: [{ content_nibble_level_1: 1, content_nibble_level_2: 0, user_nibble_1: 0, user_nibble_2: 0 }] };

    new EPG().write(eit(1, [
      event(1, startTime(20, 0), duration(1, 0), [group, content]),
      event(2, startTime(21, 0), duration(1, 0), [group, content])
    ]));

    assert.strictEqual(store.size, 2);
    for (const program of store.values()) {
      assert.deepStrictEqual(program.genres, [{ lv1: 1, lv2: 0, un1: 0, un2: 0 }]);
      assert.deepStrictEqual(program.relatedItems, []);
    }
  });
});
