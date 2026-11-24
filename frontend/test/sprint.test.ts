import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const QUEST = { id: 'q9', title: 'Wipe the counters', minutes: 3, xp: 14, gold: 2, status: 'open', createdAt: '2026-11-24T09:00:00Z', startedAt: null, claimedBy: null, templateId: null, snoozedUntil: null };

const running = (minutes = 15, agoMs = 0, logs = 0) => ({ id: 's1', playerId: 'p1', minutes, startedAt: new Date(T0 - agoMs).toISOString(), endedAt: null, logs, xp: null });
interface Opts { sprint?: any; startErr?: number; logErr?: boolean }
function fakeHass(o: Opts = {}) {
  let sprint: any = o.sprint ?? null;
  const lists = { active: [] as any[], open: [{ ...QUEST }], whenever: [] as any[] };
  const callApi = vi.fn(async (m: string, path: string, body?: any) => {
    if (path === 'cuest_whoami') return { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
    if (path === 'cuest/quests') return lists;
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 130, gold: 5, restTokens: 0, boostUntil: null }, level: 4, title: 'Hearthkeeper', intoLevel: 30, toNext: 70 };
    if (path.startsWith('cuest/shop?')) return { gold: 5, restTokens: 0, boostUntil: null, owned: {}, equipped: {}, catalog: [] };
    if (path.startsWith('cuest/sprint?')) return { sprint };
    if (path === 'cuest/sprint/start') {
      if (o.startErr) { sprint = running(15, 60_000); throw { status_code: o.startErr, body: { error: 'sprint_running', message: 'A sprint is already running.' } }; }
      sprint = { id: 's1', playerId: 'p1', minutes: body.minutes, startedAt: new Date(Date.now()).toISOString(), endedAt: null, logs: 0, xp: null };
      return sprint;
    }
    if (path === 'cuest/sprint/log') {
      if (o.logErr) throw { status_code: 409, body: { error: 'log_limit', message: 'Ten notes is plenty. Keep going!' } };
      sprint = { ...sprint, logs: sprint.logs + 1 };
      return { sprint, xp: 5 };
    }
    if (path === 'cuest/sprint/finish') {
      const elapsed = Math.floor((Date.now() - Date.parse(sprint.startedAt)) / 60000);
      const xp = Math.min(sprint.minutes, elapsed) * 2;
      const done = { ...sprint, endedAt: new Date().toISOString(), xp };
      sprint = null;
      return { sprint: done, xp };
    }
    if (path.endsWith('/done')) return { quest: QUEST, reward: { xp: 14, gold: 2, lines: [] }, player: { id: 'p1', name: 'Ada', xp: 144, gold: 7, restTokens: 0, boostUntil: null } };
    return {};
  });
  const hass = {
    states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level' } } },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(), callService: vi.fn(), callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi, endSprint: () => { sprint = null; } };
}
async function settle(el: any) {
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
}
async function mount(hass: HomeAssistant) {
  const el = document.createElement('cuest-panel') as any;
  el.now = () => Date.now();
  document.body.appendChild(el);
  el.hass = hass;
  await settle(el);
  return el;
}
const q = (el: any, sel: string) => el.shadowRoot.querySelector(sel) as HTMLElement;
const qa = (el: any, sel: string) => [...el.shadowRoot.querySelectorAll(sel)] as HTMLElement[];
async function openSprint(el: any) { q(el, '[data-act="sprint"]').click(); await settle(el); }
async function tickFor(el: any, ms: number) { vi.advanceTimersByTime(ms); await el.updateComplete; }

beforeEach(() => {
  document.body.innerHTML = '';
  try { localStorage.clear(); } catch { /* */ }
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); });

