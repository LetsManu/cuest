import { copy } from '../copy.js';
import type { Quest } from './types.js';

export interface Reward {
  xp: number;
  gold: number;
  lines: { label: string; xp: number; gold: number }[];
}

export function computeReward(input: { quest: Quest; startedAt: Date | null; doneAt: Date }): Reward {
  const { quest } = input;
  return {
    xp: quest.xp,
    gold: quest.gold,
    lines: [{ label: copy.rewardBaseLabel, xp: quest.xp, gold: quest.gold }],
  };
}
