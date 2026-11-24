import { describe, expect, it } from 'vitest';
import { fakeHass, st } from './fake-hass';
import {
  batteries,
  collectFaults,
  displayName,
  heroFor,
  isLightGroup,
  lightStats,
  matches,
  onlineShare,
  restingAllies,
  roomRows,
} from '../../src/arcane/house';

const AREAS = {
  wohnzimmer: { area_id: 'wohnzimmer', name: 'Wohnzimmer' },
  kuche: { area_id: 'kuche', name: 'Küche' },
  buro: { area_id: 'buro', name: 'Büro' },
  schlafzimmer: { area_id: 'schlafzimmer', name: 'Schlafzimmer' },
};

describe('names and matching', () => {
  it('matches wildcards', () => {
    expect(matches('sensor.macbook_battery', ['sensor.macbook_*'])).toBe(true);
    expect(matches('sensor.other', ['sensor.macbook_*'])).toBe(false);
    expect(matches('sensor.a.b', ['sensor.a.b'])).toBe(true);
    expect(matches('sensor.axb', ['sensor.a.b'])).toBe(false);
  });
  it('prefers device names and strips the sensor suffix from friendly names', () => {
    const h = fakeHass({
      states: {
        'sensor.a_battery': st('50', { friendly_name: 'Thermostat Büro Battery' }),
        'sensor.b': st('1', { friendly_name: 'Plain' }),
        'sensor.c': st('1', { friendly_name: 'Cnamed' }),
        'sensor.d': st('1'),
      },
      entities: { 'sensor.c': { device_id: 'dev', platform: 'x' }, 'sensor.b': { device_id: 'dev2' } },
      devices: { dev: { id: 'dev', name: 'Dev Name', name_by_user: 'Mine' }, dev2: { id: 'dev2', name: 'Raw' } },
    });
    expect(displayName(h, 'sensor.a_battery')).toBe('Thermostat Büro');
    expect(displayName(h, 'sensor.c')).toBe('Mine');
    expect(displayName(h, 'sensor.b')).toBe('Raw');
    expect(displayName(h, 'sensor.d')).toBe('sensor.d');
  });
});

describe('lightStats', () => {
  it('skips groups and unavailable lights', () => {
    const h = fakeHass({
      states: {
        'light.alle_lichter_im_haus': st('on', { entity_id: ['light.wohnzimmer', 'light.lamp'] }),
        'light.wohnzimmer_spots': st('on'),
        'light.wohnzimmer': st('on'),
        'light.lamp': st('off'),
        'light.gone': st('unavailable'),
      },
      entities: { 'light.wohnzimmer_spots': { platform: 'group' } },
    });
    expect(isLightGroup(h, 'light.alle_lichter_im_haus')).toBe(true);
    expect(isLightGroup(h, 'light.wohnzimmer_spots')).toBe(true);
    expect(isLightGroup(h, 'light.lamp')).toBe(false);
    expect(lightStats(h)).toEqual({ on: 1, total: 2 });
    expect(lightStats(h, (id) => id === 'light.lamp')).toEqual({ on: 0, total: 1 });
  });
});

describe('onlineShare', () => {
  const states: Record<string, ReturnType<typeof st>> = { 'automation.x': st('unavailable') };
  const entities: Record<string, { platform: string }> = {};
  for (let i = 0; i < 9; i++) {
    states[`sensor.s${i}`] = st(i === 0 ? 'unavailable' : '1');
    entities[`sensor.s${i}`] = { platform: i < 4 ? 'tuya' : 'hue' };
  }
  const h = fakeHass({ states, entities });
  it('skips housekeeping domains', () => {
    expect(onlineShare(h, {})).toEqual({ online: 8, total: 9, pct: 89 });
  });
  it('narrows by integration and domain', () => {
    expect(onlineShare(h, { integrations: ['tuya'] })).toEqual({ online: 3, total: 4, pct: 75 });
    expect(onlineShare(h, { domains: ['automation'] })).toEqual({ online: 0, total: 1, pct: 0 });
  });
  it('reports null for nothing to measure', () => {
    expect(onlineShare(fakeHass(), {})).toEqual({ online: 0, total: 0, pct: null });
  });
});

