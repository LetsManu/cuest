import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { TemplatesRepo } from '../src/repos/templates.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { FakeClock } from '../src/clock.js';
import { Bus } from '../src/bus.js';
import { QuestService } from '../src/services/quests.js';
import { transaction } from '../src/db/db.js';
import { computeReward } from '../src/domain/rewards.js';
import { DEFAULT_NUDGE, type Player } from '../src/domain/types.js';

let clock: FakeClock;
let db: ReturnType<typeof openDb>;
let service: QuestService;
let quests: QuestsRepo;
let players: PlayersRepo;
let ledger: LedgerRepo;
let bus: Bus;
let A: Player;
let B: Player;
let input: { templateId: string; title: string; energy: 'low'; minutes: number; xp: number };
let mkTemplate: () => string;

const baseInput = { templateId: 't1', title: 'Dishes', energy: 'low' as const, minutes: 10, xp: 30 };

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  clock = new FakeClock(new Date('2026-11-24T10:00:00.000Z'));
  players = new PlayersRepo(db);
  quests = new QuestsRepo(db);
  ledger = new LedgerRepo(db);
  bus = new Bus();
  service = new QuestService({ quests, players, ledger, bus, clock, tx: (fn) => transaction(db, fn) });
  A = players.create({ name: 'A' }, clock.now());
  B = players.create({ name: 'B' }, clock.now());
  const templates = new TemplatesRepo(db);
  mkTemplate = () =>
    templates.create(
      { title: 'Dishes', energy: 'low', minutes: 10, xp: 30, gold: 10, source: 'manual', rule: null, schedule: null, nudge: DEFAULT_NUDGE, wheneverAfterHours: 12, enabled: true },
      clock.now(),
    ).id;
  input = { ...baseInput, templateId: mkTemplate() };
});

