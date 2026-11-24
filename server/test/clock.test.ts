import { describe, expect, it } from 'vitest';
import { FakeClock, isQuiet, localParts, minutesOfDay, newId, systemClock } from '../src/clock.js';

const TZ = 'Europe/Berlin';

describe('clock', () => {
  it('isQuiet handles ranges crossing midnight', () => {
    expect(isQuiet(new Date('2026-11-24T22:30:00Z'), TZ, '22:00', '08:00')).toBe(true);
    expect(isQuiet(new Date('2026-11-24T06:30:00Z'), TZ, '22:00', '08:00')).toBe(true);
    expect(isQuiet(new Date('2026-11-24T07:30:00Z'), TZ, '22:00', '08:00')).toBe(false);
  });
  it('isQuiet handles same-day ranges and start === end', () => {
    expect(isQuiet(new Date('2026-11-24T12:00:00Z'), TZ, '13:00', '13:00')).toBe(false);
    expect(isQuiet(new Date('2026-11-24T12:30:00Z'), TZ, '13:00', '15:00')).toBe(true);
    expect(isQuiet(new Date('2026-11-24T15:00:00Z'), TZ, '13:00', '15:00')).toBe(false);
  });
  it('localParts uses the given tz', () => {
    expect(localParts(new Date('2026-11-24T23:30:00Z'), TZ)).toMatchObject({ y: 2026, m: 11, d: 25, hh: 0, mm: 30, weekday: 3 });
    expect(localParts(new Date('2026-11-29T12:00:00Z'), TZ).weekday).toBe(0);
  });
  it('minutesOfDay parses HH:MM', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('08:30')).toBe(510);
  });
  it('FakeClock set/advance', () => {
    const c = new FakeClock(new Date('2026-01-01T00:00:00Z'));
    c.advance(90);
    expect(c.now().toISOString()).toBe('2026-01-01T01:30:00.000Z');
    c.set(new Date('2026-02-01T00:00:00Z'));
    expect(c.now().toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
  it('systemClock and newId', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });
});
