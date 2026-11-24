import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { FakeClock } from '../src/clock.js';
import { copy } from '../src/copy.js';
import { openDb, transaction } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { ItemsRepo } from '../src/repos/items.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { UnlocksRepo } from '../src/repos/unlocks.js';
import { QuestService } from '../src/services/quests.js';
import { ShopError, ShopService } from '../src/services/shop.js';
import { CATALOG, findItem } from '../src/shop/catalog.js';
import { makeDeps } from './helpers.js';

const start = new Date('2026-11-24T10:00:00.000Z');
const LOOT_ONLY = ['hood_starry', 'broom_moss', 'owl'];

let db: ReturnType<typeof openDb>;
let players: PlayersRepo;
let items: ItemsRepo;
let ledger: LedgerRepo;
let clock: FakeClock;
let rngValues: number[];
let shop: ShopService;
let quests: QuestService;
let bus: Bus;
let qotd: boolean;
let pid: string;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  players = new PlayersRepo(db);
  items = new ItemsRepo(db);
  ledger = new LedgerRepo(db);
  clock = new FakeClock(start);
  rngValues = [];
  bus = new Bus();
  qotd = false;
  const tx = <T>(fn: () => T): T => transaction(db, fn);
  shop = new ShopService({
    players, items, ledger, tx, clock, bus,
    rng: () => rngValues.shift() ?? 0.99,
    unlocks: new UnlocksRepo(db),
    hub: { isConnected: () => true, callServiceAwait: () => Promise.resolve({ ok: true }) },
  });
  quests = new QuestService({
    quests: new QuestsRepo(db), players, ledger, bus, clock, tx,
    isQuestOfDay: () => qotd,
    onLoot: (p, guaranteed) => shop.rollLoot(p, guaranteed),
  });
  pid = players.create({ name: 'Ada' }, start).id;
});

const doQuest = () => {
  clock.advance(60);
  const q = quests.open({ title: `q${Math.random()}`, energy: 'low', minutes: 5, xp: 10 }).quest;
  return quests.done(q.id, pid);
};
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof ShopError ? e.code : `other:${String(e)}`;
  }
  return undefined;
};

describe('loot-only catalog', () => {
  it('has the three loot-only items at cost 0', () => {
    for (const id of LOOT_ONLY) expect(findItem(id)).toMatchObject({ cost: 0, lootOnly: true });
    expect(findItem('hood_starry')).toMatchObject({ kind: 'wardrobe', slot: 'hood', name: 'Starry cloak', palette: { G: '#1F2A4A', L: '#F7D27A', g: '#141C33' } });
    expect(findItem('broom_moss')).toMatchObject({ kind: 'wardrobe', slot: 'broom', name: 'Mossy broom', palette: { T: '#5A4630', F: '#6FAE8C', f: '#3B6E57' } });
    expect(findItem('owl')).toMatchObject({ kind: 'decor', name: 'Sleepy owl' });
  });

  it('is not buyable and not in the shop view', () => {
    players.addRewards(pid, 0, 500);
    for (const id of LOOT_ONLY) expect(code(() => shop.buy(pid, id))).toBe('unknown_item');
    expect(players.get(pid)?.gold).toBe(500);
    const ids = shop.view(pid).catalog.map((i) => i.id);
    for (const id of LOOT_ONLY) expect(ids).not.toContain(id);
  });

  it('mystery chest never draws a loot-only item', () => {
    for (const i of CATALOG) if (i.kind === 'wardrobe' && !i.lootOnly) items.grant(pid, i.id);
    players.addRewards(pid, 0, 100);
    rngValues = [0.1, 0.1];
    const r = shop.buy(pid, 'mystery_chest');
    expect(r.result.kind).toBe('chest');
    expect('gold' in r.result).toBe(true);
  });
});

describe('rollLoot', () => {
  it('rng 0.2 drops, 0.3 does not', () => {
    rngValues = [0.2, 0];
    expect(shop.rollLoot(pid, false)).toBe('hood_ember');
    expect(items.owned(pid).hood_ember).toBe(1);
    rngValues = [0.3];
    expect(shop.rollLoot(pid, false)).toBeNull();
  });

  it('quest of the day is always a drop', () => {
    rngValues = [0.99, 0];
    expect(shop.rollLoot(pid, true)).not.toBeNull();
  });

  it('pool excludes owned items and cost above 60', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const p2 = players.create({ name: `x${k}` }, start).id;
      rngValues = [0, k / 40];
      seen.add(shop.rollLoot(p2, false) as string);
    }
    expect([...seen].sort()).toEqual(['broom_moss', 'cat', 'flowers', 'hood_ember', 'hood_starry', 'lantern', 'owl', 'scarf_teal']);
    items.grant(pid, 'owl');
    for (const id of seen) if (id !== 'cat') items.grant(pid, id);
    rngValues = [0, 0];
    expect(shop.rollLoot(pid, false)).toBe('cat');
  });

  it('all owned returns null', () => {
    for (const i of CATALOG) if ((i.kind === 'wardrobe' || i.kind === 'decor') && i.cost <= 60) items.grant(pid, i.id);
    rngValues = [0, 0];
    expect(shop.rollLoot(pid, true)).toBeNull();
  });
});

