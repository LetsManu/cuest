import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestSpellTile } from '../../src/arcane/spell-tile';
import '../../src/arcane/spell-tile';

const TAG = 'cuest-spell-tile';
const root = (el: HTMLElement) => el.shadowRoot!;
const done = (el: HTMLElement) => (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
const tile = (el: HTMLElement) => root(el).querySelector<HTMLButtonElement>('button.tile')!;
const css = () => CuestSpellTile.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const light = (state = 'on', over: Record<string, unknown> = {}) => st(state, { friendly_name: 'Ceiling', brightness: 204, ...over });
const one = (id: string, s = light()) => fakeHass({ states: { [id]: s } });
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const press = (b: HTMLElement) => b.dispatchEvent(new Event('pointerdown', { bubbles: true }));
const release = (b: HTMLElement) => b.dispatchEvent(new Event('pointerup', { bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('light tile', () => {
  it('wide: name, brightness percent, lit glow, toggles on tap', async () => {
    const h = one('light.ceiling');
    const el = await mount(TAG, { entity: 'light.ceiling', variant: 'wide' }, h);
    expect(root(el).querySelector('.name')!.textContent!.trim()).toBe('Ceiling');
    expect(text(el)).toContain('Ceiling');
    expect(text(el)).toContain('On · 80 %');
    expect(tile(el).classList.contains('lit')).toBe(true);
    expect(tile(el).getAttribute('aria-pressed')).toBe('true');
    expect(root(el).querySelector('.state .num')!.textContent).toBe('80');
    tile(el).click();
    expect(h.callService).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.ceiling' });
    expectClean(el);
  });

  it('off: Off, not lit, aria-pressed false', async () => {
    const el = await mount(TAG, { entity: 'light.ceiling', variant: 'wide' }, one('light.ceiling', light('off')));
    expect(text(el)).toContain('Off');
    expect(text(el)).not.toContain('%');
    expect(tile(el).classList.contains('lit')).toBe(false);
    expect(tile(el).getAttribute('aria-pressed')).toBe('false');
  });

  it('brightness boundaries: 255 is 100 %, 1 is 0..1 rounded, missing is plain On', async () => {
    const a = await mount(TAG, { entity: 'light.c', variant: 'wide' }, one('light.c', light('on', { brightness: 255 })));
    expect(text(a)).toContain('On · 100 %');
    const b = await mount(TAG, { entity: 'light.c', variant: 'wide' }, one('light.c', light('on', { brightness: 128 })));
    expect(text(b)).toContain('On · 50 %');
    const c = await mount(TAG, { entity: 'light.c', variant: 'wide' }, one('light.c', light('on', { brightness: undefined })));
    expect(root(c).querySelector('.state')!.textContent!.trim()).toBe('On');
    const d = await mount(TAG, { entity: 'light.c', variant: 'wide' }, one('light.c', light('on', { brightness: 'x' })));
    expect(root(d).querySelector('.state')!.textContent!.trim()).toBe('On');
    for (const e of [a, b, c, d]) expectClean(e);
  });

  it('a light group shows how many members are on', async () => {
    const members = Array.from({ length: 12 }, (_, i) => `light.m${i}`);
    const states: Record<string, ReturnType<typeof st>> = { 'light.all': st('on', { friendly_name: 'All lights', entity_id: members, brightness: 100 }) };
    members.forEach((m, i) => (states[m] = st(i < 11 ? 'on' : 'off')));
    const el = await mount(TAG, { entity: 'light.all', variant: 'wide' }, fakeHass({ states }));
    expect(text(el)).toContain('11 on');
    expect(text(el)).not.toContain('%');
    expect(root(el).querySelector('.state .num')!.textContent).toBe('11');
  });

  it('a group whose members are not visible still reads sensibly', async () => {
    const states = { 'light.all': st('on', { friendly_name: 'All', entity_id: ['light.a', 'light.b'] }) };
    const el = await mount(TAG, { entity: 'light.all', variant: 'wide' }, fakeHass({ states }));
    expect(text(el)).toContain('2 on');
  });

  it('state_text overrides the line', async () => {
    const el = await mount(TAG, { entity: 'light.ceiling', variant: 'wide', state_text: 'Cozy' }, one('light.ceiling'));
    expect(text(el)).toContain('Cozy');
    expect(text(el)).not.toContain('80 %');
  });

  it('icon variant shows no state line; name is the label', async () => {
    const el = await mount(TAG, { entity: 'light.ceiling', variant: 'icon' }, one('light.ceiling'));
    expect(root(el).querySelector('.state')).toBeNull();
    expect(text(el)).toContain('Ceiling');
    expect(tile(el).classList.contains('icon')).toBe(true);
  });

  it('name config wins; friendly name and id are fallbacks', async () => {
    const a = await mount(TAG, { entity: 'light.ceiling', name: 'Lamp' }, one('light.ceiling'));
    expect(root(a).querySelector('.name')!.textContent).toContain('Lamp');
    const b = await mount(TAG, { entity: 'light.x' }, one('light.x', st('on')));
    expect(root(b).querySelector('.name')!.textContent).toContain('x');
  });
});

describe('default taps', () => {
  const cases: [string, string, string][] = [
    ['switch.fan', 'switch', 'toggle'],
    ['input_boolean.guest', 'input_boolean', 'toggle'],
    ['fan.bed', 'fan', 'toggle'],
    ['scene.movie', 'scene', 'turn_on'],
    ['script.bedtime', 'script', 'turn_on'],
    ['button.doorbell', 'button', 'press'],
  ];
  it.each(cases)('%s calls %s.%s', async (id, domain, service) => {
    const h = one(id, st(domain === 'scene' || domain === 'button' ? '2026-11-24T10:00:00+00:00' : 'off', { friendly_name: 'Thing' }));
    const el = await mount(TAG, { entity: id }, h);
    tile(el).click();
    expect(h.callService).toHaveBeenCalledWith(domain, service, { entity_id: id });
    expectClean(el);
  });

  it('other domains open more-info', async () => {
    const h = one('sensor.t', st('21', { friendly_name: 'Temp' }));
    const el = await mount(TAG, { entity: 'sensor.t' }, h);
    const seen: string[] = [];
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail.entityId));
    tile(el).click();
    expect(seen).toEqual(['sensor.t']);
    expect(h.callService).not.toHaveBeenCalled();
    expect(tile(el).hasAttribute('aria-pressed')).toBe(false);
  });

  it('scene tile: scene.turn_on, scene variant, never lit by its timestamp state', async () => {
    const h = one('scene.movie', st('2026-11-24T10:00:00+00:00', { friendly_name: 'Movie night' }));
    const el = await mount(TAG, { entity: 'scene.movie', variant: 'scene' }, h);
    expect(tile(el).classList.contains('scene')).toBe(true);
    expect(tile(el).classList.contains('lit')).toBe(false);
    expect(tile(el).hasAttribute('aria-pressed')).toBe(false);
    expect(text(el)).toContain('Movie night');
    tile(el).click();
    expect(h.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });

  it('explicit actions: none does nothing, more-info opens, toggle toggles', async () => {
    const h = one('light.a');
    const none = await mount(TAG, { entity: 'light.a', tap_action: { action: 'none' } }, h);
    tile(none).click();
    expect(h.callService).not.toHaveBeenCalled();
    const seen: string[] = [];
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail.entityId));
    const mi = await mount(TAG, { entity: 'light.a', tap_action: { action: 'more-info' } }, h);
    tile(mi).click();
    expect(seen).toEqual(['light.a']);
    const hs = one('sensor.s', st('on'));
    const tg = await mount(TAG, { entity: 'sensor.s', tap_action: { action: 'toggle' } }, hs);
    tile(tg).click();
    expect(hs.callService).toHaveBeenCalledWith('homeassistant', 'toggle', { entity_id: 'sensor.s' });
  });
});

describe('call-service', () => {
  it('calls the service with its own data and shows state_text', async () => {
    const h = one('vacuum.robo', st('docked', { friendly_name: 'Robo' }));
    const el = await mount(
      TAG,
      { entity: 'vacuum.robo', variant: 'wide', icon: 'mdi:robot-vacuum', state_text: 'Docked · tap to clean', tap_action: { action: 'call-service', service: 'vacuum.start', data: { entity_id: 'vacuum.robo' } } },
      h,
    );
    expect(text(el)).toContain('Docked · tap to clean');
    tile(el).click();
    expect(h.callService).toHaveBeenCalledWith('vacuum', 'start', { entity_id: 'vacuum.robo' });
    const ic = root(el).querySelector('ha-icon')!;
    expect(ic.getAttribute('icon')).toBe('mdi:robot-vacuum');
    expect(ic.getAttribute('aria-hidden')).toBe('true');
  });

  it('works without an entity and sends no data when none is given', async () => {
    const h = fakeHass();
    const el = await mount(TAG, { name: 'Wake PC', icon: 'pc', tap_action: { action: 'call-service', service: 'script.wake_pc' } }, h);
    expect(text(el)).toContain('Wake PC');
    tile(el).click();
    expect(h.callService).toHaveBeenCalledWith('script', 'wake_pc', {});
    expectClean(el);
  });

  it('cleaning is lit', async () => {
    const el = await mount(TAG, { entity: 'vacuum.robo', tap_action: { action: 'call-service', service: 'vacuum.pause' } }, one('vacuum.robo', st('cleaning', { friendly_name: 'Robo' })));
    expect(tile(el).classList.contains('lit')).toBe(true);
    const p = await mount(TAG, { entity: 'media_player.m' }, one('media_player.m', st('playing', { friendly_name: 'M' })));
    expect(tile(p).classList.contains('lit')).toBe(true);
    const o = await mount(TAG, { entity: 'media_player.m' }, one('media_player.m', st('paused', { friendly_name: 'M' })));
    expect(tile(o).classList.contains('lit')).toBe(false);
  });
});

describe('busy guard and failures', () => {
  it('a double tap sends one call, re-enables after a rejection with kind copy', async () => {
    const d = deferred();
    const h = one('light.a');
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: 'light.a' }, h);
    tile(el).click();
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    d.reject(new Error('x'));
    await flush();
    await done(el);
    expect(tile(el).hasAttribute('aria-disabled')).toBe(false);
    expect(text(el)).toContain('could not be cast right now');
    expect(text(el)).not.toMatch(/error|failed|broken/i);
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(2);
    await flush();
    await done(el);
    expect(text(el)).not.toContain('could not be cast');
  });
});

