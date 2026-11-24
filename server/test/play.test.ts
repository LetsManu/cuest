import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { FakeClock } from '../src/clock.js';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { createEngine, type Engine } from '../src/engine.js';
import { copy } from '../src/copy.js';
import { Bus } from '../src/bus.js';
import { transaction } from '../src/db/db.js';
import { SprintService } from '../src/services/sprint.js';
import { DiceService } from '../src/services/dice.js';
import { QuestService } from '../src/services/quests.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';

const config: Config = { port: 0, dataDir: ':memory:', bridgeSecret: 'sekrit', tz: 'UTC', tickSeconds: 30 };
let db: DatabaseSync;
let clock: FakeClock;
let engine: Engine;
let pid: string;

const post = async (url: string, payload: object) => engine.app.inject({ method: 'POST', url, payload });
const get = async (url: string) => engine.app.inject({ method: 'GET', url });
const mkQuest = async (title: string, energy: string) =>
  (await post('/api/quests', { title, energy, minutes: 5, xp: 10 })).json();
const xp = (): number => new PlayersRepo(db).get(pid)!.xp;

beforeEach(async () => {
  db = openDb(':memory:');
  migrate(db);
  clock = new FakeClock(new Date('2026-11-24T10:00:00Z'));
  engine = await createEngine({ db, clock, config, log: () => {}, logger: false });
  pid = (await post('/api/players', { name: 'Ana' })).json().id;
});
afterEach(async () => {
  await engine.app.close();
});

describe('energy dice', () => {
  it('returns a quest matching the energy', async () => {
    await mkQuest('Low one', 'low');
    const high = await mkQuest('High one', 'high');
    const res = (await get(`/api/dice?playerId=${pid}&energy=high`)).json();
    expect(res.quest.id).toBe(high.id);
  });

  it('falls back to the nearest energy', async () => {
    const med = await mkQuest('Medium one', 'medium');
    expect((await get(`/api/dice?playerId=${pid}&energy=low`)).json().quest.id).toBe(med.id);
    expect((await get(`/api/dice?playerId=${pid}&energy=high`)).json().quest.id).toBe(med.id);
  });

  it('low falls through to high when medium is empty', async () => {
    const high = await mkQuest('High one', 'high');
    expect((await get(`/api/dice?playerId=${pid}&energy=low`)).json().quest.id).toBe(high.id);
  });

  it('accept leaves no orphan quest when start fails', () => {
    const quests = new QuestService({ quests: new QuestsRepo(db), players: new PlayersRepo(db), ledger: new LedgerRepo(db), bus: new Bus(), clock });
    const dice = new DiceService({ quests, tx: (fn) => transaction(db, fn) });
    expect(() => dice.accept('nope', copy.dice.suggestion)).toThrow();
    expect(quests.listVisible().open).toHaveLength(0);
  });

  it('uses the injected rng to pick among matches', () => {
    const quests = new QuestService({ quests: new QuestsRepo(db), players: new PlayersRepo(db), ledger: new LedgerRepo(db), bus: new Bus(), clock });
    const a = quests.open({ title: 'A', energy: 'low', minutes: 1, xp: 1 }).quest;
    clock.advance(1);
    const b = quests.open({ title: 'B', energy: 'low', minutes: 1, xp: 1 }).quest;
    const first = new DiceService({ quests, rng: () => 0 }).roll('low') as { quest: { id: string } };
    const last = new DiceService({ quests, rng: () => 0.99 }).roll('low') as { quest: { id: string } };
    expect(new Set([first.quest.id, last.quest.id])).toEqual(new Set([a.id, b.id]));
  });

  it('suggests a quick tidy when there are no quests at all', async () => {
    const res = (await get(`/api/dice?playerId=${pid}&energy=medium`)).json();
    expect(res).toEqual({ suggestion: { title: 'Quick tidy: put 5 things back where they belong', minutes: 2, xp: 10, energy: 'low' } });
  });

  it('accept creates a manual quest and starts it', async () => {
    const { suggestion } = (await get(`/api/dice?playerId=${pid}&energy=low`)).json();
    const res = await post('/api/dice/accept', { playerId: pid, suggestion });
    expect(res.statusCode).toBe(201);
    const q = res.json();
    expect(q).toMatchObject({ title: suggestion.title, status: 'active', claimedBy: pid, templateId: null, xp: 10 });
    expect((await get('/api/quests')).json().active.map((x: { id: string }) => x.id)).toContain(q.id);
  });

  it('rejects a made-up suggestion, bad energy and unknown player', async () => {
    const bad = { title: 'Free XP', minutes: 1, xp: 9999, energy: 'low' };
    expect((await post('/api/dice/accept', { playerId: pid, suggestion: bad })).statusCode).toBe(400);
    expect((await get(`/api/dice?playerId=${pid}&energy=huge`)).statusCode).toBe(400);
    expect((await get('/api/dice?playerId=nope&energy=low')).statusCode).toBe(404);
    expect((await post('/api/dice/accept', { playerId: 'nope', suggestion: copy.dice.suggestion })).statusCode).toBe(404);
    expect((await get('/api/quests')).json().open).toHaveLength(0);
  });
});