describe('collectFaults', () => {
  const opts = { batteryThreshold: 20, exclude: [] as string[] };

  it('merges an impossible temperature into the critical battery scroll', () => {
    const h = fakeHass({
      states: {
        'sensor.thermostat_buro_battery': st('0', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Thermostat Büro Battery' }),
        'sensor.thermostat_buro_temperature': st('-327.7', { device_class: 'temperature', unit_of_measurement: '°C' }),
      },
      entities: {
        'sensor.thermostat_buro_battery': { device_id: 'd1' },
        'sensor.thermostat_buro_temperature': { device_id: 'd1' },
      },
      devices: { d1: { id: 'd1', name: 'Thermostat Büro' } },
    });
    const r = collectFaults(h, opts);
    expect(r.faults).toHaveLength(1);
    expect(r.faults[0]).toMatchObject({
      id: 'battery:sensor.thermostat_buro_battery',
      kind: 'battery_critical',
      title: 'Change the Thermostat Büro battery',
      detail: 'Battery 0 % · it reads -327.7 °C until then',
      xp: 30,
      minutes: 5,
      entityIds: ['sensor.thermostat_buro_battery', 'sensor.thermostat_buro_temperature'],
    });
    expect(r.checked).toBe(2);
    expect(r.faultyEntities).toBe(2);
    expect(r.health).toBe(0);
  });

  it('classifies low batteries by threshold', () => {
    const h = fakeHass({
      states: {
        'sensor.a_battery': st('14', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'A Battery' }),
        'sensor.b_battery': st('25', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'B Battery' }),
        'binary_sensor.c_battery': st('on', { device_class: 'battery', friendly_name: 'C Battery' }),
      },
    });
    const low = collectFaults(h, opts).faults;
    expect(low.map((f) => [f.id, f.kind, f.xp, f.title])).toEqual([
      ['battery:sensor.a_battery', 'battery_low', 5, 'Charge or change the A battery'],
      ['battery:binary_sensor.c_battery', 'battery_low', 5, 'Charge or change the C battery'],
    ]);
    expect(low[0].detail).toBe('Battery 14 %');
    expect(low[1].detail).toBe('Battery is low');
    const ids = collectFaults(h, { ...opts, batteryThreshold: 30 }).faults.map((f) => f.id);
    expect(ids).toContain('battery:sensor.b_battery');
  });

  it('groups problem sensors by device model', () => {
    const h = fakeHass({
      states: {
        'binary_sensor.v1_problem': st('on', { device_class: 'problem' }),
        'binary_sensor.v2_problem': st('on', { device_class: 'problem' }),
        'binary_sensor.v3_problem': st('on', { device_class: 'problem' }),
        'binary_sensor.v4_problem': st('off', { device_class: 'problem' }),
      },
      areas: AREAS,
      entities: {
        'binary_sensor.v1_problem': { device_id: 'a' },
        'binary_sensor.v2_problem': { device_id: 'b' },
        'binary_sensor.v3_problem': { device_id: 'c' },
        'binary_sensor.v4_problem': { device_id: 'd' },
      },
      devices: {
        a: { id: 'a', model: 'Valve', area_id: 'wohnzimmer' },
        b: { id: 'b', model: 'Valve', area_id: 'wohnzimmer' },
        c: { id: 'c', model: 'Valve', area_id: 'kuche' },
        d: { id: 'd', model: 'Valve', area_id: 'kuche' },
      },
    });
    const r = collectFaults(h, opts);
    expect(r.faults).toHaveLength(1);
    expect(r.faults[0]).toMatchObject({
      id: 'problem:model:Valve',
      kind: 'problem',
      title: 'Check 3 Valve devices',
      detail: 'Wohnzimmer ×2 · Küche report a small problem',
      xp: 20,
      minutes: 10,
    });
    expect(r.faults[0].entityIds).toHaveLength(3);
    expect(r.checked).toBe(4);
    expect(r.faultyEntities).toBe(3);
    expect(r.health).toBe(25);
  });

  it('writes a single problem with and without an area', () => {
    const h = fakeHass({
      states: {
        'binary_sensor.pump_problem': st('on', { device_class: 'problem', friendly_name: 'Pump' }),
        'binary_sensor.fan_problem': st('on', { device_class: 'problem', friendly_name: 'Fan' }),
      },
      areas: AREAS,
      entities: { 'binary_sensor.pump_problem': { device_id: 'p' } },
      devices: { p: { id: 'p', area_id: 'kuche', model: 'Pump 1' } },
    });
    const byId = Object.fromEntries(collectFaults(h, opts).faults.map((f) => [f.id, f]));
    expect(byId['problem:binary_sensor.pump_problem']).toMatchObject({ title: 'Check Pump', detail: 'Küche report a small problem', area: 'Küche' });
    expect(byId['problem:binary_sensor.fan_problem']).toMatchObject({ title: 'Check Fan', detail: 'Reports a small problem', area: null });
  });

  it('reports updates and impossible temperatures', () => {
    const h = fakeHass({
      states: {
        'update.home_assistant_core_update': st('on', { installed_version: '2026.11.1', latest_version: '2026.11.2', friendly_name: 'Home Assistant Core Update' }),
        'update.quiet': st('on', { friendly_name: 'Quiet' }),
        'update.done': st('off'),
        'sensor.oven_temperature': st('250', { device_class: 'temperature', unit_of_measurement: '°F', friendly_name: 'Oven Temperature' }),
        'sensor.hot_water': st('100', { device_class: 'temperature', unit_of_measurement: '°C', friendly_name: 'Hot water' }),
      },
    });
    const r = collectFaults(h, opts);
    const byId = Object.fromEntries(r.faults.map((f) => [f.id, f]));
    expect(byId['update:update.home_assistant_core_update']).toMatchObject({ kind: 'update', detail: '2026.11.1 → 2026.11.2 ready', xp: 10 });
    expect(byId['update:update.quiet'].detail).toBe('Update ready');
    expect(byId['temperature:sensor.oven_temperature']).toMatchObject({
      kind: 'temperature',
      title: 'Check the Oven sensor',
      detail: "It reads 121.1 °C, which can't be right",
      xp: 10,
      minutes: 5,
    });
    expect(byId['temperature:sensor.hot_water']).toBeUndefined();
    expect(r.checked).toBe(5);
  });

  it('honours exclude and orders critical, problem, temperature, low, update', () => {
    const h = fakeHass({
      states: {
        'update.u': st('on', { friendly_name: 'U' }),
        'sensor.low_battery': st('15', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Low Battery' }),
        'sensor.t_temperature': st('250', { device_class: 'temperature', unit_of_measurement: '°F', friendly_name: 'T Temperature' }),
        'binary_sensor.p_problem': st('on', { device_class: 'problem', friendly_name: 'P' }),
        'sensor.crit_battery': st('3', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Crit Battery' }),
        'sensor.macbook_battery': st('1', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'MacBook Battery' }),
      },
    });
    const r = collectFaults(h, { batteryThreshold: 20, exclude: ['sensor.macbook_*'] });
    expect(r.faults.map((f) => f.kind)).toEqual(['battery_critical', 'problem', 'temperature', 'battery_low', 'update']);
    expect(r.faults.some((f) => f.entityIds.includes('sensor.macbook_battery'))).toBe(false);
    expect(r.checked).toBe(5);
  });

  it('computes health from distinct faulty entities', () => {
    const states: Record<string, ReturnType<typeof st>> = {};
    for (let i = 0; i < 10; i++) {
      states[`sensor.b${i}_battery`] = st(i < 3 ? '10' : '90', { device_class: 'battery', unit_of_measurement: '%', friendly_name: `B${i} Battery` });
    }
    const r = collectFaults(fakeHass({ states }), opts);
    expect(r.checked).toBe(10);
    expect(r.faultyEntities).toBe(3);
    expect(r.health).toBe(70);
  });

  it('is fully healthy with nothing to inspect', () => {
    expect(collectFaults(fakeHass({ states: { 'sensor.x': st('3') } }), opts)).toEqual({ faults: [], checked: 0, faultyEntities: 0, health: 100 });
  });
});

