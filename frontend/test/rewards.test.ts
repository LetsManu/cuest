import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';
import { isSoundOn, playFanfare, setSoundOn } from '../src/sound';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const Q = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Quest ${id}`, minutes: 5, xp: 12, gold: 3, status: 'open', createdAt: 't',
  startedAt: null, claimedBy: null, templateId: null, snoozedUntil: null, ...over,
});

interface Opts { streak?: number; restTokens?: number; chestKeys?: number; questOfDay?: string | null; done?: Record<string, unknown>; chest?: unknown }
function fakeHass(o: Opts = {}) {
  const callApi = vi.fn(async (_m: string, path: string) => {
    if (path === 'cuest_whoami') return { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
    if (path === 'cuest/quests') return { active: [Q('q1', { status: 'active', startedAt: new Date(T0).toISOString() })], open: [Q('q2')], whenever: [], questOfDay: o.questOfDay === undefined ? 'q2' : o.questOfDay };
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 130, gold: 215, restTokens: o.restTokens ?? 1, boostUntil: null }, level: 4, title: 'Hearthkeeper', intoLevel: 30, toNext: 70, streak: o.streak ?? 6, bestStreak: 9, restTokens: o.restTokens ?? 1, chestKeys: o.chestKeys ?? 0 };
    if (path.endsWith('/done')) return { quest: Q('q1', { status: 'done' }), reward: { xp: 52, gold: 3, lines: [{ label: 'Quest', xp: 12, gold: 3 }, { label: 'Kept going', xp: 25, gold: 0 }, { label: 'Combo ×3', xp: 15, gold: 0 }] }, player: { xp: 300 }, streak: { streak: 6, restarted: false, usedRest: null }, loot: null, chestKey: false, ...o.done };
    if (path === 'cuest/shop/open-chest') return { player: {}, result: o.chest ?? { kind: 'chest', gold: 40 } };
    return {};
  });
  const hass = {
    states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level' } } },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(), callService: vi.fn(), callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi };
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
async function finish(el: any) {
  q(el, '[data-act="start"]').click();
  await settle(el);
  q(el, '[data-act="done"]').click();
  await settle(el);
}

describe('rewards in the panel', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('lists the reward lines in the toast', async () => {
    const el = await mount(fakeHass().hass);
    await finish(el);
    const t = q(el, '[data-role="toast"]').textContent!;
    expect(t).toContain('+52 XP · +3 gold');
    expect(t).toContain('Kept going +25');
    expect(t).toContain('Combo ×3 +15');
    expect(t).toContain('Streak: 6 days');
  });

  it('shows loot and the chest key', async () => {
    const f = fakeHass({ done: { loot: { itemId: 'hood_starry', name: 'Starry cloak' }, chestKey: true, streak: { streak: 6, restarted: false, usedRest: null } } });
    const el = await mount(f.hass);
    await finish(el);
    const t = q(el, '[data-role="toast"]').textContent!;
    expect(t).toContain('You found: Starry cloak!');
    expect(t).toContain('chest key');
    expect(t).toContain('Streak: 6 days');
  });

  it('uses kind copy when a streak restarts and when a rest day saves it', async () => {
    let el = await mount(fakeHass({ done: { streak: { streak: 1, restarted: true, usedRest: null } } }).hass);
    await finish(el);
    let t = q(el, '[data-role="toast"]').textContent!;
    expect(t).toContain('New streak started — welcome back!');
    expect(t).not.toMatch(/lost|broke|failed|missed/i);
    document.body.innerHTML = '';
    el = await mount(fakeHass({ done: { streak: { streak: 7, restarted: false, usedRest: 'free' } } }).hass);
    await finish(el);
    t = q(el, '[data-role="toast"]').textContent!;
    expect(t).toContain('Rest day used — your streak is safe.');
    expect(t).toContain('Streak: 7 days');
  });

  it('hero card shows the flame streak badge with rest tokens', async () => {
    const el = await mount(fakeHass().hass);
    const b = q(el, '[data-role="streak"]');
    expect(b.textContent).toContain('6-day streak · 1 rest token');
    expect(b.querySelector('svg')).not.toBeNull();
    document.body.innerHTML = '';
    const el2 = await mount(fakeHass({ streak: 1, restTokens: 2 }).hass);
    expect(q(el2, '[data-role="streak"]').textContent).toContain('1-day streak · 2 rest tokens');
  });

  it('marks the quest of the day only on that card', async () => {
    const el = await mount(fakeHass().hass);
    const badges = el.shadowRoot.querySelectorAll('[data-role="qotd"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain('Quest of the day ×3');
    expect(badges[0].closest('article').textContent).toContain('Quest q2');
  });

  it('shows Open chest (N) only with keys and opens it', async () => {
    let el = await mount(fakeHass({ chestKeys: 0 }).hass);
    expect(q(el, '[data-act="open-chest"]')).toBeNull();
    document.body.innerHTML = '';
    const f = fakeHass({ chestKeys: 2 });
    el = await mount(f.hass);
    const btn = q(el, '[data-act="open-chest"]');
    expect(btn.textContent).toContain('Open chest (2)');
    btn.click();
    await settle(el);
    expect(f.callApi).toHaveBeenCalledWith('POST', 'cuest/shop/open-chest', { playerId: 'p1' });
    expect(q(el, '[data-role="toast"]').textContent).toContain('40 gold');
  });

  it('sound is off until the player taps Sound on', async () => {
    const el = await mount(fakeHass().hass);
    expect(isSoundOn()).toBe(false);
    const b = q(el, '[data-act="sound"]');
    expect(b.textContent).toContain('Sound on');
    b.click();
    await settle(el);
    expect(isSoundOn()).toBe(true);
    expect(q(el, '[data-act="sound"]').textContent).toContain('Sound off');
  });
});

describe('sound', () => {
  beforeEach(() => localStorage.clear());
  it('does not throw without AudioContext and persists the toggle', () => {
    expect(isSoundOn()).toBe(false);
    setSoundOn(true);
    expect(localStorage.getItem('cuest.sound')).toBe('1');
    expect(() => playFanfare('done')).not.toThrow();
    expect(() => playFanfare('level')).not.toThrow();
    setSoundOn(false);
    expect(isSoundOn()).toBe(false);
  });
  it('survives a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('x'); });
    expect(isSoundOn()).toBe(false);
    spy.mockRestore();
  });
});