describe('quick suggestions pay a small flat reward (Ruling 2)', () => {
  const accept = async () => {
    const { suggestion } = (await get(`/api/dice?playerId=${pid}&energy=low`)).json();
    const res = await post('/api/dice/accept', { playerId: pid, suggestion });
    expect(res.statusCode).toBe(201);
    return res.json();
  };
  const done = async (id: string) => (await post(`/api/quests/${id}/done`, { playerId: pid })).json();
  const player = () => new PlayersRepo(db).get(pid)!;

  it('marks the accepted quest as a dice suggestion', async () => {
    const q = await accept();
    expect(q.source).toBe('dice_suggestion');
  });

  it('pays base XP and gold only: no fresh, keep-going, combo or quest of the day', async () => {
    engine.tick(); // today's quest-of-the-day row exists but is empty
    const real = await mkQuest('Dishes', 'low');
    await done(real.id); // a real quest just before: a combo would start here
    const q = await accept();
    expect((await get('/api/quests')).json().questOfDay).toBe(real.id);
    clock.advance(6); // keep-going would pay here
    const r = await done(q.id);
    expect(r.reward).toEqual({ xp: 10, gold: 3, lines: [{ label: 'Quest', xp: 10, gold: 3 }] });
  });

  it('never becomes the quest of the day, even as the first quest opened that day', async () => {
    engine.tick();
    const q = await accept();
    expect((await get('/api/quests')).json().questOfDay).toBeNull();
    const r = await done(q.id);
    expect(r.reward.lines.map((l: { label: string }) => l.label)).toEqual(['Quest']);
  });

  it('is never picked as quest of the day from the pool either', async () => {
    const q = await accept();
    db.prepare("UPDATE quests SET status = 'whenever', claimed_by = NULL, started_at = NULL WHERE id = ?").run(q.id);
    clock.advance(24 * 60);
    engine.tick();
    expect((await get('/api/quests')).json().questOfDay).toBeNull();
  });

  it('rolls no loot and does not count towards chest keys', async () => {
    db.prepare('UPDATE players SET done_count = 4 WHERE id = ?').run(pid);
    for (let i = 0; i < 6; i++) {
      const r = await done((await accept()).id);
      expect(r).toMatchObject({ loot: null, chestKey: false });
      clock.advance(1);
    }
    expect(player()).toMatchObject({ doneCount: 4, chestKeys: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM player_items WHERE player_id = ?').get(pid)).toEqual({ n: 0 });
  });

  it('does not touch the combo chain', async () => {
    const q = await accept();
    await done(q.id);
    expect(player()).toMatchObject({ comboCount: 0, lastDoneAt: null });
  });

  it('still counts for the streak', async () => {
    const r = await done((await accept()).id);
    expect(r.streak).toMatchObject({ streak: 1 });
    expect(player().streak).toBe(1);
  });

  it('accept is 409 with kind copy when a quest is waiting in the pool', async () => {
    const { suggestion } = (await get(`/api/dice?playerId=${pid}&energy=low`)).json();
    await mkQuest('Vacuum', 'high');
    const res = await post('/api/dice/accept', { playerId: pid, suggestion });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'quest_waiting', message: copy.dice.errors.quest_waiting });
    expect((await get('/api/quests')).json().active).toHaveLength(0);
  });
});

