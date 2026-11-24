import { afterEach, describe, expect, it } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { validateOrb } from '../../src/arcane/orb';
import '../../src/arcane/orb';

const TAG = 'cuest-orb-card';

// 9 inspected entities (lights included), 1 unavailable -> 8/9 = 89 %. One light on of two reachable.
const HOUSE = {
  'light.lamp': st('on'),
  'light.desk': st('off'),
  'light.gone': st('unavailable'),
  'light.all': st('on', { entity_id: ['light.lamp', 'light.desk'] }),
  'switch.plug': st('on'),
  'sensor.a': st('1'),
  'sensor.b': st('2'),
  'sensor.c': st('3'),
  'sensor.d': st('4'),
  'automation.skipped': st('unavailable'),
};

const root = (el: HTMLElement) => el.shadowRoot!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('orb presets', () => {
  it('percent shows the label line, wave height and aria text', async () => {
    const h = fakeHass({ states: { 'sensor.washer_progress': st('72') } });
    const el = await mount(TAG, { preset: 'percent', entity: 'sensor.washer_progress' }, h);
    expect(text(el)).toContain('Mana 72%');
    expect(root(el).querySelector('[data-wave="front"]')!.getAttribute('transform')).toBe('translate(0,11.12)');
    expect(root(el).querySelector('[data-wave="back"]')!.getAttribute('transform')).toBe('translate(0,9.12)');
    const svg = root(el).querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toBe('Mana: 72 percent');
    expectClean(el);
  });

  it('unavailable percent shows a dash and an empty orb', async () => {
    const h = fakeHass({ states: { 'sensor.washer_progress': st('unavailable') } });
    const el = await mount(TAG, { preset: 'percent', entity: 'sensor.washer_progress' }, h);
    expect(text(el)).toContain('Mana —');
    expect(root(el).querySelector('[data-wave="front"]')!.getAttribute('transform')).toBe('translate(0,86)');
    expectClean(el);
  });

  it('missing entity shows the warning, not an orb', async () => {
    const el = await mount(TAG, { preset: 'percent', entity: 'sensor.nope' }, fakeHass());
    expect(text(el)).toContain('Entity not found: sensor.nope');
    expect(root(el).querySelector('svg')).toBeNull();
    expectClean(el);
  });

  it('ratio divides by the max entity', async () => {
    const h = fakeHass({ states: { 'sensor.v': st('50'), 'sensor.max': st('200') } });
    const el = await mount(TAG, { preset: 'ratio', entity: 'sensor.v', max: 'sensor.max' }, h);
    expect(text(el)).toContain('25%');
  });

  it('ratio accepts a fixed number', async () => {
    const h = fakeHass({ states: { 'sensor.v': st('3') } });
    const el = await mount(TAG, { preset: 'ratio', entity: 'sensor.v', max: 4 }, h);
    expect(text(el)).toContain('Mana 75%');
  });

  it('online shows Mana 89% with sublabel online', async () => {
    const el = await mount(TAG, { preset: 'online' }, fakeHass({ states: HOUSE }));
    expect(text(el)).toContain('Mana 89%');
    expect(root(el).querySelector('.sub')!.textContent).toBe('online');
    expect(root(el).querySelector('svg')!.getAttribute('aria-label')).toBe('Mana: 89 percent of devices online');
  });

  it('lights shows Glow 1 with sublabel lights on', async () => {
    const el = await mount(TAG, { preset: 'lights' }, fakeHass({ states: HOUSE }));
    expect(text(el)).toContain('Glow 1');
    expect(root(el).querySelector('.sub')!.textContent).toBe('lights on');
  });

  it('health uses singular copy for one quest', async () => {
    const states = {
      'sensor.b1_battery': st('3', { device_class: 'battery', unit_of_measurement: '%' }),
      'sensor.b2_battery': st('90', { device_class: 'battery', unit_of_measurement: '%' }),
      'sensor.b3_battery': st('80', { device_class: 'battery', unit_of_measurement: '%' }),
      'sensor.b4_battery': st('70', { device_class: 'battery', unit_of_measurement: '%' }),
    };
    const el = await mount(TAG, { preset: 'health' }, fakeHass({ states }));
    expect(text(el)).toContain('Health 75%');
    expect(root(el).querySelector('.sub')!.textContent).toBe('1 quest');
  });

  it('health with no problems reads 100%', async () => {
    const el = await mount(TAG, { preset: 'health' }, fakeHass({ states: { 'sensor.x': st('1') } }));
    expect(text(el)).toContain('Health 100%');
    expect(root(el).querySelector('.sub')!.textContent).toBe('0 quests');
  });

  it('label and sublabel overrides win', async () => {
    const el = await mount(TAG, { preset: 'online', label: 'Power', sublabel: 'all good' }, fakeHass({ states: HOUSE }));
    expect(text(el)).toContain('Power 89%');
    expect(text(el)).toContain('all good');
  });
});