describe('done flow', () => {
  it('returns loot with name and grants it', () => {
    rngValues = [0.1, 0];
    const r = doQuest();
    expect(r.loot).toEqual({ itemId: 'hood_ember', name: 'Ember hood' });
    expect(items.owned(pid).hood_ember).toBe(1);
    rngValues = [0.9];
    expect(doQuest().loot).toBeNull();
  });

  it('quest of the day always drops', () => {
    qotd = true;
    expect(doQuest().loot).not.toBeNull();
  });

  it('every 5th done grants a chest key', () => {
    const flags: boolean[] = [];
    for (let i = 0; i < 10; i++) flags.push(doQuest().chestKey);
    expect(flags).toEqual([false, false, false, false, true, false, false, false, false, true]);
    const p = players.get(pid)!;
    expect(p.chestKeys).toBe(2);
    expect(p.doneCount).toBe(10);
  });

  it('quest:done payload carries loot and chestKey', () => {
    const got: unknown[] = [];
    bus.on('quest:done', (e) => got.push(e));
    doQuest();
    expect(got[0]).toMatchObject({ loot: null, chestKey: false });
  });
});

describe('open chest', () => {
  it('consumes a key and applies the chest at no cost', () => {
    db.prepare('UPDATE players SET chest_keys = 1 WHERE id = ?').run(pid);
    rngValues = [0.1, 0];
    const r = shop.openChest(pid);
    expect(r.result).toEqual({ kind: 'chest', itemId: 'hood_ember' });
    expect(r.player.chestKeys).toBe(0);
    expect(r.player.gold).toBe(0);
    expect(ledger.listForPlayer(pid)).toEqual([]);
  });

  it('chest gold writes only a positive ledger row', () => {
    db.prepare('UPDATE players SET chest_keys = 1 WHERE id = ?').run(pid);
    rngValues = [0.9, 0.5];
    const r = shop.openChest(pid);
    expect(r.result).toMatchObject({ kind: 'chest' });
    const rows = ledger.listForPlayer(pid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'purchase', meta: { itemId: 'mystery_chest', chestKey: true } });
    expect(rows[0]!.gold).toBeGreaterThan(0);
    expect(players.get(pid)?.gold).toBe(rows[0]!.gold);
  });

  it('without a key is no_chest_key and nothing changes', () => {
    expect(code(() => shop.openChest(pid))).toBe('no_chest_key');
    expect(players.get(pid)?.chestKeys).toBe(0);
    expect(code(() => shop.openChest('nope'))).toBe('unknown_player');
  });
});

describe('api', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp(makeDeps({ players, shop, quests }));
  });

  it('POST /api/shop/open-chest 409 without a key, ok with one', async () => {
    const no = await app.inject({ method: 'POST', url: '/api/shop/open-chest', payload: { playerId: pid } });
    expect(no.statusCode).toBe(409);
    expect(no.json()).toEqual({ error: 'no_chest_key', message: 'No chest key yet. Every 5 quests brings one!' });
    expect(copy.shop.errors.no_chest_key).toBe('No chest key yet. Every 5 quests brings one!');
    db.prepare('UPDATE players SET chest_keys = 1 WHERE id = ?').run(pid);
    rngValues = [0.1, 0];
    const ok = await app.inject({ method: 'POST', url: '/api/shop/open-chest', payload: { playerId: pid } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result).toEqual({ kind: 'chest', itemId: 'hood_ember' });
  });

  it('shop view and summary carry chestKeys', async () => {
    db.prepare('UPDATE players SET chest_keys = 2 WHERE id = ?').run(pid);
    expect((await app.inject({ url: `/api/shop?playerId=${pid}` })).json().chestKeys).toBe(2);
    expect((await app.inject({ url: `/api/players/${pid}/summary` })).json().chestKeys).toBe(2);
  });

  it('GET /api/collection lists wardrobe and decor incl. loot-only', async () => {
    items.grant(pid, 'owl');
    const res = await app.inject({ url: `/api/collection?playerId=${pid}` });
    expect(res.statusCode).toBe(200);
    const list = res.json().items as { id: string; kind: string; name: string; owned: boolean; lootOnly: boolean }[];
    expect(list.map((i) => i.id)).toEqual([
      'hood_ember', 'hood_night', 'scarf_teal', 'broom_gold', 'hood_starry', 'broom_moss',
      'lantern', 'flowers', 'cat', 'fountain', 'owl',
    ].sort((a, b) => CATALOG.findIndex((i) => i.id === a) - CATALOG.findIndex((i) => i.id === b)));
    expect(list.find((i) => i.id === 'owl')).toEqual({ id: 'owl', kind: 'decor', name: 'Sleepy owl', owned: true, lootOnly: true });
    expect(list.find((i) => i.id === 'hood_starry')).toMatchObject({ slot: 'hood', palette: { G: '#1F2A4A', L: '#F7D27A', g: '#141C33' } });
    expect(list.find((i) => i.id === 'cat')).toMatchObject({ owned: false, lootOnly: false });
    expect(list.some((i) => i.kind === 'helper')).toBe(false);
    expect((await app.inject({ url: '/api/collection?playerId=zzz' })).statusCode).toBe(404);
  });
});