describe('power sprint', () => {
  const start = (minutes = 15) => post('/api/sprint/start', { playerId: pid, minutes });

  it('starts, reports current, and 409s a second start', async () => {
    const res = await start();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ playerId: pid, minutes: 15, endedAt: null, logs: 0 });
    expect((await get(`/api/sprint?playerId=${pid}`)).json().sprint.id).toBe(res.json().id);
    const again = await start(5);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('sprint_running');
  });

  it('only allows 5, 15 or 25 minutes and a known player', async () => {
    expect((await start(10)).statusCode).toBe(400);
    expect((await post('/api/sprint/start', { playerId: 'nope', minutes: 5 })).statusCode).toBe(404);
  });

  it('quick-log gives +5 XP each, capped at 10', async () => {
    await start();
    for (let i = 0; i < 10; i++) {
      const r = await post('/api/sprint/log', { playerId: pid, note: `did thing ${i}` });
      expect(r.statusCode).toBe(200);
    }
    expect(xp()).toBe(50);
    const over = await post('/api/sprint/log', { playerId: pid, note: 'one more' });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe('log_limit');
    expect(xp()).toBe(50);
    expect((await post('/api/sprint/log', { playerId: pid, note: 'x'.repeat(81) })).statusCode).toBe(400);
    const kinds = new LedgerRepo(db).listForPlayer(pid).map((e) => e.kind);
    expect(kinds).toEqual(Array(10).fill('sprint'));
  });

  it('log after the planned end (before the tick) finishes the sprint and is 409 with kind copy', async () => {
    await start(5);
    clock.advance(5);
    const res = await post('/api/sprint/log', { playerId: pid, note: 'late note' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'sprint_over', message: copy.sprint.errors.sprint_over });
    expect(xp()).toBe(10);
    expect((await get(`/api/sprint?playerId=${pid}`)).json().sprint).toBeNull();
    expect(db.prepare('SELECT logs, xp, ended_at FROM sprints').get()).toMatchObject({ logs: 0, xp: 10, ended_at: '2026-11-24T10:05:00.000Z' });
  });

  it('log without a sprint is 404', async () => {
    expect((await post('/api/sprint/log', { playerId: pid, note: 'hi' })).statusCode).toBe(404);
  });

  it('finish early is prorated by whole minutes', async () => {
    await start(15);
    clock.advance(4.5);
    const res = (await post('/api/sprint/finish', { playerId: pid })).json();
    expect(res.xp).toBe(8);
    expect(res.sprint.endedAt).not.toBeNull();
    expect(xp()).toBe(8);
    expect((await get(`/api/sprint?playerId=${pid}`)).json().sprint).toBeNull();
    const entries = new LedgerRepo(db).listForPlayer(pid);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'sprint', xp: 8, questId: null });
    expect(entries[0]!.meta).toMatchObject({ sprint: true });
    expect((await post('/api/sprint/finish', { playerId: pid })).statusCode).toBe(404);
  });

  it('tick auto-finishes when time is up with full XP and keeps log XP', async () => {
    await start(5);
    await post('/api/sprint/log', { playerId: pid, note: 'a' });
    clock.advance(4);
    engine.tick();
    expect((await get(`/api/sprint?playerId=${pid}`)).json().sprint).not.toBeNull();
    clock.advance(30);
    engine.tick();
    engine.tick();
    expect((await get(`/api/sprint?playerId=${pid}`)).json().sprint).toBeNull();
    expect(xp()).toBe(5 + 10);
    const row = db.prepare('SELECT minutes, ended_at, xp, logs FROM sprints').get() as Record<string, unknown>;
    expect(row).toMatchObject({ xp: 10, logs: 1, ended_at: '2026-11-24T10:05:00.000Z' });
  });

  it('finishing long after the end still caps at the sprint length', async () => {
    await start(5);
    clock.advance(20);
    expect((await post('/api/sprint/finish', { playerId: pid })).json().xp).toBe(10);
    expect(xp()).toBe(10);
  });

  it('a whitespace-only note is rejected and pays nothing', async () => {
    await start();
    expect((await post('/api/sprint/log', { playerId: pid, note: '   ' })).statusCode).toBe(400);
    expect(xp()).toBe(0);
  });

  it('the database allows only one active sprint per player', () => {
    db.prepare("INSERT INTO sprints (id, player_id, minutes, started_at) VALUES ('a', ?, 5, 'x')").run(pid);
    expect(() => db.prepare("INSERT INTO sprints (id, player_id, minutes, started_at) VALUES ('b', ?, 5, 'x')").run(pid)).toThrow();
  });

  it('one broken sprint row does not stop the others from finishing', async () => {
    await start(5);
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("INSERT INTO sprints (id, player_id, minutes, started_at) VALUES ('bad', 'ghost', 5, '2026-11-24T09:00:00.000Z')").run();
    const logs: string[] = [];
    const svc = new SprintService({ db, players: new PlayersRepo(db), ledger: new LedgerRepo(db), bus: new Bus(), clock, tx: (fn) => transaction(db, fn), log: (m) => logs.push(m) });
    clock.advance(10);
    expect(() => svc.tick(clock.now())).not.toThrow();
    expect(svc.current(pid)).toBeNull();
    expect(logs.length).toBe(1);
  });

  it('survives an engine restart (state lives in the DB)', async () => {
    await start(25);
    clock.advance(10);
    await engine.app.close();
    engine = await createEngine({ db, clock, config, log: () => {}, logger: false });
    const cur = (await get(`/api/sprint?playerId=${pid}`)).json().sprint;
    expect(cur).toMatchObject({ minutes: 25, endedAt: null });
    clock.advance(20);
    engine.tick();
    expect(xp()).toBe(50);
  });

  it('is independent per player', async () => {
    const other = (await post('/api/players', { name: 'Ben' })).json().id;
    await start();
    expect((await post('/api/sprint/start', { playerId: other, minutes: 5 })).statusCode).toBe(201);
  });
});