describe('orb row', () => {
  it('renders several orbs with distinct clip paths, sparks and role=img', async () => {
    const el = await mount(TAG, { orbs: [{ preset: 'online' }, { preset: 'health' }, { preset: 'lights' }] }, fakeHass({ states: HOUSE }));
    const svgs = root(el).querySelectorAll('svg[role="img"]');
    expect(svgs.length).toBe(3);
    const ids = Array.from(root(el).querySelectorAll('clipPath')).map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['orb-0-clip', 'orb-1-clip', 'orb-2-clip']);
    expect(root(el).querySelectorAll('.spark').length).toBe(3);
    expect(root(el).querySelector('.panel.rim')).not.toBeNull();
    expect(text(el)).toContain('Mana 89%');
    expect(text(el)).toContain('Glow 1');
    expectClean(el);
  });

  it('updates when hass changes', async () => {
    const h = fakeHass({ states: { 'sensor.p': st('10') } });
    const el = await mount<{ hass: unknown }>(TAG, { preset: 'percent', entity: 'sensor.p' }, h);
    expect(text(el)).toContain('Mana 10%');
    el.hass = fakeHass({ states: { 'sensor.p': st('20') } });
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('Mana 20%');
  });

  it('exposes grid options, card size and stub config', async () => {
    const C = customElements.get(TAG) as unknown as { getStubConfig(): object; new (): HTMLElement & { getGridOptions(): unknown; getCardSize(): number } };
    const el = new C();
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 3 });
    expect(el.getCardSize()).toBe(3);
    expect(C.getStubConfig()).toEqual({ preset: 'online' });
  });

  it('registers once as Arcane orb', () => {
    const cards = (window.customCards ?? []).filter((c) => c.type === TAG);
    expect(cards.length).toBe(1);
    expect(cards[0].name).toBe('Arcane orb');
  });
});

describe('orb validation', () => {
  const set = (cfg: unknown) => () => (document.createElement(TAG) as unknown as { setConfig(c: unknown): void }).setConfig(cfg);
  it('rejects more than four orbs', () => {
    expect(set({ orbs: Array(5).fill({ preset: 'online' }) })).toThrow(/at most 4/);
  });
  it('requires entity for percent', () => {
    expect(set({ preset: 'percent' })).toThrow(/"entity" is required/);
    expect(() => validateOrb({ preset: 'ratio', entity: 'sensor.a' }, TAG)).toThrow(/"max"/);
  });
  it('rejects unknown colours', () => {
    expect(set({ preset: 'online', color: 'pink' })).toThrow(/one of mana, health, glow/);
  });
  it('defaults the colour by preset', () => {
    expect(validateOrb({ preset: 'online' }, TAG).color).toBe('mana');
    expect(validateOrb({ preset: 'health' }, TAG).color).toBe('health');
    expect(validateOrb({ preset: 'lights' }, TAG).color).toBe('glow');
    expect(validateOrb({ preset: 'percent', entity: 'sensor.a' }, TAG).color).toBe('mana');
  });
  it('prefixes errors with the tag', () => {
    expect(set({ preset: 'percent' })).toThrow(/^Error: cuest-orb-card:|cuest-orb-card:/);
  });
});
