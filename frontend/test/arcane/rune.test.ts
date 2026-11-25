import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestRuneGauge } from '../../src/arcane/rune';
import '../../src/arcane/rune';

const TAG = 'cuest-rune-gauge';
const root = (el: HTMLElement) => el.shadowRoot!;
const arc = (el: HTMLElement) => root(el).querySelector('circle[data-arc]')!;
const btn = (el: HTMLElement, label: string) => root(el).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

const heater = (over: Record<string, unknown> = {}, state = 'heat') =>
  st(state, { temperature: 23, current_temperature: 21.5, min_temp: 7, max_temp: 30, target_temp_step: 0.5, hvac_action: 'heating', ...over });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('climate rune', () => {
  it('shows target, current, action and the arc length', async () => {
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': heater() } }));
    expect(text(el)).toContain('23°');
    expect(text(el)).toContain('now 21.5°');
    expect(text(el)).toContain('Fire rune · heating');
    expect(arc(el).getAttribute('stroke-dasharray')).toBe('192.7 277');
    expect(arc(el).getAttribute('stroke')).toBe('#FF8A5B');
    expect(btn(el, 'Cooler')).toBeTruthy();
    expect(btn(el, 'Warmer')).toBeTruthy();
    expectClean(el);
  });

  it('describes the gauge for assistive tech with the real numbers', async () => {
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': heater() } }));
    const svg = root(el).querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toBe('Fire rune: 23°, now 21.5°');
  });

  it('debounces quick taps into one service call with the final target', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    for (let i = 0; i < 3; i++) {
      btn(el, 'Warmer').click();
      await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
      vi.advanceTimersByTime(200);
    }
    expect(text(el)).toContain('24.5°');
    expect(h.callService).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(h.callService).toHaveBeenCalledTimes(1);
    expect(h.callService).toHaveBeenCalledWith('climate', 'set_temperature', { entity_id: 'climate.living', temperature: 24.5 });
  });

  it('never goes below min_temp or above max_temp', async () => {
    const h = fakeHass({ states: { 'climate.living': heater({ temperature: 29.5, max_temp: 30 }) } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    for (let i = 0; i < 4; i++) btn(el, 'Warmer').click();
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('30°');
    vi.advanceTimersByTime(800);
    expect(h.callService).toHaveBeenCalledWith('climate', 'set_temperature', { entity_id: 'climate.living', temperature: 30 });

    const h2 = fakeHass({ states: { 'climate.cold': heater({ temperature: 7.5, min_temp: 7 }) } });
    const el2 = await mount(TAG, { entity: 'climate.cold' }, h2);
    for (let i = 0; i < 3; i++) btn(el2, 'Cooler').click();
    await (el2 as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el2)).toContain('7°');
  });

  it('uses the entity step and defaults to 0.5', async () => {
    const h = fakeHass({ states: { 'climate.a': heater({ target_temp_step: 1 }), 'climate.b': heater({ target_temp_step: undefined }) } });
    const a = await mount(TAG, { entity: 'climate.a' }, h);
    btn(a, 'Warmer').click();
    await (a as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(a)).toContain('24°');
    const b = await mount(TAG, { entity: 'climate.b' }, h);
    btn(b, 'Warmer').click();
    await (b as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(b)).toContain('23.5°');
  });

  it('sends a pending tap at once when the card leaves the page, then clears its timers', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    btn(el, 'Warmer').click();
    el.remove();
    expect(h.callService).toHaveBeenCalledOnce();
    expect(h.callService).toHaveBeenCalledWith('climate', 'set_temperature', { entity_id: 'climate.living', temperature: 24 });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(h.callService).toHaveBeenCalledOnce();
  });

  it('sends nothing on leaving when the taps ended where they started', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    btn(el, 'Cooler').click();
    el.remove();
    expect(h.callService).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a range without buttons for heat_cool', async () => {
    const s = st('heat_cool', { target_temp_low: 20, target_temp_high: 23, current_temperature: 21, min_temp: 7, max_temp: 30, hvac_action: 'idle' });
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': s } }));
    expect(text(el)).toContain('20–23°');
    expect(root(el).querySelectorAll('button').length).toBe(0);
    expectClean(el);
  });

  it('rests when the thermostat is off', async () => {
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': heater({}, 'off') } }));
    expect(text(el)).toContain('Fire rune · resting');
    expect(root(el).querySelectorAll('button').length).toBe(0);
    expect(arc(el).getAttribute('stroke-dasharray')).toBe('0 277');
    expectClean(el);
  });

  it('shows a dash and resting copy when unavailable', async () => {
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': st('unavailable') } }));
    expect(text(el)).toContain('—');
    expect(text(el)).toContain('Fire rune · resting');
    expect(root(el).querySelectorAll('button').length).toBe(0);
    expectClean(el);
  });

  it('compact layout shows the current temperature and the target in the label', async () => {
    const el = await mount(TAG, { entity: 'climate.living', controls: false }, fakeHass({ states: { 'climate.living': heater() } }));
    expect(text(el)).toContain('Fire rune · to 23°');
    expect(text(el)).toContain('21.5°');
    expect(root(el).querySelectorAll('button').length).toBe(0);
    expect(root(el).querySelector('.rune.compact')).toBeTruthy();
    expect((el as unknown as CuestRuneGauge).getGridOptions()).toEqual({ columns: 6, rows: 'auto' });
    // Desktop mockup: 12px panel, 13px regular label under the gauge.
    expect(root(el).querySelector('.panel.compact')).toBeTruthy();
    const css = CuestRuneGauge.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.panel\.compact\{padding:12px\}/);
    expect(css).toMatch(/\.compact \.label\{font-size:13px;font-weight:400\}/);
  });

  it('warns about a missing entity', async () => {
    const el = await mount(TAG, { entity: 'climate.nope' }, fakeHass());
    expect(text(el)).toContain('Entity not found: climate.nope');
  });
});

