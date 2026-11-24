import type { DatabaseSync } from 'node:sqlite';
import { addDays, dayNumber, isoWeek, localDate, type Clock } from '../clock.js';
import type { Player, Quest } from '../domain/types.js';
import type { PlayersRepo } from '../repos/players.js';
import type { QuestsRepo } from '../repos/quests.js';

export interface StreakResult {
  streak: number;
  restarted: boolean;
  usedRest: 'free' | 'token' | null;
}

/**
 * Performance bound: a gap of more than 60 missed days is not walked day by day; after two months
 * away a fresh start is the kind outcome anyway (best streak is kept).
 */
const MAX_COVERABLE_GAP = 60;

/** Quest of the day and kind streaks (one free rest day per ISO week, then rest tokens). */
export class DailyService {
  private readonly db: DatabaseSync;
  private readonly quests: QuestsRepo;
  private readonly players: PlayersRepo;
  private readonly clock: Clock;
  private readonly tz: string;
  private readonly rng: () => number;
  private readonly onPicked: ((questId: string | null) => void) | undefined;

  constructor(deps: {
    db: DatabaseSync;
    quests: QuestsRepo;
    players: PlayersRepo;
    clock: Clock;
    tz: string;
    rng?: () => number;
    /** Called when a new day's quest of the day is chosen (tick or first-opened fallback). */
    onPicked?: (questId: string | null) => void;
  }) {
    this.onPicked = deps.onPicked;
    this.db = deps.db;
    this.quests = deps.quests;
    this.players = deps.players;
    this.clock = deps.clock;
    this.tz = deps.tz;
    this.rng = deps.rng ?? Math.random;
  }

  /** Last local day whose pick the tick has announced (a lazy pick via questOfDay() announces nothing). */
  private publishedDate: string | null = null;

  tick(now: Date): void {
    const date = localDate(now, this.tz);
    const pick = this.ensurePicked(date);
    if (this.publishedDate !== date) {
      this.publishedDate = date;
      this.onPicked?.(pick);
    }
  }

  questOfDay(now: Date): string | null {
    return this.ensurePicked(localDate(now, this.tz));
  }

  isQuestOfDay(questId: string, now: Date): boolean {
    return this.questOfDay(now) === questId;
  }

  /** With no quest to pick at the start of the day, the first one opened becomes it. */
  onQuestOpened(quest: Quest, now: Date): void {
    const date = localDate(now, this.tz);
    const row = this.row(date);
    if (quest.source === 'dice_suggestion') return;
    if (row && row.quest_id === null) {
      this.db.prepare('UPDATE daily SET quest_id = ? WHERE date = ? AND quest_id IS NULL').run(quest.id, date);
      this.onPicked?.(quest.id);
    }
  }

  onQuestDone(playerId: string, doneAt: Date): StreakResult {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`unknown player ${playerId}`);
    const today = localDate(doneAt, this.tz);
    const save = (streak: number, restWeek: string | null): StreakResult['streak'] => {
      const best = Math.max(player.bestStreak, streak);
      this.players.setStreak(playerId, { streak, bestStreak: best, lastStreakDay: today, restWeek });
      return streak;
    };

    const gap = this.gap(player, today);
    if (gap.kind !== 'covered') {
      if (gap.kind === 'first') return { streak: save(1, player.restWeek), restarted: false, usedRest: null };
      if (gap.kind === 'same_day') return { streak: player.streak, restarted: false, usedRest: null };
      if (gap.kind === 'next_day') return { streak: save(player.streak + 1, player.restWeek), restarted: false, usedRest: null };
      return { streak: save(1, player.restWeek), restarted: true, usedRest: null };
    }
    for (let i = 0; i < gap.tokensNeeded; i++) {
      if (!this.players.consumeRestToken(playerId)) throw new Error('rest token vanished');
    }
    return {
      streak: save(player.streak + 1, gap.restWeek),
      restarted: false,
      usedRest: gap.tokensNeeded > 0 ? 'token' : gap.freeUsed ? 'free' : null,
    };
  }

  /**
   * The streak as it stands right now, for display (summary, HA sensor). Read-only: while a quest
   * today could still continue the streak (rest day / tokens cover the gap) it is the stored streak;
   * once it cannot, it is 0 (a new streak starts with the next quest). The best streak is untouched.
   */
  currentStreak(player: Player, now: Date): number {
    const kind = this.gap(player, localDate(now, this.tz)).kind;
    return kind === 'restart' || kind === 'first' ? 0 : player.streak;
  }

  /** How `today` relates to the player's last streak day, and whether missed days can be covered. */
  private gap(
    player: Player,
    today: string,
  ):
    | { kind: 'first' | 'same_day' | 'next_day' | 'restart' }
    | { kind: 'covered'; tokensNeeded: number; freeUsed: boolean; restWeek: string | null } {
    const last = player.lastStreakDay;
    if (last === null) return { kind: 'first' };
    const gap = dayNumber(today) - dayNumber(last);
    if (gap <= 0) return { kind: 'same_day' };
    if (gap === 1) return { kind: 'next_day' };

    // Days off in between: the free weekly rest day first, then one token per day.
    const missed = gap - 1;
    if (missed > MAX_COVERABLE_GAP) return { kind: 'restart' };
    let restWeek = player.restWeek;
    let tokensNeeded = 0;
    let freeUsed = false;
    for (let i = 1; i <= missed; i++) {
      const week = isoWeek(addDays(last, i));
      if (restWeek !== week) {
        restWeek = week;
        freeUsed = true;
      } else {
        tokensNeeded++;
      }
    }
    if (player.restTokens < tokensNeeded) return { kind: 'restart' };
    return { kind: 'covered', tokensNeeded, freeUsed, restWeek };
  }

  private row(date: string): { quest_id: string | null } | undefined {
    return this.db.prepare('SELECT quest_id FROM daily WHERE date = ?').get(date) as { quest_id: string | null } | undefined;
  }

  private ensurePicked(date: string): string | null {
    const row = this.row(date);
    if (row) return row.quest_id;
    const pool = this.quests.listByStatus(['open', 'whenever']).filter((q) => q.source !== 'dice_suggestion');
    const pick = pool.length === 0 ? null : (pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))] as Quest).id;
    this.db.prepare('INSERT INTO daily (date, quest_id) VALUES (?, ?)').run(date, pick);
    return pick;
  }
}
