import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';

const Q = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Quest ${id}`, minutes: 5, xp: 12, gold: 3, status: 'open', createdAt: 't',
  startedAt: null, claimedBy: null, templateId: null, snoozedUntil: null, ...over,
});

interface Setup {
  who?: unknown;
  quests?: unknown;
  fail?: (method: string, path: string) => unknown;
}

function fakeHass(s: Setup = {}) {
  const who = s.who ?? { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
  const quests = s.quests ?? { active: [], open: [Q('q1')], whenever: [Q('w1'), Q('w2')] };
  const callApi = vi.fn(async (method: string, path: string) => {
    const f = s.fail?.(method, path);
    if (f) throw f;
    if (path === 'cuest_whoami') return who;
    if (path === 'cuest/quests') return quests;
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 30, gold: 15, restTokens: 0, boostUntil: null }, level: 4, title: 'Hearthkeeper', intoLevel: 20, toNext: 80 };
    if (path.endsWith('/start')) return { quest: Q('q1', { status: 'active' }) };
    if (path.endsWith('/later')) return { quest: Q('q1') };
    return {};
  });
  const hass = {
    states: {
      'sensor.cuest_ada_level': { state: '4', last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level', outfit_palette: { G: '#B5523B' }, decor: ['lantern', 'fountain'] } },
    },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(),
    callService: vi.fn(),
    callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi };
}

async function mount(hass: HomeAssistant) {
  const el = document.createElement('cuest-panel') as any;
  el.narrow = false;
  document.body.appendChild(el);
  el.hass = hass;
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
  return el;
}

const text = (el: any) => el.shadowRoot.textContent as string;

describe('cuest-panel', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('shows the village of a linked user', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    expect(callApi).toHaveBeenCalledWith('GET', 'cuest_whoami', undefined);
    const t = text(el);
    expect(t).toContain('Level 4');
    expect(t).toContain('Hearthkeeper');
    expect(t).toContain('The house needs you');
    expect(t).toContain('Quest q1');
    expect(t).toContain('+12 XP');
    expect(t).toContain('Just 2 minutes');
    expect(t).toContain('2 quests are resting in the Whenever pool');
    expect(el.shadowRoot.querySelectorAll('nav button')).toHaveLength(3);
  });

  it('shows All quiet when there is nothing to do', async () => {
    const { hass } = fakeHass({ quests: { active: [], open: [], whenever: [] } });
    const el = await mount(hass);
    expect(text(el)).toContain('All quiet');
  });

  it('asks an unlinked user who is playing and remembers the choice', async () => {
    const { hass } = fakeHass({ who: { playerId: null, isAdmin: true, players: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bo' }] } });
    const el = await mount(hass);
    expect(text(el)).toContain("Who's playing?");
    el.shadowRoot.querySelector('[data-player="p1"]').click();
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(localStorage.getItem('cuest.player')).toBe('p1');
    expect(text(el)).toContain('The house needs you');
  });

  it('uses the remembered choice on the next visit', async () => {
    localStorage.setItem('cuest.player', 'p2');
    const { hass, callApi } = fakeHass({ who: { playerId: null, isAdmin: true, players: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bo' }] } });
    await mount(hass);
    expect(callApi).toHaveBeenCalledWith('GET', 'cuest/players/p2/summary', undefined);
  });

  it('shows onboarding when no players exist', async () => {
    const { hass } = fakeHass({ who: { playerId: null, isAdmin: true, players: [] } });
    const el = await mount(hass);
    expect(text(el)).toContain('Settings → Devices & services → Cuest → Configure → People and their phones');
    expect(el.shadowRoot.querySelector('nav')).toBeNull();
  });

  it('starts a quest and opens the quest screen', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    el.shadowRoot.querySelector('[data-act="start"]').click();
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/q1/start', { playerId: 'p1' });
    expect(text(el)).toContain('quest screen');
  });

  it('Later calls later', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    el.shadowRoot.querySelector('[data-act="later"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/q1/later', {});
  });

  it('expands the whenever pool and starts from it', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    el.shadowRoot.querySelector('[data-act="pool"]').click();
    await el.updateComplete;
    expect(text(el)).toContain('Quest w1');
    const btns = [...el.shadowRoot.querySelectorAll('.poolitem [data-act="start"]')];
    btns[0].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/w1/start', { playerId: 'p1' });
  });

  it('shows an offline banner on 503 and keeps the last data', async () => {
    let offline = false;
    const { hass } = fakeHass({ fail: (_m, path) => (offline && path === 'cuest/quests' ? { status_code: 503, body: { error: 'bridge_offline' } } : null) });
    const el = await mount(hass);
    expect(text(el)).toContain('Quest q1');
    offline = true;
    (hass as any).states = { ...hass.states, 'sensor.cuest_ada_level': { ...hass.states['sensor.cuest_ada_level'], last_changed: 't2' } };
    el.hass = { ...hass };
    for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(el.shadowRoot.querySelector('.banner')).not.toBeNull();
    expect(text(el)).toContain('Quest q1');
  });

  it('shows the server message on other errors', async () => {
    const { hass } = fakeHass({ fail: (m, path) => (m === 'POST' && path.endsWith('/start') ? { status: 409, body: { error: 'conflict', message: 'Someone else has this one.' } } : null) });
    const el = await mount(hass);
    el.shadowRoot.querySelector('[data-act="start"]').click();
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(el.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Someone else has this one.');
  });

  it('switches to placeholder views from the nav', async () => {
    const { hass } = fakeHass();
    const el = await mount(hass);
    el.shadowRoot.querySelector('nav [data-go="shop"]').click();
    await el.updateComplete;
    expect(text(el)).toContain('coming next');
  });

  it('refetches when a Cuest sensor changes', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    const before = callApi.mock.calls.filter((c) => c[1] === 'cuest/quests').length;
    el.hass = { ...hass, states: { ...hass.states, 'sensor.cuest_ada_level': { ...hass.states['sensor.cuest_ada_level'], state: '5', last_changed: 't9' } } };
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/quests').length).toBe(before + 1);
  });

  it('treats a network failure (no status) as offline, not a raw error', async () => {
    const { hass } = fakeHass({ fail: (_m, path) => (path === 'cuest_whoami' ? { error: 'Request error' } : null) });
    const el = await mount(hass);
    expect(el.shadowRoot.querySelector('.banner')).not.toBeNull();
    expect(el.shadowRoot.querySelector('[role="alert"]')).toBeNull();
    expect(text(el)).not.toContain('Request error');
  });

  it('shows friendly copy for a plain-text error body', async () => {
    const { hass } = fakeHass({ fail: (m, path) => (m === 'POST' && path.endsWith('/start') ? { error: 'Response error: 502', status_code: 502, body: '502: Bad Gateway' } : null) });
    const el = await mount(hass);
    el.shadowRoot.querySelector('[data-act="start"]').click();
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    const alert = el.shadowRoot.querySelector('[role="alert"]').textContent;
    expect(alert).toContain('Something went sideways');
    expect(alert).not.toContain('502');
    expect(el.shadowRoot.querySelector('.banner')).toBeNull();
  });

  it("shows \"Someone's on it\" without buttons for a quest another player is doing", async () => {
    const { hass } = fakeHass({ quests: { active: [Q('a1', { status: 'active', claimedBy: 'p2' })], open: [], whenever: [] } });
    const el = await mount(hass);
    expect(text(el)).toContain("Someone's on it");
    expect(el.shadowRoot.querySelector('.qcard [data-act="start"]')).toBeNull();
    expect(text(el)).not.toContain('Continue');
  });

  it('shows Continue to the claimer', async () => {
    const { hass } = fakeHass({ quests: { active: [Q('a1', { status: 'active', claimedBy: 'p1' })], open: [], whenever: [] } });
    const el = await mount(hass);
    expect(text(el)).toContain('Continue');
  });

  it('switches player: clears the choice and returns to the picker', async () => {
    const { hass, callApi } = fakeHass({ who: { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bo' }] } });
    const el = await mount(hass);
    localStorage.setItem('cuest.player', 'p1');
    el.shadowRoot.querySelector('[data-act="switch"]').click();
    await new Promise((r) => setTimeout(r, 0)); await el.updateComplete;
    expect(localStorage.getItem('cuest.player')).toBeNull();
    expect(text(el)).toContain("Who's playing?");
    el.shadowRoot.querySelector('[data-player="p2"]').click();
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(callApi).toHaveBeenCalledWith('GET', 'cuest/players/p2/summary', undefined);
    expect(localStorage.getItem('cuest.player')).toBe('p2');
  });

  it('re-runs a refresh requested while one is loading', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    const before = callApi.mock.calls.filter((c) => c[1] === 'cuest/quests').length;
    void el._refresh();
    void el._refresh();
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/quests').length).toBe(before + 2);
  });

  it('renders level and title in separate elements without a dot', async () => {
    const { hass } = fakeHass();
    const el = await mount(hass);
    expect(el.shadowRoot.querySelector('.lvl').textContent.trim()).toBe('Level 4');
    expect(el.shadowRoot.querySelector('.ttl').textContent.trim()).toBe('Hearthkeeper');
    expect(el.shadowRoot.querySelector('.herocard').textContent).not.toContain('·');
  });
});
