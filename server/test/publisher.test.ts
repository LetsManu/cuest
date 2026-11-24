import { beforeEach, describe, expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { FakeClock } from '../src/clock.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { Publisher } from '../src/services/publisher.js';
import { QuestService } from '../src/services/quests.js';
import type { ServerMessage } from '../src/bridge/protocol.js';

let sent: ServerMessage[];
let authFns: Array<() => void>;
let quests: QuestService;
let players: PlayersRepo;
let publisher: Publisher;
let pid: string;

beforeEach(() => {
  const db = openDb(':memory:');
  migrate(db);
  const clock = new FakeClock(new Date('2026-01-01T10:00:00Z'));
  const bus = new Bus();
  players = new PlayersRepo(db);
  quests = new QuestService({ quests: new QuestsRepo(db), players, ledger: new LedgerRepo(db), bus, clock });
  sent = [];
  authFns = [];
  const hub = { send: (m: ServerMessage) => (sent.push(m), true), onAuthenticated: (fn: () => void) => void authFns.push(fn) };
  publisher = new Publisher({ bus, hub, players, quests, clock });
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
});
