import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, transaction } from '../src/db/db.js';
import { migrate, MIGRATIONS } from '../src/db/migrate.js';
import { PlayersRepo } from '../src/repos/players.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { UnlocksRepo } from '../src/repos/unlocks.js';
import { ItemsRepo } from '../src/repos/items.js';
import { ShopService, ShopError } from '../src/services/shop.js';
import { CATALOG, findItem } from '../src/shop/catalog.js';
import { FakeClock } from '../src/clock.js';
import { Bus } from '../src/bus.js';

const start = new Date('2026-11-24T10:00:00.000Z');

describe('shop', () => {
  let db: DatabaseSync;
  let players: PlayersRepo;
  let items: ItemsRepo;
  let ledger: LedgerRepo;
  let clock: FakeClock;
  let rngValues: number[];
  let bus: Bus;
  let events: string[];
  let shop: ShopService;
  let pid: string;

  const give = (gold: number) => players.addRewards(pid, 0, gold);
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      return e instanceof ShopError ? e.code : `other:${String(e)}`;
    }
    return undefined;
  };

  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    players = new PlayersRepo(db);
    items = new ItemsRepo(db);
    ledger = new LedgerRepo(db);
    clock = new FakeClock(start);
    rngValues = [];
    bus = new Bus();
    events = [];
    bus.on('shop:changed', (e) => events.push(e.playerId));
    shop = new ShopService({
      players,
      items,
      ledger,
      tx: (fn) => transaction(db, fn),
      clock,
      rng: () => rngValues.shift() ?? 0.99,
      bus,
      unlocks: new UnlocksRepo(db),
      hub: { isConnected: () => true, callServiceAwait: () => Promise.resolve({ ok: true }) },
    });
    pid = players.create({ name: 'Ada' }, start).id;
  });

  it('catalog has the exact entries', () => {
    expect(CATALOG.map((i) => [i.id, i.cost])).toEqual([
      ['hood_ember', 40],
      ['hood_night', 70],
      ['scarf_teal', 25],
      ['broom_gold', 80],
      ['lantern', 30],
      ['flowers', 20],
      ['cat', 60],
      ['fountain', 90],
      ['rest_token', 50],
      ['mystery_chest', 40],
      ['xp_potion', 70],
    ]);
    expect(findItem('hood_ember')?.palette).toEqual({ G: '#B5523B', L: '#D47A5E', g: '#8E3E2C' });
    expect(findItem('nope')).toBeNull();
  });

  it('migration 2 upgrades a v1 database in place', () => {
    const old = openDb(':memory:');
    old.exec(MIGRATIONS[0] as string);
    old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
    old.exec(
      `INSERT INTO schema_version VALUES (1);
       INSERT INTO players (id, name, xp, gold, created_at) VALUES ('p1', 'Old', 12, 34, 'x');`,
    );
    migrate(old);
    const p = new PlayersRepo(old).get('p1');
    expect(p).toMatchObject({ xp: 12, gold: 34, restTokens: 0, boostUntil: null });
    expect(new ItemsRepo(old).owned('p1')).toEqual({});
    const v = old.prepare('SELECT version FROM schema_version').all();
    expect(v).toEqual([{ version: 5 }]);
  });

  it('buys a wardrobe item', () => {
    give(100);
    const r = shop.buy(pid, 'hood_ember');
    expect(r.player.gold).toBe(60);
    expect(r.result).toEqual({ kind: 'item', itemId: 'hood_ember' });
    expect(items.owned(pid)).toEqual({ hood_ember: 1 });
    const l = ledger.listForPlayer(pid);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ kind: 'purchase', gold: -40, xp: 0, meta: { itemId: 'hood_ember' } });
    expect(events).toEqual([pid]);
  });

  it('rejects a second purchase of a single-ownership item', () => {
    give(100);
    shop.buy(pid, 'hood_ember');
    expect(code(() => shop.buy(pid, 'hood_ember'))).toBe('already_owned');
    expect(players.get(pid)?.gold).toBe(60);
  });

  it('rejects buying without enough gold and grants nothing', () => {
    give(10);
    expect(code(() => shop.buy(pid, 'hood_ember'))).toBe('not_enough_gold');
    expect(players.get(pid)?.gold).toBe(10);
    expect(items.owned(pid)).toEqual({});
    expect(ledger.listForPlayer(pid)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('unknown items and treats are unknown_item, unknown players unknown_player', () => {
    give(500);
    expect(code(() => shop.buy(pid, 'nope'))).toBe('unknown_item');
    expect(code(() => shop.buy(pid, 'treat:abc'))).toBe('unknown_item');
    expect(code(() => shop.buy('ghost', 'cat'))).toBe('unknown_player');
  });

  it('rest tokens stack', () => {
    give(100);
    shop.buy(pid, 'rest_token');
    const r = shop.buy(pid, 'rest_token');
    expect(r.result).toEqual({ kind: 'rest_token' });
    expect(r.player.restTokens).toBe(2);
    expect(r.player.gold).toBe(0);
  });

  it('xp potions extend the boost by 60 minutes each', () => {
    give(210);
    const a = shop.buy(pid, 'xp_potion');
    expect(a.result).toEqual({ kind: 'potion', boostUntil: '2026-11-24T11:00:00.000Z' });
    const b = shop.buy(pid, 'xp_potion');
    expect(b.result).toEqual({ kind: 'potion', boostUntil: '2026-11-24T12:00:00.000Z' });
    expect(b.player.boostUntil).toBe('2026-11-24T12:00:00.000Z');
    clock.advance(300);
    const c = shop.buy(pid, 'xp_potion');
    expect(c.result).toEqual({ kind: 'potion', boostUntil: '2026-11-24T16:00:00.000Z' });
  });

  it('chest below 0.5 grants an unowned wardrobe item', () => {
    give(100);
    rngValues = [0.2, 0.0];
    const r = shop.buy(pid, 'mystery_chest');
    expect(r.result).toEqual({ kind: 'chest', itemId: 'hood_ember' });
    expect(items.owned(pid)).toEqual({ hood_ember: 1 });
    expect(r.player.gold).toBe(60);
  });

  it('chest at 0.8 grants gold in 20-80', () => {
    give(100);
    rngValues = [0.8, 0.5];
    const r = shop.buy(pid, 'mystery_chest');
    expect(r.result).toEqual({ kind: 'chest', gold: 50 });
    expect(r.player.gold).toBe(110);
    rngValues = [0.8, 0.999999];
    expect(shop.buy(pid, 'mystery_chest').result).toEqual({ kind: 'chest', gold: 80 });
    rngValues = [0.8, 0];
    expect(shop.buy(pid, 'mystery_chest').result).toEqual({ kind: 'chest', gold: 20 });
  });

  it('chest gold writes a second ledger row so the ledger reconciles', () => {
    give(100);
    rngValues = [0.8, 0.5];
    const r = shop.buy(pid, 'mystery_chest');
    const rows = ledger.listForPlayer(pid).filter((e) => e.meta.itemId === 'mystery_chest');
    expect(rows.map((e) => [e.kind, e.gold, e.xp]).sort((a, b) => (a[1] as number) - (b[1] as number))).toEqual([['purchase', -40, 0], ['purchase', 50, 0]]);
    expect(rows.find((e) => e.gold > 0)!.meta).toEqual({ itemId: 'mystery_chest', chestReward: true });
    expect(rows.reduce((s, e) => s + e.gold, 0)).toBe(r.player.gold - 100);
  });

  it('chest gives gold when all wardrobe is owned', () => {
    give(1000);
    for (const id of ['hood_ember', 'hood_night', 'scarf_teal', 'broom_gold']) shop.buy(pid, id);
    rngValues = [0.1, 0.0];
    const r = shop.buy(pid, 'mystery_chest');
    expect(r.result.kind).toBe('chest');
    expect(r.result).toMatchObject({ gold: 20 });
  });

  it('equips owned items only, and null unequips', () => {
    give(100);
    expect(code(() => shop.equip(pid, 'hood', 'hood_ember'))).toBe('not_owned');
    shop.buy(pid, 'hood_ember');
    shop.equip(pid, 'hood', 'hood_ember');
    expect(items.equipped(pid)).toEqual({ hood: 'hood_ember' });
    expect(code(() => shop.equip(pid, 'scarf', 'hood_ember'))).toBe('not_owned');
    shop.equip(pid, 'hood', null);
    expect(items.equipped(pid)).toEqual({});
    expect(events.length).toBe(3);
  });

  it('view lists the catalog with ownership', () => {
    give(100);
    shop.buy(pid, 'cat');
    shop.equip(pid, 'hood', null);
    const v = shop.view(pid);
    expect(v.gold).toBe(40);
    expect(v.owned).toEqual({ cat: 1 });
    expect(v.catalog.find((i) => i.id === 'cat')?.owned).toBe(true);
    expect(v.catalog.find((i) => i.id === 'lantern')?.owned).toBe(false);
  });

  it('spendGold never goes below zero', () => {
    give(5);
    expect(code(() => players.spendGold(pid, 6))).toBe('not_enough_gold');
    expect(players.spendGold(pid, 5).gold).toBe(0);
    expect(code(() => players.spendGold(pid, 1))).toBe('not_enough_gold');
  });
});
