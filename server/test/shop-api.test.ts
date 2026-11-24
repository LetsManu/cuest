import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { FakeClock } from '../src/clock.js';
import { openDb, transaction } from '../src/db/db.js';
import { migrate, MIGRATIONS } from '../src/db/migrate.js';
import { ItemsRepo } from '../src/repos/items.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { PlayersRepo } from '../src/repos/players.js';
import { UnlocksRepo } from '../src/repos/unlocks.js';
import { ShopService } from '../src/services/shop.js';
import { makeDeps } from './helpers.js';

const start = new Date('2026-11-24T10:00:00.000Z');

describe('shop api and treats', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  let players: PlayersRepo;
  let ledger: LedgerRepo;
  let unlocks: UnlocksRepo;
  let pid: string;
  let connected: boolean;
  let callResult: boolean;
  let calls: unknown[][];
  let events: string[];

  beforeEach(async () => {
    db = openDb(':memory:');
    migrate(db);
    players = new PlayersRepo(db);
    ledger = new LedgerRepo(db);
    unlocks = new UnlocksRepo(db);
    connected = true;
    callResult = true;
    calls = [];
    events = [];
    const bus = new Bus();
    bus.on('shop:changed', (e) => events.push(e.playerId));
    const clock = new FakeClock(start);
    const hub = {
      isConnected: () => connected,
      callService: (...a: unknown[]) => (calls.push(a), callResult),
    };
    const shop = new ShopService({
      players,
      items: new ItemsRepo(db),
      ledger,
      unlocks,
      hub,
      tx: (fn) => transaction(db, fn),
      clock,
      bus,
    });
    app = await buildApp(makeDeps({ players, shop, unlocks, clock }));
    pid = players.create({ name: 'Ada' }, start).id;
    players.addRewards(pid, 0, 100);
  });

  const mkUnlock = (cost = 30, entityId = 'scene.movie_night') => unlocks.create({ name: 'Movie night', cost, entityId }, start);
  const buy = (itemId: string, playerId = pid) => app.inject({ method: 'POST', url: '/api/shop/buy', payload: { playerId, itemId } });

  it('migration 3 upgrades a v2 database in place', () => {
    const old = openDb(':memory:');
    old.exec(MIGRATIONS[0] as string);
    old.exec(MIGRATIONS[1] as string);
    old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
    old.exec(`INSERT INTO schema_version VALUES (2); INSERT INTO players (id, name, xp, gold, created_at) VALUES ('p1', 'Old', 1, 2, 'x');`);
    migrate(old);
    expect(new PlayersRepo(old).get('p1')?.gold).toBe(2);
    expect(new UnlocksRepo(old).list()).toEqual([]);
    expect(old.prepare('SELECT version FROM schema_version').all()).toEqual([{ version: 3 }]);
  });

  it('treat purchase calls turn_on on the entity and spends gold', async () => {
    const u = mkUnlock();
    const res = await buy(`treat:${u.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ player: { gold: 70 }, result: { kind: 'treat', itemId: `treat:${u.id}` } });
    expect(calls).toEqual([['scene', 'turn_on', {}, { entity_id: 'scene.movie_night' }]]);
    expect(events).toEqual([pid]);
    expect(ledger.listForPlayer(pid).map((r) => [r.kind, r.gold])).toContainEqual(['purchase', -30]);
  });

  it('treats are repeatable', async () => {
    const u = mkUnlock(10);
    expect((await buy(`treat:${u.id}`)).statusCode).toBe(200);
    expect((await buy(`treat:${u.id}`)).statusCode).toBe(200);
    expect(players.get(pid)?.gold).toBe(80);
  });

  it('bridge offline: 503, nothing spent, no call', async () => {
    const u = mkUnlock();
    connected = false;
    const res = await buy(`treat:${u.id}`);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'bridge_offline',
      message: "Home Assistant isn't connected right now, so this treat can't switch on. Your gold is safe.",
    });
    expect(players.get(pid)?.gold).toBe(100);
    expect(calls).toEqual([]);
    expect(ledger.listForPlayer(pid)).toEqual([]);
  });

  it('callService false after spend: refunded, 503, ledger nets to zero', async () => {
    const u = mkUnlock();
    callResult = false;
    const res = await buy(`treat:${u.id}`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('bridge_offline');
    expect(players.get(pid)?.gold).toBe(100);
    const rows = ledger.listForPlayer(pid);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.gold, 0)).toBe(0);
    expect(rows.find((r) => r.gold === 30)?.meta).toMatchObject({ itemId: `treat:${u.id}`, refund: true });
  });

  it('disabled or unknown treat is unknown_item and not in the catalog', async () => {
    const u = mkUnlock();
    let view = (await app.inject({ url: `/api/shop?playerId=${pid}` })).json();
    expect(view.catalog.find((i: { id: string }) => i.id === `treat:${u.id}`)).toMatchObject({
      kind: 'treat', name: 'Movie night', cost: 30, owned: false,
    });
    unlocks.update(u.id, { enabled: false });
    view = (await app.inject({ url: `/api/shop?playerId=${pid}` })).json();
    expect(view.catalog.some((i: { id: string }) => i.id.startsWith('treat:'))).toBe(false);
    const res = await buy(`treat:${u.id}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('unknown_item');
    expect((await buy('treat:nope')).statusCode).toBe(404);
  });

  it('shop view and buy/equip error codes with friendly copy', async () => {
    expect((await app.inject({ url: '/api/shop?playerId=nope' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/shop' })).statusCode).toBe(400);
    expect((await buy('hood_ember', 'nope')).json().error).toBe('unknown_player');
    const poor = players.create({ name: 'Poor' }, start).id;
    const r = await buy('hood_ember', poor);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'not_enough_gold', message: "Not quite enough gold yet. A few more quests and it's yours!" });
    expect((await buy('hood_ember')).statusCode).toBe(200);
    const again = await buy('hood_ember');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_owned', message: 'You already have this one.' });
    expect((await buy('bogus')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/shop/buy', payload: {} })).statusCode).toBe(400);

    const eq = await app.inject({ method: 'POST', url: '/api/shop/equip', payload: { playerId: pid, slot: 'hood', itemId: 'hood_ember' } });
    expect(eq.statusCode).toBe(200);
    expect(eq.json().id).toBe(pid);
    const bad = await app.inject({ method: 'POST', url: '/api/shop/equip', payload: { playerId: pid, slot: 'hood', itemId: 'hood_night' } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toEqual({ error: 'not_owned', message: 'Get this one in the shop first.' });
    const un = await app.inject({ method: 'POST', url: '/api/shop/equip', payload: { playerId: pid, slot: 'hood', itemId: null } });
    expect(un.statusCode).toBe(200);
    const view = (await app.inject({ url: `/api/shop?playerId=${pid}` })).json();
    expect(view.equipped).toEqual({});
  });

  it('unlocks CRUD with entity validation', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/unlocks', payload: { name: 'Door', cost: 5, entityId: 'lock.front_door' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/unlocks', payload: { name: 'Fan', cost: 5, entityId: 'switch.fan' } });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id;
    expect(ok.json()).toMatchObject({ name: 'Fan', cost: 5, entityId: 'switch.fan', enabled: true });
    const patched = await app.inject({ method: 'PATCH', url: `/api/unlocks/${id}`, payload: { cost: 8 } });
    expect(patched.json()).toMatchObject({ cost: 8, name: 'Fan' });
    expect((await app.inject({ method: 'PATCH', url: `/api/unlocks/${id}`, payload: { entityId: 'light.x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/unlocks/zzz', payload: { cost: 1 } })).statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/api/unlocks/${id}` });
    expect(del.json().enabled).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/unlocks/zzz' })).statusCode).toBe(404);
    const list = (await app.inject({ url: '/api/unlocks' })).json();
    expect(list).toHaveLength(1);
    expect(list[0].enabled).toBe(false);
  });
});
