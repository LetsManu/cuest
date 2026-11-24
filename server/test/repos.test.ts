import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db/db.js';
import { migrate, MIGRATIONS } from '../src/db/migrate.js';
import { PlayersRepo } from '../src/repos/players.js';
import { TemplatesRepo } from '../src/repos/templates.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { DEFAULT_NUDGE, type Quest } from '../src/domain/types.js';
import { newId } from '../src/clock.js';

const now = new Date('2026-11-24T10:00:00.000Z');

function makeQuest(over: Partial<Quest> = {}): Quest {
  return {
    id: newId(),
    templateId: null,
    title: 'Dishes',
    energy: 'low',
    minutes: 10,
    xp: 5,
    gold: 2,
    status: 'open',
    createdAt: now.toISOString(),
    wheneverAfterHours: 24,
    claimedBy: null,
    startedAt: null,
    doneAt: null,
    doneBy: null,
    wheneverAt: null,
    snoozedUntil: null,
    nudgeCount: 0,
    lastNudgeAt: null,
    ...over,
  };
}

describe('repos', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('migrate is idempotent', () => {
    migrate(db);
    migrate(db);
    const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
    expect(rows).toEqual([{ version: 9 }]);
  });

  it('players round-trip', () => {
    const players = new PlayersRepo(db);
    const p = players.create({ name: 'Ada' }, now);
    expect(players.get(p.id)).toEqual(p);
    expect(p.name).toBe('Ada');
    expect(p.xp).toBe(0);
    expect(p.gold).toBe(0);
    expect(players.list()).toHaveLength(1);
    expect(players.update(p.id, { haPerson: 'person.ada' })?.haPerson).toBe('person.ada');
  });

  it('addRewards refuses negatives', () => {
    const players = new PlayersRepo(db);
    const p = players.create({ name: 'Ada' }, now);
    expect(() => players.addRewards(p.id, -5, 0)).toThrow();
    expect(() => players.addRewards(p.id, 0, -1)).toThrow();
    const after = players.addRewards(p.id, 5, 3);
    expect(after.xp).toBe(5);
    expect(after.gold).toBe(3);
  });

  it('templates round-trip JSON fields', () => {
    const templates = new TemplatesRepo(db);
    const rule = {
      type: 'power_below' as const,
      entityId: 'sensor.washer_power',
      runningAboveW: 10,
      idleBelowW: 3,
      forMinutes: 3,
    };
    const t = templates.create(
      {
        title: 'Empty washer',
        energy: 'medium',
        minutes: 5,
        xp: 10,
        gold: 3,
        source: 'rule',
        rule,
        schedule: null,
        nudge: DEFAULT_NUDGE,
        wheneverAfterHours: 24,
        enabled: true,
      },
      now,
    );
    const got = templates.get(t.id);
    expect(got?.rule).toEqual(rule);
    expect(got?.nudge).toEqual(DEFAULT_NUDGE);
    expect(got?.enabled).toBe(true);
    expect(got?.lastSpawnedAt).toBe(now.toISOString());
    templates.update(t.id, { enabled: false });
    expect(templates.list({ enabledOnly: true })).toHaveLength(0);
    expect(templates.list()).toHaveLength(1);
  });

  it('findLiveByTemplate ignores done quests', () => {
    const quests = new QuestsRepo(db);
    const templates = new TemplatesRepo(db);
    const t = templates.create(
      {
        title: 'x', energy: 'low', minutes: 1, xp: 1, gold: 1, source: 'manual',
        rule: null, schedule: null, nudge: DEFAULT_NUDGE, wheneverAfterHours: 1, enabled: true,
      },
      now,
    );
    const q = makeQuest({ templateId: t.id });
    quests.insert(q);
    expect(quests.findLiveByTemplate(t.id)?.id).toBe(q.id);
    const updated = quests.update(q.id, { status: 'done', doneAt: now.toISOString() });
    expect(updated.status).toBe('done');
    expect(quests.findLiveByTemplate(t.id)).toBeNull();
    expect(() => quests.update('nope', { title: 'x' })).toThrow();
  });

  it('migration 9 upgrades a v8 database: existing quests get no source', () => {
    const old = openDb(':memory:');
    old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
    for (const m of MIGRATIONS.slice(0, 8)) old.exec(m);
    old.exec(`INSERT INTO schema_version VALUES (8);
      INSERT INTO quests (id, title, energy, minutes, xp, gold, status, created_at, whenever_after_hours)
      VALUES ('q1', 'Old', 'low', 5, 10, 3, 'open', '2026-11-24T10:00:00.000Z', 12);`);
    migrate(old);
    expect(new QuestsRepo(old).get('q1')).toMatchObject({ title: 'Old', source: null });
    expect(old.prepare('SELECT version FROM schema_version').all()).toEqual([{ version: 9 }]);
  });

  it('quest source round-trips (null by default, dice_suggestion when set)', () => {
    const quests = new QuestsRepo(db);
    const plain = makeQuest();
    const dice = makeQuest({ source: 'dice_suggestion' });
    quests.insert(plain);
    quests.insert(dice);
    expect(quests.get(plain.id)?.source).toBeNull();
    expect(quests.get(dice.id)?.source).toBe('dice_suggestion');
    expect(quests.update(dice.id, { status: 'active' }).source).toBe('dice_suggestion');
  });

  it('quests listByStatus oldest first; ledger round-trips', () => {
    const quests = new QuestsRepo(db);
    const players = new PlayersRepo(db);
    const ledger = new LedgerRepo(db);
    const a = makeQuest({ createdAt: '2026-11-24T09:00:00.000Z' });
    const b = makeQuest({ createdAt: '2026-11-24T08:00:00.000Z' });
    quests.insert(a);
    quests.insert(b);
    expect(quests.listByStatus(['open']).map((q) => q.id)).toEqual([b.id, a.id]);
    expect(quests.listByStatus([])).toEqual([]);
    const p = players.create({ name: 'Ada' }, now);
    const e = ledger.add({
      playerId: p.id, questId: a.id, kind: 'quest_done', xp: 5, gold: 2,
      at: now.toISOString(), meta: { foo: 1 },
    });
    expect(ledger.listForPlayer(p.id)).toEqual([e]);
  });
});
