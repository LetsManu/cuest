import { describe, expect, it } from 'vitest';
import type { EntityInfo } from '../src/bridge/protocol.js';
import { detect } from '../src/services/detect.js';

const ent = (o: Partial<EntityInfo> & { entityId: string }): EntityInfo => ({
  domain: o.entityId.split('.')[0]!, deviceId: null, deviceClass: null, platform: null, translationKey: null,
  options: null, unit: null, name: null, deviceName: null, manufacturer: null, model: null, state: null, ...o,
});

describe('detect', () => {
  it('Home Connect washer -> finished_state', () => {
    const r = detect([
      ent({ entityId: 'sensor.w_state', deviceId: 'd1', deviceName: 'Washer', platform: 'home_connect',
        translationKey: 'operation_state', options: ['inactive', 'ready', 'run', 'finished', 'pause'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('washer');
    expect(r[0]!.method).toBe('finished_state');
    expect(r[0]!.key).toBe('finished_state:sensor.w_state');
    expect(r[0]!.templates[0]!.rule).toEqual({ type: 'state', entityId: 'sensor.w_state', to: ['finished'], normalize: true });
    expect(r[0]!.templates[0]!.title).toBe('Hang up the laundry');
  });
  it('Miele status', () => {
    const r = detect([
      ent({ entityId: 'sensor.m', deviceId: 'd', deviceName: 'Miele Washing Machine', translationKey: 'status',
        options: ['off', 'in_use', 'program_ended'] }),
    ]);
    expect(r[0]!.templates[0]!.rule).toMatchObject({ to: ['program_ended'] });
  });
  it('SmartThings dryer', () => {
    const r = detect([
      ent({ entityId: 'sensor.s', deviceId: 'd', deviceName: 'Dryer', translationKey: 'job_state', options: ['none', 'drying', 'finish'] }),
    ]);
    expect(r[0]!.kind).toBe('dryer');
    expect(r[0]!.templates[0]!.rule).toMatchObject({ to: ['finish'] });
  });
  it('state key without done options uses all done words', () => {
    const r = detect([ent({ entityId: 'sensor.s', deviceId: 'd', deviceName: 'Dryer', translationKey: 'machine_state' })]);
    expect((r[0]!.templates[0]!.rule as { to: string[] }).to).toContain('fertig');
  });
  it('dishwasher with power sensor', () => {
    const r = detect([
      ent({ entityId: 'sensor.dw_p', deviceId: 'd', deviceName: 'Dishwasher', deviceClass: 'power', unit: 'W' }),
    ]);
    expect(r[0]!.kind).toBe('dishwasher');
    expect(r[0]!.method).toBe('power');
    expect(r[0]!.templates[0]!.rule!.type).toBe('power_below');
  });
  it('washer dryer is washer', () => {
    const r = detect([ent({ entityId: 'sensor.p', deviceId: 'd', deviceName: 'Washer Dryer', deviceClass: 'power', unit: 'W' })]);
    expect(r[0]!.kind).toBe('washer');
  });
  it('German Shelly', () => {
    const r = detect([
      ent({ entityId: 'sensor.shelly_power', deviceId: 'd', deviceName: 'Waschmaschine Keller', platform: 'shelly', deviceClass: 'power', unit: 'W' }),
      ent({ entityId: 'sensor.shelly_energy', deviceId: 'd', deviceName: 'Waschmaschine Keller', deviceClass: 'energy', unit: 'kWh' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('washer');
    expect(r[0]!.method).toBe('power');
  });
  it('binary sensors', () => {
    const a = detect([ent({ entityId: 'binary_sensor.r', deviceId: 'd', deviceName: 'Trockner', deviceClass: 'running' })]);
    expect(a[0]!.method).toBe('running_stops');
    expect(a[0]!.templates[0]!.rule).toMatchObject({ type: 'running_stops', forMinutes: 2 });
    const b = detect([ent({ entityId: 'binary_sensor.v', deviceId: 'd', deviceName: 'Trockner', deviceClass: 'vibration' })]);
    expect(b[0]!.templates[0]!.rule).toMatchObject({ forMinutes: 5 });
  });
  it('running-word sensor', () => {
    const r = detect([ent({ entityId: 'sensor.x', deviceId: 'd', deviceName: 'Dishwasher', state: 'Running' })]);
    expect(r[0]!.method).toBe('running_stops');
    expect(r[0]!.templates[0]!.rule).toMatchObject({ forMinutes: 3 });
  });
  it('vacuum and bin sensor, sorted after appliances', () => {
    const r = detect([
      ent({ entityId: 'vacuum.robo', deviceId: 'v', deviceName: 'Roborock' }),
      ent({ entityId: 'binary_sensor.robo_bin', deviceId: 'v', deviceName: 'Roborock', translationKey: 'dustbin_full' }),
      ent({ entityId: 'sensor.w', deviceId: 'w', deviceName: 'Washer', deviceClass: 'power', unit: 'W' }),
    ]);
    expect(r.map((s) => s.key)).toEqual(['power:sensor.w', 'vacuum_state:vacuum.robo', 'bin_sensor:binary_sensor.robo_bin']);
    expect(r[1]!.templates).toHaveLength(2);
  });
  it('ignores unrelated', () => {
    expect(detect([
      ent({ entityId: 'light.a', deviceId: 'l', deviceName: 'Lamp' }),
      ent({ entityId: 'sensor.t', deviceId: 't', deviceName: 'Temp', deviceClass: 'temperature', unit: '°C' }),
    ])).toEqual([]);
  });
});
