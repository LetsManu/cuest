import { copy } from '../copy.js';
import type { Quest } from './types.js';

export interface Reward {
  xp: number;
  gold: number;
  lines: { label: string; xp: number; gold: number }[];
}

export function computeReward(input: {
  quest: Quest;
  startedAt: Date | null;
  doneAt: Date;
  boostUntil?: string | null;
}): Reward {
  const { quest } = input;
  const lines = [{ label: copy.rewardBaseLabel, xp: quest.xp, gold: quest.gold }];
  let xp = quest.xp;
  if (input.boostUntil && new Date(input.boostUntil).getTime() > input.doneAt.getTime()) {
    lines.push({ label: copy.rewardDoubleXp, xp: quest.xp, gold: 0 });
    xp += quest.xp;
  }
  return { xp, gold: quest.gold, lines };
}
