import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { FakeClock } from '../src/clock.js';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { createEngine, type Engine } from '../src/engine.js';
import { copy } from '../src/copy.js';
import { Bus } from '../src/bus.js';
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
    expect(entries[0]).toMatchObject({ kind: 'quest_done', xp: 8, questId: null });
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
