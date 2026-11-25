import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestArcaneHeader } from '../../src/arcane/header';
import { clockLine } from '../../src/arcane/format';
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

  it('lights windows in the mockup order: the big house right window comes last', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: lights(3) }));
    const lit = Array.from(root(el).querySelectorAll('rect.win.lit')).map((r) => r.getAttribute('x'));
    expect(lit).toEqual(['42', '68', '172', '245']);
    const dark = Array.from(root(el).querySelectorAll('rect.win:not(.lit)')).map((r) => r.getAttribute('x'));
    expect(dark).toEqual(['94']);
    expect(root(el).querySelectorAll('rect.halo').length).toBe(4);
    const css = CuestArcaneHeader.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.halo\{[^}]*filter:blur\(4px\)/);
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

  it('re-renders when the inside temperature changes', async () => {
    const el = await mount<{ hass: unknown }>(TAG, { inside: 'sensor.inside' }, fakeHass({ states: { 'sensor.inside': st('20') } }));
    expect(text(el)).toContain('20° inside');
    el.hass = fakeHass({ states: { 'sensor.inside': st('22') } });
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('22° inside');
  });

  it('scales the village to the card width with the ground reaching both edges', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: lights(1) }));
    const svg = root(el).querySelector('svg.village')!;
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('210');
    expect(svg.getAttribute('viewBox')).toBe('0 0 390 210');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
    const ground = svg.querySelector('rect.ground')!;
    expect(Number(ground.getAttribute('x'))).toBeLessThanOrEqual(-1000);
    expect(Number(ground.getAttribute('x')) + Number(ground.getAttribute('width'))).toBeGreaterThanOrEqual(1390);
    const css = CuestArcaneHeader.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.village\{[^}]*width:100%/);
  });

  it('is a rounded card like the others', async () => {
    const css = CuestArcaneHeader.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/--arc-radius:18px/);
    expect(css).toMatch(/\.sky\{[^}]*border-radius:var\(--arc-radius\)/);
    expect(css).toMatch(/\.panel\{[^}]*border-radius:var\(--arc-radius\)/);
    const el = await mount(TAG, {}, fakeHass({ states: lights(1) }));
    expect(root(el).querySelector('.sky')).not.toBeNull();
  });

  it('flickers lit windows but honours reduced motion', () => {
    const css = CuestArcaneHeader.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.win\.lit\{[^}]*animation:flicker 4s/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^}]*\.win\.lit\{animation:none\}/);
  });
});