describe('Power sprint', () => {
  it('offers 5 / 15 / 25 minutes and starts the chosen length', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    await openSprint(el);
    expect(qa(el, '[data-minutes]').map((b) => b.dataset.minutes)).toEqual(['5', '15', '25']);
    q(el, '[data-minutes="15"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/sprint/start', { playerId: 'p1', minutes: 15 });
    expect(q(el, '[data-role="countdown"]').textContent).toBe('15:00');
  });

  it('counts down from the server startedAt, not a local counter', async () => {
    const { hass } = fakeHass({ sprint: running(15, 4 * 60_000 + 30_000) });
    const el = await mount(hass);
    await openSprint(el);
    expect(q(el, '[data-role="countdown"]').textContent).toBe('10:30');
    await tickFor(el, 1000);
    expect(q(el, '[data-role="countdown"]').textContent).toBe('10:29');
    await tickFor(el, 60_000);
    expect(q(el, '[data-role="countdown"]').textContent).toBe('09:29');
    const bar = q(el, '[role="progressbar"]');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBe(Math.floor(((15 * 60_000 - 569_000) / (15 * 60_000)) * 100));
  });

  it('shows sprint XP so far: whole minutes x2 plus 5 per log', async () => {
    const { hass } = fakeHass({ sprint: running(15, 3 * 60_000 + 10_000, 2) });
    const el = await mount(hass);
    await openSprint(el);
    expect(q(el, '[data-role="sprint-xp"]').textContent).toContain('16');
    await tickFor(el, 50_000);
    expect(q(el, '[data-role="sprint-xp"]').textContent).toContain('18');
  });

  it('quick-log: counter, maxlength 80, posts the note, +5 XP', async () => {
    const { hass, callApi } = fakeHass({ sprint: running(15, 60_000) });
    const el = await mount(hass);
    await openSprint(el);
    const input = q(el, '[data-role="log-input"]') as HTMLInputElement;
    expect(input.maxLength).toBe(80);
    expect(q(el, '[data-role="log-count"]').textContent).toContain('0/80');
    input.value = 'Cleared the sink';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(q(el, '[data-role="log-count"]').textContent).toContain('16/80');
    q(el, '[data-act="sprint-log"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/sprint/log', { playerId: 'p1', note: 'Cleared the sink' });
    expect((q(el, '[data-role="log-input"]') as HTMLInputElement).value).toBe('');
    expect(q(el, '[data-role="sprint-xp"]').textContent).toContain('7');
  });

  it('log button is disabled when empty and a double tap sends one request', async () => {
    const { hass, callApi } = fakeHass({ sprint: running(15, 60_000) });
    const el = await mount(hass);
    await openSprint(el);
    expect((q(el, '[data-act="sprint-log"]') as HTMLButtonElement).disabled).toBe(true);
    const input = q(el, '[data-role="log-input"]') as HTMLInputElement;
    input.value = 'x'; input.dispatchEvent(new Event('input')); await el.updateComplete;
    const b = q(el, '[data-act="sprint-log"]');
    b.click(); b.click(); await settle(el);
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/sprint/log')).toHaveLength(1);
  });

  it('at 10 logs the input is disabled with kind copy', async () => {
    const { hass } = fakeHass({ sprint: running(15, 60_000, 10) });
    const el = await mount(hass);
    await openSprint(el);
    expect((q(el, '[data-role="log-input"]') as HTMLInputElement).disabled).toBe(true);
    expect((q(el, '[data-act="sprint-log"]') as HTMLButtonElement).disabled).toBe(true);
    expect(q(el, '[data-role="log-full"]').textContent).toMatch(/10/);
  });

  it('double tapping a start length sends one request', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    await openSprint(el);
    const b = q(el, '[data-minutes="5"]');
    b.click(); b.click(); await settle(el);
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/sprint/start')).toHaveLength(1);
  });

  it('start 409 just resumes the running sprint', async () => {
    const { hass } = fakeHass({ startErr: 409, sprint: null });
    const el = await mount(hass);
    await openSprint(el);
    q(el, '[data-minutes="5"]').click(); await settle(el);
    expect(q(el, '[data-role="countdown"]').textContent).toBe('14:00');
    expect(q(el, '[role="alert"]')).toBeNull();
  });

  it('ticking off an open quest uses the normal done route and stays in the sprint', async () => {
    const { hass, callApi } = fakeHass({ sprint: running(15, 60_000) });
    const el = await mount(hass);
    await openSprint(el);
    expect(q(el, '[data-role="sprint-quests"]').textContent).toContain('Wipe the counters');
    q(el, '[data-act="sprint-quest-done"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/q9/done', { playerId: 'p1' });
    expect(q(el, '[data-role="countdown"]')).toBeTruthy();
  });

  it('end early finishes, shows the summary with base plus log XP and no shame wording', async () => {
    const { hass, callApi } = fakeHass({ sprint: running(15, 5 * 60_000 + 5_000, 2) });
    const el = await mount(hass);
    await openSprint(el);
    const b = q(el, '[data-act="sprint-finish"]');
    expect(b.textContent).toContain('End sprint early (keep all XP)');
    b.click(); b.click(); await settle(el);
    expect(callApi.mock.calls.filter((c) => c[1] === 'cuest/sprint/finish')).toHaveLength(1);
    const s = q(el, '[data-role="sprint-summary"]');
    expect(s.textContent).toContain('20');
    expect(s.textContent).not.toMatch(/fail|late|missed|penalty|overdue/i);
    expect(q(el, '[data-role="countdown"]')).toBeNull();
  });

  it('notices the server auto-finish when time is up and shows the result', async () => {
    const h = fakeHass({ sprint: running(5, 4 * 60_000 + 58_000, 1) });
    const el = await mount(h.hass);
    await openSprint(el);
    expect(q(el, '[data-role="countdown"]').textContent).toBe('00:02');
    h.endSprint();
    await tickFor(el, 3000);
    await settle(el);
    await tickFor(el, 3000);
    await settle(el);
    const s = q(el, '[data-role="sprint-summary"]');
    expect(s).toBeTruthy();
    expect(s.textContent).toContain('15');
  });

  it('stops its interval when the view changes or the panel disconnects', async () => {
    const { hass } = fakeHass({ sprint: running(15, 60_000) });
    const el = await mount(hass);
    const base = vi.getTimerCount();
    await openSprint(el);
    expect(vi.getTimerCount()).toBeGreaterThan(base);
    q(el, '[data-go="village"]').click(); await settle(el);
    expect(vi.getTimerCount()).toBe(base);
    await openSprint(el);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});
