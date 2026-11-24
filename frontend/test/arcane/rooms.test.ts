import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import '../../src/arcane/rooms';

const TAG = 'cuest-rooms-card';
const root = (el: HTMLElement) => el.shadowRoot!;
const rowTexts = (el: HTMLElement) => Array.from(root(el).querySelectorAll('.row')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
const T = (v: string) => st(v, { device_class: 'temperature', unit_of_measurement: '°C' });

function house(language = 'en') {
  return fakeHass({
    language,
    areas: {
      wohnzimmer: { area_id: 'wohnzimmer', name: 'Wohnzimmer' },
      kuche: { area_id: 'kuche', name: 'Küche' },
      schlafzimmer: { area_id: 'schlafzimmer', name: 'Schlafzimmer' },
      buro: { area_id: 'buro', name: 'Büro' },
    },
    states: {
      'sensor.wz_temp': T('21.5'),
      'sensor.kuche_temp': T('22.5'),
      'sensor.buro_temp': T('-327.7'),
      'sensor.buro_battery': st('4', { device_class: 'battery', unit_of_measurement: '%' }),
      'sensor.other': T('19'),
      'light.wz_group': st('on', { entity_id: ['light.wz_a', 'light.wz_b'] }),
      'light.wz_a': st('on'),
      'light.wz_b': st('on'),
      'light.kuche_a': st('off'),
      'light.sz_a': st('on'),
    },
    entities: {
      'sensor.wz_temp': { platform: 'zha', area_id: 'wohnzimmer' },
      'sensor.kuche_temp': { platform: 'zha', area_id: 'kuche' },
      'sensor.buro_temp': { platform: 'zha', area_id: 'buro', device_id: 'dburo' },
      'sensor.buro_battery': { platform: 'zha', device_id: 'dburo' },
      'sensor.other': { platform: 'zha' },
      'light.wz_group': { platform: 'group', area_id: 'wohnzimmer' },
      'light.wz_a': { platform: 'hue', area_id: 'wohnzimmer' },
      'light.wz_b': { platform: 'hue', area_id: 'wohnzimmer' },
      'light.kuche_a': { platform: 'hue', area_id: 'kuche' },
      'light.sz_a': { platform: 'hue', area_id: 'schlafzimmer' },
    },
    devices: { dburo: { id: 'dburo', name: 'Thermostat Büro', area_id: 'buro' } },
  });
}
const AREAS = ['Wohnzimmer', 'Küche', 'Schlafzimmer', 'Büro'];

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('rooms card', () => {
  it('lists configured areas in order with temperature and lights', async () => {
    const el = await mount(TAG, { areas: AREAS }, house());
    expect(rowTexts(el)).toEqual(['Wohnzimmer 21.5° 2 lit', 'Küche 22.5° dark', 'Schlafzimmer — 1 lit', 'Büro ? battery']);
    expect(text(el)).toContain('Rooms');
    expect(root(el).querySelector('h2')!.textContent).toBe('Rooms');
    expectClean(el);
  });

  it('puts numbers in .num, colours the states and keeps the status column 52px', async () => {
    const el = await mount(TAG, { areas: AREAS }, house());
    const rows = Array.from(root(el).querySelectorAll('.row'));
    expect(rows[0].querySelector('.temp .num')!.textContent).toBe('21.5°');
    expect(rows[0].querySelector('.status .num')!.textContent).toBe('2');
    expect(rows[0].querySelector('.status')!.classList.contains('lit-on')).toBe(true);
    expect(rows[1].querySelector('.status')!.classList.contains('lit-on')).toBe(false);
    expect(rows[2].querySelector('.temp')!.classList.contains('muted')).toBe(true);
    expect(rows[3].querySelector('.temp')!.classList.contains('warn-text')).toBe(true);
    expect(rows[3].querySelector('.status')!.classList.contains('warn-text')).toBe(true);
    const css = (customElements.get(TAG) as unknown as { elementStyles: { cssText: string }[] }).elementStyles.map((s) => s.cssText).join('\n');
    const status = /\.status\s*\{([^}]*)\}/.exec(css)![1];
    expect(status).toMatch(/min-width:\s*52px/);
    expect(status).toMatch(/white-space:\s*nowrap/);
    expect(/(?<![-\w])width:/.test(status)).toBe(false);
    expect(/\.temp\s*\{[^}]*font-size:\s*18px/.test(css)).toBe(true);
  });

  it('says "check" when the only reading is impossible and no battery is low', async () => {
    const h = house();
    h.states['sensor.buro_battery'] = st('80', { device_class: 'battery', unit_of_measurement: '%' });
    const el = await mount(TAG, { areas: ['Büro'] }, h);
    expect(rowTexts(el)).toEqual(['Büro ? check']);
  });

  it('formats the temperature for the viewer language', async () => {
    const el = await mount(TAG, { areas: AREAS }, house('de'));
    expect(rowTexts(el)[0]).toBe('Wohnzimmer 21,5° 2 lit');
  });

  it('uses the singular for one light and finds areas by id', async () => {
    const el = await mount(TAG, { areas: ['schlafzimmer'] }, house());
    expect(rowTexts(el)).toEqual(['Schlafzimmer — 1 lit']);
  });

  it('lists every area, sorted by name, when none are configured', async () => {
    const el = await mount(TAG, {}, house());
    expect(rowTexts(el).map((r) => r.split(' ')[0])).toEqual(['Büro', 'Küche', 'Schlafzimmer', 'Wohnzimmer']);
  });

  it('uses a configured name and temperature override', async () => {
    const el = await mount(TAG, { areas: [{ area: 'Wohnzimmer', name: 'Living', temperature: 'sensor.other' }] }, house());
    expect(rowTexts(el)).toEqual(['Living 19° 2 lit']);
  });

  it('rows are buttons that navigate to the path with the area id', async () => {
    const seen = vi.fn();
    window.addEventListener('location-changed', seen);
    const el = await mount(TAG, { areas: AREAS, path: '/home-control#{area}' }, house());
    const rows = Array.from(root(el).querySelectorAll('.row'));
    expect(rows.every((r) => r.localName === 'button' && r.getAttribute('type') === 'button')).toBe(true);
    (rows[1] as HTMLElement).click();
    expect(location.pathname + location.hash).toBe('/home-control#kuche');
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('location-changed', seen);
  });

  it('rows are not buttons without a path', async () => {
    const el = await mount(TAG, { areas: AREAS }, house());
    expect(root(el).querySelector('button')).toBeNull();
    expect(root(el).querySelectorAll('.row')).toHaveLength(4);
  });

  it('button rows are at least 44px tall by rule and carry the row class', async () => {
    const el = await mount(TAG, { areas: AREAS, path: '/x' }, house());
    const css = (customElements.get(TAG) as unknown as { elementStyles: { cssText: string }[] }).elementStyles.map((s) => s.cssText).join('\n');
    const rule = /(?:^|[}\s,])\.row\s*\{[^}]*min-height:\s*(\d+)px/.exec(css);
    expect(Number(rule![1])).toBeGreaterThanOrEqual(44);
    expect(root(el).querySelector('button')!.classList.contains('row')).toBe(true);
  });

  it('has no div inside a span or button', async () => {
    const el = await mount(TAG, { areas: AREAS, path: '/x' }, house());
    expect(root(el).querySelectorAll('span div, button div')).toHaveLength(0);
  });

  it('title null hides the heading; a title replaces it', async () => {
    const none = await mount(TAG, { areas: AREAS, title: null }, house());
    expect(root(none).querySelector('h2')).toBeNull();
    const own = await mount(TAG, { areas: AREAS, title: 'Zimmer' }, house());
    expect(root(own).querySelector('h2')!.textContent).toBe('Zimmer');
  });

  it('heading inside puts the h2 in the panel', async () => {
    const el = await mount(TAG, { areas: AREAS, heading: 'inside' }, house());
    expect(root(el).querySelector('.panel h2')).not.toBeNull();
    const out = await mount(TAG, { areas: AREAS }, house());
    expect(root(out).querySelector('.panel h2')).toBeNull();
  });

  it('shows the resting copy without areas', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: {} }));
    expect(text(el)).toContain('No rooms yet. Add areas in Home Assistant.');
    const unmatched = await mount(TAG, { areas: ['Nowhere'] }, house());
    expect(text(unmatched)).toContain('No rooms yet. Add areas in Home Assistant.');
    expectClean(el);
  });

  it('takes battery_threshold from 1 to 100', () => {
    const el = document.createElement(TAG) as HTMLElement & { setConfig(c: unknown): void };
    expect(() => el.setConfig({ battery_threshold: 0 })).toThrow('cuest-rooms-card: "battery_threshold" must be between 1 and 100');
    expect(() => el.setConfig({ battery_threshold: 101 })).toThrow(/between 1 and 100/);
    expect(() => el.setConfig({ battery_threshold: 1 })).not.toThrow();
  });

  it('battery_threshold decides battery versus check at the boundary', async () => {
    const at = await mount(TAG, { areas: ['Büro'], battery_threshold: 4 }, house());
    expect(rowTexts(at)).toEqual(['Büro ? battery']);
    const under = await mount(TAG, { areas: ['Büro'], battery_threshold: 3 }, house());
    expect(rowTexts(under)).toEqual(['Büro ? check']);
  });

  it('rejects bad config and has the stub, grid and size', async () => {
    const el = await mount<{ getCardSize(): number; getGridOptions(): unknown }>(TAG, { areas: AREAS }, house());
    expect(() => el.constructor && (document.createElement(TAG) as unknown as { setConfig(c: unknown): void }).setConfig({ areas: 'x' })).toThrow(/cuest-rooms-card: "areas"/);
    expect(() => (document.createElement(TAG) as unknown as { setConfig(c: unknown): void }).setConfig({ heading: 'side' })).toThrow(/"heading" must be one of outside, inside/);
    expect(() => (document.createElement(TAG) as unknown as { setConfig(c: unknown): void }).setConfig({ areas: [{ name: 'x' }] })).toThrow(/"area"/);
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 'auto' });
    expect(el.getCardSize()).toBe(5);
    expect((customElements.get(TAG) as unknown as { getStubConfig(): object }).getStubConfig()).toEqual({});
  });

  it('re-renders when a light changes', async () => {
    const h = house();
    const el = await mount<{ updateComplete: Promise<boolean>; hass: unknown }>(TAG, { areas: ['Küche'] }, h);
    expect(rowTexts(el)).toEqual(['Küche 22.5° dark']);
    h.states = { ...h.states, 'light.kuche_a': st('on') };
    el.hass = h;
    await el.updateComplete;
    expect(rowTexts(el)).toEqual(['Küche 22.5° 1 lit']);
  });
});
