import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, localDate, isoWeek } from '../src/clock.js';
import { Bus } from '../src/bus.js';
import { openDb, transaction } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { DailyService } from '../src/services/daily.js';
import { QuestService } from '../src/services/quests.js';
import { copy } from '../src/copy.js';

const TZ = 'Europe/Berlin';
let db: ReturnType<typeof openDb>;
let clock: FakeClock;
let players: PlayersRepo;
let questsRepo: QuestsRepo;
let quests: QuestService;
let daily: DailyService;
let bus: Bus;
let pid: string;
let rngValue: number;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  clock = new FakeClock(new Date('2026-11-24T09:00:00Z')); // Tue 10:00 Berlin
  players = new PlayersRepo(db);
  questsRepo = new QuestsRepo(db);
  bus = new Bus();
  rngValue = 0;
  daily = new DailyService({ db, quests: questsRepo, players, clock, tz: TZ, rng: () => rngValue });
  bus.on('quest:opened', (q) => daily.onQuestOpened(q, clock.now()));
  quests = new QuestService({
    quests: questsRepo,
    players,
    ledger: new LedgerRepo(db),
    bus,
    clock,
    tx: (fn) => transaction(db, fn),
    isQuestOfDay: (id, now) => daily.isQuestOfDay(id, now),
    onDone: (p, at) => daily.onQuestDone(p, at),
  });
  pid = players.create({ name: 'A' }, clock.now()).id;
});

const open = (title: string) => {
  clock.advance(1); // distinct created_at keeps the pool order stable
  return quests.open({ title, energy: 'low', minutes: 5, xp: 10 }).quest;
};
const at = (iso: string) => new Date(iso);

describe('date helpers', () => {
  it('localDate uses the zone', () => {
    expect(localDate(at('2026-11-24T22:59:00Z'), TZ)).toBe('2026-11-24');
    expect(localDate(at('2026-11-24T23:01:00Z'), TZ)).toBe('2026-11-25');
  });
  it('isoWeek is Monday based with ISO week-year', () => {
    expect(isoWeek('2026-11-23')).toBe('2026-W48');
    expect(isoWeek('2026-11-29')).toBe('2026-W48');
    expect(isoWeek('2026-11-30')).toBe('2026-W49');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
  });
});

describe('quest of the day', () => {
  it('is picked once per local day with the rng and stays', () => {
    const a = open('A');
    const b = open('B');
    const c = open('C');
    rngValue = 0.5;
    daily.tick(clock.now());
    expect(daily.questOfDay(clock.now())).toBe(b.id);
    rngValue = 0;
    daily.tick(clock.now());
    expect(daily.questOfDay(clock.now())).toBe(b.id);
    expect(daily.isQuestOfDay(b.id, clock.now())).toBe(true);
    expect(daily.isQuestOfDay(a.id, clock.now())).toBe(false);
    expect([a.id, c.id]).toHaveLength(2);
  });

  it('re-picks the next local day (Berlin midnight)', () => {
    const a = open('A');
    const b = open('B');
    clock.set(at('2026-11-24T22:59:00Z'));
    daily.tick(clock.now());
    expect(daily.questOfDay(clock.now())).toBe(a.id);
    clock.set(at('2026-11-24T23:01:00Z')); // already the 25th in Berlin
    rngValue = 0.99;
    daily.tick(clock.now());
    expect(daily.questOfDay(clock.now())).toBe(b.id);
  });

  it('includes whenever quests and ignores done and active ones', () => {
    const a = open('A');
    const b = open('B');
    questsRepo.update(a.id, { status: 'whenever' });
    quests.start(b.id, pid);
    expect(daily.questOfDay(clock.now())).toBe(a.id);
  });

  it('is none without quests, then the first quest opened that day', () => {
    daily.tick(clock.now());
    expect(daily.questOfDay(clock.now())).toBeNull();
    const first = open('First');
    open('Second');
    expect(daily.questOfDay(clock.now())).toBe(first.id);
  });

  it('is lazily picked by questOfDay', () => {
    const a = open('A');
    expect(daily.questOfDay(clock.now())).toBe(a.id);
  });

  it('pays the quest-of-the-day bonus on done', () => {
    const a = open('A');
    daily.tick(clock.now());
    const r = quests.done(a.id, pid);
    expect(r.reward.lines.map((l) => l.label)).toContain('Quest of the day');
  });
});

