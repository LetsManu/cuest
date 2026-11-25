import { describe, expect, it, vi } from 'vitest';
import { fakeHass } from './fake-hass';
import { fetchHistory, resample, trailGeometry, type Sample } from '../../src/arcane/history';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('resample', () => {
  it('steps through samples and nulls non-numeric ones', () => {
    const s: Sample[] = [
      { t: 0, v: 20 },
      { t: 30 * MIN, v: 21 },
      { t: 60 * MIN, v: null },
      { t: 90 * MIN, v: 22 },
    ];
    expect(resample(s, 0, 2 * HOUR, 4)).toEqual([21, null, 22, 22]);
  });

  it('is all null without samples', () => {
    expect(resample([], 0, HOUR, 4)).toEqual([null, null, null, null]);
  });

  it('is null before the first sample', () => {
    expect(resample([{ t: 45 * MIN, v: 5 }], 0, HOUR, 4)).toEqual([null, null, 5, 5]);
  });

  it('defaults to 48 points and never exceeds 48', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ t: (i * 24 * HOUR) / 1000, v: i }));
    expect(resample(many, 0, 24 * HOUR)).toHaveLength(48);
    expect(resample(many, 0, 24 * HOUR, 500)).toHaveLength(48);
  });
});

describe('trailGeometry', () => {
  it('splits runs of values at gaps', () => {
    const g = trailGeometry([[1, 2, null, 4]])!;
    expect(g.segments[0]).toEqual(['0,101.2 108.67,70.4', '326,8.8']);
    expect(g.area.startsWith('M')).toBe(true);
    expect(g.area.match(/Z/g)).toHaveLength(2);
  });

  it('is null when everything is null', () => {
    expect(trailGeometry([[null, null], [null]])).toBeNull();
    expect(trailGeometry([])).toBeNull();
  });

  it('keeps a flat series finite', () => {
    const g = trailGeometry([[5, 5, 5]])!;
    expect(g.segments[0].join(' ')).not.toMatch(/NaN|Infinity/);
    expect(g.segments[0][0]).toBe('0,55 163,55 326,55');
  });

  it('pads 8 percent by default', () => {
    const g = trailGeometry([[0, 10]])!;
    expect(g.segments[0][0]).toBe('0,101.2 326,8.8');
  });

  it('shares the y range, pads 8 percent and puts the last point at the right edge', () => {
    const g = trailGeometry([[0, 10], [5, 5]], 326, 110, 0.08)!;
    const [a0, a1] = g.segments[0][0].split(' ').map((p) => p.split(',').map(Number));
    expect(a0[0]).toBe(0);
    expect(a1[0]).toBe(326);
    expect(a0[1]).toBeCloseTo(110 - 8.8, 5);
    expect(a1[1]).toBeCloseTo(8.8, 5);
    expect(g.last).toEqual({ x: 326, y: a1[1] });
    const mid = g.segments[1][0].split(' ')[0].split(',').map(Number);
    expect(mid[1]).toBeCloseTo(55, 5);
  });
});

describe('trailGeometry separate scales', () => {
  // Primary band: top 65 % of the height; secondary band: the bottom 28 %. Each pads 8 % of its own band.
  it('draws the primary in the upper band and the secondary in the lower band, each on its own range', () => {
    const g = trailGeometry([[20, 22], [0, 1]], 326, 110, 0.08, 'separate')!;
    expect(g.segments[0]).toEqual(['0,65.78 326,5.72']);
    expect(g.segments[1]).toEqual(['0,107.54 326,81.66']);
    expect(g.last).toEqual({ x: 326, y: 5.72 });
    expect(g.area).toBe('M0,65.78 L326,5.72 L326,110 L0,110 Z');
  });

  it('keeps a flat secondary finite and centred in its band', () => {
    const g = trailGeometry([[20, 22], [3, 3]], 326, 110, 0.08, 'separate')!;
    expect(g.segments[1]).toEqual(['0,94.6 326,94.6']);
  });

  it('uses the whole height for a single series in either mode', () => {
    expect(trailGeometry([[0, 10]], 326, 110, 0.08, 'separate')).toEqual(trailGeometry([[0, 10]]));
  });

  it('a series with no values does not disturb the other band', () => {
    const g = trailGeometry([[20, 22], [null, null]], 326, 110, 0.08, 'separate')!;
    expect(g.segments[0]).toEqual(['0,65.78 326,5.72']);
    expect(g.segments[1]).toEqual([]);
    const only2 = trailGeometry([[null], [0, 1]], 326, 110, 0.08, 'separate')!;
    expect(only2.segments[1]).toEqual(['0,107.54 326,81.66']);
  });

  it('shared stays the default', () => {
    expect(trailGeometry([[20, 22], [0, 1]], 326, 110, 0.08, 'shared')).toEqual(trailGeometry([[20, 22], [0, 1]]));
    expect(trailGeometry([[20, 22], [0, 1]])!.segments[0]).toEqual(['0,17.2 326,8.8']);
  });
});

describe('fetchHistory', () => {
  it('sends the exact message and converts lu seconds to ms', async () => {
    const h = fakeHass({ history: { 'sensor.a': [{ s: '21.5', lu: 1764000000.5 }, { s: 'unavailable', lu: 1764000100 }] } });
    const start = new Date('2026-11-23T10:00:00Z');
    const end = new Date('2026-11-24T10:00:00Z');
    const out = await fetchHistory(h, ['sensor.a', 'sensor.b'], start, end);
    expect(h.callWS).toHaveBeenCalledTimes(1);
    expect(h.callWS).toHaveBeenCalledWith({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: ['sensor.a', 'sensor.b'],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    expect(out['sensor.a']).toEqual([
      { t: 1764000000500, v: 21.5 },
      { t: 1764000100000, v: null },
    ]);
    expect(out['sensor.b']).toEqual([]);
  });

  it('reads the full first state (state, last_updated)', async () => {
    const h = fakeHass();
    h.callWS = vi.fn(async () => ({ 'sensor.a': [{ state: '7', last_updated: '2026-11-24T10:00:00+00:00' }, { s: '8' }] })) as never;
    const out = await fetchHistory(h, ['sensor.a'], new Date(0), new Date(1));
    expect(out['sensor.a']).toEqual([{ t: Date.parse('2026-11-24T10:00:00Z'), v: 7 }]);
  });

  it('treats a missing response as empty series', async () => {
    const h = fakeHass();
    h.callWS = vi.fn(async () => undefined) as never;
    expect(await fetchHistory(h, ['sensor.a'], new Date(0), new Date(1))).toEqual({ 'sensor.a': [] });
  });
});