describe('sensor rune', () => {
  it('shows a water rune for humidity', async () => {
    const s = st('38', { device_class: 'humidity', unit_of_measurement: '%', friendly_name: 'Air' });
    const el = await mount(TAG, { entity: 'sensor.air' }, fakeHass({ states: { 'sensor.air': s } }));
    expect(text(el)).toContain('38%');
    expect(text(el)).toContain('Water rune · Air');
    expect(arc(el).getAttribute('stroke')).toBe('#8FDCFF');
    expect(arc(el).getAttribute('stroke-dasharray')).toBe('105.3 277');
    expect(root(el).querySelectorAll('button').length).toBe(0);
    expectClean(el);
  });

  it('uses the arcane rune with min and max for other sensors', async () => {
    const s = st('75', { unit_of_measurement: 'GB', friendly_name: 'Disk' });
    const el = await mount(TAG, { entity: 'sensor.disk', min: 50, max: 100 }, fakeHass({ states: { 'sensor.disk': s } }));
    expect(text(el)).toContain('75GB');
    expect(text(el)).toContain('Arcane rune · Disk');
    expect(arc(el).getAttribute('stroke')).toBe('#B98CFF');
    expect(arc(el).getAttribute('stroke-dasharray')).toBe('138.5 277');
    expect(root(el).querySelector('polygon')).toBeTruthy();
  });

  it('honours an explicit rune and name', async () => {
    const s = st('5', { friendly_name: 'Air' });
    const el = await mount(TAG, { entity: 'sensor.air', rune: 'fire', name: 'Boiler' }, fakeHass({ states: { 'sensor.air': s } }));
    expect(text(el)).toContain('Fire rune · Boiler');
  });

  it('shows resting copy for an unavailable sensor', async () => {
    const el = await mount(TAG, { entity: 'sensor.air' }, fakeHass({ states: { 'sensor.air': st('unknown', { friendly_name: 'Air' }) } }));
    expect(text(el)).toContain('—');
    expect(text(el)).toContain('resting');
    expectClean(el);
  });
});

describe('rune config and styles', () => {
  it('rejects other domains and an empty range', () => {
    const el = document.createElement(TAG) as unknown as { setConfig(c: unknown): void };
    expect(() => el.setConfig({ entity: 'light.x' })).toThrow(/climate or sensor/);
    expect(() => el.setConfig({ entity: 'sensor.x', min: 10, max: 10 })).toThrow(/cuest-rune-gauge/);
    expect(() => el.setConfig({ entity: 'sensor.x', min: 10, max: 5 })).toThrow(/min/);
  });

  it('grid options and stub', () => {
    const el = document.createElement(TAG) as unknown as CuestRuneGauge;
    el.setConfig({ entity: 'climate.x' });
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 'auto' });
    expect(el.getCardSize()).toBe(3);
    const stub = CuestRuneGauge.getStubConfig({ states: { 'sensor.a': st('1'), 'climate.q': st('heat') } } as never);
    expect(stub).toEqual({ entity: 'climate.q' });
  });

  it('buttons are 48px and numbers use Inter 700 tabular', async () => {
    const css = CuestRuneGauge.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.btn\{[^}]*width:48px[^}]*height:48px/);
    expect(css).toMatch(/\.num\{[^}]*font-family:Inter[^}]*font-weight:700[^}]*font-variant-numeric:tabular-nums/);
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': heater() } }));
    expect(btn(el, 'Warmer').classList.contains('btn')).toBe(true);
    expect(btn(el, 'Cooler').classList.contains('btn')).toBe(true);
    expect(root(el).querySelector('svg text.num')).toBeTruthy();
  });
});

