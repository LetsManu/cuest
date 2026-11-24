import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const Q = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Quest ${id}`, minutes: 5, xp: 12, gold: 3, status: 'open', createdAt: 't',
  startedAt: null, claimedBy: null, templateId: null, snoozedUntil: null, ...over,
});

function fakeHass(opts: { level?: number; levelAfterDone?: number; boostUntil?: string | null; offlineDone?: boolean; xpAfter?: number; staleSummary?: boolean } = {}) {
  let level = opts.level ?? 4;
  let down = false;
  const callApi = vi.fn(async (method: string, path: string) => {
    if (down) throw { status_code: 503, body: '{"error":"bridge_offline"}' };
    if (path === 'cuest_whoami') return { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
    if (path === 'cuest/quests') return { active: [Q('q1', { status: 'active', startedAt: new Date(T0).toISOString(), xp: 12 })], open: [], whenever: [] };
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 130, gold: 215, restTokens: 2, boostUntil: opts.boostUntil ?? null }, level, title: level >= 8 ? 'Hearth Warden' : level >= 4 ? 'Hearthkeeper' : 'Apprentice', intoLevel: 30, toNext: 70 };
    if (path.endsWith('/done')) {
      if (opts.offlineDone) { down = true; throw { status_code: 503, body: '{"error":"bridge_offline"}' }; }
      if (opts.levelAfterDone && !opts.staleSummary) level = opts.levelAfterDone;
      return { quest: Q('q1', { status: 'done' }), reward: { xp: 12, gold: 3, lines: [] }, player: { xp: opts.xpAfter ?? 130 } };
    }
    return {};
  });
  const hass = {
    states: { 'sensor.cuest_ada_level': { state: String(level), last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level', outfit_palette: { G: '#B5523B' }, decor: ['lantern'] } } },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(), callService: vi.fn(), callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi };
}

async function settle(el: any) {
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
}
async function mount(hass: HomeAssistant, clock: { t: number }) {
  const el = document.createElement('cuest-panel') as any;
  el.now = () => clock.t;
  el.narrow = false;
  document.body.appendChild(el);
  el.hass = hass;
  await settle(el);
  return el;
}
const text = (el: any) => el.shadowRoot.textContent as string;

describe('quest screen', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  async function openQuest(clock: { t: number }, o = {}) {
    const f = fakeHass(o);
    const el = await mount(f.hass, clock);
    el.shadowRoot.querySelector('[data-act="start"]').click();
    await settle(el);
    return { el, ...f };
  }

  it('counts down from startedAt on the injected clock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const clock = { t: T0 + 30_000 };
      const { el } = await openQuest(clock);
      expect(text(el)).toContain('Quest started');
      expect(text(el)).toContain('Only 2 minutes. Stop whenever you like, it still counts.');
      expect(el.shadowRoot.querySelector('[data-role="clock"]').textContent).toBe('1:30');
      expect(Number(el.shadowRoot.querySelector('.arc').getAttribute('stroke-dashoffset'))).toBeCloseTo(603.2 * 0.25, 0);
      clock.t = T0 + 90_000;
      vi.advanceTimersByTime(1000);
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('[data-role="clock"]').textContent).toBe('0:30');
      clock.t = T0 + 130_000;
      vi.advanceTimersByTime(1000);
      await el.updateComplete;
      expect(text(el)).toContain('minutes done. Keep going if you like');
      // leaving the view stops the ticking
      el.shadowRoot.querySelector('[data-go="village"]').click();
      await el.updateComplete;
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the 30 s refresh timer remains
    } finally { vi.useRealTimers(); }
  });

  it('doubles the XP on the button while boosted', async () => {
    const { el } = await openQuest({ t: T0 + 1000 }, { boostUntil: new Date(T0 + 3600_000).toISOString() });
    expect(el.shadowRoot.querySelector('[data-act="done"]').textContent).toContain('Done! +24 XP');
  });

  it('done calls the API, returns to the village and shows the reward toast', async () => {
    const { el, callApi } = await openQuest({ t: T0 + 5000 });
    el.shadowRoot.querySelector('[data-act="done"]').click();
    await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/q1/done', { playerId: 'p1' });
    expect(el.shadowRoot.querySelector('.quest')).toBeNull();
    const toast = el.shadowRoot.querySelector('[data-role="toast"]');
    expect(toast.textContent).toContain('+12 XP · +3 gold');
    expect(toast.classList.contains('levelup')).toBe(false);
  });

  it('"Stop for now" also completes the quest', async () => {
    const { el, callApi } = await openQuest({ t: T0 + 5000 });
    el.shadowRoot.querySelector('[data-act="stop"]').click();
    await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/q1/done', { playerId: 'p1' });
  });

  it('shows a level-up toast when the level increased', async () => {
    const { el } = await openQuest({ t: T0 + 5000 }, { level: 3, xpAfter: 605 });
    el.shadowRoot.querySelector('[data-act="done"]').click();
    await settle(el);
    const toast = el.shadowRoot.querySelector('[data-role="toast"]');
    expect(toast.classList.contains('levelup')).toBe(true);
    expect(toast.textContent).toContain('Level 4! Hearthkeeper');
  });

  it('shows the level-up toast from the done response even when a refresh is in flight', async () => {
    const { el } = await openQuest({ t: T0 + 5000 }, { level: 3, xpAfter: 605, staleSummary: true });
    el._loading = true; // a refresh is already running, so _act's own refresh is skipped
    el.shadowRoot.querySelector('[data-act="done"]').click();
    await settle(el);
    const toast = el.shadowRoot.querySelector('[data-role="toast"]');
    expect(toast.classList.contains('levelup')).toBe(true);
    expect(toast.textContent).toContain('Level 4! Hearthkeeper');
    el._loading = false;
  });

  it('keeps a full ring when the two minutes are over', async () => {
    const { el } = await openQuest({ t: T0 + 200_000 });
    expect(el.shadowRoot.querySelector('.arc').getAttribute('stroke-dashoffset')).toBe('0.0');
    expect(text(el)).toContain('minutes done. Keep going if you like');
  });

  it('re-arms the tick after a reconnect on the quest view', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const clock = { t: T0 + 30_000 };
      const { el } = await openQuest(clock);
      el.remove();
      expect(vi.getTimerCount()).toBe(0);
      document.body.appendChild(el);
      clock.t = T0 + 60_000;
      vi.advanceTimersByTime(1000);
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('[data-role="clock"]').textContent).toBe('1:00');
    } finally { vi.useRealTimers(); }
  });

  it('shows a friendly line when the quest is no longer there', async () => {
    const { el } = await openQuest({ t: T0 + 5000 });
    el._questId = 'gone';
    await el.updateComplete;
    expect(text(el)).toContain('This quest is already taken care of. Nice!');
    expect(el.shadowRoot.querySelector('[data-go="village"]')).not.toBeNull();
  });

  it('stays on the quest and shows the offline banner when done cannot reach Cuest', async () => {
    const { el } = await openQuest({ t: T0 + 5000 }, { offlineDone: true });
    el.shadowRoot.querySelector('[data-act="done"]').click();
    await settle(el);
    expect(text(el)).toContain('Cuest is resting right now');
    expect(el.shadowRoot.querySelector('[data-act="done"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('[data-role="toast"]')).toBeNull();
  });
});

describe('hero screen', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('shows level, title, xp bar, path with silhouettes and stats', async () => {
    const { hass } = fakeHass({ level: 4 });
    const el = await mount(hass, { t: T0 });
    el.shadowRoot.querySelector('nav [data-go="hero"]').click();
    await settle(el);
    const t = text(el);
    expect(t).toContain('Level 4');
    expect(t).toContain('Hearthkeeper');
    expect(t).toContain('30 / 100 XP');
    expect(t).toContain('Next: Level 5');
    expect(t).toContain('Path of the hero');
    expect(t).toContain('You are here');
    expect(t).toContain('Level 8');
    const boxes = [...el.shadowRoot.querySelectorAll('[data-stage-box] .sprite')].map((n: any) => n.dataset.stage);
    expect(boxes).toEqual(['1', '2', '0']);
    const big = el.shadowRoot.querySelector('[data-role="hero"] .sprite div') as HTMLElement;
    expect(big.style.boxShadow).toContain('#B5523B'); // outfit palette applied
    expect(t).toContain('130');
    expect(t).toContain('215');
    expect(t).toContain('rest-day tokens');
  });
});