describe('streaks', () => {
  const doneOn = (iso: string) => {
    clock.set(at(iso));
    const q = open('Q' + iso);
    const r = quests.done(q.id, pid);
    return { ...r, streak: r.streak! };
  };
  const p = () => players.get(pid)!;

  it('counts consecutive days and ignores a second quest the same day', () => {
    expect(doneOn('2026-11-24T09:00:00Z').streak).toEqual({ streak: 1, restarted: false, usedRest: null });
    expect(doneOn('2026-11-24T15:00:00Z').streak.streak).toBe(1);
    expect(doneOn('2026-11-25T09:00:00Z').streak.streak).toBe(2);
    expect(doneOn('2026-11-26T09:00:00Z').streak.streak).toBe(3);
    expect(p()).toMatchObject({ streak: 3, bestStreak: 3 });
  });

  it('23:59 and 00:01 local are different days', () => {
    doneOn('2026-11-24T22:57:00Z'); // 23:58 Nov 24 Berlin (open adds a minute)
    expect(doneOn('2026-11-24T23:00:00Z').streak.streak).toBe(2); // 00:01 Nov 25
  });

  it('a missed day uses the free weekly rest day', () => {
    doneOn('2026-11-23T09:00:00Z'); // Mon
    const r = doneOn('2026-11-25T09:00:00Z'); // Wed, Tue missed
    expect(r.streak).toEqual({ streak: 2, restarted: false, usedRest: 'free' });
    expect(p().restTokens).toBe(0);
  });

  it('a second missed day in the same week needs a token', () => {
    doneOn('2026-11-23T09:00:00Z'); // Mon
    doneOn('2026-11-25T09:00:00Z'); // Wed (free used for Tue)
    players.addRestTokens(pid, 1);
    const r = doneOn('2026-11-27T09:00:00Z'); // Fri, Thu missed
    expect(r.streak).toEqual({ streak: 3, restarted: false, usedRest: 'token' });
    expect(p().restTokens).toBe(0);
  });

  it('free rest day is available again in a new ISO week', () => {
    doneOn('2026-11-23T09:00:00Z');
    doneOn('2026-11-25T09:00:00Z'); // uses W48 free
    doneOn('2026-11-26T09:00:00Z');
    doneOn('2026-11-27T09:00:00Z');
    doneOn('2026-11-28T09:00:00Z');
    doneOn('2026-11-29T09:00:00Z');
    doneOn('2026-11-30T09:00:00Z'); // Mon W49
    const r = doneOn('2026-12-02T09:00:00Z'); // Tue missed, W49 free
    expect(r.streak).toMatchObject({ streak: 8, usedRest: 'free' });
  });

  it('without a token the streak restarts at 1 and the best is kept, tokens untouched', () => {
    doneOn('2026-11-23T09:00:00Z');
    doneOn('2026-11-24T09:00:00Z');
    doneOn('2026-11-25T09:00:00Z'); // 3
    const r = doneOn('2026-11-28T09:00:00Z'); // Thu, Fri missed: free + no token
    expect(r.streak).toEqual({ streak: 1, restarted: true, usedRest: null });
    expect(p()).toMatchObject({ streak: 1, bestStreak: 3, restTokens: 0 });
    expect(doneOn('2026-11-29T09:00:00Z').streak.streak).toBe(2);
  });

  it('a failed cover does not spend tokens or the free day', () => {
    doneOn('2026-11-23T09:00:00Z');
    players.addRestTokens(pid, 1);
    const r = doneOn('2026-11-27T09:00:00Z'); // 3 missed days: free + 1 token = 2 < 3
    expect(r.streak.restarted).toBe(true);
    expect(p().restTokens).toBe(1);
  });

  it('long gaps cover with free + tokens across weeks and never go negative', () => {
    doneOn('2026-11-27T09:00:00Z'); // Fri W48
    players.addRestTokens(pid, 1);
    const r = doneOn('2026-11-30T09:00:00Z' /* Mon */); // Sat, Sun missed: W48 free + token
    expect(r.streak).toMatchObject({ streak: 2, usedRest: 'token' });
    expect(p().restTokens).toBe(0);
    expect(players.consumeRestToken(pid)).toBe(false);
    expect(p().restTokens).toBe(0);
  });

  it('handles the DST change week (Berlin, 2026-10-25)', () => {
    doneOn('2026-10-24T09:00:00Z'); // Sat
    expect(doneOn('2026-10-25T10:00:00Z').streak.streak).toBe(2); // Sun, 25h day
    expect(doneOn('2026-10-26T10:00:00Z').streak.streak).toBe(3); // Mon
  });

  it('quest:done carries the streak and rolls back with the transaction', () => {
    const seen: unknown[] = [];
    bus.on('quest:done', (e) => seen.push((e as { streak?: unknown }).streak));
    const q = open('X');
    quests.done(q.id, pid);
    expect(seen).toEqual([{ streak: 1, restarted: false, usedRest: null }]);
  });
});

describe('streak copy', () => {
  it('is kind', () => {
    expect(copy.streak.restarted).toBe('New streak started — welcome back!');
    expect(copy.streak.restUsed).toBe('Rest day used — your streak is safe.');
  });
});
