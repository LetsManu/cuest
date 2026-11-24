import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const ITEMS = [
  { id: 'hood_ember', kind: 'wardrobe', name: 'Ember hood', owned: true, lootOnly: false, slot: 'hood', palette: { G: '#B5523B' } },
  { id: 'hood_starry', kind: 'wardrobe', name: 'Starry cloak', owned: true, lootOnly: true, slot: 'hood', palette: { G: '#1F2A4A', L: '#F7D27A', g: '#141C33' } },
  { id: 'broom_moss', kind: 'wardrobe', name: 'Mossy broom', owned: false, lootOnly: true, slot: 'broom', palette: { T: '#5A4630' } },
  { id: 'scarf_teal', kind: 'wardrobe', name: 'Teal scarf', owned: false, lootOnly: false, slot: 'scarf', palette: {} },
  { id: 'cat', kind: 'decor', name: 'Village cat', owned: true, lootOnly: false },
  { id: 'lantern', kind: 'decor', name: 'Village lantern', owned: false, lootOnly: false },
  { id: 'owl', kind: 'decor', name: 'Sleepy owl', owned: true, lootOnly: true },
];

const OPEN_Q = { id: 'q1', title: 'Dishes', minutes: 5, xp: 10, gold: 3, status: 'open', createdAt: 't', startedAt: null, claimedBy: null, templateId: null, snoozedUntil: null };
function fakeHass(items: unknown = ITEMS) {
  const callApi = vi.fn(async (_m: string, path: string) => {
    if (path === 'cuest_whoami') return { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
    if (path === 'cuest/quests') return { active: [], open: [OPEN_Q], whenever: [] };
    if (path.endsWith('/start')) return { ...OPEN_Q, status: 'active', claimedBy: 'p1', startedAt: new Date(T0).toISOString() };
    if (path.endsWith('/done')) return { quest: OPEN_Q, reward: { xp: 10, gold: 3, lines: [] }, player: { xp: 140 }, loot: null, chestKey: false };
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 130, gold: 10, restTokens: 0, boostUntil: null }, level: 4, title: 'Hearthkeeper', intoLevel: 30, toNext: 70 };
    if (path.startsWith('cuest/shop?')) return { gold: 10, restTokens: 0, boostUntil: null, owned: {}, equipped: {}, catalog: [] };
    if (path.startsWith('cuest/collection?')) {
      const v = typeof items === 'function' ? (items as () => unknown)() : items;
      if (v === 'fail') throw new Error('nope');
      return { items: v };
    }
    return {};
  });
  const hass = {
    states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level' } } },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(), callService: vi.fn(), callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi };
}
async function settle(el: any) { for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; } }
async function openHero(hass: HomeAssistant) {
  const el = document.createElement('cuest-panel') as any;
  el.now = () => T0;
  document.body.appendChild(el);
  el.hass = hass;
  await settle(el);
  (el.shadowRoot.querySelector('nav [data-go="hero"]') as HTMLElement).click();
  await settle(el);
  return el;
}
const all = (el: any, sel: string) => Array.from(el.shadowRoot.querySelectorAll(sel)) as HTMLElement[];