describe('sprint XP reaches Home Assistant', () => {
  type Msg = { type: string; event?: string; data?: Record<string, unknown>; players?: { id: string; xp: number; level: number }[] };
  let sent: Msg[];
  let calls: { domain: string; service: string; data: Record<string, unknown> }[];
  beforeEach(async () => {
    sent = [];
    calls = [];
    vi.spyOn(engine.hub, 'send').mockImplementation(((m: Msg) => (sent.push(m), true)) as never);
    vi.spyOn(engine.hub, 'callService').mockImplementation(((domain: string, service: string, data: Record<string, unknown>) => (calls.push({ domain, service, data }), true)) as never);
    await engine.app.inject({ method: 'PATCH', url: '/api/settings', payload: { celebrationLights: ['light.hall'] } });
  });
  const snapshots = () => sent.filter((m) => m.type === 'snapshot');
  const levelUps = () => sent.filter((m) => m.type === 'fire_event' && m.event === 'cuest_level_up');
  const flashes = () => calls.filter((c) => c.domain === 'light').map((c) => c.data.flash);

  it('start, log and finish across a level publish snapshots, fire cuest_level_up and flash long', async () => {
    new PlayersRepo(db).addRewards(pid, 90, 0);
    await post('/api/sprint/start', { playerId: pid, minutes: 5 });
    sent.length = 0;
    const logged = (await post('/api/sprint/log', { playerId: pid, note: 'sink' })).json();
    expect(logged.levelUp).toBeNull();
    expect(snapshots().at(-1)!.players!.find((p) => p.id === pid)).toMatchObject({ xp: 95, level: 1 });
    expect(levelUps()).toHaveLength(0);
    clock.advance(5);
    const finished = (await post('/api/sprint/finish', { playerId: pid })).json();
    expect(finished).toMatchObject({ xp: 10, levelUp: { level: 2, title: 'Apprentice' } });
    expect(snapshots().at(-1)!.players!.find((p) => p.id === pid)).toMatchObject({ xp: 105, level: 2 });
    expect(levelUps()).toHaveLength(1);
    expect(levelUps()[0]!.data).toMatchObject({ player_id: pid, player_name: 'Ana', level: 2, title: 'Apprentice' });
    expect(flashes()).toEqual(['long']);
  });

  it('a quick-log that crosses a level fires the level-up and flashes long', async () => {
    new PlayersRepo(db).addRewards(pid, 98, 0);
    await post('/api/sprint/start', { playerId: pid, minutes: 5 });
    const logged = (await post('/api/sprint/log', { playerId: pid, note: 'sink' })).json();
    expect(logged.levelUp).toEqual({ level: 2, title: 'Apprentice' });
    expect(levelUps()).toHaveLength(1);
    expect(flashes()).toEqual(['long']);
  });

  it('the tick auto-finish publishes and flashes short without a level-up', async () => {
    await post('/api/sprint/start', { playerId: pid, minutes: 5 });
    sent.length = 0;
    clock.advance(6);
    engine.tick();
    expect(snapshots().at(-1)!.players!.find((p) => p.id === pid)).toMatchObject({ xp: 10 });
    expect(levelUps()).toHaveLength(0);
    expect(flashes()).toEqual(['short']);
  });
});

describe('current streak in summary and snapshot', () => {
  it('reports 0 once a gap cannot be covered, keeps best and does not change the stored row', async () => {
    const sent: { type: string; players?: { id: string; streak: number; bestStreak: number }[] }[] = [];
    vi.spyOn(engine.hub, 'send').mockImplementation(((m: (typeof sent)[number]) => (sent.push(m), true)) as never);
    const q = await mkQuest('Dishes', 'low');
    await post(`/api/quests/${q.id}/done`, { playerId: pid });
    const summary = async () => (await get(`/api/players/${pid}/summary`)).json();
    expect(await summary()).toMatchObject({ streak: 1, bestStreak: 1 });
    clock.advance(2 * 24 * 60); // Thu: Wed is covered by the free rest day
    expect((await summary()).streak).toBe(1);
    clock.advance(24 * 60); // Fri: Thu has no token left
    expect(await summary()).toMatchObject({ streak: 0, bestStreak: 1 });
    engine.tick(); // new day: quest-of-the-day pick publishes a snapshot
    const snap = sent.filter((m) => m.type === 'snapshot').at(-1)!;
    expect(snap.players!.find((p) => p.id === pid)).toMatchObject({ streak: 0, bestStreak: 1 });
    expect(new PlayersRepo(db).get(pid)).toMatchObject({ streak: 1, bestStreak: 1 });
  });
});
