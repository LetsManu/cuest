import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestArcaneHeader } from '../../src/arcane/header';
import '../../src/arcane/orb';

const TAG = 'cuest-arcane-header';
const root = (el: HTMLElement) => el.shadowRoot!;

const lights = (on: number) => ({
  'light.a': st(on >= 1 ? 'on' : 'off'),
  'light.b': st(on >= 2 ? 'on' : 'off'),
  'light.c': st(on >= 3 ? 'on' : 'off'),
  'light.d': st(on >= 4 ? 'on' : 'off'),
  'light.all': st('on', { entity_id: ['light.a', 'light.b'] }),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 24, 16, 40, 0));
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('header phone', () => {
  it('lights windows by share of lights on, ignoring groups', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: lights(3) }));
    expect(root(el).querySelectorAll('.win.lit').length).toBe(4);
    expect(root(el).querySelectorAll('.win').length).toBe(5);
  });

  it('keeps every window dark when nothing is on', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: lights(0) }));
    expect(root(el).querySelectorAll('.win.lit').length).toBe(0);
  });

  it('lights one window for a single light on of many', async () => {
    const states: Record<string, ReturnType<typeof st>> = {};
    for (let i = 0; i < 20; i++) states[`light.l${i}`] = st(i === 0 ? 'on' : 'off');
    const el = await mount(TAG, {}, fakeHass({ states }));
    expect(root(el).querySelectorAll('.win.lit').length).toBe(1);
  });

  it('shows title, clock line and mood; village is hidden from assistive tech', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: lights(1) }));
    expect(root(el).querySelector('h1')!.textContent).toBe('Cuest Home');
    expect(text(el)).toContain('Tuesday 16:40 · the house is happy');
    expect(root(el).querySelector('svg.village')!.getAttribute('aria-hidden')).toBe('true');
    expect(root(el).querySelectorAll('.house').length).toBe(2);
    expectClean(el);
  });

  it('shows configured temperatures and omits missing ones', async () => {
    const h = fakeHass({ states: { ...lights(1), 'sensor.outside': st('-0.7'), 'sensor.inside': st('21.5') } });
    const el = await mount(TAG, { outside: 'sensor.outside', inside: 'sensor.inside' }, h);
    expect(text(el)).toContain('-0.7° outside');
    expect(text(el)).toContain('21.5° inside');
  });

  it('omits the line for a missing or unavailable decorative entity', async () => {
    const h = fakeHass({ states: { ...lights(1), 'sensor.inside': st('unavailable') } });
    const el = await mount(TAG, { outside: 'sensor.outside', inside: 'sensor.inside' }, h);
    expect(text(el)).not.toContain('outside');
    expect(text(el)).not.toContain('inside');
    expect(root(el).querySelector('.warn')).toBeNull();
    expectClean(el);
  });

  it('re-renders when the outside temperature changes', async () => {
    const el = await mount<{ hass: unknown }>(TAG, { outside: 'sensor.outside' }, fakeHass({ states: { 'sensor.outside': st('1') } }));
    expect(text(el)).toContain('1° outside');
    el.hass = fakeHass({ states: { 'sensor.outside': st('2') } });
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('2° outside');
  });

  it('flickers lit windows but honours reduced motion', () => {
    const css = CuestArcaneHeader.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.win\.lit\{[^}]*animation:flicker 4s/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^}]*\.win\.lit\{animation:none\}/);
  });
});

describe('header clock', () => {
  it('moves to the next minute on the boundary and clears timers on disconnect', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: lights(1) }));
    expect(text(el)).toContain('16:40');
    vi.advanceTimersByTime(60_000);
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('16:41');
    vi.advanceTimersByTime(60_000);
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('16:42');
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aligns the first tick to the minute boundary', async () => {
    vi.setSystemTime(new Date(2026, 10, 24, 16, 40, 45));
    const el = await mount(TAG, {}, fakeHass({ states: lights(1) }));
    vi.advanceTimersByTime(15_000);
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('16:41');
  });
});

describe('header wide', () => {
  const states = {
    ...lights(1),
    'sensor.outside': st('-0.7'),
    'sensor.b1_battery': st('3', { device_class: 'battery', unit_of_measurement: '%' }),
  };
  const orbs = [{ preset: 'online' }, { preset: 'health' }, { preset: 'lights' }];

  it('shows stars, a larger title and three 72px orbs without the village', async () => {
    const el = await mount(TAG, { variant: 'wide', outside: 'sensor.outside', orbs }, fakeHass({ states }));
    expect(root(el).querySelectorAll('.house').length).toBe(0);
    expect(root(el).querySelector('svg.village')).toBeNull();
    expect(root(el).querySelectorAll('.star').length).toBe(5);
    const svgs = root(el).querySelectorAll('svg[role="img"]');
    expect(svgs.length).toBe(3);
    for (const s of Array.from(svgs)) expect(s.getAttribute('width')).toBe('72');
    expect(new Set(Array.from(root(el).querySelectorAll('clipPath')).map((c) => c.id)).size).toBe(3);
    expect(text(el)).toContain('Tuesday 16:40 · the house is happy · -0.7° outside');
    expect(text(el)).toContain('Mana · online');
    expect(text(el)).toContain('Glow · lights on');
    expectClean(el);
  });

  it('rejects orbs on the phone variant', () => {
    const c = document.createElement(TAG) as unknown as { setConfig(c: unknown): void };
    expect(() => c.setConfig({ variant: 'phone', orbs })).toThrow(/only with variant: wide/);
    expect(() => c.setConfig({ orbs })).toThrow(/only with variant: wide/);
    expect(() => c.setConfig({ variant: 'wide', orbs: Array(5).fill(orbs[0]) })).toThrow(/at most 4/);
  });

  it('reports grid options and card size per variant', () => {
    const mk = (cfg: object) => {
      const el = document.createElement(TAG) as unknown as { setConfig(c: unknown): void; getGridOptions(): unknown; getCardSize(): number };
      el.setConfig(cfg);
      return el;
    };
    expect(mk({}).getGridOptions()).toEqual({ columns: 'full', rows: 4 });
    expect(mk({}).getCardSize()).toBe(4);
    expect(mk({ variant: 'wide' }).getGridOptions()).toEqual({ columns: 'full', rows: 3 });
    expect(mk({ variant: 'wide' }).getCardSize()).toBe(3);
  });

  it('shows the warning for a required orb entity that is missing', async () => {
    const el = await mount(TAG, { variant: 'wide', orbs: [{ preset: 'percent', entity: 'sensor.nope' }] }, fakeHass());
    expect(text(el)).toContain('Entity not found: sensor.nope');
  });
});

describe('registration', () => {
  it('registers once as Arcane header', () => {
    const cards = (window.customCards ?? []).filter((c) => c.type === TAG);
    expect(cards.length).toBe(1);
    expect(cards[0].name).toBe('Arcane header');
  });
});
