import type { Energy, Quest } from '../domain/types.js';
import { copy } from '../copy.js';
import type { QuestService } from './quests.js';

export interface Suggestion {
  title: string;
  minutes: number;
  xp: number;
  energy: Energy;
}

const ORDER: Energy[] = ['low', 'medium', 'high'];

/** Energy dice: picks a quest matching the player's energy, else the nearest energy, else a suggestion. */
export class DiceService {
  private readonly quests: QuestService;
  private readonly rng: () => number;

  constructor(deps: { quests: QuestService; rng?: () => number }) {
    this.quests = deps.quests;
    this.rng = deps.rng ?? Math.random;
  }

  roll(energy: Energy): { quest: Quest } | { suggestion: Suggestion } {
    const { open, whenever } = this.quests.listVisible();
    const pool = [...open, ...whenever];
    const at = ORDER.indexOf(energy);
    for (const distance of [0, 1, 2]) {
      const near = pool.filter((q) => Math.abs(ORDER.indexOf(q.energy) - at) === distance);
      if (near.length > 0) return { quest: near[Math.min(near.length - 1, Math.floor(this.rng() * near.length))] as Quest };
    }
    return { suggestion: { ...copy.dice.suggestion } };
  }

  /** Accepting the suggestion creates a manual quest and starts it for the player. */
  accept(playerId: string, suggestion: Suggestion): Quest {
    const { quest } = this.quests.open({
      title: suggestion.title,
      energy: suggestion.energy,
      minutes: suggestion.minutes,
      xp: suggestion.xp,
    });
    return this.quests.start(quest.id, playerId);
  }
}