describe('QuestService', () => {
  it('open creates once per template', () => {
    const first = service.open(input);
    const second = service.open(input);
    expect(first.created).toBe(true);
    expect(first.quest).toMatchObject({ status: 'open', gold: 10, wheneverAfterHours: 12, nudgeCount: 0, claimedBy: null });
    expect(second.created).toBe(false);
    expect(second.quest.id).toBe(first.quest.id);
    expect(quests.listByStatus(['open', 'active', 'whenever'])).toHaveLength(1);
  });

  it('whenever quest is revived by a new trigger', () => {
    const opened: string[] = [];
    bus.on('quest:opened', (q) => opened.push(q.id));
    const { quest } = service.open(input);
    clock.advance(13 * 60);
    service.sweep(clock.now());
    expect(quests.get(quest.id)?.status).toBe('whenever');
    expect(quests.get(quest.id)?.wheneverAt).not.toBeNull();
    const again = service.open(input);
    expect(again.created).toBe(false);
    expect(again.quest).toMatchObject({ id: quest.id, status: 'open', nudgeCount: 0, wheneverAt: null });
    expect(opened).toEqual([quest.id, quest.id]);
  });

  it('revived quest restarts its whenever clock', () => {
    const { quest } = service.open(input);
    clock.advance(13 * 60);
    service.sweep(clock.now());
    expect(quests.get(quest.id)?.status).toBe('whenever');
    service.open(input);
    service.sweep(clock.now());
    expect(quests.get(quest.id)?.status).toBe('open');
    clock.advance(13 * 60);
    service.sweep(clock.now());
    expect(quests.get(quest.id)?.status).toBe('whenever');
  });

  it('second player cannot steal an active quest', () => {
    const { quest } = service.open(input);
    const started = service.start(quest.id, A.id);
    expect(started).toMatchObject({ status: 'active', claimedBy: A.id });
    expect(service.start(quest.id, A.id)).toEqual(started);
    expect(() => service.start(quest.id, B.id)).toThrow(expect.objectContaining({ code: 'already_claimed' }));
    expect(() => service.done(quest.id, B.id)).toThrow(expect.objectContaining({ code: 'already_claimed' }));
  });

  it('done awards xp and gold and never twice', () => {
    const { quest } = service.open(input);
    const res = service.done(quest.id, A.id);
    expect(res.quest).toMatchObject({ status: 'done', doneBy: A.id });
    expect(res.reward).toMatchObject({ xp: 30, gold: 10 });
    expect(players.get(A.id)).toMatchObject({ xp: 30, gold: 10 });
    expect(ledger.listForPlayer(A.id)).toHaveLength(1);
    expect(() => service.done(quest.id, A.id)).toThrow(expect.objectContaining({ code: 'already_done' }));
    expect(() => service.start(quest.id, A.id)).toThrow(expect.objectContaining({ code: 'already_done' }));
    expect(players.get(A.id)).toMatchObject({ xp: 30, gold: 10 });
    expect(ledger.listForPlayer(A.id)).toHaveLength(1);
  });

  it('done straight from whenever pool works', () => {
    const { quest } = service.open(input);
    clock.advance(13 * 60);
    service.sweep(clock.now());
    const res = service.done(quest.id, B.id);
    expect(res.quest.status).toBe('done');
    expect(players.get(B.id)?.xp).toBe(30);
  });

  it('sweep moves a stuck active quest to whenever, releases the claim, and a trigger revives it', () => {
    const wheneverEvents: string[] = [];
    bus.on('quest:whenever', (q) => wheneverEvents.push(q.id));
    const { quest } = service.open(input);
    service.start(quest.id, A.id);
    clock.advance(11 * 60);
    service.sweep(clock.now());
    expect(quests.get(quest.id)?.status).toBe('active');
    clock.advance(2 * 60);
    service.sweep(clock.now());
    expect(quests.get(quest.id)).toMatchObject({ status: 'whenever', claimedBy: null, startedAt: null });
    expect(wheneverEvents).toEqual([quest.id]);
    const again = service.open(input);
    expect(again.quest).toMatchObject({ id: quest.id, status: 'open' });
    expect(service.start(quest.id, B.id).claimedBy).toBe(B.id);
  });

  it('done is atomic: a failing ledger write rolls everything back and a retry succeeds', () => {
    const { quest } = service.open(input);
    const done: string[] = [];
    bus.on('quest:done', (r) => done.push(r.quest.id));
    const add = ledger.add.bind(ledger);
    const spy = vi.spyOn(ledger, 'add').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => service.done(quest.id, A.id)).toThrow('disk full');
    expect(quests.get(quest.id)?.status).toBe('open');
    expect(players.get(A.id)).toMatchObject({ xp: 0, gold: 0 });
    expect(ledger.listForPlayer(A.id)).toHaveLength(0);
    expect(done).toEqual([]);
    spy.mockImplementation(add);
    const res = service.done(quest.id, A.id);
    expect(res.quest.status).toBe('done');
    expect(players.get(A.id)?.xp).toBe(30);
    expect(ledger.listForPlayer(A.id)).toHaveLength(1);
    expect(done).toEqual([quest.id]);
  });

  it('unknown player', () => {
    const { quest } = service.open(input);
    expect(() => service.start(quest.id, 'nope')).toThrow(expect.objectContaining({ code: 'unknown_player' }));
    expect(() => service.done(quest.id, 'nope')).toThrow(expect.objectContaining({ code: 'unknown_player' }));
  });

  it('not_found for unknown quest; later sets snoozedUntil', () => {
    expect(() => service.start('nope', A.id)).toThrow(expect.objectContaining({ code: 'not_found' }));
    const { quest } = service.open(input);
    const snoozed = service.later(quest.id);
    expect(snoozed.status).toBe('open');
    expect(snoozed.snoozedUntil).toBe('2026-11-24T11:00:00.000Z');
  });

  it('listVisible groups by status', () => {
    const a = service.open({ ...input, templateId: mkTemplate() }).quest;
    const b = service.open({ ...input, templateId: mkTemplate() }).quest;
    service.start(b.id, A.id);
    const v = service.listVisible();
    expect(v.open.map((q) => q.id)).toEqual([a.id]);
    expect(v.active.map((q) => q.id)).toEqual([b.id]);
    expect(v.whenever).toEqual([]);
  });
});

describe('Bus', () => {
  it('a throwing listener is logged and others still run', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    bus.on('quest:opened', () => {
      throw new Error('boom');
    });
    bus.on('quest:opened', (q) => seen.push(q.id));
    const { quest } = service.open(input);
    expect(seen).toEqual([quest.id]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('computeReward', () => {
  it('returns base line only', () => {
    const { quest } = service.open(input);
    expect(computeReward({ quest, startedAt: null, doneAt: clock.now() })).toEqual({
      xp: 30,
      gold: 10,
      lines: [{ label: 'Quest', xp: 30, gold: 10 }],
    });
  });
});