describe('header title and section', () => {
  it('renders a page title with an optional link and no village, clock or timers', async () => {
    const el = await mount(TAG, { variant: 'title', title: 'Quest board', link: { name: 'Home', path: '/system-ok/ok' } }, fakeHass({ states: lights(1) }));
    expect(root(el).querySelector('h1')!.textContent).toBe('Quest board');
    expect(root(el).querySelector('svg.village')).toBeNull();
    expect(root(el).querySelector('.star')).toBeNull();
    expect(text(el)).not.toContain('16:40');
    expect(vi.getTimerCount()).toBe(0);
    const spy = vi.fn();
    window.addEventListener('location-changed', spy);
    const link = root(el).querySelector<HTMLButtonElement>('button.link')!;
    expect(link.textContent).toBe('Home');
    link.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/system-ok/ok');
    window.removeEventListener('location-changed', spy);
    expectClean(el);
  });

  it('renders a section heading as h2 on its own dusk plate', async () => {
    const el = await mount(TAG, { variant: 'section', title: 'Scenes' }, fakeHass());
    expect(root(el).querySelector('h2')!.textContent).toBe('Scenes');
    expect(root(el).querySelector('h1')).toBeNull();
    expect(root(el).querySelector('.plate')).not.toBeNull();
    expect(root(el).querySelector('button')).toBeNull();
  });

  it('paints headings independent of the Home Assistant theme', () => {
    const css = CuestArcaneHeader.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.plate\{background:#14172A;border-radius:var\(--arc-radius\)\}/);
    expect(css).toMatch(/h1\{[^}]*font-weight:700[^}]*color:#F7D27A[^}]*font-size:28px/);
    expect(css).toMatch(/h2\{[^}]*font-family:'Pixelify Sans'[^}]*font-weight:700[^}]*font-size:18px[^}]*color:#F7D27A/);
    expect(css).toMatch(/\.heading\.plate\{border-radius:6px\}/);
    expect(css).toMatch(/\.heading \.link\{[^}]*min-height:44px[^}]*text-decoration:underline/);
  });

  it('checks title and link options', () => {
    const c = document.createElement(TAG) as unknown as { setConfig(c: unknown): void };
    expect(() => c.setConfig({ variant: 'title' })).toThrow(/"title" is required for variant: title/);
    expect(() => c.setConfig({ variant: 'section', title: 'x', link: 'home' })).toThrow(/"link" must be an object/);
    expect(() => c.setConfig({ variant: 'section', title: 'x', link: { name: 'Home' } })).toThrow(/"path" is required/);
    expect(() => c.setConfig({ link: { name: 'Home', path: '/' } })).toThrow(/"link" works only with variant: title or section/);
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

  it("uses Home Assistant's time zone unless the user picked their own", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 24, 15, 40)));
    const withTz = (time_zone?: 'local' | 'server') =>
      Object.assign(fakeHass({ states: lights(1) }), { config: { time_zone: 'Asia/Tokyo' }, locale: { language: 'en', ...(time_zone ? { time_zone } : {}) } });
    const server = await mount(TAG, {}, withTz('server'));
    expect(text(server)).toContain('Wednesday 00:40 · the house is happy');
    const unset = await mount(TAG, {}, withTz());
    expect(text(unset)).toContain('Wednesday 00:40');
    const local = await mount(TAG, {}, withTz('local'));
    expect(text(local)).toContain(`${clockLine(new Date(), 'en')} · the house is happy`);
    const wide = await mount(TAG, { variant: 'wide' }, withTz('server'));
    expect(text(wide)).toContain('Wednesday 00:40');
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
    expect(root(el).querySelectorAll('.spin').length).toBe(0);
    for (const c of Array.from(root(el).querySelectorAll('circle[r="54"]'))) expect(c.getAttribute('stroke-width')).toBe('5');
    expect(root(el).querySelector('.orbitem .val')!.classList.contains('num')).toBe(true);
    expect(CuestArcaneHeader.styles.map((x) => (x as { cssText: string }).cssText).join('')).toMatch(/\.orbitem \.val\{[^}]*font-family:Inter[^}]*font-weight:700[^}]*tabular-nums/);
    expect(CuestArcaneHeader.styles.map((x) => (x as { cssText: string }).cssText).join('')).not.toMatch(/drop-shadow/);
    expect(text(el)).toContain('Glow · 1 light on');
    expectClean(el);
  });

  it('shows the inside temperature too, like the phone header', async () => {
    const h = fakeHass({ states: { ...states, 'sensor.inside': st('21.5') } });
    const el = await mount(TAG, { variant: 'wide', outside: 'sensor.outside', inside: 'sensor.inside' }, h);
    expect(text(el)).toContain('Tuesday 16:40 · the house is happy · -0.7° outside · 21.5° inside');
    const only = await mount(TAG, { variant: 'wide', inside: 'sensor.inside' }, h);
    expect(text(only)).toContain('the house is happy · 21.5° inside');
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
    // Content height, so a sections view neither clips the card nor leaves a gap under it.
    expect(mk({}).getGridOptions()).toEqual({ columns: 'full', rows: 'auto' });
    expect(mk({}).getCardSize()).toBe(4);
    expect(mk({ variant: 'wide' }).getGridOptions()).toEqual({ columns: 'full', rows: 'auto' });
    expect(mk({ variant: 'wide' }).getCardSize()).toBe(3);
    expect(mk({ variant: 'title', title: 'Spells' }).getCardSize()).toBe(1);
  });

  it('shows the warning for a required orb entity that is missing', async () => {
    const el = await mount(TAG, { variant: 'wide', orbs: [{ preset: 'percent', entity: 'sensor.nope' }] }, fakeHass());
    expect(text(el)).toContain('Entity not found: sensor.nope');
  });
});

describe('registration', () => {
  it('registers once as Cuest header', () => {
    const cards = (window.customCards ?? []).filter((c) => c.type === TAG);
    expect(cards.length).toBe(1);
    expect(cards[0].name).toBe('Cuest header');
  });
});
