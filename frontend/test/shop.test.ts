import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const CATALOG = [
  { id: 'treat:pc', kind: 'treat', name: 'Gaming PC, 1 hour', cost: 60, owned: false },
  { id: 'hood_ember', kind: 'wardrobe', name: 'Ember hood', cost: 40, slot: 'hood', palette: { G: '#B5523B' }, owned: false },
  { id: 'hood_night', kind: 'wardrobe', name: 'Night-sky hood', cost: 300, slot: 'hood', palette: { G: '#3D5A8A' }, owned: true },
  { id: 'lantern', kind: 'decor', name: 'Village lantern', cost: 30, owned: false },
  { id: 'cat', kind: 'decor', name: 'Village cat', cost: 60, owned: true },
  { id: 'mystery_chest', kind: 'helper', name: 'Mystery chest', cost: 40, owned: false },
  { id: 'xp_potion', kind: 'helper', name: 'Double XP hour', cost: 70, owned: false },
];

function fakeHass(o: { gold?: number; buy?: (body: any) => unknown; boostUntil?: string | null; sensorDecor?: string[] } = {}) {
  const state = { gold: o.gold ?? 100, equipped: {} as Record<string, string>, catalog: CATALOG.map((c) => ({ ...c })), boostUntil: o.boostUntil ?? null };
  const callApi = vi.fn(async (_m: string, path: string, body?: any) => {
    if (path === 'cuest_whoami') return { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
    if (path === 'cuest/quests') return { active: [], open: [], whenever: [] };
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 130, gold: state.gold, restTokens: 0, boostUntil: state.boostUntil }, level: 4, title: 'Hearthkeeper', intoLevel: 30, toNext: 70 };
    if (path.startsWith('cuest/shop?')) return { gold: state.gold, restTokens: 0, boostUntil: state.boostUntil, owned: { cat: 1, hood_night: 1 }, equipped: state.equipped, catalog: state.catalog };
    if (path === 'cuest/shop/buy') { if (o.buy) return o.buy(body); return { player: {}, result: { kind: 'item', itemId: body.itemId } }; }
    if (path === 'cuest/shop/equip') { if (body.itemId) state.equipped[body.slot] = body.itemId; else delete state.equipped[body.slot]; return {}; }
    return {};
  });
  const hass = {
    states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level', decor: o.sensorDecor ?? [] } } },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(), callService: vi.fn(), callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi, state };
}
async function settle(el: any) {
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
}
async function mount(hass: HomeAssistant) {
  const el = document.createElement('cuest-panel') as any;
  el.now = () => T0;
  document.body.appendChild(el);
  el.hass = hass;
  await settle(el);
  return el;
}
const q = (el: any, sel: string) => el.shadowRoot.querySelector(sel) as HTMLElement;
const text = (el: any) => el.shadowRoot.textContent as string;
async function openShop(el: any, tab?: string) {
  q(el, 'nav [data-go="shop"]').click();
  await settle(el);
  if (tab) { q(el, `[data-tab="${tab}"]`).click(); await settle(el); }
}

