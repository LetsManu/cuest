import { afterEach, describe, expect, it } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestOrbCard, validateOrb } from '../../src/arcane/orb';
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

  it('online leaves excluded entities out', async () => {
    const el = await mount(TAG, { preset: 'online', exclude: ['light.gone'] }, fakeHass({ states: HOUSE }));
    expect(text(el)).toContain('Mana 100%');
  });

  it('lights shows Glow 1 with sublabel lights on', async () => {
    const el = await mount(TAG, { preset: 'lights' }, fakeHass({ states: HOUSE }));
    expect(text(el)).toContain('Glow 1');
    expect(root(el).querySelector('.sub')!.textContent).toBe('1 light on');
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

const front = (el: HTMLElement) => root(el).querySelector('[data-wave="front"]')!.getAttribute('transform');

describe('orb levels per preset', () => {
  it('health: 3 of 4 batteries ok -> p .75', async () => {
    const bat = (n: string) => st(n, { device_class: 'battery', unit_of_measurement: '%' });
    const states = { 'sensor.a_battery': bat('3'), 'sensor.b_battery': bat('90'), 'sensor.c_battery': bat('80'), 'sensor.d_battery': bat('70') };
    expect(front(await mount(TAG, { preset: 'health' }, fakeHass({ states })))).toBe('translate(0,8)');
  });
  it('lights: 1 of 2 -> translate(0,34), singular copy and aria', async () => {
    const el = await mount(TAG, { preset: 'lights' }, fakeHass({ states: HOUSE }));
    expect(front(el)).toBe('translate(0,34)');
    expect(root(el).querySelector('.sub')!.textContent).toBe('1 light on');
    expect(root(el).querySelector('svg')!.getAttribute('aria-label')).toBe('Glow: 1 light on');
  });
  it('lights: several on keep the plural and the aria text', async () => {
    const states = { 'light.a': st('on'), 'light.b': st('on'), 'light.c': st('off') };
    const el = await mount(TAG, { preset: 'lights' }, fakeHass({ states }));
    expect(root(el).querySelector('.sub')!.textContent).toBe('lights on');
    expect(root(el).querySelector('svg')!.getAttribute('aria-label')).toBe('Glow: 2 lights on');
  });
  it('online: 89% (8 of 9) -> translate(0,-6.56)', async () => {
    expect(front(await mount(TAG, { preset: 'online' }, fakeHass({ states: HOUSE })))).toBe('translate(0,-6.56)');
  });
  it('ratio: 50 of 200 -> translate(0,60)', async () => {
    const h = fakeHass({ states: { 'sensor.v': st('50'), 'sensor.max': st('200') } });
    expect(front(await mount(TAG, { preset: 'ratio', entity: 'sensor.v', max: 'sensor.max' }, h))).toBe('translate(0,60)');
  });
});

describe('orb decoration and numbers', () => {
  it('spins the ring on mana only and uses a 4 wide rim at 96px', async () => {
    const el = await mount(TAG, { orbs: [{ preset: 'online' }, { preset: 'health' }, { preset: 'lights' }] }, fakeHass({ states: HOUSE }));
    expect(root(el).querySelectorAll('.spin').length).toBe(1);
    expect(root(el).querySelector('svg:first-of-type .spin')).not.toBeNull();
    for (const c of Array.from(root(el).querySelectorAll('circle[r="54"]'))) expect(c.getAttribute('stroke-width')).toBe('4');
  });
  it('shows the value in a numeric span, word apart', async () => {
    const el = await mount(TAG, { preset: 'percent', entity: 'sensor.p' }, fakeHass({ states: { 'sensor.p': st('50') } }));
    expect(root(el).querySelector('.line .num')!.textContent).toBe('50%');
    expect(text(el)).toContain('Mana 50%');
  });
  it('styles .num with Inter 700 and tabular figures', () => {
    const css = CuestOrbCard.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.num\{[^}]*font-weight:700[^}]*font-variant-numeric:tabular-nums/);
    expect(css).toMatch(/\.num\{[^}]*font-family:Inter/);
  });
  it('sets battery_threshold only for health', () => {
    expect(validateOrb({ preset: 'online' }, TAG).battery_threshold).toBeUndefined();
    expect(validateOrb({ preset: 'health' }, TAG).battery_threshold).toBe(20);
  });
  it('takes battery_threshold from 1 to 100, like the quest board and rooms', () => {
    expect(() => validateOrb({ preset: 'health', battery_threshold: 0 }, TAG)).toThrow('cuest-orb-card: "battery_threshold" must be between 1 and 100');
    expect(() => validateOrb({ preset: 'health', battery_threshold: 101 }, TAG)).toThrow(/between 1 and 100/);
    expect(validateOrb({ preset: 'health', battery_threshold: 1 }, TAG).battery_threshold).toBe(1);
    expect(validateOrb({ preset: 'health', battery_threshold: 100 }, TAG).battery_threshold).toBe(100);
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

  it('registers once as Cuest orbs', () => {
    const cards = (window.customCards ?? []).filter((c) => c.type === TAG);
    expect(cards.length).toBe(1);
    expect(cards[0].name).toBe('Cuest orbs');
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
