import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { TemplatesRepo } from '../src/repos/templates.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { FakeClock } from '../src/clock.js';
import { Bus } from '../src/bus.js';
import { QuestService } from '../src/services/quests.js';
import { RuleEngine } from '../src/services/rules.js';
import { presetTemplates } from '../src/domain/presets.js';

const T0 = new Date('2026-11-24T10:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

let templates: TemplatesRepo;
let quests: QuestsRepo;
let engine: RuleEngine;
let clock: FakeClock;

const power = (w: string, min: number) =>
  engine.onState({ entityId: 'sensor.washer_power', oldState: null, newState: w, at: at(min) });
const live = () => quests.listByStatus(['open', 'active', 'whenever']);

beforeEach(() => {
  const db = openDb(':memory:');
  migrate(db);
  clock = new FakeClock(T0);
  templates = new TemplatesRepo(db);
  quests = new QuestsRepo(db);
  const svc = new QuestService({ quests, players: new PlayersRepo(db), ledger: new LedgerRepo(db), bus: new Bus(), clock });
  engine = new RuleEngine({ templates, quests: svc });
});

const addPreset = (preset: Parameters<typeof presetTemplates>[0], entityId: string, enabled = true) =>
  presetTemplates(preset, { entityId }).map((t) => templates.create({ ...t, enabled }, clock.now()));

describe('RuleEngine power_below', () => {
  beforeEach(() => {
    addPreset('washer_power', 'sensor.washer_power');
  });

  it('washer quest after power stays low for 3 minutes', () => {
    power('1800', 0);
    power('2', 40);
    engine.tick(at(42));
    expect(live()).toHaveLength(0);
    engine.tick(at(43));
    expect(live()).toHaveLength(1);
    expect(live()[0]!.title).toBe('Hang up the laundry');
  });

  it('short dip between cycles does not finish', () => {
    power('1800', 0);
    power('2', 10);
    power('1500', 11);
    engine.tick(at(20));
    expect(live()).toHaveLength(0);
  });

  it('second wash while laundry quest open does not duplicate', () => {
    power('1800', 0);
    power('2', 10);
    engine.tick(at(13));
    power('1800', 60);
    power('2', 70);
    engine.tick(at(74));
    expect(live()).toHaveLength(1);
  });

  it('unavailable and garbage are ignored', () => {
    power('1800', 0);
    power('unavailable', 5);
    power('abc', 6);
    power('2', 10);
    engine.tick(at(13));
    expect(live()).toHaveLength(1);
  });

  it('fires from onState when the low reading arrives late', () => {
    power('1800', 0);
    power('2', 10);
    power('2', 14);
    expect(live()).toHaveLength(1);
  });
});

describe('RuleEngine state rules', () => {
  it('respects from', () => {
    addPreset('vacuum', 'vacuum.robo');
    const ev = (o: string, n: string) => engine.onState({ entityId: 'vacuum.robo', oldState: o, newState: n, at: at(0) });
    ev('idle', 'docked');
    expect(live()).toHaveLength(0);
    ev('docked', 'docked');
    expect(live()).toHaveLength(0);
    ev('cleaning', 'docked');
    expect(live().map((q) => q.title)).toEqual(['Empty the vacuum bin']);
    ev('cleaning', 'error');
    expect(live().map((q) => q.title).sort()).toEqual(['Empty the vacuum bin', 'Rescue the robot vacuum']);
  });

  it('does not fire on unavailable, or on unavailable with no known good state', () => {
    addPreset('vacuum_bin_sensor', 'binary_sensor.bin');
    const ev = (o: string | null, n: string) =>
      engine.onState({ entityId: 'binary_sensor.bin', oldState: o, newState: n, at: at(0) });
    ev('off', 'unavailable');
    ev('unknown', 'unavailable');
    expect(live()).toHaveLength(0);
    ev('unavailable', 'on');
    expect(live()).toHaveLength(0);
    ev(null, 'on');
    expect(live()).toHaveLength(0);
  });

  it('off -> unavailable -> on still fires', () => {
    addPreset('vacuum_bin_sensor', 'binary_sensor.bin');
    const ev = (o: string | null, n: string) =>
      engine.onState({ entityId: 'binary_sensor.bin', oldState: o, newState: n, at: at(0) });
    ev(null, 'off');
    ev('off', 'unavailable');
    ev('unavailable', 'on');
    expect(live()).toHaveLength(1);
  });

  it('on -> unavailable -> on does not fire again', () => {
    addPreset('vacuum_bin_sensor', 'binary_sensor.bin');
    const ev = (o: string | null, n: string) =>
      engine.onState({ entityId: 'binary_sensor.bin', oldState: o, newState: n, at: at(0) });
    ev('off', 'on');
    expect(live()).toHaveLength(1);
    quests.listByStatus(['open']).forEach((q) => quests.update(q.id, { status: 'done' }));
    ev('on', 'unavailable');
    ev('unavailable', 'on');
    ev('on', 'unknown');
    ev('unknown', 'on');
    expect(live()).toHaveLength(0);
  });

  it('blip uses the last known good state as the effective old state for from', () => {
    addPreset('vacuum', 'vacuum.robo');
    const ev = (o: string | null, n: string) => engine.onState({ entityId: 'vacuum.robo', oldState: o, newState: n, at: at(0) });
    ev('idle', 'cleaning');
    ev('cleaning', 'unavailable');
    ev('unavailable', 'docked');
    expect(live().map((q) => q.title)).toEqual(['Empty the vacuum bin']);
  });
});

describe('RuleEngine entities', () => {
  it('lists enabled rule entities only', () => {
    addPreset('washer_power', 'sensor.b');
    addPreset('vacuum', 'vacuum.a');
    addPreset('dryer_state', 'sensor.off', false);
    templates.create(
      { ...presetTemplates('washer_state', { entityId: 'x' })[0]!, source: 'manual', rule: null },
      clock.now(),
    );
    expect(engine.entities()).toEqual(['sensor.b', 'vacuum.a']);
  });
});

describe('RuleEngine normalize and running_stops', () => {
  const add = (rule: import('../src/domain/types.js').Rule) =>
    templates.create({ ...presetTemplates('washer_state', { entityId: 'x' })[0]!, rule }, clock.now());
  const ev = (e: string, o: string | null, n: string, min: number) =>
    engine.onState({ entityId: e, oldState: o, newState: n, at: at(min) });

  it('normalized state rule matches "Program ended"', () => {
    add({ type: 'state', entityId: 'sensor.m', to: ['program_ended'], normalize: true });
    ev('sensor.m', 'In use', 'Program ended', 0);
    expect(live()).toHaveLength(1);
  });

  const rs: import('../src/domain/types.js').Rule & { type: 'running_stops' } = { type: 'running_stops', entityId: 'binary_sensor.r', runningStates: ['running'], pauseStates: ['pause'], forMinutes: 2 };

  it('fires after forMinutes stopped', () => {
    add(rs);
    ev('binary_sensor.r', null, 'on', 0);
    ev('binary_sensor.r', 'on', 'off', 10);
    engine.tick(at(11));
    expect(live()).toHaveLength(0);
    engine.tick(at(12));
    expect(live()).toHaveLength(1);
  });

  it('pause does not count as stopped; unavailable ignored', () => {
    add(rs);
    ev('binary_sensor.r', null, 'running', 0);
    ev('binary_sensor.r', 'running', 'pause', 5);
    ev('binary_sensor.r', 'pause', 'unavailable', 6);
    engine.tick(at(30));
    expect(live()).toHaveLength(0);
  });

  it('numericAbove counts as running; resume cancels', () => {
    add({ ...rs, entityId: 'sensor.n', numericAbove: 5 });
    ev('sensor.n', null, '10', 0);
    ev('sensor.n', '10', '1', 5);
    ev('sensor.n', '1', '9', 6);
    engine.tick(at(30));
    expect(live()).toHaveLength(0);
    ev('sensor.n', '9', '1', 31);
    engine.tick(at(33));
    expect(live()).toHaveLength(1);
  });

  it('never fires without having run', () => {
    add(rs);
    ev('binary_sensor.r', null, 'off', 0);
    engine.tick(at(30));
    expect(live()).toHaveLength(0);
  });
});
