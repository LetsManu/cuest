import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { Bus } from '../src/bus.js';
import { FakeClock } from '../src/clock.js';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { createEngine, type Engine } from '../src/engine.js';
import { SettingsRepo } from '../src/repos/settings.js';
import { CelebrateService } from '../src/services/celebrate.js';
import type { Player, Quest } from '../src/domain/types.js';
import type { Reward } from '../src/domain/rewards.js';
import type { Sprint } from '../src/services/sprint.js';

type Call = { domain: string; service: string; data: Record<string, unknown>; target?: { entity_id: string | string[] } };

function setup(over: { throwing?: boolean } = {}) {
  const db = openDb(':memory:');
  migrate(db);
  const settings = new SettingsRepo(db);
  const bus = new Bus();
  const calls: Call[] = [];
  const logs: string[] = [];
  const hub = {
    callService: (domain: string, service: string, data: Record<string, unknown>, target?: { entity_id: string | string[] }) => {
      if (over.throwing) throw new Error('bridge exploded');
      calls.push({ domain, service, data, ...(target ? { target } : {}) });
      return true;
    },
  };
  new CelebrateService({ bus, hub, settings, log: (m) => logs.push(m) });
  return { bus, settings, calls, logs };
}

const player = (xp: number): Player => ({ id: 'p1', xp }) as unknown as Player;
const reward = (xp: number): Reward => ({ xp, gold: 0, lines: [] }) as unknown as Reward;
const done = (xp: number, gained: number) => ({ quest: { id: 'q1' } as Quest, reward: reward(gained), player: player(xp) });
const sprint = { id: 's1' } as Sprint;

describe('CelebrateService', () => {
  it('flashes the celebration lights short on quest done', () => {
    const { bus, settings, calls } = setup();
    settings.update({ celebrationLights: ['light.hall', 'light.desk'] });
    bus.emit('quest:done', done(30, 10));
    expect(calls).toEqual([{ domain: 'light', service: 'turn_on', data: { flash: 'short' }, target: { entity_id: ['light.hall', 'light.desk'] } }]);
  });

  it('flashes long on a level up (once)', () => {
    const { bus, settings, calls } = setup();
    settings.update({ celebrationLights: ['light.hall'] });
    bus.emit('quest:done', done(100, 10)); // 90 -> 100 crosses level 2
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data).toEqual({ flash: 'long' });
  });

  it('does nothing without lights', () => {
    const { bus, calls } = setup();
    bus.emit('quest:done', done(30, 10));
    bus.emit('sprint:finished', { playerId: 'p1', sprint, xp: 10, auto: false });
    expect(calls).toEqual([]);
  });

  it('turns on the sprint scene at sprint start, only the configured one', () => {
    const { bus, settings, calls } = setup();
    bus.emit('sprint:started', { playerId: 'p1', sprint });
    expect(calls).toEqual([]);
    settings.update({ sprintScene: 'scene.focus' });
    bus.emit('sprint:started', { playerId: 'p1', sprint });
    expect(calls).toEqual([{ domain: 'scene', service: 'turn_on', data: {}, target: { entity_id: 'scene.focus' } }]);
  });

  it('flashes at sprint end', () => {
    const { bus, settings, calls } = setup();
    settings.update({ celebrationLights: ['light.hall'] });
    bus.emit('sprint:finished', { playerId: 'p1', sprint, xp: 10, auto: true });
    expect(calls[0]).toMatchObject({ domain: 'light', data: { flash: 'short' } });
  });

  it('only logs when the bridge call fails', () => {
    const { bus, settings, logs } = setup({ throwing: true });
    settings.update({ celebrationLights: ['light.hall'], sprintScene: 'scene.focus' });
    expect(() => bus.emit('quest:done', done(30, 10))).not.toThrow();
    expect(() => bus.emit('sprint:started', { playerId: 'p1', sprint })).not.toThrow();
    expect(logs.length).toBe(2);
  });
});

describe('settings API + done never breaks', () => {
  const config: Config = { port: 0, dataDir: ':memory:', bridgeSecret: 'sekrit', tz: 'UTC', tickSeconds: 30 };
  let db: DatabaseSync;
  let engine: Engine;
  beforeEach(async () => {
    db = openDb(':memory:');
    migrate(db);
    engine = await createEngine({ db, clock: new FakeClock(new Date('2026-11-24T10:00:00Z')), config, log: () => {}, logger: false });
  });
  afterEach(async () => {
    await engine.app.close();
  });
  const patch = (payload: unknown) => engine.app.inject({ method: 'PATCH', url: '/api/settings', payload: payload as object });

  it('defaults, saves and clears', async () => {
    expect((await engine.app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({ celebrationLights: [], sprintScene: null });
    const res = await patch({ celebrationLights: ['light.hall'], sprintScene: 'scene.focus' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ celebrationLights: ['light.hall'], sprintScene: 'scene.focus' });
    expect((await patch({ sprintScene: null })).json()).toEqual({ celebrationLights: ['light.hall'], sprintScene: null });
  });

  it.each([
    { celebrationLights: ['switch.x'] },
    { celebrationLights: 'light.hall' },
    { celebrationLights: ['light.hall/../x'] },
    { sprintScene: 'script.x' },
    { sprintScene: ['scene.a'] },
    { extra: 1 },
  ])('rejects %j', async (body) => {
    expect((await patch(body)).statusCode).toBe(400);
  });

  it('quest done still works when celebration fails', async () => {
    await patch({ celebrationLights: ['light.hall'] });
    const pid = (await engine.app.inject({ method: 'POST', url: '/api/players', payload: { name: 'Ana' } })).json().id;
    const q = (await engine.app.inject({ method: 'POST', url: '/api/quests', payload: { title: 'T', energy: 'low', minutes: 5, xp: 10 } })).json();
    const res = await engine.app.inject({ method: 'POST', url: `/api/quests/${q.id}/done`, payload: { playerId: pid } });
    expect(res.statusCode).toBe(200);
  });
});
