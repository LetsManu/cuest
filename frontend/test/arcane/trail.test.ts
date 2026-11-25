import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { HISTORY_REFRESH_MS } from '../../src/arcane/trail';
import '../../src/arcane/index';

const TAG = 'cuest-trail-card';
const NOW = Date.parse('2026-11-24T12:00:00Z');
const root = (el: HTMLElement) => el.shadowRoot!;
const ls = (hoursAgo: number) => (NOW - hoursAgo * 3_600_000) / 1000;

const states = () => ({
  'sensor.living': st('21.5', { friendly_name: 'Wohnzimmer', unit_of_measurement: '°C', device_class: 'temperature' }),
  'sensor.out': st('-0.7', { friendly_name: 'Outside', unit_of_measurement: '°C' }),
});
const history = () => ({
  'sensor.living': [
    { s: '20', lu: ls(23) },
    { s: '22.3', lu: ls(12) },
    { s: '20.5', lu: ls(3) },
  ],
  'sensor.out': [
    { s: '-3', lu: ls(23) },
    { s: '1', lu: ls(6) },
  ],
});
const cfg = { entity: 'sensor.living', entity2: 'sensor.out', name: 'Wohnzimmer', name2: 'outside' };

const flush = async (el: HTMLElement) => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  }
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('trail card rendering', () => {
  it('draws two lines, a pulse and the legend with live values', async () => {
    const h = fakeHass({ states: states(), history: history() });
    const el = await mount(TAG, cfg, h);
    await flush(el);
    const lines = root(el).querySelectorAll('polyline');
    expect(lines).toHaveLength(2);
    expect(lines[0].hasAttribute('stroke-dasharray')).toBe(false);
    expect(lines[0].hasAttribute('pathLength')).toBe(false);
    expect(lines[0].getAttribute('class') ?? '').not.toContain('draw');
    expect(lines[1].getAttribute('stroke-dasharray')).toBe('4 4');
    const rect = root(el).querySelector('clipPath rect')!;
    expect(rect.getAttribute('class')).toContain('reveal');
    const clipId = root(el).querySelector('clipPath')!.id;
    expect(root(el).querySelector('.lines')!.getAttribute('clip-path')).toBe(`url(#${clipId})`);
    expect(root(el).querySelectorAll('circle')).toHaveLength(0);
    const dot = root(el).querySelector('.dot.pulse') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute('style')).toMatch(/left:\s*100%/);
    expect(dot.getAttribute('style')).toMatch(/top:\s*\d/);
    const t = text(el);
    expect(t).toContain('Warmth trail');
    expect(t).toContain('24 h');
    expect(t).toContain('Wohnzimmer 21.5°');
    expect(t).toContain('outside -0.7°');
    const svg = root(el).querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toBe('Wohnzimmer over the last 24 hours, between 20 and 22.3 °C');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expectClean(el);
  });

  it('replaces the last point with the live state', async () => {
    const s = states();
    s['sensor.living'] = st('30', { friendly_name: 'Wohnzimmer', unit_of_measurement: '°C' });
    const el = await mount(TAG, { entity: 'sensor.living' }, fakeHass({ states: s, history: history() }));
    await flush(el);
    expect(root(el).querySelector('svg')!.getAttribute('aria-label')).toContain('between 20 and 30');
    expect(root(el).querySelectorAll('polyline')).toHaveLength(1);
  });

  it('survives a flat series', async () => {
    const h = fakeHass({
      states: { 'sensor.living': st('5') },
      history: { 'sensor.living': [{ s: '5', lu: ls(10) }] },
    });
    const el = await mount(TAG, { entity: 'sensor.living' }, h);
    await flush(el);
    expect(root(el).querySelectorAll('polyline')).toHaveLength(1);
    expectClean(el);
  });

  it('shows the missing-entity warning', async () => {
    const el = await mount(TAG, { entity: 'sensor.nope' }, fakeHass());
    await flush(el);
    expect(text(el)).toContain('Entity not found: sensor.nope');
    expectClean(el);
  });

  it('shows title and dash legend when the request rejects, then retries when allowed', async () => {
    const h = fakeHass({ states: states(), history: history() });
    h.callWS.mockRejectedValueOnce(new Error('boom'));
    const el = await mount(TAG, cfg, h);
    await flush(el);
    expect(text(el)).toContain('Warmth trail');
    expect(text(el)).toContain('Wohnzimmer —');
    expect(root(el).querySelector('polyline')).toBeNull();
    expectClean(el);
    vi.setSystemTime(NOW + 60_000);
    (el as unknown as { hass: unknown }).hass = { ...h, states: { ...h.states } };
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + HISTORY_REFRESH_MS);
    (el as unknown as { hass: unknown }).hass = { ...h, states: { ...h.states } };
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(2);
    expect(root(el).querySelectorAll('polyline')).toHaveLength(2);
  });

  it('shows no lines when every value is unavailable', async () => {
    const h = fakeHass({ states: { 'sensor.living': st('unavailable') }, history: { 'sensor.living': [{ s: 'unavailable', lu: ls(5) }] } });
    const el = await mount(TAG, { entity: 'sensor.living' }, h);
    await flush(el);
    expect(root(el).querySelector('polyline')).toBeNull();
    expect(text(el)).toContain('—');
    expectClean(el);
  });
});