const tick = (el: HTMLElement) => (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;

describe('rune pending target', () => {
  it('sends a change back to the start when an earlier change was already sent', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    expect(h.callService).toHaveBeenCalledTimes(1);
    btn(el, 'Cooler').click();
    await tick(el);
    expect(text(el)).toContain('23°');
    vi.advanceTimersByTime(800);
    expect(h.callService).toHaveBeenCalledTimes(2);
    expect(h.callService).toHaveBeenLastCalledWith('climate', 'set_temperature', { entity_id: 'climate.living', temperature: 23 });
  });

  it('shows the device target again after 8 s without an echo', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    await tick(el);
    expect(text(el)).toContain('23.5°');
    vi.advanceTimersByTime(800);
    vi.advanceTimersByTime(7000);
    await tick(el);
    expect(text(el)).toContain('23.5°');
    vi.advanceTimersByTime(1100);
    await tick(el);
    expect(text(el)).toContain('23°');
    expect(text(el)).not.toContain('23.5°');
  });

  it('clears every timer on disconnect after a send', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops the pending value when hass echoes the new target', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    (el as unknown as { hass: unknown }).hass = fakeHass({ states: { 'climate.living': heater({ temperature: 23.5 }) } });
    await tick(el);
    expect(text(el)).toContain('23.5°');
    vi.advanceTimersByTime(8000);
    await tick(el);
    expect(text(el)).toContain('23.5°');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops the pending value when the service call is rejected', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    h.callService.mockRejectedValueOnce(new Error('no'));
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    await vi.advanceTimersByTimeAsync(0);
    await tick(el);
    expect(text(el)).toContain('23°');
    expect(text(el)).not.toContain('23.5°');
  });

  it('keeps a pending tap when the config is set again for the same entity', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    (el as unknown as { setConfig(c: unknown): void }).setConfig({ entity: 'climate.living' });
    vi.advanceTimersByTime(800);
    expect(h.callService).toHaveBeenCalledTimes(1);
  });
});

describe('rune safe values', () => {
  it('survives min_temp equal to max_temp without NaN', async () => {
    const s = heater({ temperature: 20, min_temp: 20, max_temp: 20 });
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': s } }));
    expect(arc(el).getAttribute('stroke-dasharray')).toMatch(/^[\d.]+ 277$/);
    expectClean(el);
  });

  it('draws the heat_cool arc up to the high target', async () => {
    const s = st('heat_cool', { target_temp_low: 20, target_temp_high: 23, min_temp: 7, max_temp: 30 });
    const el = await mount(TAG, { entity: 'climate.living' }, fakeHass({ states: { 'climate.living': s } }));
    expect(arc(el).getAttribute('stroke-dasharray')).toBe('192.7 277');
  });

  it('numbers in the label and sub-line are tabular', () => {
    const css = CuestRuneGauge.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.gauge-sub\{[^}]*font-variant-numeric:tabular-nums/);
    expect(css).toMatch(/\.label\{[^}]*font-variant-numeric:tabular-nums/);
  });
});

describe('rune with several calls outstanding', () => {
  const echo = (el: HTMLElement, t: number) => {
    (el as unknown as { hass: unknown }).hass = fakeHass({ states: { 'climate.living': heater({ temperature: t }) } });
  };

  it('keeps a newer tap when an older call is rejected', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    h.callService.mockRejectedValueOnce(new Error('no'));
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    btn(el, 'Warmer').click();
    await vi.advanceTimersByTimeAsync(0);
    await tick(el);
    expect(text(el)).toContain('24°');
    vi.advanceTimersByTime(800);
    expect(h.callService).toHaveBeenCalledTimes(2);
    expect(h.callService).toHaveBeenLastCalledWith('climate', 'set_temperature', { entity_id: 'climate.living', temperature: 24 });
  });

  it('keeps the newer sent value when an older call is rejected late', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    h.callService.mockRejectedValueOnce(new Error('no'));
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    await vi.advanceTimersByTimeAsync(0);
    await tick(el);
    expect(text(el)).toContain('24°');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('does not flicker when a late echo of the older value arrives', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    echo(el, 23.5);
    await tick(el);
    expect(text(el)).toContain('24°');
    echo(el, 24);
    await tick(el);
    expect(text(el)).toContain('24°');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts an echo of a value that was never sent (device clamp or outside change)', async () => {
    const h = fakeHass({ states: { 'climate.living': heater() } });
    const el = await mount(TAG, { entity: 'climate.living' }, h);
    btn(el, 'Warmer').click();
    vi.advanceTimersByTime(800);
    echo(el, 25);
    await tick(el);
    expect(text(el)).toContain('25°');
    expect(text(el)).not.toContain('23.5°');
    expect(vi.getTimerCount()).toBe(0);
  });
});
