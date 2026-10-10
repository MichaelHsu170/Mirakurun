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
    get: id => store.get(id),
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

  describe("extended_event", () => {
    const { updateObject } = require("../lib/Mirakurun/common");
    const text = s => Buffer.from([0x0E, ...Buffer.from(s)]); // LS1: the alphanumeric set, decoded as full-width
    const extendedEvent = items => ({
      descriptor_tag: 0x4E,
      descriptor_number: 0,
      last_descriptor_number: 0,
      items: Object.entries(items).map(([key, value]) => ({
        item_description_length: key.length + 1,
        item_description_char: text(key),
        item_char: text(value)
      }))
    });
    const gather = (version, items) => new EPG().write(eit(version, [
      event(100, startTime(20, 0), duration(1, 0), [extendedEvent(items)])
    ]));
    // merges like Program.set(), and records whether a set changed the program
    let updates;
    beforeEach(() => {
      updates = [];
      _.program.set = (id, props) => updates.push(updateObject(store.get(id), props));
    });

    it("drops the items that a new version of the descriptors no longer has", () => {
      gather(1, { cast: "A", note: "old" });
      gather(2, { note: "new" });

      assert.deepStrictEqual([...store.values()][0].extended, { "ｎｏｔｅ": "ｎｅｗ" });
    });

    it("leaves an unchanged program unchanged", () => {
      gather(1, { cast: "A", note: "old" });
      updates = [];
      gather(2, { cast: "A", note: "old" });

      assert.deepStrictEqual(updates, [false, false]); // the event's times, then extended
    });
  });
});

describe("[EPG.spec] EPG.write() with the real Program", () => {
  const Program = require("../lib/Mirakurun/Program").default;
  const Event = require("../lib/Mirakurun/Event").default;
  const section = (tableId, sectionNumber, version, events) => ({ ...eit(version, events), table_id: tableId, section_number: sectionNumber });
  const at = time => new Date(`2023-02-25T${time}:00+09:00`).getTime();
  const X = 327360102400001, Y = 327360102400002;
  let program, emitted;
  beforeEach(t => {
    // the real add/set/remove and conflict removal; save() only schedules the emit and the DB write
    program = Object.create(Program.prototype);
    program._itemMap = new Map();
    program._itemMapDeleted = new Map();
    program._emitPrograms = new Map();
    program.save = () => {};
    _.program = program;
    emitted = [];
    t.mock.method(Event, "emit", (resource, type, data) => emitted.push(`${type} ${data.id}`));
  });
  const times = id => {
    const { startAt, duration, _isPresent, _isFollowing } = program.get(id);
    return { startAt, duration, _isPresent, _isFollowing };
  };

  it("keeps the p/f times of the present and following programs when a new stream first sees them in a stale schedule section", () => {
    // the 1st stream: EIT p/f extends X to 21:30, Y follows at 21:30; the schedule still has the old times
    let epg = new EPG();
    epg.write(section(0x50, 0, 5, [event(1, startTime(18, 0), duration(3, 0)), event(2, startTime(21, 0), duration(1, 0))]));
    epg.write(section(0x4E, 0, 9, [event(1, startTime(18, 0), duration(3, 30))]));
    epg.write(section(0x4E, 1, 9, [event(2, startTime(21, 30), duration(1, 0))]));
    epg.end();
    emitted = [];

    // the 2nd stream: the schedule section arrives before p/f
    epg = new EPG();
    epg.write(section(0x50, 0, 5, [event(1, startTime(18, 0), duration(3, 0)), event(2, startTime(21, 0), duration(1, 0))]));
    assert.deepStrictEqual(times(X), { startAt: at("18:00"), duration: 210 * 60 * 1000, _isPresent: true, _isFollowing: undefined });
    assert.deepStrictEqual(times(Y), { startAt: at("21:30"), duration: 60 * 60 * 1000, _isPresent: undefined, _isFollowing: true });

    epg.write(section(0x4E, 0, 9, [event(1, startTime(18, 0), duration(3, 30))]));
    epg.write(section(0x4E, 1, 9, [event(2, startTime(21, 30), duration(1, 0))]));
    assert.deepStrictEqual(emitted, []);
    assert.strictEqual(program.exists(Y), true);
  });

  it("applies a p/f time to a present program at a new stream's first sighting", () => {
    let epg = new EPG();
    epg.write(section(0x4E, 0, 9, [event(1, startTime(18, 0), duration(3, 30))]));
    epg.end();

    // the next stream: the game runs on further, to 22:00
    epg = new EPG();
    epg.write(section(0x4E, 0, 10, [event(1, startTime(18, 0), duration(4, 0))]));

    assert.deepStrictEqual(times(X), { startAt: at("18:00"), duration: 240 * 60 * 1000, _isPresent: true, _isFollowing: undefined });
  });

  it("applies a schedule time change to a program that p/f has not shown", () => {
    let epg = new EPG();
    epg.write(section(0x50, 0, 5, [event(2, startTime(21, 0), duration(1, 0))]));
    epg.end();

    // the next gathering: the broadcaster moved Y to 21:30
    epg = new EPG();
    epg.write(section(0x50, 0, 6, [event(2, startTime(21, 30), duration(1, 0))]));

    assert.deepStrictEqual(times(Y), { startAt: at("21:30"), duration: 60 * 60 * 1000, _isPresent: undefined, _isFollowing: undefined });
  });
});
