import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';

let app: FastifyInstance;
let onTemplatesChanged: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
  onTemplatesChanged = vi.fn<() => void>();
  app = await buildApp(makeDeps({ onTemplatesChanged }));
});

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

describe('REST API', () => {
  it('create player then summary shows level 1 Apprentice', async () => {
    const created = await post('/api/players', { name: 'Ana' });
    expect(created.statusCode).toBe(201);
    const p = created.json();
    const res = await app.inject({ method: 'GET', url: `/api/players/${p.id}/summary` });
    expect(res.json()).toEqual({ player: p, level: 1, title: 'Apprentice', intoLevel: 0, toNext: 100, streak: 0, bestStreak: 0, restTokens: 0 });
    const patched = await app.inject({ method: 'PATCH', url: `/api/players/${p.id}`, payload: { haPerson: 'person.ana' } });
    expect(patched.json()).toMatchObject({ name: 'Ana', haPerson: 'person.ana' });
    expect((await app.inject({ method: 'PATCH', url: '/api/players/nope', payload: {} })).statusCode).toBe(404);
  });

  it('manual quest full flow', async () => {
    const p = (await post('/api/players', { name: 'Ana' })).json();
    const q = await post('/api/quests', { title: 'Tidy desk', energy: 'low', minutes: 5 });
    expect(q.statusCode).toBe(201);
    expect(q.json().xp).toBe(20);
    const id = q.json().id;
    expect((await post(`/api/quests/${id}/start`, { playerId: p.id })).json().status).toBe('active');
    const done = await post(`/api/quests/${id}/done`, { playerId: p.id });
    expect(done.statusCode).toBe(200);
    expect(done.json().player.xp).toBeGreaterThan(0);
    const list = (await app.inject({ method: 'GET', url: '/api/quests' })).json();
    expect(list.open).toEqual([]);
    expect(list.active).toEqual([]);
  });

  it('second claim gets friendly 409', async () => {
    const a = (await post('/api/players', { name: 'A' })).json();
    const b = (await post('/api/players', { name: 'B' })).json();
    const id = (await post('/api/quests', { title: 'Dishes', energy: 'low', minutes: 5 })).json().id;
    await post(`/api/quests/${id}/start`, { playerId: a.id });
    const res = await post(`/api/quests/${id}/start`, { playerId: b.id });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'already_claimed',
      message: 'Someone else is already on this one. Thanks for checking!',
    });
    await post(`/api/quests/${id}/done`, { playerId: a.id });
    const again = await post(`/api/quests/${id}/done`, { playerId: a.id });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_done', message: 'This quest is already done. Nice!' });
  });

  it('maps not_found and unknown_player to 404', async () => {
    expect((await post('/api/quests/nope/start', { playerId: 'x' })).statusCode).toBe(404);
    const id = (await post('/api/quests', { title: 'T', energy: 'low', minutes: 5 })).json().id;
    expect((await post(`/api/quests/${id}/start`, { playerId: 'ghost' })).statusCode).toBe(404);
    expect((await post(`/api/quests/${id}/later`, { minutes: 30 })).statusCode).toBe(200);
  });

  it('later is capped at 7 days', async () => {
    const id = (await post('/api/quests', { title: 'T', energy: 'low', minutes: 5 })).json().id;
    expect((await post(`/api/quests/${id}/later`, { minutes: 10080 })).statusCode).toBe(200);
    expect((await post(`/api/quests/${id}/later`, { minutes: 10081 })).statusCode).toBe(400);
  });

  it('notifyService strips a notify. prefix and validates the format', async () => {
    const a = await post('/api/players', { name: 'Ana', notifyService: 'notify.mobile_app_ana' });
    expect(a.statusCode).toBe(201);
    expect(a.json().notifyService).toBe('mobile_app_ana');
    const p = a.json();
    const patched = await app.inject({ method: 'PATCH', url: `/api/players/${p.id}`, payload: { notifyService: 'notify.mobile_app_b' } });
    expect(patched.json().notifyService).toBe('mobile_app_b');
    expect((await post('/api/players', { name: 'B', notifyService: 'mobile_app_x' })).json().notifyService).toBe('mobile_app_x');
    expect((await post('/api/players', { name: 'C', notifyService: null })).statusCode).toBe(201);
    for (const bad of ['Mobile App', 'notify.', 'a.b', 'x y', '']) {
      expect((await post('/api/players', { name: 'D', notifyService: bad })).statusCode).toBe(400);
    }
  });

  it('invalid body gives 400', async () => {
    const res = await post('/api/quests', { title: 'x', energy: 'extreme', minutes: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid');
    expect(res.json().issues).toBeDefined();
    expect((await post('/api/quests', { title: 'x', energy: 'low', minutes: -1 })).statusCode).toBe(400);
  });

  it('preset endpoint creates washer template and triggers onTemplatesChanged', async () => {
    const res = await post('/api/templates/presets', { preset: 'washer_power', entityId: 'sensor.washer_power' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].title).toBe('Hang up the laundry');
    expect(onTemplatesChanged).toHaveBeenCalledTimes(1);
  });

  it('template create defaults nudge, patch ignores undefined, validates times', async () => {
    const body = { title: 'Water plants', energy: 'low', minutes: 5, xp: 20, gold: 7, source: 'recurring',
      rule: null, schedule: { type: 'weekly', days: [1], time: '09:00' }, wheneverAfterHours: 12, enabled: true };
    const res = await post('/api/templates', body);
    expect(res.statusCode).toBe(201);
    expect(res.json().nudge.repeatEveryMinutes).toBe(60);
    expect(onTemplatesChanged).toHaveBeenCalledTimes(1);
    const bad = await post('/api/templates', { ...body, schedule: { type: 'weekly', days: [1], time: '25:00' } });
    expect(bad.statusCode).toBe(400);
    const patched = await app.inject({ method: 'PATCH', url: `/api/templates/${res.json().id}`, payload: { title: 'Water', xp: undefined } });
    expect(patched.json()).toMatchObject({ title: 'Water', xp: 20 });
    expect(onTemplatesChanged).toHaveBeenCalledTimes(2);
    expect((await app.inject({ method: 'PATCH', url: '/api/templates/nope', payload: {} })).statusCode).toBe(404);
  });

  it('DELETE disables, never removes', async () => {
    const t = (await post('/api/templates/presets', { preset: 'vacuum_bin_sensor', entityId: 'binary_sensor.bin' })).json()[0];
    const del = await app.inject({ method: 'DELETE', url: `/api/templates/${t.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().enabled).toBe(false);
    const list = (await app.inject({ method: 'GET', url: '/api/templates' })).json();
    expect(list).toHaveLength(1);
    expect(list[0].enabled).toBe(false);
    expect(onTemplatesChanged).toHaveBeenCalledTimes(2);
  });
});

describe('daily REST fields', () => {
  it('GET /api/quests carries questOfDay', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/quests' });
    expect(empty.json()).toMatchObject({ questOfDay: null, open: [] });
  });
});
