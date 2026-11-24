import type { Bus } from '../bus.js';
import type { Clock } from '../clock.js';
import { newId } from '../clock.js';
import { baseReward, computeReward, nextCombo, type Reward } from '../domain/rewards.js';
import type { Energy, Player, Quest, QuestSource } from '../domain/types.js';
import type { LedgerRepo } from '../repos/ledger.js';
import type { PlayersRepo } from '../repos/players.js';
import type { QuestsRepo } from '../repos/quests.js';
import { findItem } from '../shop/catalog.js';
import type { StreakResult } from './daily.js';

export const QUESTS_PER_CHEST_KEY = 5;

export interface DoneResult {
  quest: Quest;
  reward: Reward;
  player: Player;
  streak?: StreakResult;
  loot: { itemId: string; name: string } | null;
  chestKey: boolean;
}

export type QuestErrorCode = 'not_found' | 'already_claimed' | 'already_done' | 'unknown_player';

export class QuestError extends Error {
  constructor(public readonly code: QuestErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'QuestError';
  }
}

export interface OpenInput {
  templateId?: string | null;
  title: string;
  energy: Energy;
  minutes: number;
  xp: number;
  gold?: number;
  wheneverAfterHours?: number;
  source?: QuestSource;
}

export class QuestService {
  private quests: QuestsRepo;
  private players: PlayersRepo;
  private ledger: LedgerRepo;
  private bus: Bus;
  private clock: Clock;
  private tx: <T>(fn: () => T) => T;
  private isQuestOfDay: (questId: string, now: Date) => boolean;
  private onDone: ((playerId: string, doneAt: Date) => StreakResult) | undefined;
  private onLoot: ((playerId: string, guaranteed: boolean) => string | null) | undefined;

  constructor(deps: {
    quests: QuestsRepo;
    players: PlayersRepo;
    ledger: LedgerRepo;
    bus: Bus;
    clock: Clock;
    tx?: <T>(fn: () => T) => T;
    isQuestOfDay?: (questId: string, now: Date) => boolean;
    /** Runs inside the done transaction so streak, rest tokens and rewards commit together. */
    onDone?: (playerId: string, doneAt: Date) => StreakResult;
    /** Runs inside the done transaction; returns the id of a granted loot item, or null. */
    onLoot?: (playerId: string, guaranteed: boolean) => string | null;
  }) {
    this.quests = deps.quests;
    this.players = deps.players;
    this.ledger = deps.ledger;
    this.bus = deps.bus;
    this.clock = deps.clock;
    this.tx = deps.tx ?? ((fn) => fn());
    this.isQuestOfDay = deps.isQuestOfDay ?? (() => false);
    this.onDone = deps.onDone;
    this.onLoot = deps.onLoot;
  }

  open(input: OpenInput): { quest: Quest; created: boolean } {
    if (input.templateId) {
      const live = this.quests.findLiveByTemplate(input.templateId);
      if (live) {
        if (live.status === 'whenever') {
          const quest = this.quests.update(live.id, {
            status: 'open',
            nudgeCount: 0,
            wheneverAt: null,
            createdAt: this.clock.now().toISOString(),
          });
          this.bus.emit('quest:opened', quest);
          return { quest, created: false };
        }
        return { quest: live, created: false };
      }
    }
    const quest: Quest = {
      id: newId(),
      templateId: input.templateId ?? null,
      title: input.title,
      energy: input.energy,
      minutes: input.minutes,
      xp: input.xp,
      gold: input.gold ?? Math.round(input.xp / 3),
      status: 'open',
      createdAt: this.clock.now().toISOString(),
      wheneverAfterHours: input.wheneverAfterHours ?? 12,
      claimedBy: null,
      startedAt: null,
      doneAt: null,
      doneBy: null,
      wheneverAt: null,
      snoozedUntil: null,
      nudgeCount: 0,
      lastNudgeAt: null,
      source: input.source ?? null,
    };
    this.quests.insert(quest);
    this.bus.emit('quest:opened', quest);
    return { quest, created: true };
  }

  start(questId: string, playerId: string): Quest {
    const quest = this.requireQuest(questId);
    this.requirePlayer(playerId);
    if (quest.status === 'done') throw new QuestError('already_done');
    if (quest.status === 'active') {
      if (quest.claimedBy === playerId) return quest;
      throw new QuestError('already_claimed');
    }
    const started = this.quests.update(questId, {
      status: 'active',
      claimedBy: playerId,
      startedAt: this.clock.now().toISOString(),
    });
    this.bus.emit('quest:started', started);
    return started;
  }

