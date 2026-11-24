import type { DatabaseSync } from 'node:sqlite';
import { addDays, dayNumber, isoWeek, localDate, type Clock } from '../clock.js';
import type { Quest } from '../domain/types.js';
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

  tick(now: Date): void {
    const date = localDate(now, this.tz);
    const fresh = this.row(date) === undefined;
    const pick = this.ensurePicked(date);
    if (fresh) this.onPicked?.(pick);
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
    const last = player.lastStreakDay;
    const save = (streak: number, restWeek: string | null): StreakResult['streak'] => {
      const best = Math.max(player.bestStreak, streak);
      this.players.setStreak(playerId, { streak, bestStreak: best, lastStreakDay: today, restWeek });
      return streak;
    };

    if (last === null) return { streak: save(1, player.restWeek), restarted: false, usedRest: null };
    const gap = dayNumber(today) - dayNumber(last);
    if (gap <= 0) return { streak: player.streak, restarted: false, usedRest: null };
    if (gap === 1) return { streak: save(player.streak + 1, player.restWeek), restarted: false, usedRest: null };

    // Missed days in between: the free weekly rest day first, then one token per day.
    const missed = gap - 1;
    let restWeek = player.restWeek;
    let tokensNeeded = 0;
    let freeUsed = false;
    if (missed <= MAX_COVERABLE_GAP) {
      for (let i = 1; i <= missed; i++) {
        const week = isoWeek(addDays(last, i));
        if (restWeek !== week) {
          restWeek = week;
          freeUsed = true;
        } else {
          tokensNeeded++;
        }
      }
    }
    const covered = missed <= MAX_COVERABLE_GAP && player.restTokens >= tokensNeeded;
    if (!covered) return { streak: save(1, player.restWeek), restarted: true, usedRest: null };
    for (let i = 0; i < tokensNeeded; i++) {
      if (!this.players.consumeRestToken(playerId)) throw new Error('rest token vanished');
    }
    return {
      streak: save(player.streak + 1, restWeek),
      restarted: false,
      usedRest: tokensNeeded > 0 ? 'token' : freeUsed ? 'free' : null,
    };
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