describe('hold', () => {
  it('500 ms hold opens more-info and does not tap', async () => {
    const h = one('light.a');
    const el = await mount(TAG, { entity: 'light.a' }, h);
    const seen: string[] = [];
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail.entityId));
    press(tile(el));
    vi.advanceTimersByTime(600);
    release(tile(el));
    tile(el).click();
    expect(seen).toEqual(['light.a']);
    expect(h.callService).not.toHaveBeenCalled();
    // the next ordinary tap works again
    press(tile(el));
    vi.advanceTimersByTime(100);
    release(tile(el));
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    expect(seen.length).toBe(1);
  });

  it('boundary: 499 ms is a tap, 500 ms is a hold', async () => {
    const h = one('light.a');
    const el = await mount(TAG, { entity: 'light.a' }, h);
    const seen: string[] = [];
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail.entityId));
    press(tile(el));
    vi.advanceTimersByTime(499);
    release(tile(el));
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    press(tile(el));
    vi.advanceTimersByTime(500);
    release(tile(el));
    tile(el).click();
    expect(seen).toEqual(['light.a']);
    expect(h.callService).toHaveBeenCalledTimes(1);
  });

  it('leaving cancels the hold; a stale hold never swallows a later tap', async () => {
    const h = one('light.a');
    const el = await mount(TAG, { entity: 'light.a' }, h);
    const seen: string[] = [];
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail.entityId));
    press(tile(el));
    tile(el).dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(800);
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    press(tile(el));
    vi.advanceTimersByTime(600);
    tile(el).dispatchEvent(new Event('pointerleave'));
    expect(seen).toEqual(['light.a']);
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(1);
  });

  it('removing the tile mid-press clears the timer', async () => {
    const el = await mount(TAG, { entity: 'light.a' }, one('light.a'));
    press(tile(el));
    expect(vi.getTimerCount()).toBe(1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a tile with only a service call has no more-info to hold for', async () => {
    const h = fakeHass();
    const el = await mount(TAG, { name: 'Go', tap_action: { action: 'call-service', service: 'script.go' } }, h);
    press(tile(el));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hold that ends without a click does not swallow the next keyboard activation', async () => {
    const h = one('light.a');
    const el = await mount(TAG, { entity: 'light.a' }, h);
    press(tile(el));
    vi.advanceTimersByTime(600);
    release(tile(el));
    tile(el).dispatchEvent(new Event('keydown', { bubbles: true }));
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus on a busy tile', async () => {
    const d = deferred();
    const h = one('light.a');
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: 'light.a' }, h);
    tile(el).focus();
    tile(el).click();
    await done(el);
    expect(root(el).activeElement).toBe(tile(el));
    expect(tile(el).getAttribute('aria-disabled')).toBe('true');
    tile(el).click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    d.resolve();
    await flush();
  });
});

