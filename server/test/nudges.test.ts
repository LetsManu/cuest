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
import { NudgeService, decodeAction, encodeAction } from '../src/services/nudges.js';
import { copy } from '../src/copy.js';
import { DEFAULT_NUDGE, type NudgeConfig, type Player } from '../src/domain/types.js';

type Call = { domain: string; service: string; data: Record<string, unknown>; target?: { entity_id: string | string[] } };

let calls: Call[];
let clock: FakeClock;
let quests: QuestService;
let questsRepo: QuestsRepo;
let templates: TemplatesRepo;
let players: PlayersRepo;
let nudges: NudgeService;
let A: Player;

const light = { entityId: 'light.hall', rgb: [255, 160, 0] as [number, number, number] };

function setup(start: string) {
  const db = openDb(':memory:');
  migrate(db);
  clock = new FakeClock(new Date(start));
  players = new PlayersRepo(db);
  questsRepo = new QuestsRepo(db);
  templates = new TemplatesRepo(db);
  const bus = new Bus();
  quests = new QuestService({ quests: questsRepo, players, ledger: new LedgerRepo(db), bus, clock });
  A = players.create({ name: 'A', notifyService: 'mobile_app_iphone' }, clock.now());
  calls = [];
  const hub = {
    callService: (domain: string, service: string, data: Record<string, unknown>, target?: { entity_id: string | string[] }) => {
      calls.push({ domain, service, data, target });
      return true;
    },
  };
  nudges = new NudgeService({ bus, hub, quests, questsRepo, templates, players, clock, tz: 'Europe/Berlin' });
}

function mkQuest(title: string, nudge: Partial<NudgeConfig> = {}) {
  const t = templates.create(
    { title, energy: 'low', minutes: 10, xp: 30, gold: 10, source: 'manual', rule: null, schedule: null, nudge: { ...DEFAULT_NUDGE, ...nudge }, wheneverAfterHours: 12, enabled: true },
    clock.now(),
  );
  return quests.open({ templateId: t.id, title, energy: 'low', minutes: 10, xp: 30 }).quest;
}

const notifies = () => calls.filter((c) => c.domain === 'notify' && c.data.message !== 'clear_notification');

beforeEach(() => setup('2026-11-24T10:00:00.000Z')); // 11:00 Berlin

describe('NudgeService', () => {
  it('new quest sends actionable notification', () => {
    const q = mkQuest('Dishes');
    expect(notifies()).toHaveLength(1);
    const c = notifies()[0]!;
    expect(c.service).toBe('mobile_app_iphone');
    expect(c.data.title).toBe(`New quest: Dishes`);
    const data = c.data.data as { tag: string; url: string; actions: { action: string; title: string }[] };
    expect(data.tag).toBe(`cuest-${q.id}`);
    expect(data.url).toBe('/cuest');
    expect(data.actions.map((a) => a.title)).toEqual(['Start 2 min', 'Already done', 'Later']);
    expect(data.actions.map((a) => decodeAction(a.action))).toEqual([
      { verb: 'START', questId: q.id, playerId: A.id },
      { verb: 'DONE', questId: q.id, playerId: A.id },
      { verb: 'LATER', questId: q.id, playerId: A.id },
    ]);
    expect(questsRepo.get(q.id)).toMatchObject({ nudgeCount: 1, lastNudgeAt: clock.now().toISOString() });
  });

  it('manual quests without template do not notify', () => {
    quests.open({ title: 'Manual', energy: 'low', minutes: 5, xp: 10 });
    expect(calls).toHaveLength(0);
  });

  it('light glows while quest waits and turns off when done', () => {
    const q = mkQuest('Dishes', { light });
    expect(calls.find((c) => c.domain === 'light')).toMatchObject({ service: 'turn_on', data: { rgb_color: [255, 160, 0] }, target: { entity_id: 'light.hall' } });
    quests.done(q.id, A.id);
    expect(calls.find((c) => c.service === 'turn_off')).toMatchObject({ domain: 'light', target: { entity_id: 'light.hall' } });
    expect(calls.some((c) => c.data.message === 'clear_notification' && (c.data.data as { tag: string }).tag === `cuest-${q.id}`)).toBe(true);
  });

  it('light stays on while another quest uses it', () => {
    const q1 = mkQuest('Dishes', { light });
    mkQuest('Laundry', { light });
    quests.done(q1.id, A.id);
    expect(calls.filter((c) => c.service === 'turn_off')).toHaveLength(0);
  });

  it('gentle repeats stop after maxRepeats', () => {
    const q = mkQuest('Dishes');
    calls.length = 0;
    clock.advance(60);
    nudges.tick(clock.now());
    clock.advance(60);
    nudges.tick(clock.now());
    clock.advance(60);
    nudges.tick(clock.now());
    const msgs = notifies().map((c) => c.data.message);
    expect(msgs).toEqual([copy.repeatMessage(q, 1), copy.repeatMessage(q, 2)]);
    expect((notifies()[0]!.data.data as { tag: string }).tag).toBe(`cuest-${q.id}`);
  });

  it('quiet hours hold the first nudge until morning', () => {
    setup('2026-11-24T22:30:00.000Z'); // 23:30 Berlin
    const q = mkQuest('Dishes');
    expect(notifies()).toHaveLength(0);
    nudges.tick(new Date('2026-11-25T06:59:00.000Z')); // 07:59
    expect(notifies()).toHaveLength(0);
    nudges.tick(new Date('2026-11-25T07:00:00.000Z')); // 08:00
    expect(notifies()).toHaveLength(1);
    expect(questsRepo.get(q.id)!.nudgeCount).toBe(1);
  });

  it('LATER snoozes repeats for 60 minutes', () => {
    const q = mkQuest('Dishes', { repeatEveryMinutes: 30 });
    calls.length = 0;
    nudges.handleAction(encodeAction('LATER', q.id, A.id));
    clock.advance(30);
    nudges.tick(clock.now());
    expect(notifies()).toHaveLength(0);
    clock.advance(31);
    nudges.tick(clock.now());
    expect(notifies()).toHaveLength(1);
  });

  it('START and DONE actions drive the quest', () => {
    const q = mkQuest('Dishes');
    nudges.handleAction(encodeAction('START', q.id, A.id));
    expect(questsRepo.get(q.id)!.status).toBe('active');
    nudges.handleAction(encodeAction('DONE', q.id, A.id));
    expect(questsRepo.get(q.id)!.status).toBe('done');
  });

  it('stale or malformed actions are ignored', () => {
    const q = mkQuest('Dishes');
    quests.done(q.id, A.id);
    const xp = players.get(A.id)!.xp;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => nudges.handleAction(encodeAction('DONE', q.id, 'A'))).not.toThrow();
    expect(() => nudges.handleAction('hello')).not.toThrow();
    expect(() => nudges.handleAction(encodeAction('START', 'nope', A.id))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
    expect(players.get(A.id)!.xp).toBe(xp);
  });
});