describe('trail failures and geometry', () => {
  it('keeps the previous graph when a later refresh fails', async () => {
    const h = fakeHass({ states: states(), history: history() });
    const el = await mount(TAG, cfg, h);
    await flush(el);
    h.callWS.mockRejectedValueOnce(new Error('boom'));
    vi.setSystemTime(NOW + HISTORY_REFRESH_MS);
    (el as unknown as { hass: unknown }).hass = { ...h, states: { ...h.states } };
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(2);
    expect(root(el).querySelectorAll('polyline')).toHaveLength(2);
    expect(text(el)).toContain('Wohnzimmer 21.5°');
  });

  it('pads the y range by 8 percent by default (minimum sits at 101.2)', async () => {
    const h = fakeHass({
      states: { 'sensor.living': st('10') },
      history: { 'sensor.living': [{ s: '0', lu: ls(23.9) }, { s: '10', lu: ls(0.1) }] },
    });
    const el = await mount(TAG, { entity: 'sensor.living' }, h);
    await flush(el);
    const pts = root(el).querySelector('polyline')!.getAttribute('points')!.split(' ');
    expect(pts[0].split(',')[1]).toBe('101.2');
  });
});

describe('trail with a silent main sensor', () => {
  it('uses a range-free aria label when only the secondary has data', async () => {
    const h = fakeHass({
      states: { 'sensor.living': st('unavailable', { friendly_name: 'Wohnzimmer' }), 'sensor.out': st('-0.7') },
      history: { 'sensor.living': [{ s: 'unavailable', lu: ls(5) }], 'sensor.out': [{ s: '-3', lu: ls(20) }, { s: '1', lu: ls(6) }] },
    });
    const el = await mount(TAG, { entity: 'sensor.living', entity2: 'sensor.out' }, h);
    await flush(el);
    const label = root(el).querySelector('svg[role="img"]')!.getAttribute('aria-label')!;
    expect(label).toBe('Wohnzimmer: no history in the last 24 h');
    expect(label).not.toMatch(/Infinity|NaN/);
    expectClean(el);
  });
});

describe('trail refresh', () => {
  it('fetches once for a burst of updates and again after five minutes', async () => {
    const h = fakeHass({ states: states(), history: history() });
    const el = await mount(TAG, cfg, h);
    await flush(el);
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(NOW + i * 10_000);
      (el as unknown as { hass: unknown }).hass = { ...h, states: { ...h.states } };
    }
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + HISTORY_REFRESH_MS);
    (el as unknown as { hass: unknown }).hass = { ...h, states: { ...h.states } };
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(2);
  });

  it('does not start a second request while one is pending', async () => {
    const h = fakeHass({ states: states(), history: history() });
    h.callWS.mockImplementation(() => new Promise(() => {}));
    const el = await mount(TAG, cfg, h);
    vi.setSystemTime(NOW + HISTORY_REFRESH_MS * 2);
    (el as unknown as { hass: unknown }).hass = { ...h, states: { ...h.states } };
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(1);
  });

  it('refetches at once with a new window on config change', async () => {
    const h = fakeHass({ states: states(), history: history() });
    const el = await mount(TAG, cfg, h);
    await flush(el);
    (el as unknown as { setConfig(c: unknown): void }).setConfig({ ...cfg, hours: 48 });
    await flush(el);
    expect(h.callWS).toHaveBeenCalledTimes(2);
    const msg = h.callWS.mock.calls[1][0] as { start_time: string; end_time: string };
    expect(Date.parse(msg.end_time) - Date.parse(msg.start_time)).toBe(48 * 3_600_000);
    expect(text(el)).toContain('48 h');
  });

  it('drops a stale response that finishes after a newer one', async () => {
    const h = fakeHass({ states: states(), history: history() });
    let resolveFirst!: (v: unknown) => void;
    h.callWS.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    const el = await mount(TAG, cfg, h);
    (el as unknown as { setConfig(c: unknown): void }).setConfig({ entity: 'sensor.living', hours: 12 });
    await flush(el);
    expect(root(el).querySelectorAll('polyline')).toHaveLength(1);
    const before = root(el).querySelector('polyline')!.getAttribute('points');
    resolveFirst({ 'sensor.living': [{ s: '99', lu: ls(1) }, { s: '-99', lu: ls(0.5) }], 'sensor.out': [{ s: '5', lu: ls(1) }] });
    await flush(el);
    expect(root(el).querySelectorAll('polyline')).toHaveLength(1);
    expect(root(el).querySelector('polyline')!.getAttribute('points')).toBe(before);
    expect(root(el).querySelector('svg')!.getAttribute('aria-label')).not.toContain('99');
  });
});