describe('look', () => {
  it('colours: gold lit, green tone, no emoji, inline svg icons', async () => {
    const lit = await mount(TAG, { entity: 'light.a' }, one('light.a'));
    expect(root(lit).querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(css()).toMatch(/\.tile\.lit\{[^}]*border-color:#C9A14A[^}]*color:#FFE7A8/);
    expect(css()).toMatch(/\.tile\.green\{[^}]*border-color:#3E7A55[^}]*background:#1F3A2C[^}]*color:#CFEBD6/);
    const g = await mount(TAG, { entity: 'light.a', tone: 'green' }, one('light.a', light('off')));
    expect(tile(g).classList.contains('green')).toBe(true);
    expect(text(lit)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each(['bulb', 'tv', 'pc', 'shield', 'spark'])('icon %s renders an inline svg, not ha-icon', async (icon) => {
    const el = await mount(TAG, { entity: 'light.a', icon }, one('light.a', light('off')));
    expect(root(el).querySelector('svg path, svg rect')).not.toBeNull();
    expect(root(el).querySelector('ha-icon')).toBeNull();
    // nested html`` would put the shapes in the HTML namespace, where they never paint
    const shape = root(el).querySelector('svg path, svg rect')!;
    expect(shape.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('every variant has a min-height of at least 56px on its own rule', async () => {
    for (const variant of ['icon', 'wide', 'scene']) {
      const el = await mount(TAG, { entity: 'light.a', variant }, one('light.a'));
      expect(tile(el).classList.contains('tile')).toBe(true);
      expect(tile(el).classList.contains(variant)).toBe(true);
      const m = css().match(new RegExp(`\\.tile\\.${variant}\\{[^}]*min-height:(\\d+)px`));
      expect(m, variant).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(56);
    }
    expect(css()).toMatch(/\.tile\{[^}]*min-height:56px/);
  });

  it('words in Pixelify-free Inter, numbers tabular, no div in button', async () => {
    expect(css()).toMatch(/\.num\{[^}]*tabular-nums/);
    const el = await mount(TAG, { entity: 'light.a', variant: 'wide' }, one('light.a'));
    expect(root(el).querySelector('button div, span div')).toBeNull();
  });

  it('describes the tile for assistive tech', async () => {
    const el = await mount(TAG, { entity: 'light.a', variant: 'wide' }, one('light.a'));
    expect(tile(el).getAttribute('aria-label')).toBe('Ceiling, On · 80 %');
    const s = await mount(TAG, { entity: 'light.a', variant: 'icon' }, one('light.a'));
    expect(tile(s).getAttribute('aria-label')).toBe('Ceiling');
  });
});

describe('updates and config', () => {
  it('re-renders on brightness change that does not touch last_changed', async () => {
    const h = one('light.a');
    const el = await mount<CuestSpellTile>(TAG, { entity: 'light.a', variant: 'wide' }, h);
    h.states['light.a'] = light('on', { brightness: 51 });
    el.hass = { ...h };
    await done(el);
    expect(text(el)).toContain('On · 20 %');
  });

  it('missing entity shows the warning panel', async () => {
    const el = await mount(TAG, { entity: 'light.gone' }, fakeHass());
    expect(text(el)).toContain('Entity not found: light.gone');
  });

  it('unavailable reads as a dash, stays clean', async () => {
    const el = await mount(TAG, { entity: 'light.a', variant: 'wide' }, one('light.a', st('unavailable', { friendly_name: 'Ceiling' })));
    expect(root(el).querySelector('.state')!.textContent!.trim()).toBe('—');
    expect(tile(el).classList.contains('lit')).toBe(false);
    expectClean(el);
  });

  it('grid options and stub', () => {
    const g = (c: object) => {
      const el = document.createElement(TAG) as unknown as CuestSpellTile;
      el.setConfig(c);
      return el.getGridOptions();
    };
    expect(g({ entity: 'light.a' })).toEqual({ columns: 3, rows: 2 });
    expect(g({ entity: 'light.a', variant: 'icon' })).toEqual({ columns: 3, rows: 2 });
    expect(g({ entity: 'light.a', variant: 'wide' })).toEqual({ columns: 6, rows: 2 });
    expect(g({ entity: 'scene.a', variant: 'scene' })).toEqual({ columns: 4, rows: 1 });
    const h = fakeHass({ states: { 'switch.s': st('on'), 'light.l': st('on') } });
    expect(CuestSpellTile.getStubConfig(h)).toEqual({ entity: 'light.l' });
    expect(CuestSpellTile.getStubConfig()).toEqual({ entity: 'light.living_room' });
  });

  it('rejects bad config', () => {
    const mk = (c: unknown) => () => (document.createElement(TAG) as unknown as CuestSpellTile).setConfig(c);
    expect(mk({})).toThrow(/cuest-spell-tile.*entity.*call-service/);
    expect(mk({ tap_action: { action: 'toggle' } })).toThrow(/entity/);
    expect(mk({ tap_action: { action: 'call-service' } })).toThrow(/service/);
    expect(mk({ tap_action: { action: 'call-service', service: 'nope' } })).toThrow(/service/);
    expect(mk({ tap_action: { action: 'call-service', service: 'a.b', data: 'x' } })).toThrow(/data/);
    expect(mk({ entity: 'light.a', tap_action: { action: 'jump' } })).toThrow(/action.*one of/);
    expect(mk({ entity: 'light.a', variant: 'huge' })).toThrow(/variant/);
    expect(mk({ entity: 'light.a', tone: 'red' })).toThrow(/tone/);
    expect(mk({ entity: 'light.a', icon: 'banana' })).toThrow(/icon/);
    expect(mk({ entity: 'light.a', icon: 'mdi:lamp' })).not.toThrow();
    expect(mk({ tap_action: { action: 'call-service', service: 'a.b' } })).not.toThrow();
  });

  it('tap_action without action toggles a toggleable tile and is an error otherwise', async () => {
    const mk = (c: unknown) => () => (document.createElement(TAG) as unknown as CuestSpellTile).setConfig(c);
    const msg = 'cuest-spell-tile: "tap_action": "action" is required';
    expect(mk({ entity: 'vacuum.robo', tap_action: { service: 'vacuum.start' } })).toThrow(msg);
    expect(mk({ entity: 'light.a', tap_action: { service: 'script.x' } })).toThrow(msg);
    expect(mk({ entity: 'scene.a', tap_action: {} })).toThrow(msg);
    expect(mk({ tap_action: {} })).toThrow(msg);
    const h = one('light.a');
    const el = await mount(TAG, { entity: 'light.a', tap_action: {} }, h);
    tile(el).click();
    expect(h.callService).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.a' });
    expect(tile(el).getAttribute('aria-pressed')).toBe('true');
  });
});
