import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { TemplatesRepo } from '../src/repos/templates.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { FakeClock } from '../src/clock.js';
import { Bus } from '../src/bus.js';
import { QuestService } from '../src/services/quests.js';
import { lastOccurrence, RecurringScheduler } from '../src/services/recurring.js';
import { DEFAULT_NUDGE, type Schedule } from '../src/domain/types.js';

const TZ = 'Europe/Berlin';
// Berlin is UTC+1 in November: local HH:MM = UTC (HH-1):MM
const berlin = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+01:00`);

let templates: TemplatesRepo;
let quests: QuestsRepo;
let scheduler: RecurringScheduler;
const mk = (schedule: Schedule, created: Date) =>
  templates.create(
    { title: 'Trash', energy: 'low', minutes: 10, xp: 30, gold: 10, source: 'manual', rule: null, schedule, nudge: DEFAULT_NUDGE, wheneverAfterHours: 12, enabled: true },
    created,
  );
const open = () => quests.listByStatus(['open', 'active', 'whenever']);

beforeEach(() => {
  const db = openDb(':memory:');
  migrate(db);
  const clock = new FakeClock(berlin('2026-11-23', '10:00'));
  const players = new PlayersRepo(db);
  quests = new QuestsRepo(db);
  templates = new TemplatesRepo(db);
  const service = new QuestService({ quests, players, ledger: new LedgerRepo(db), bus: new Bus(), clock });
  scheduler = new RecurringScheduler({ templates, quests: service, tz: TZ });
});

describe('recurring', () => {
  it('weekly trash day', () => {
    mk({ type: 'weekly', days: [2], time: '18:00' }, berlin('2026-11-23', '10:00'));
    scheduler.tick(berlin('2026-11-24', '17:59'));
    expect(open()).toHaveLength(0);
    scheduler.tick(berlin('2026-11-24', '18:00'));
    expect(open()).toHaveLength(1);
    scheduler.tick(berlin('2026-11-24', '19:00'));
    expect(open()).toHaveLength(1);
  });

  it('no backfill flood', () => {
    mk({ type: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' }, berlin('2026-11-02', '10:00'));
    scheduler.tick(berlin('2026-11-23', '10:00'));
    expect(open()).toHaveLength(1);
  });

  it('every_n_days', () => {
    const s: Schedule = { type: 'every_n_days', n: 3, time: '09:00', startDate: '2026-11-01' };
    expect(lastOccurrence(s, berlin('2026-11-24', '10:00'), TZ)).toEqual(berlin('2026-11-22', '09:00'));
  });

  it('created after today\'s time does not spawn today', () => {
    mk({ type: 'weekly', days: [2], time: '18:00' }, berlin('2026-11-24', '19:00'));
    scheduler.tick(berlin('2026-11-24', '19:01'));
    expect(open()).toHaveLength(0);
  });

  it('is DST-safe across the spring change', () => {
    // 2026-03-29 02:00 -> 03:00 in Berlin; Sunday 09:00 local is 07:00Z after the change
    const s: Schedule = { type: 'weekly', days: [0], time: '09:00' };
    expect(lastOccurrence(s, new Date('2026-03-29T08:00:00Z'), TZ)).toEqual(new Date('2026-03-29T07:00:00Z'));
  });
});
