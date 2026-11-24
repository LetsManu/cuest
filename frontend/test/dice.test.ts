import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-panel';
import type { HomeAssistant } from '../src/hass-types';
import { diceView } from '../src/views/dice';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const QUEST = { id: 'q9', title: 'Wipe the counters', minutes: 3, xp: 14, gold: 2, status: 'open', createdAt: '2026-11-24T09:00:00Z', startedAt: null, claimedBy: null, templateId: null, snoozedUntil: null, energy: 'low' };
const SUGGESTION = { title: 'Quick tidy: put 5 things back where they belong', minutes: 2, xp: 10, energy: 'low' };

function fakeHass(o: { roll?: (energy: string) => unknown; accept?: (body: any) => unknown } = {}) {
  const lists = { active: [] as any[], open: [{ ...QUEST }], whenever: [] as any[] };
  const callApi = vi.fn(async (m: string, path: string, body?: any) => {
    if (path === 'cuest_whoami') return { playerId: 'p1', isAdmin: false, players: [{ id: 'p1', name: 'Ada' }] };
    if (path === 'cuest/quests') return lists;
    if (path.endsWith('/summary')) return { player: { id: 'p1', name: 'Ada', xp: 130, gold: 5, restTokens: 0, boostUntil: null }, level: 4, title: 'Hearthkeeper', intoLevel: 30, toNext: 70 };
    if (path.startsWith('cuest/shop?')) return { gold: 5, restTokens: 0, boostUntil: null, owned: {}, equipped: {}, catalog: [] };
    if (path.startsWith('cuest/dice?')) return (o.roll ?? (() => ({ quest: QUEST })))(new URL('http://x/' + path).searchParams.get('energy')!);
    if (path === 'cuest/dice/accept') return (o.accept ?? (() => ({ ...QUEST, id: 'n1', title: SUGGESTION.title, status: 'active', startedAt: '2026-11-24T10:00:00Z' })))(body);
    if (path.endsWith('/start')) { lists.active = [{ ...QUEST, status: 'active', startedAt: '2026-11-24T10:00:00Z' }]; lists.open = []; return { quest: lists.active[0] }; }
    return {};
  });
  const hass = {
    states: { 'sensor.cuest_ada_level': { state: '4', last_changed: 't1', attributes: { cuest_player_id: 'p1', cuest_kind: 'level' } } },
    entities: { 'sensor.cuest_ada_level': { platform: 'cuest' } },
    callWS: vi.fn(), callService: vi.fn(), callApi,
  } as unknown as HomeAssistant;
  return { hass, callApi, lists };
}
async function settle(el: any) {
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
}
async function mount(hass: HomeAssistant) {
  const el = document.createElement('cuest-panel') as any;
  el.now = () => T0;
  el.diceDelayMs = 0;
  document.body.appendChild(el);
  el.hass = hass;
  await settle(el);
  return el;
}
const q = (el: any, sel: string) => el.shadowRoot.querySelector(sel) as HTMLElement;
async function openDice(el: any) { q(el, '[data-act="dice"]').click(); await settle(el); }

beforeEach(() => { document.body.innerHTML = ''; try { localStorage.clear(); } catch { /* */ } });

