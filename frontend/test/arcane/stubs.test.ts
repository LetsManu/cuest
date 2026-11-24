import { afterEach, describe, expect, it } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import '../../src/arcane/index';

afterEach(() => {
  document.body.innerHTML = '';
});

type Stubbed = { getStubConfig(h?: unknown): Record<string, unknown> };
const stubOf = (tag: string, h?: unknown) => (customElements.get(tag) as unknown as Stubbed).getStubConfig(h);

const ENTITY_CARDS = ['cuest-trail-card', 'cuest-rune-gauge', 'cuest-bard-card', 'cuest-spell-tile'];

describe('card picker stubs', () => {
  it.each(ENTITY_CARDS)('%s: an empty house gives a valid config that shows the friendly missing panel', async (tag) => {
    for (const h of [undefined, fakeHass()]) {
      const cfg = stubOf(tag, h);
      expect(typeof cfg.entity).toBe('string');
      expect(cfg.entity).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
      const el = await mount(tag, cfg, fakeHass());
      expect(el.shadowRoot!.querySelector('.warn')).not.toBeNull();
      expect(text(el)).toContain(`Entity not found: ${cfg.entity}`);
      expectClean(el);
    }
  });

  it('falls back to another fitting entity before the placeholder', () => {
    const h = fakeHass({ states: { 'sensor.power': st('5', { device_class: 'power', unit_of_measurement: 'W' }), 'switch.plug': st('on'), 'sensor.word': st('abc') } });
    expect(stubOf('cuest-trail-card', h)).toEqual({ entity: 'sensor.power' });
    expect(stubOf('cuest-rune-gauge', h)).toEqual({ entity: 'sensor.power' });
    expect(stubOf('cuest-spell-tile', h)).toEqual({ entity: 'switch.plug' });
  });
});

describe('card picker names', () => {
  it('all eleven cards carry the Cuest prefix, once each', () => {
    const ours = (window.customCards ?? []).filter((c) => c.type.startsWith('cuest-') && c.type !== 'cuest-card');
    expect(ours).toHaveLength(11);
    for (const c of ours) expect(c.name, c.type).toMatch(/^Cuest [a-z]/);
    expect(new Set(ours.map((c) => c.name)).size).toBe(11);
  });
});