describe('shop', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('shows header, tabs, affordable and unaffordable states and the footer', async () => {
    const { hass } = fakeHass({ gold: 100 });
    const el = await mount(hass);
    await openShop(el, 'wardrobe');
    expect(text(el)).toContain('Earned from quests. Never taken away.');
    expect(text(el)).toContain('Treats only switch things on. Your devices always work normally too.');
    expect(['House treats', 'Wardrobe', 'Village', 'Helpers'].every((t) => text(el).includes(t))).toBe(true);
    const ember = q(el, '[data-item="hood_ember"]') as HTMLButtonElement;
    expect(ember.textContent!.trim()).toBe('40 gold');
    expect(ember.disabled).toBe(false);
    expect(text(el)).toContain('A warm red hood');
    q(el, '[data-tab="treat"]').click(); await settle(el);
    const pc = q(el, '[data-item="treat:pc"]') as HTMLButtonElement;
    expect(pc.textContent!.trim()).toBe('60 gold');
    expect(text(el)).toContain('Switches on in your home');
  });

  it('shows N to go (disabled) when short of gold', async () => {
    const { hass, callApi } = fakeHass({ gold: 15 });
    const el = await mount(hass);
    await openShop(el, 'decor');
    const b = q(el, '[data-item="lantern"]') as HTMLButtonElement;
    expect(b.textContent!.trim()).toBe('15 to go');
    expect(b.disabled).toBe(true);
    b.click(); await settle(el);
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/shop/buy')).toHaveLength(0);
    expect(q(el, '[data-item="cat"]').textContent!.trim()).toBe('In village');
  });

  it('calls buy once on a double click', async () => {
    const { hass, callApi } = fakeHass({ gold: 100 });
    const el = await mount(hass);
    await openShop(el, 'decor');
    const b = q(el, '[data-item="lantern"]');
    b.click(); b.click();
    await settle(el);
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/shop/buy')).toHaveLength(1);
    expect(text(el)).toContain('Village lantern');
  });

  it('toggles equip: Wear then Wearing then takes it off', async () => {
    const { hass, callApi } = fakeHass({ gold: 100 });
    const el = await mount(hass);
    await openShop(el, 'wardrobe');
    expect(q(el, '[data-item="hood_night"]').textContent!.trim()).toBe('Wear');
    q(el, '[data-item="hood_night"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/shop/equip', { playerId: 'p1', slot: 'hood', itemId: 'hood_night' });
    expect(q(el, '[data-item="hood_night"]').textContent!.trim()).toBe('Wearing');
    q(el, '[data-item="hood_night"]').click(); await settle(el);
    const paths = callApi.mock.calls.map((c) => c[1]);
    expect(paths.slice(-2)).toContain('cuest/shop?playerId=p1');
    expect(paths.lastIndexOf('cuest/shop?playerId=p1')).toBeGreaterThan(paths.lastIndexOf('cuest/shop/equip'));
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/shop/equip', { playerId: 'p1', slot: 'hood', itemId: null });
    expect(q(el, '[data-item="hood_night"]').textContent!.trim()).toBe('Wear');
  });

  it('chest toast reveals the item or the gold', async () => {
    const a = fakeHass({ buy: () => ({ player: {}, result: { kind: 'chest', itemId: 'hood_ember' } }) });
    let el = await mount(a.hass);
    await openShop(el, 'helper');
    q(el, '[data-item="mystery_chest"]').click(); await settle(el);
    expect(q(el, '[data-role="toast"]').textContent).toContain('Ember hood');
    document.body.innerHTML = '';
    const b = fakeHass({ buy: () => ({ player: {}, result: { kind: 'chest', gold: 55 } }) });
    el = await mount(b.hass);
    await openShop(el, 'helper');
    q(el, '[data-item="mystery_chest"]').click(); await settle(el);
    expect(q(el, '[data-role="toast"]').textContent).toContain('55 gold');
  });

  it('potion toast shows the 24 h time and Village shows the banner', async () => {
    const until = new Date(T0 + 3600_000).toISOString();
    const f = fakeHass({ buy: () => ({ player: {}, result: { kind: 'potion', boostUntil: until } }) });
    const el = await mount(f.hass);
    await openShop(el, 'helper');
    q(el, '[data-item="xp_potion"]').click(); await settle(el);
    const d = new Date(until);
    const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(q(el, '[data-role="toast"]').textContent).toContain(`Double XP until ${hh}`);
    f.state.boostUntil = until;
    q(el, 'nav [data-go="village"]').click();
    el.shadowRoot.querySelector('[data-role="toast"] button').click();
    await el.updateComplete;
    // refresh pulled the new boostUntil
    await el['_refresh']();
    await settle(el);
    expect(q(el, '[data-role="boost"]').textContent).toContain(`Double XP until ${hh}`);
  });

  it('treat purchase gives Enjoy!, and a 503 shows a friendly toast without the offline banner', async () => {
    const ok = fakeHass({ buy: () => ({ player: {}, result: { kind: 'treat', itemId: 'treat:pc' } }) });
    let el = await mount(ok.hass);
    await openShop(el, 'treat');
    q(el, '[data-item="treat:pc"]').click(); await settle(el);
    expect(q(el, '[data-role="toast"]').textContent).toContain('Enjoy!');
    document.body.innerHTML = '';
    const msg = "Home Assistant isn't connected right now, so this treat can't switch on. Your gold is safe.";
    const bad = fakeHass({ buy: () => { throw { status_code: 503, body: JSON.stringify({ error: 'bridge_offline', message: msg }) }; } });
    el = await mount(bad.hass);
    await openShop(el, 'treat');
    q(el, '[data-item="treat:pc"]').click(); await settle(el);
    expect(q(el, '[data-role="toast"]').textContent).toContain('Your gold is safe');
    expect(q(el, '.banner')).toBeNull();
    expect((q(el, '[data-item="treat:pc"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('409 errors become friendly toasts', async () => {
    const f = fakeHass({ buy: () => { throw { status_code: 409, body: JSON.stringify({ error: 'not_enough_gold', message: 'Not quite enough gold yet.' }) }; } });
    const el = await mount(f.hass);
    await openShop(el, 'decor');
    q(el, '[data-item="lantern"]').click(); await settle(el);
    expect(q(el, '[data-role="toast"]').textContent).toContain('Not quite enough gold yet.');
  });

  it('owned decor appears in the village scene (shop is the source of truth)', async () => {
    const f = fakeHass({ sensorDecor: [] });
    const el = await mount(f.hass);
    expect(el.shadowRoot.querySelectorAll('.decorrow .slot').length).toBe(1); // cat
  });
});

describe('shop fix round 1', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });
  async function mountNarrow(hass: HomeAssistant) {
    const el = document.createElement('cuest-panel') as any;
    el.now = () => T0; el.narrow = true;
    document.body.appendChild(el); el.hass = hass; await settle(el);
    return el;
  }
  it('narrow shop and hero show exactly one menu button; quest shows the row', async () => {
    const el = await mountNarrow(fakeHass().hass);
    for (const v of ['shop', 'hero']) {
      q(el, `nav [data-go="${v}"]`).click(); await settle(el);
      expect(el.shadowRoot.querySelectorAll('ha-menu-button').length).toBe(1);
    }
    el['_view'] = 'quest'; await settle(el);
    expect(el.shadowRoot.querySelectorAll('.menu ha-menu-button').length).toBe(1);
  });
  it('narrow player picker shows the menu row', async () => {
    const f = fakeHass();
    (f.callApi as any).mockImplementation(async (_m: string, path: string) => path === 'cuest_whoami'
      ? { playerId: null, isAdmin: false, players: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bo' }] } : {});
    const el = await mountNarrow(f.hass);
    expect(el.shadowRoot.querySelectorAll('.menu ha-menu-button').length).toBe(1);
  });
  it('a failing shop GET does not break summary or show an error', async () => {
    const f = fakeHass();
    const orig = (f.callApi as any).getMockImplementation();
    (f.callApi as any).mockImplementation(async (m: string, path: string, b: any) => {
      if (path.startsWith('cuest/shop?')) throw { status_code: 500, body: '{}' };
      return orig(m, path, b);
    });
    const el = await mount(f.hass);
    expect(text(el)).toContain('Hearthkeeper');
    expect(q(el, '[role="alert"]')).toBeNull();
  });
  it('empty tab uses shop copy', async () => {
    const f = fakeHass();
    const el = await mount(f.hass);
    f.state.catalog = f.state.catalog.filter((c) => c.kind !== 'treat');
    await el['_refresh'](); await openShop(el, 'treat');
    expect(text(el)).toContain('Ask whoever set up Cuest');
    q(el, '[data-tab="wardrobe"]').click(); await settle(el);
    f.state.catalog = [];
    await el['_refresh'](); await settle(el);
    expect(text(el)).toContain('Nothing here yet.');
  });
  it('double-tap on equip fires one equip; only that item is disabled while pending', async () => {
    const f = fakeHass({ gold: 100 });
    const el = await mount(f.hass);
    await openShop(el, 'wardrobe');
    const b = q(el, '[data-item="hood_night"]') as HTMLButtonElement;
    b.click(); b.click();
    await el.updateComplete;
    expect((q(el, '[data-item="hood_night"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(el, '[data-item="hood_ember"]') as HTMLButtonElement).disabled).toBe(false);
    await settle(el);
    expect(f.callApi.mock.calls.filter((c) => c[1] === 'cuest/shop/equip')).toHaveLength(1);
  });
});
