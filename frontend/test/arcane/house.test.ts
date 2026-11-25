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
  it('leaves excluded entities out, with * wildcards', () => {
    expect(onlineShare(h, { exclude: ['sensor.s0'] })).toEqual({ online: 8, total: 8, pct: 100 });
    expect(onlineShare(h, { exclude: ['sensor.s*'] })).toEqual({ online: 0, total: 0, pct: null });
    expect(onlineShare(h, { integrations: ['tuya'], exclude: ['sensor.s1'] })).toEqual({ online: 2, total: 3, pct: 67 });
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
    expect(byId['problem:binary_sensor.pump_problem']).toMatchObject({ title: 'Check Pump', detail: 'Küche reports a small problem' });
    expect(byId['problem:binary_sensor.fan_problem']).toMatchObject({ title: 'Check Fan', detail: 'Reports a small problem' });
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

describe('collectFaults short forms for the compact teaser', () => {
  const opts = { batteryThreshold: 20, exclude: [] as string[] };
  const bat = (v: string) => st(v, { device_class: 'battery', unit_of_measurement: '%' });

  it('battery: "{device} at {n} %" from the device model, without the impossible-reading hint', () => {
    const h = fakeHass({
      states: {
        'sensor.buro_battery': bat('0'),
        'sensor.buro_temperature': st('-327.7', { device_class: 'temperature', unit_of_measurement: '°C' }),
        'sensor.mac_battery': bat('14'),
        'binary_sensor.door_battery': st('on', { device_class: 'battery' }),
      },
      entities: { 'sensor.buro_battery': { device_id: 'd1' }, 'sensor.buro_temperature': { device_id: 'd1' }, 'sensor.mac_battery': { device_id: 'd2' }, 'binary_sensor.door_battery': { device_id: 'd3' } },
      devices: { d1: { id: 'd1', name: 'Büro', model: 'Thermostat' }, d2: { id: 'd2', name: 'MacBook' }, d3: { id: 'd3', name: 'Door', model: 'Contact' } },
    });
    const byId = Object.fromEntries(collectFaults(h, opts).faults.map((f) => [f.id, f]));
    expect(byId['battery:sensor.buro_battery']).toMatchObject({
      title: 'Change the Büro battery',
      detail: 'Battery 0 % · it reads -327.7 °C until then',
      short: { title: 'Change the Büro battery', detail: 'Thermostat at 0 %' },
    });
    expect(byId['battery:sensor.mac_battery'].short).toEqual({ title: 'Charge or change the MacBook battery', detail: 'Battery at 14 %' });
    expect(byId['battery:binary_sensor.door_battery'].short).toEqual({ title: 'Charge or change the Door battery', detail: 'Battery is low' });
  });

  it('grouped problems: "Check {n} {models}" with the places only', () => {
    const mk = (model: string, areas: (string | undefined)[]) => {
      const states: Record<string, ReturnType<typeof st>> = {};
      const entities: Record<string, { device_id: string }> = {};
      const devices: Record<string, { id: string; model: string; area_id?: string }> = {};
      areas.forEach((a, i) => {
        states[`binary_sensor.p${i}`] = st('on', { device_class: 'problem' });
        entities[`binary_sensor.p${i}`] = { device_id: `d${i}` };
        devices[`d${i}`] = { id: `d${i}`, model, ...(a ? { area_id: a } : {}) };
      });
      return collectFaults(fakeHass({ states, entities, devices, areas: AREAS }), opts).faults[0];
    };
    const valves = mk('Thermostat valve', ['wohnzimmer', 'wohnzimmer', 'kuche']);
    expect(valves.title).toBe('Check 3 Thermostat valve devices');
    expect(valves.detail).toBe('Wohnzimmer ×2 · Küche report a small problem');
    expect(valves.short).toEqual({ title: 'Check 3 thermostat valves', detail: 'Wohnzimmer ×2 · Küche' });
    expect(mk('Switch', ['kuche', 'kuche']).short.title).toBe('Check 2 switches');
    expect(mk('Relay', ['kuche', 'kuche']).short.title).toBe('Check 2 relays');
    expect(mk('Battery', ['kuche', 'kuche']).short.title).toBe('Check 2 batteries');
    expect(mk('TRVZB', ['kuche', 'kuche']).short.title).toBe('Check 2 TRVZBs');
    expect(mk('Valve', [undefined, undefined]).short).toEqual({ title: 'Check 2 valves', detail: 'Reports a small problem' });
  });

  it('product-code models fall back to plain words', () => {
    const one = (model: string) => {
      const h = fakeHass({
        states: {
          'sensor.x_battery': bat('3'),
          'binary_sensor.p1': st('on', { device_class: 'problem' }),
          'binary_sensor.p2': st('on', { device_class: 'problem' }),
        },
        entities: { 'sensor.x_battery': { device_id: 'b' }, 'binary_sensor.p1': { device_id: 'p1' }, 'binary_sensor.p2': { device_id: 'p2' } },
        devices: { b: { id: 'b', name: 'Hall', model }, p1: { id: 'p1', model, area_id: 'kuche' }, p2: { id: 'p2', model, area_id: 'kuche' } },
        areas: AREAS,
      });
      const f = collectFaults(h, opts).faults;
      return [f.find((x) => x.kind === 'battery_critical')!.short.detail, f.find((x) => x.kind === 'problem')!.short.title];
    };
    for (const code of ['TS0601', 'lumi.sensor_ht', 'SNZB-02D', 'Thermostat radiator valve X', 'TRV_2']) {
      expect(one(code), code).toEqual(['Battery at 3 %', 'Check 2 devices']);
    }
    expect(one('Smoke-detector')).toEqual(['Smoke-detector at 3 %', 'Check 2 smoke-detectors']);
    expect(one('Heizkörperthermostat')).toEqual(['Heizkörperthermostat at 3 %', 'Check 2 heizkörperthermostats']);
  });

  it('other quests keep their full wording', () => {
    const h = fakeHass({
      states: {
        'binary_sensor.pump_problem': st('on', { device_class: 'problem', friendly_name: 'Pump' }),
        'update.core': st('on', { friendly_name: 'Home Assistant update' }),
        'sensor.t': st('-400', { device_class: 'temperature', unit_of_measurement: '°C', friendly_name: 'Probe' }),
      },
    });
    for (const f of collectFaults(h, opts).faults) expect(f.short).toEqual({ title: f.title, detail: f.detail });
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

describe('boundaries', () => {
  const bat = (v: string, n: string) => st(v, { device_class: 'battery', unit_of_measurement: '%', friendly_name: `${n} Battery` });
  const temp = (v: string) => st(v, { device_class: 'temperature', unit_of_measurement: '°C', friendly_name: 'T Temperature' });
  const opts = { batteryThreshold: 20, exclude: [] as string[] };
  const kinds = (states: Record<string, ReturnType<typeof st>>) => collectFaults(fakeHass({ states }), opts).faults.map((f) => f.kind);

  it('critical battery is at most 5 percent', () => {
    expect(kinds({ 'sensor.a_battery': bat('5', 'A') })).toEqual(['battery_critical']);
    expect(kinds({ 'sensor.a_battery': bat('6', 'A') })).toEqual(['battery_low']);
    expect(kinds({ 'sensor.a_battery': bat('20', 'A') })).toEqual(['battery_low']);
    expect(kinds({ 'sensor.a_battery': bat('21', 'A') })).toEqual([]);
  });

  it('groups exactly two devices of one model, never one', () => {
    const mk = (n: number) => {
      const states: Record<string, ReturnType<typeof st>> = {};
      const entities: Record<string, { device_id: string }> = {};
      const devices: Record<string, { id: string; model: string }> = {};
      for (let i = 0; i < n; i++) {
        states[`binary_sensor.v${i}_problem`] = st('on', { device_class: 'problem', friendly_name: `V${i}` });
        entities[`binary_sensor.v${i}_problem`] = { device_id: `d${i}` };
        devices[`d${i}`] = { id: `d${i}`, model: 'Valve' };
      }
      return collectFaults(fakeHass({ states, entities, devices }), opts).faults.map((f) => f.id);
    };
    expect(mk(2)).toEqual(['problem:model:Valve']);
    expect(mk(1)).toEqual(['problem:binary_sensor.v0_problem']);
  });

  it('impossible temperature limits are -50 and 100 degrees', () => {
    const ids = (v: string) => kinds({ 'sensor.t_temperature': temp(v) });
    expect(ids('-50')).toEqual([]);
    expect(ids('-51')).toEqual(['temperature']);
    expect(ids('100')).toEqual([]);
    expect(ids('101')).toEqual(['temperature']);
  });

  it('rounds health to the nearest percent', () => {
    const states: Record<string, ReturnType<typeof st>> = {};
    for (let i = 0; i < 8; i++) states[`sensor.b${i}_battery`] = bat(i < 3 ? '10' : '90', `B${i}`);
    expect(collectFaults(fakeHass({ states }), opts).health).toBe(63);
  });

  it('uses the singular verb for one device', () => {
    const h = fakeHass({
      states: { 'binary_sensor.p_problem': st('on', { device_class: 'problem', friendly_name: 'P' }) },
      areas: AREAS,
      entities: { 'binary_sensor.p_problem': { area_id: 'kuche' } },
    });
    expect(collectFaults(h, opts).faults[0].detail).toBe('Küche reports a small problem');
  });

  it('formats readings in the viewer language', () => {
    const h = fakeHass({
      language: 'de',
      states: { 'sensor.t_battery': bat('0', 'T'), 'sensor.t_temperature': temp('-327.7') },
      entities: { 'sensor.t_battery': { device_id: 'd' }, 'sensor.t_temperature': { device_id: 'd' } },
      devices: { d: { id: 'd', name: 'T' } },
    });
    expect(collectFaults(h, opts).faults[0].detail).toContain('-327,7 °C');
  });

  it('treats Zigbee2MQTT and Hue groups as light groups', () => {
    const h = fakeHass({
      states: {
        'light.all_lights': st('on'),
        'light.wohnzimmer_spots': st('on'),
        'light.hue_room': st('on', { is_hue_group: true }),
        'light.hue_lamp': st('on', { is_hue_group: false }),
        'light.real': st('on'),
      },
      entities: { 'light.all_lights': { device_id: 'g1' }, 'light.wohnzimmer_spots': { device_id: 'g2' }, 'light.real': { device_id: 'r' } },
      devices: { g1: { id: 'g1', model: 'Group' }, g2: { id: 'g2', model: 'group' }, r: { id: 'r', model: 'Bulb' } },
    });
    expect(isLightGroup(h, 'light.all_lights')).toBe(true);
    expect(isLightGroup(h, 'light.wohnzimmer_spots')).toBe(true);
    expect(isLightGroup(h, 'light.hue_room')).toBe(true);
    expect(isLightGroup(h, 'light.hue_lamp')).toBe(false);
    expect(lightStats(h)).toEqual({ on: 2, total: 2 });
  });

  it('allies rest at 50 percent unavailable, not at 49', () => {
    const build = (platform: string, total: number, down: number) => {
      const states: Record<string, ReturnType<typeof st>> = {};
      const entities: Record<string, { platform: string }> = {};
      for (let i = 0; i < total; i++) {
        states[`sensor.${platform}_${i}`] = st(i < down ? 'unavailable' : '1');
        entities[`sensor.${platform}_${i}`] = { platform };
      }
      return fakeHass({ states, entities });
    };
    expect(restingAllies(build('x', 4, 2), { ignore: [], minEntities: 1 })).toHaveLength(1);
    expect(restingAllies(build('x', 100, 49), { ignore: [], minEntities: 1 })).toHaveLength(0);
  });

  it('breaks battery ties by name', () => {
    const h = fakeHass({ states: { 'sensor.z_battery': bat('10', 'Zeta'), 'sensor.a_battery': bat('10', 'Alpha') } });
    expect(batteries(h, { exclude: [], limit: 5 }).map((b) => b.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('room battery state respects the threshold and bad sensors do not hide good ones', () => {
    const mk = (battery: string) =>
      fakeHass({
        states: {
          'sensor.a_bad': temp('99999'),
          'sensor.b_good': temp('19'),
          'sensor.c_bad': temp('-327.7'),
          'sensor.c_battery': bat(battery, 'C'),
        },
        areas: AREAS,
        entities: {
          'sensor.a_bad': { area_id: 'wohnzimmer' },
          'sensor.b_good': { area_id: 'wohnzimmer' },
          'sensor.c_bad': { device_id: 'dc' },
          'sensor.c_battery': { device_id: 'dc' },
        },
        devices: { dc: { id: 'dc', area_id: 'buro' } },
      });
    const rows = (b: string) => roomRows(mk(b), { areas: ['wohnzimmer', 'buro'], batteryThreshold: 20 });
    expect(rows('20')[0]).toMatchObject({ temp: 19, tempState: 'ok' });
    expect(rows('20')[1].tempState).toBe('battery');
    expect(rows('21')[1].tempState).toBe('check');
  });
});

describe('whole-house scans are memoised per states object', () => {
  /** States wrapped so every key listing (one per whole-house scan) is counted. */
  const counted = (states: Record<string, ReturnType<typeof st>>) => {
    const seen = { scans: 0 };
    const proxy = new Proxy(states, {
      ownKeys(t) {
        seen.scans++;
        return Reflect.ownKeys(t);
      },
    });
    return { proxy, seen };
  };
  const base = {
    'sensor.b_battery': st('3', { device_class: 'battery', unit_of_measurement: '%' }),
    'light.a': st('on'),
    'switch.x': st('unavailable'),
  };

  it('collectFaults computes once for the same states and options', () => {
    const { proxy, seen } = counted({ ...base });
    const h = fakeHass({ states: proxy });
    const opts = { batteryThreshold: 20, exclude: [] };
    const a = collectFaults(h, opts);
    const n = seen.scans;
    expect(collectFaults(h, { batteryThreshold: 20, exclude: [] })).toBe(a);
    expect(collectFaults({ ...h }, opts)).toBe(a);
    expect(seen.scans).toBe(n);
  });

  it('recomputes for new states, other options, other registries or another language', () => {
    const h = fakeHass({ states: { ...base } });
    const opts = { batteryThreshold: 20, exclude: [] };
    const a = collectFaults(h, opts);
    expect(collectFaults({ ...h, states: { ...h.states } }, opts)).not.toBe(a);
    expect(collectFaults(h, { batteryThreshold: 2, exclude: [] })).not.toBe(a);
    expect(collectFaults(h, { batteryThreshold: 20, exclude: ['light.*'] })).not.toBe(a);
    expect(collectFaults({ ...h, entities: {} }, opts)).not.toBe(a);
    expect(collectFaults({ ...h, locale: { language: 'de' } }, opts)).not.toBe(a);
  });

  it('memoises lightStats, onlineShare, restingAllies, roomRows and batteries too', () => {
    const { proxy, seen } = counted({ ...base });
    const h = fakeHass({ states: proxy, entities: { 'switch.x': { platform: 'tuya' } }, areas: AREAS });
    const run = () => [
      lightStats(h),
      onlineShare(h, {}),
      restingAllies(h, { ignore: [], minEntities: 1 }),
      roomRows(h, { batteryThreshold: 20 }),
      batteries(h, { exclude: [], limit: 8 }),
    ];
    const first = run();
    const n = seen.scans;
    run().forEach((r, i) => expect(r).toBe(first[i]));
    expect(seen.scans).toBe(n);
  });
});