describe('restingAllies', () => {
  const states: Record<string, ReturnType<typeof st>> = {};
  const entities: Record<string, { platform: string }> = {};
  const add = (platform: string, total: number, awake: number) => {
    for (let i = 0; i < total; i++) {
      const id = `sensor.${platform}_${i}`;
      states[id] = st(i < awake ? '1' : 'unavailable');
      entities[id] = { platform };
    }
  };
  add('fritz', 122, 0);
  add('tuya', 20, 0);
  add('music_assistant', 8, 2);
  add('hue', 10, 9);
  const h = fakeHass({ states, entities });

  it('lists resting integrations, most resting first, with friendly names', () => {
    expect(restingAllies(h, { ignore: [], minEntities: 1 })).toEqual([
      { platform: 'fritz', name: 'FRITZ!Box', awake: 0, total: 122 },
      { platform: 'tuya', name: 'Tuya', awake: 0, total: 20 },
      { platform: 'music_assistant', name: 'Music Assistant', awake: 2, total: 8 },
    ]);
  });
  it('supports ignore, names and minEntities', () => {
    expect(restingAllies(h, { ignore: ['tuya'], minEntities: 1 }).map((a) => a.platform)).toEqual(['fritz', 'music_assistant']);
    expect(restingAllies(h, { ignore: [], minEntities: 1, names: { fritz: 'Router' } })[0].name).toBe('Router');
    expect(restingAllies(h, { ignore: [], minEntities: 50 }).map((a) => a.platform)).toEqual(['fritz']);
  });
  it('title-cases unknown platforms', () => {
    const g = fakeHass({ states: { 'sensor.a': st('unavailable') }, entities: { 'sensor.a': { platform: 'home_connect' } } });
    expect(restingAllies(g, { ignore: [], minEntities: 1 })[0].name).toBe('Home Connect');
  });
});