  done(questId: string, playerId: string): DoneResult {
    const quest = this.requireQuest(questId);
    const doer = this.requirePlayer(playerId);
    if (quest.status === 'done') throw new QuestError('already_done');
    if (quest.status === 'active' && quest.claimedBy !== playerId) throw new QuestError('already_claimed');
    const now = this.clock.now();
    // A quick dice suggestion is effort that counts (streak), but only for its flat base reward:
    // no bonuses, no loot, no chest-key progress and no combo, so it cannot be farmed.
    const flat = quest.source === 'dice_suggestion';
    const lastDoneAt = doer.lastDoneAt ? new Date(doer.lastDoneAt) : null;
    const questOfDay = !flat && this.isQuestOfDay(questId, now);
    const reward = flat ? baseReward(quest) : computeReward({
      quest,
      startedAt: quest.startedAt ? new Date(quest.startedAt) : null,
      doneAt: now,
      boostUntil: doer.boostUntil,
      lastDoneAt,
      comboCount: doer.comboCount,
      questOfDay,
    });
    const combo = nextCombo(lastDoneAt, now, doer.comboCount);
    const result = this.tx(() => {
      const doneQuest = this.quests.update(questId, {
        status: 'done',
        claimedBy: quest.claimedBy ?? playerId,
        doneAt: now.toISOString(),
        doneBy: playerId,
      });
      this.players.addRewards(playerId, reward.xp, reward.gold);
      const streak = this.onDone?.(playerId, now);
      const lootId = flat ? null : (this.onLoot?.(playerId, questOfDay) ?? null);
      const loot = lootId ? { itemId: lootId, name: findItem(lootId)?.name ?? lootId } : null;
      let chestKey = false;
      if (!flat) {
        const doneCount = this.players.incrementDoneCount(playerId);
        chestKey = doneCount % QUESTS_PER_CHEST_KEY === 0;
        if (chestKey) this.players.addChestKeys(playerId, 1);
      }
      const player = flat ? (this.players.get(playerId) as Player) : this.players.setCombo(playerId, combo, now.toISOString());
      this.ledger.add({
        playerId,
        questId,
        kind: 'quest_done',
        xp: reward.xp,
        gold: reward.gold,
        at: now.toISOString(),
        meta: { lines: reward.lines, ...(flat ? { source: quest.source } : {}) },
      });
      return { quest: doneQuest, reward, player, ...(streak ? { streak } : {}), loot, chestKey };
    });
    this.bus.emit('quest:done', result);
    return result;
  }

  later(questId: string, minutes = 60): Quest {
    this.requireQuest(questId);
    const until = new Date(this.clock.now().getTime() + minutes * 60_000).toISOString();
    const quest = this.quests.update(questId, { snoozedUntil: until });
    this.bus.emit('quest:snoozed', quest);
    return quest;
  }

  listVisible(): { active: Quest[]; open: Quest[]; whenever: Quest[] } {
    const all = this.quests.listByStatus(['active', 'open', 'whenever']);
    return {
      active: all.filter((q) => q.status === 'active'),
      open: all.filter((q) => q.status === 'open'),
      whenever: all.filter((q) => q.status === 'whenever'),
    };
  }

  sweep(now: Date): void {
    for (const q of this.quests.listByStatus(['open'])) {
      const due = new Date(q.createdAt).getTime() + q.wheneverAfterHours * 3_600_000;
      if (due <= now.getTime()) {
        const quest = this.quests.update(q.id, { status: 'whenever', wheneverAt: now.toISOString() });
        this.bus.emit('quest:whenever', quest);
      }
    }
    // A started quest nobody finishes goes back to the pool, claim released.
    for (const q of this.quests.listByStatus(['active'])) {
      if (!q.startedAt) continue;
      const due = new Date(q.startedAt).getTime() + q.wheneverAfterHours * 3_600_000;
      if (due <= now.getTime()) {
        const quest = this.quests.update(q.id, {
          status: 'whenever',
          wheneverAt: now.toISOString(),
          claimedBy: null,
          startedAt: null,
        });
        this.bus.emit('quest:whenever', quest);
      }
    }
  }

  private requireQuest(id: string): Quest {
    const q = this.quests.get(id);
    if (!q) throw new QuestError('not_found');
    return q;
  }

  private requirePlayer(id: string): Player {
    const p = this.players.get(id);
    if (!p) throw new QuestError('unknown_player');
    return p;
  }
}