describe('trail theme css', () => {
  it('defines the reveal keyframes and switches them off for reduced motion', async () => {
    const { arcaneBase } = await import('../../src/arcane/theme');
    const css = arcaneBase.cssText;
    expect(css).toMatch(/@keyframes reveal\{from\{transform:scaleX\(0\)\}to\{transform:scaleX\(1\)\}\}/);
    expect(css).toMatch(/\.reveal\{[^}]*transform-origin:0 50%[^}]*animation:reveal 2\.4s ease-out both[^}]*\}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^@]*\.reveal[^@]*animation:none/);
  });
});

describe('trail scales', () => {
  const ys = (el: HTMLElement) =>
    Array.from(root(el).querySelectorAll('polyline')).map((p) => p.getAttribute('points')!.split(' ').map((q) => Number(q.split(',')[1])));
  const range = (a: number[]) => [Math.min(...a), Math.max(...a)];

  it('two sensors draw in separate bands by default, like the mockup', async () => {
    const el = await mount(TAG, cfg, fakeHass({ states: states(), history: history() }));
    await flush(el);
    const [inside, outside] = ys(el);
    expect(range(inside)).toEqual([5.72, 65.78]);
    expect(range(outside)).toEqual([81.66, 107.54]);
    expect(root(el).querySelector('svg.graph')!.getAttribute('aria-label')).toBe('Wohnzimmer over the last 24 hours, between 20 and 22.3 °C');
    expect(text(el)).toContain('Wohnzimmer 21.5°');
    expect(text(el)).toContain('outside -0.7°');
  });

  it('scale: shared keeps one range for both lines', async () => {
    const el = await mount(TAG, { ...cfg, scale: 'shared' }, fakeHass({ states: states(), history: history() }));
    await flush(el);
    const [inside, outside] = ys(el);
    expect(Math.min(...inside)).toBe(8.8);
    expect(Math.max(...outside)).toBe(101.2);
  });

  it('rejects an unknown scale', () => {
    const c = document.createElement(TAG) as unknown as { setConfig(c: unknown): void };
    expect(() => c.setConfig({ ...cfg, scale: 'log' })).toThrow(/cuest-trail-card: "scale" must be one of separate, shared/);
  });
});

describe('trail config', () => {
  const card = () => document.createElement(TAG) as unknown as { setConfig(c: unknown): void; getCardSize(): number; getGridOptions(): unknown; constructor: { getStubConfig(h: unknown): unknown } };
  it('rejects bad hours and a missing entity', () => {
    expect(() => card().setConfig({ entity: 'sensor.a', hours: 0 })).toThrow(/"hours" must be between 1 and 168/);
    expect(() => card().setConfig({ entity: 'sensor.a', hours: 500 })).toThrow(/"hours" must be between 1 and 168/);
    expect(() => card().setConfig({})).toThrow(/"entity" is required/);
    expect(() => card().setConfig({ entity: 'nope' })).toThrow(/cuest-trail-card/);
  });

  it('reports size, grid and a temperature stub', () => {
    const c = card();
    expect(c.getCardSize()).toBe(3);
    expect(c.getGridOptions()).toEqual({ columns: 12, rows: 'auto' });
    const stub = c.constructor.getStubConfig({
      states: { 'light.a': st('on'), 'sensor.hum': st('5', { device_class: 'humidity' }), 'sensor.t': st('5', { device_class: 'temperature' }) },
    });
    expect(stub).toEqual({ entity: 'sensor.t' });
  });
});