describe('collection book', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('shows the count and one tile per item with aria labels', async () => {
    const el = await openHero(fakeHass().hass);
    expect(el.shadowRoot.querySelector('[data-role="collection-count"]').textContent).toContain('4 of 7 found');
    const tiles = all(el, '[data-collection] [data-item]');
    expect(tiles).toHaveLength(7);
    const label = (id: string) => el.shadowRoot.querySelector(`[data-item="${id}"]`).getAttribute('aria-label');
    expect(label('hood_starry')).toBe('Starry cloak, found');
    expect(label('owl')).toBe('Sleepy owl, found');
    expect(label('broom_moss')).toBe('Unknown item, found as loot');
    expect(label('lantern')).toBe('Unknown item, in the shop');
  });

  it('hides the names of unfound items and shows hints; owned get previews', async () => {
    const el = await openHero(fakeHass().hass);
    const t = (id: string) => el.shadowRoot.querySelector(`[data-item="${id}"]`) as HTMLElement;
    expect(t('broom_moss').textContent).toContain('Found as loot');
    expect(t('broom_moss').textContent).not.toContain('Mossy broom');
    expect(t('broom_moss').textContent).toContain('?');
    expect(t('lantern').textContent).toContain('In the shop');
    expect(t('hood_starry').textContent).toContain('Starry cloak');
    expect(t('hood_starry').querySelector('[data-preview="wardrobe"]')).not.toBeNull();
    expect(t('owl').querySelector('[data-preview="decor"]')).not.toBeNull();
    expect(t('broom_moss').querySelector('[data-preview]')).toBeNull();
  });

  it('renders loot-only wardrobe preview with its own palette', async () => {
    const el = await openHero(fakeHass().hass);
    const box = el.shadowRoot.querySelector('[data-item="hood_starry"] [data-preview="wardrobe"] div div') as HTMLElement;
    expect(box.getAttribute('style')).toContain('#1F2A4A');
  });

  it('survives a failed or malformed collection response', async () => {
    for (const bad of ['fail', 'oops']) {
      document.body.innerHTML = '';
      const el = await openHero(fakeHass(bad).hass);
      expect(el.shadowRoot.querySelector('[data-collection]')).toBeNull();
      expect(el.shadowRoot.textContent).toContain('Path of the hero');
    }
  });

  it('tiles stay list items (no role override) and keep their aria-label', async () => {
    const el = await openHero(fakeHass().hass);
    for (const t of all(el, '[data-collection] [data-item]')) {
      expect(t.tagName).toBe('LI');
      expect(t.hasAttribute('role')).toBe(false);
      expect(t.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('a failed collection fetch keeps the list it already had', async () => {
    let fail = false;
    const { hass } = fakeHass(() => (fail ? 'fail' : ITEMS));
    const el = await openHero(hass);
    expect(all(el, '[data-collection] [data-item]')).toHaveLength(7);
    fail = true;
    el.hass = { ...hass, states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't2', attributes: { cuest_player_id: 'p1', cuest_kind: 'level' } } } };
    await settle(el);
    expect(all(el, '[data-collection] [data-item]')).toHaveLength(7);
    (el.shadowRoot.querySelector('nav [data-go="village"]') as HTMLElement).click(); await settle(el);
    (el.shadowRoot.querySelector('nav [data-go="hero"]') as HTMLElement).click(); await settle(el);
    expect(all(el, '[data-collection] [data-item]')).toHaveLength(7);
  });

  it('fetches the collection on first load, when Hero opens and after a quest is done, not on every refresh', async () => {
    const { hass, callApi } = fakeHass();
    const el = document.createElement('cuest-panel') as any;
    el.now = () => T0;
    document.body.appendChild(el);
    el.hass = hass;
    await settle(el);
    const colCalls = () => callApi.mock.calls.filter((c) => String(c[1]).startsWith('cuest/collection?')).length;
    expect(colCalls()).toBe(1);
    // A sensor change refreshes quests and summary, but not the collection.
    el.hass = { ...hass, states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't2', attributes: { cuest_player_id: 'p1', cuest_kind: 'level' } } } };
    await settle(el);
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/quests').length).toBe(2);
    expect(colCalls()).toBe(1);
    (el.shadowRoot.querySelector('nav [data-go="hero"]') as HTMLElement).click(); await settle(el);
    expect(colCalls()).toBe(2);
    (el.shadowRoot.querySelector('nav [data-go="village"]') as HTMLElement).click(); await settle(el);
    expect(colCalls()).toBe(2);
    (el.shadowRoot.querySelector('[data-act="start"]') as HTMLElement).click(); await settle(el);
    (el.shadowRoot.querySelector('[data-act="done"]') as HTMLElement).click(); await settle(el);
    expect(colCalls()).toBe(3);
  });

  it('shows owned loot-only decor in the village', async () => {
    const { hass } = fakeHass();
    const el = document.createElement('cuest-panel') as any;
    el.now = () => T0;
    document.body.appendChild(el);
    el.hass = hass;
    await settle(el);
    expect(el.shadowRoot.querySelector('.decorrow')?.children.length).toBe(2);
  });
});
