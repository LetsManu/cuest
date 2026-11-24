import { beforeEach, describe, expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { FakeClock } from '../src/clock.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { UnlocksRepo } from '../src/repos/unlocks.js';
import { ItemsRepo } from '../src/repos/items.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { ShopService } from '../src/services/shop.js';
import { transaction } from '../src/db/db.js';
import { Publisher } from '../src/services/publisher.js';
import { QuestService } from '../src/services/quests.js';
import type { ServerMessage } from '../src/bridge/protocol.js';

let sent: ServerMessage[];
let authFns: Array<() => void>;
let quests: QuestService;
let players: PlayersRepo;
let publisher: Publisher;
let pid: string;
let items: ItemsRepo;
let shop: ShopService;
let clock: FakeClock;

beforeEach(() => {
  const db = openDb(':memory:');
  migrate(db);
  clock = new FakeClock(new Date('2026-01-01T10:00:00Z'));
  const bus = new Bus();
  players = new PlayersRepo(db);
  items = new ItemsRepo(db);
  quests = new QuestService({ quests: new QuestsRepo(db), players, ledger: new LedgerRepo(db), bus, clock });
  sent = [];
  authFns = [];
  const hub = { send: (m: ServerMessage) => (sent.push(m), true), onAuthenticated: (fn: () => void) => void authFns.push(fn) };
  publisher = new Publisher({ bus, hub, players, quests, items, clock });
  shop = new ShopService({ players, items, ledger: new LedgerRepo(db), tx: (fn) => transaction(db, fn), clock, bus, unlocks: new UnlocksRepo(db), hub: { isConnected: () => true, callService: () => true } });
  pid = players.create({ name: 'Ana', haPerson: 'person.ana' }, clock.now()).id;
});

const open = (title: string, xp: number) => quests.open({ title, energy: 'low', minutes: 5, xp }).quest;
const events = (name: string) => sent.filter((m) => m.type === 'fire_event' && m.event === name);
const lastSnapshot = () => [...sent].reverse().find((m) => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }>;

describe('Publisher', () => {
  it('fires cuest_quest_opened and a snapshot', () => {
    const q = open('Dishes', 20);
    expect(events('cuest_quest_opened')[0]).toMatchObject({ data: { quest_id: q.id, title: 'Dishes', xp: 20, minutes: 5 } });
    expect(lastSnapshot().quests.map((x) => x.id)).toEqual([q.id]);
  });

  it('snapshot has level/title after done and excludes done quests', () => {
    const q = open('Big', 120);
    quests.start(q.id, pid);
    quests.done(q.id, pid);
    const snap = lastSnapshot();
    expect(snap.quests).toEqual([]);
    expect(snap.players[0]).toMatchObject({ id: pid, level: 2, title: 'Apprentice', xp: 120, haPerson: 'person.ana' });
    expect(events('cuest_quest_done')[0]).toMatchObject({
      data: { quest_id: q.id, title: 'Big', player_id: pid, player_name: 'Ana', xp: 120 },
    });
  });

  it('level_up fires exactly when crossing 100 XP', () => {
    const a = open('A', 60);
    quests.done(a.id, pid);
    expect(events('cuest_level_up')).toHaveLength(0);
    const b = open('B', 60);
    quests.done(b.id, pid);
    expect(events('cuest_level_up')).toHaveLength(1);
    expect(events('cuest_level_up')[0]).toMatchObject({ data: { player_id: pid, player_name: 'Ana', level: 2, title: 'Apprentice' } });
    const c = open('C', 10);
    quests.done(c.id, pid);
    expect(events('cuest_level_up')).toHaveLength(1);
  });

  it('snapshot on authenticate', () => {
    sent.length = 0;
    authFns.forEach((f) => f());
    expect(sent.map((m) => m.type)).toEqual(['snapshot']);
  });

  it('snapshot carries outfit palette, decor, tokens and boost', () => {
    players.addRewards(pid, 0, 500);
    for (const id of ['hood_ember', 'scarf_teal', 'broom_gold', 'cat', 'lantern', 'rest_token', 'xp_potion']) shop.buy(pid, id);
    shop.equip(pid, 'hood', 'hood_ember');
    shop.equip(pid, 'scarf', 'scarf_teal');
    const p = lastSnapshot().players[0]!;
    expect(p.outfit.items).toEqual({ hood: 'hood_ember', scarf: 'scarf_teal', broom: null });
    expect(p.outfit.palette).toEqual({ G: '#B5523B', L: '#D47A5E', g: '#8E3E2C', y: '#7CC4BF', Y: '#3E8E8A' });
    expect([...p.decor].sort()).toEqual(['cat', 'lantern']);
    expect(p.restTokens).toBe(1);
    expect(p.boostUntil).toBe('2026-01-01T11:00:00.000Z');
  });

  it('publishes a snapshot after purchase and equip', () => {
    players.addRewards(pid, 0, 100);
    sent.length = 0;
    shop.buy(pid, 'hood_ember');
    expect(sent.filter((m) => m.type === 'snapshot')).toHaveLength(1);
    shop.equip(pid, 'hood', 'hood_ember');
    expect(sent.filter((m) => m.type === 'snapshot')).toHaveLength(2);
  });

  it('done during boost doubles XP; after it ends is normal', () => {
    players.addRewards(pid, 0, 100);
    shop.buy(pid, 'xp_potion');
    const a = open('A', 10);
    expect(quests.done(a.id, pid).reward.xp).toBe(20);
    clock.advance(3601);
    const b = open('B', 10);
    expect(quests.done(b.id, pid).reward.xp).toBe(10);
  });
});