describe('batteries', () => {
  const h = fakeHass({
    states: {
      'sensor.a_battery': st('80', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Alpha Battery' }),
      'sensor.b_battery': st('0', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Beta Battery' }),
      'sensor.c_battery': st('14', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Gamma Battery' }),
      'sensor.d_battery': st('unknown', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Delta Battery' }),
      'sensor.macbook_battery': st('1', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'MacBook Battery' }),
    },
  });
  it('sorts low first and skips non-numeric', () => {
    expect(batteries(h, { exclude: ['sensor.macbook_*'], limit: 10 })).toEqual([
      { entityId: 'sensor.b_battery', name: 'Beta', pct: 0 },
      { entityId: 'sensor.c_battery', name: 'Gamma', pct: 14 },
      { entityId: 'sensor.a_battery', name: 'Alpha', pct: 80 },
    ]);
  });
  it('limits and accepts explicit entities', () => {
    expect(batteries(h, { exclude: ['sensor.macbook_*'], limit: 2 })).toHaveLength(2);
    expect(batteries(h, { entities: ['sensor.a_battery', 'sensor.d_battery'], exclude: [], limit: 5 }).map((b) => b.entityId)).toEqual(['sensor.a_battery']);
  });
});

describe('roomRows', () => {
  const h = fakeHass({
    states: {
      'light.wz1': st('on'),
      'light.wz2': st('off'),
      'light.wz_gruppe': st('on', { entity_id: ['light.wz1', 'light.wz2'] }),
      'light.kuche': st('on'),
      'light.kuche2': st('on'),
      'sensor.wz_temp': st('21.5', { device_class: 'temperature', unit_of_measurement: '°C' }),
      'sensor.wz_temp_b': st('99999', { device_class: 'temperature', unit_of_measurement: '°C' }),
      'sensor.kuche_temp': st('unavailable', { device_class: 'temperature', unit_of_measurement: '°C' }),
      'sensor.buro_temp': st('-327.7', { device_class: 'temperature', unit_of_measurement: '°C' }),
      'sensor.buro_battery': st('0', { device_class: 'battery', unit_of_measurement: '%' }),
      'sensor.override': st('18', { device_class: 'temperature', unit_of_measurement: '°C' }),
    },
    areas: AREAS,
    entities: {
      'light.wz1': { area_id: 'wohnzimmer' },
      'light.wz2': { area_id: 'wohnzimmer' },
      'light.wz_gruppe': { area_id: 'wohnzimmer', platform: 'group' },
      'light.kuche': { device_id: 'dk' },
      'light.kuche2': { area_id: 'kuche' },
      'sensor.wz_temp_b': { area_id: 'wohnzimmer' },
      'sensor.wz_temp': { area_id: 'wohnzimmer' },
      'sensor.kuche_temp': { area_id: 'kuche' },
      'sensor.buro_temp': { device_id: 'db' },
      'sensor.buro_battery': { device_id: 'db' },
    },
    devices: { dk: { id: 'dk', area_id: 'kuche' }, db: { id: 'db', area_id: 'buro' } },
  });
  const opts = { batteryThreshold: 20 };

  it('keeps the configured order and matches by id or name', () => {
    const rows = roomRows(h, { ...opts, areas: ['Wohnzimmer', 'kuche', 'Büro', 'Nowhere'] });
    expect(rows.map((r) => r.areaId)).toEqual(['wohnzimmer', 'kuche', 'buro']);
    expect(rows[0]).toEqual({ areaId: 'wohnzimmer', name: 'Wohnzimmer', temp: 21.5, tempState: 'ok', lit: 1 });
    expect(rows[1]).toMatchObject({ temp: null, tempState: 'check', lit: 2 });
    expect(rows[2]).toMatchObject({ temp: null, tempState: 'battery', lit: 0 });
  });
  it('defaults to all areas by name and reports rooms without a sensor', () => {
    const rows = roomRows(h, opts);
    expect(rows.map((r) => r.name)).toEqual(['Büro', 'Küche', 'Schlafzimmer', 'Wohnzimmer']);
    expect(rows.find((r) => r.areaId === 'schlafzimmer')).toMatchObject({ tempState: 'none', temp: null, lit: 0 });
  });
  it('supports object entries with a name and temperature override', () => {
    const rows = roomRows(h, { ...opts, areas: [{ area: 'schlafzimmer', name: 'Bedroom', temperature: 'sensor.override' }] });
    expect(rows).toEqual([{ areaId: 'schlafzimmer', name: 'Bedroom', temp: 18, tempState: 'ok', lit: 0 }]);
  });
});

describe('heroFor', () => {
  const player = (pid: string, person: string, name: string, into: number, toNext: number, streak = '0', keys = 0) => ({
    [`sensor.${pid}_level`]: st('3', { cuest_kind: 'level', cuest_player_id: pid, ha_person: person, player_name: name, title: 'Apprentice', into_level: into, to_next: toNext }),
    [`sensor.${pid}_streak`]: st(streak, { cuest_kind: 'streak', cuest_player_id: pid, ha_person: person, chest_keys: keys }),
  });
  const ents = (...ids: string[]) => Object.fromEntries(ids.map((i) => [i, { platform: 'cuest' }]));
  const states = {
    ...player('p1', 'person.ann', 'Ann', 340, 400, '4', 2),
    ...player('p2', 'person.bob', 'Bob', 10, 100, '1', 1),
    'person.ann': st('home', { user_id: 'u-ann' }),
    'person.bob': st('home', { user_id: 'u-bob' }),
  };
  const entities = ents('sensor.p1_level', 'sensor.p1_streak', 'sensor.p2_level', 'sensor.p2_streak');

  it('uses to_next as the level span', () => {
    const hero = heroFor(fakeHass({ states, entities }), 'p1');
    expect(hero).toEqual({ name: 'Ann', level: 3, title: 'Apprentice', into: 340, span: 400, remaining: 60, pct: 85, streak: 4, chestKeys: 2 });
  });
  it('prefers the player linked to the signed-in user, then the first', () => {
    expect(heroFor(fakeHass({ states, entities, user: { id: 'u-bob', is_admin: false } }))?.name).toBe('Bob');
    expect(heroFor(fakeHass({ states, entities, user: { id: 'nobody', is_admin: false } }))?.name).toBe('Ann');
    expect(heroFor(fakeHass({ states, entities, user: { id: 'u-bob', is_admin: false } }), 'p1')?.name).toBe('Ann');
  });
  it('is null without Cuest sensors', () => {
    expect(heroFor(fakeHass())).toBeNull();
  });
});
