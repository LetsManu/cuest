import { copy } from '../copy.js';
import type { Quest } from './types.js';

export interface Reward {
  xp: number;
  gold: number;
  lines: { label: string; xp: number; gold: number }[];
}

const MIN = 60_000;
const COMBO_WINDOW_MS = 10 * MIN;
const FRESH_WINDOW_MS = 15 * MIN;

/** Combo number this done would have: 1 = no combo, 2+ = chained within 10 minutes. */
export function nextCombo(lastDoneAt: Date | null | undefined, doneAt: Date, prevCount: number): number {
  if (!lastDoneAt) return 1;
  const gap = doneAt.getTime() - lastDoneAt.getTime();
  if (gap < 0 || gap > COMBO_WINDOW_MS) return 1;
  return Math.max(prevCount, 1) + 1;
}

/** A quick dice suggestion pays its flat base XP and gold only. */
export function baseReward(quest: Quest): Reward {
  return { xp: quest.xp, gold: quest.gold, lines: [{ label: copy.reward.base, xp: quest.xp, gold: quest.gold }] };
}

export function computeReward(input: {
  quest: Quest;
  startedAt: Date | null;
  doneAt: Date;
  boostUntil?: string | null;
  lastDoneAt?: Date | null;
  comboCount?: number;
  questOfDay?: boolean;
}): Reward {
  const { quest, startedAt, doneAt } = input;
  const lines = [{ label: copy.reward.base, xp: quest.xp, gold: quest.gold }];
  const bonus = (label: string, xp: number): void => {
    if (xp > 0) lines.push({ label, xp, gold: 0 });
  };

  if (startedAt) {
    const minutes = Math.floor((doneAt.getTime() - startedAt.getTime()) / MIN);
    bonus(copy.reward.keepGoing, Math.min(50, Math.max(0, minutes - 2) * 5));
    const sinceCreated = startedAt.getTime() - new Date(quest.createdAt).getTime();
    if (sinceCreated <= FRESH_WINDOW_MS) bonus(copy.reward.fresh, quest.xp);
  }

  const n = nextCombo(input.lastDoneAt, doneAt, input.comboCount ?? 0);
  if (n >= 2) bonus(copy.reward.combo(n), Math.min(quest.xp, Math.round(quest.xp * 0.25 * (n - 1))));

  if (input.questOfDay) bonus(copy.reward.questOfDay, 2 * quest.xp);

  let xp = lines.reduce((sum, l) => sum + l.xp, 0);
  if (input.boostUntil && new Date(input.boostUntil).getTime() > doneAt.getTime()) {
    lines.push({ label: copy.reward.doubleXp, xp, gold: 0 });
    xp *= 2;
  }
  return { xp, gold: quest.gold, lines };
}