describe('Energy dice', () => {
  it('village shows Energy dice and Power sprint buttons (44px targets via min-height)', async () => {
    const el = await mount(fakeHass().hass);
    expect(q(el, '[data-act="dice"]').textContent).toContain('Energy dice');
    expect(q(el, '[data-act="sprint"]').textContent).toContain('Power sprint');
  });

  it('power sprint opens a placeholder (filled by a later task) and can go back', async () => {
    const el = await mount(fakeHass().hass);
    q(el, '[data-act="sprint"]').click(); await settle(el);
    expect(q(el, '[data-role="sprint-soon"]')).toBeTruthy();
    q(el, '[data-go="village"]').click(); await settle(el);
    expect(q(el, '[data-act="dice"]')).toBeTruthy();
  });

  it('opens the dice view with Low / Okay / High, Okay selected by default', async () => {
    const el = await mount(fakeHass().hass);
    await openDice(el);
    const btns = [...el.shadowRoot.querySelectorAll('[data-energy]')] as HTMLElement[];
    expect(btns.map((b) => b.textContent!.trim())).toEqual(['Low', 'Okay', 'High']);
    expect(q(el, '[data-energy="medium"]').getAttribute('aria-pressed')).toBe('true');
    expect(q(el, '[data-role="dice-result"]')).toBeNull();
  });

  it('roll asks the server with the mapped energy and shows title, minutes, XP and why', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    await openDice(el);
    q(el, '[data-energy="low"]').click(); await settle(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('GET', 'cuest/dice?playerId=p1&energy=low', undefined);
    const card = q(el, '[data-role="dice-result"]');
    expect(card.textContent).toContain('Wipe the counters');
    expect(card.textContent).toContain('3 min');
    expect(card.textContent).toContain('+14 XP');
    expect(card.textContent).toContain('A good fit for your energy right now.');
    expect(q(el, '[data-act="dice-start"]').textContent).toContain('Start (just 2 min)');
  });

  it('says so kindly when the quest is only the nearest energy', async () => {
    const el = await mount(fakeHass({ roll: () => ({ quest: { ...QUEST, energy: 'medium' } }) }).hass);
    await openDice(el);
    q(el, '[data-energy="high"]').click(); await settle(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    expect(q(el, '[data-role="dice-result"]').textContent).toContain('closest fit');
  });

  it('Start begins the quest and opens the quest view', async () => {
    const { hass, callApi } = fakeHass();
    const el = await mount(hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    q(el, '[data-act="dice-start"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/quests/q9/start', { playerId: 'p1' });
    expect(q(el, '.quest')).toBeTruthy();
    expect(q(el, '.quest').textContent).toContain('Wipe the counters');
  });

  it('Another re-rolls', async () => {
    let n = 0;
    const el = await mount(fakeHass({ roll: () => ({ quest: { ...QUEST, id: `q${++n}`, title: n === 1 ? 'First pick' : 'Second pick' } }) }).hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    expect(q(el, '[data-role="dice-result"]').textContent).toContain('First pick');
    expect(q(el, '[data-act="roll"]').textContent).toContain('Another');
    q(el, '[data-act="roll"]').click(); await settle(el);
    expect(q(el, '[data-role="dice-result"]').textContent).toContain('Second pick');
  });

  it('a suggestion offers Start which accepts it and opens the quest view', async () => {
    const { hass, callApi } = fakeHass({ roll: () => ({ suggestion: SUGGESTION }) });
    const el = await mount(hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    const card = q(el, '[data-role="dice-result"]');
    expect(card.textContent).toContain('Quick tidy');
    expect(card.textContent).toContain('+10 XP');
    expect(q(el, '[data-act="dice-start"]').textContent!.trim()).toBe('Start');
    // the accepted quest shows up in the lists on refresh
    const lists = (await callApi('GET', 'cuest/quests')) as any;
    lists.active = [{ ...QUEST, id: 'n1', title: SUGGESTION.title, status: 'active', startedAt: '2026-11-24T10:00:00Z' }];
    q(el, '[data-act="dice-start"]').click(); await settle(el);
    expect(callApi).toHaveBeenCalledWith('POST', 'cuest/dice/accept', { playerId: 'p1', suggestion: SUGGESTION });
    expect(q(el, '.quest').textContent).toContain('Quick tidy');
  });

  it('a failed roll shows a friendly message and stays on the dice view', async () => {
    const el = await mount(fakeHass({ roll: () => { throw { status_code: 500, body: '{}' }; } }).hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    expect(q(el, '[role="alert"]')).toBeTruthy();
    expect(q(el, '[data-act="roll"]')).toBeTruthy();
  });

  it('unlocks sound synchronously in the roll tap when sound is on', async () => {
    const resume = vi.fn(async () => {});
    (globalThis as any).AudioContext = class { state = 'suspended'; resume = resume; };
    localStorage.setItem('cuest.sound', '1');
    const el = await mount(fakeHass().hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click();
    expect(resume).toHaveBeenCalled();
    delete (globalThis as any).AudioContext;
  });

  it('double-tapping Start sends one request (quest and suggestion)', async () => {
    const a = fakeHass();
    const el = await mount(a.hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    const b = q(el, '[data-act="dice-start"]');
    b.click(); b.click(); await settle(el);
    expect(a.callApi.mock.calls.filter((c) => c[1] === 'cuest/quests/q9/start').length).toBe(1);

    document.body.innerHTML = '';
    const s = fakeHass({ roll: () => ({ suggestion: SUGGESTION }) });
    const el2 = await mount(s.hass);
    await openDice(el2);
    q(el2, '[data-act="roll"]').click(); await settle(el2);
    const b2 = q(el2, '[data-act="dice-start"]');
    b2.click(); b2.click(); await settle(el2);
    expect(s.callApi.mock.calls.filter((c) => c[1] === 'cuest/dice/accept').length).toBe(1);
  });

  it('ignores a roll reply whose energy no longer matches the toggle', async () => {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((ok) => { release = ok; });
    const f = fakeHass({ roll: () => gate });
    const el = await mount(f.hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    q(el, '[data-energy="high"]').click(); await settle(el);
    release({ quest: { ...QUEST, energy: 'medium' } }); await settle(el);
    expect(q(el, '[data-role="dice-result"]')).toBeNull();
    expect(q(el, '[data-act="roll"]').hasAttribute('disabled')).toBe(false);
  });

  it('does not unlock sound on Roll or Start when sound is off', async () => {
    const resume = vi.fn(async () => {});
    (globalThis as any).AudioContext = class { state = 'suspended'; resume = resume; };
    const el = await mount(fakeHass().hass);
    await openDice(el);
    q(el, '[data-act="roll"]').click(); await settle(el);
    q(el, '[data-act="dice-start"]').click(); await settle(el);
    expect(resume).not.toHaveBeenCalled();
    delete (globalThis as any).AudioContext;
  });

  it('back returns to the village', async () => {
    const el = await mount(fakeHass().hass);
    await openDice(el);
    q(el, '[data-act="dice-back"]').click(); await settle(el);
    expect(q(el, '[data-act="dice"]')).toBeTruthy();
  });

  it('die template is decorative (aria-hidden) and animates only while rolling', () => {
    const base = { energy: 'low' as const, result: null, busy: false, onEnergy() {}, onRoll() {}, onStart() {}, onBack() {} };
    const host = document.createElement('div');
    document.body.appendChild(host);
    return import('lit').then(({ render }) => {
      render(diceView({ ...base, rolling: true }), host);
      expect(host.querySelector('svg.die.rolling')!.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelectorAll('svg.die rect').length).toBe(2);
      expect(host.querySelector('svg.die rect')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
      render(diceView({ ...base, rolling: false }), host);
      expect(host.querySelector('svg.die.rolling')).toBeNull();
    });
  });
});
