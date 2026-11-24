export type Energy = 'low' | 'medium' | 'high';
export type QuestStatus = 'open' | 'active' | 'done' | 'whenever';
export type Rule =
  | { type: 'state'; entityId: string; to: string[]; from?: string[]; normalize?: boolean }
  | {
      type: 'running_stops';
      entityId: string;
      runningStates: string[];
      pauseStates: string[];
      numericAbove?: number;
      forMinutes: number;
    }
  | { type: 'power_below'; entityId: string; runningAboveW: number; idleBelowW: number; forMinutes: number };
export type Schedule =
  | { type: 'weekly'; days: number[]; time: string } // days 0=Sunday, time "HH:MM" local
  | { type: 'every_n_days'; n: number; time: string; startDate: string }; // startDate "YYYY-MM-DD" local
export interface NudgeConfig {
  notify: boolean;
  light: { entityId: string; rgb: [number, number, number] } | null;
  repeatEveryMinutes: number;
  maxRepeats: number;
  quietStart: string; // "HH:MM" local
  quietEnd: string; // "HH:MM" local
}
export interface Player {
  id: string;
  name: string;
  haPerson: string | null;
  notifyService: string | null;
  xp: number;
  gold: number;
  restTokens: number;
  boostUntil: string | null;
  comboCount: number;
  lastDoneAt: string | null;
  streak: number;
  bestStreak: number;
  lastStreakDay: string | null;
  restWeek: string | null;
  chestKeys: number;
  doneCount: number;
  createdAt: string;
}
export interface QuestTemplate {
  id: string;
  title: string;
  energy: Energy;
  minutes: number;
  xp: number;
  gold: number;
  source: 'manual' | 'recurring' | 'rule';
  rule: Rule | null;
  schedule: Schedule | null;
  nudge: NudgeConfig;
  wheneverAfterHours: number;
  enabled: boolean;
  lastSpawnedAt: string | null;
  createdAt: string;
}
/** Where a quest came from when that changes its rewards; null for a normal quest. */
export type QuestSource = 'dice_suggestion';
export interface Quest {
  id: string;
  templateId: string | null;
  title: string;
  energy: Energy;
  minutes: number;
  xp: number;
  gold: number;
  status: QuestStatus;
  createdAt: string;
  wheneverAfterHours: number;
  claimedBy: string | null;
  startedAt: string | null;
  doneAt: string | null;
  doneBy: string | null;
  wheneverAt: string | null;
  snoozedUntil: string | null;
  nudgeCount: number;
  lastNudgeAt: string | null;
  /** 'dice_suggestion': accepted from the energy dice; pays a small flat reward. */
  source?: QuestSource | null;
}
export interface LedgerEntry {
  id: string;
  playerId: string;
  questId: string | null;
  /** 'sprint' rows are power-sprint XP (no quest); 'quest_done' rows are finished quests only. */
  kind: 'quest_done' | 'sprint' | 'purchase';
  xp: number;
  gold: number;
  at: string;
  meta: Record<string, unknown>;
}
export interface StateEvent {
  entityId: string;
  oldState: string | null;
  newState: string;
  at: Date;
}
export const DEFAULT_NUDGE: NudgeConfig = {
  notify: true,
  light: null,
  repeatEveryMinutes: 60,
  maxRepeats: 2,
  quietStart: '22:00',
  quietEnd: '08:00',
};
export type Slot = 'hood' | 'scarf' | 'broom';
export interface ShopItem {
  id: string;
  kind: 'wardrobe' | 'decor' | 'helper' | 'treat';
  name: string;
  cost: number;
  slot?: Slot;
  palette?: Record<string, string>;
  /** Only ever won as a loot drop: not buyable, not in the shop, not in chests. */
  lootOnly?: boolean;
}
