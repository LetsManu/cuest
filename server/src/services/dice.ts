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

export class DiceError extends Error {
  constructor(public readonly code: 'quest_waiting') {
    super(code);
    this.name = 'DiceError';
  }
}

/** Energy dice: picks a quest matching the player's energy, else the nearest energy, else a suggestion. */
export class DiceService {
  private readonly quests: QuestService;
  private readonly rng: () => number;
  private readonly tx: <T>(fn: () => T) => T;

  constructor(deps: { quests: QuestService; rng?: () => number; tx?: <T>(fn: () => T) => T }) {
    this.tx = deps.tx ?? ((fn) => fn());
    this.quests = deps.quests;
    this.rng = deps.rng ?? Math.random;
  }

  roll(energy: Energy): { quest: Quest } | { suggestion: Suggestion } {
    const pool = this.pool();
    const at = ORDER.indexOf(energy);
    for (const distance of [0, 1, 2]) {
      const near = pool.filter((q) => Math.abs(ORDER.indexOf(q.energy) - at) === distance);
      if (near.length > 0) return { quest: near[Math.min(near.length - 1, Math.floor(this.rng() * near.length))] as Quest };
    }
    return { suggestion: { ...copy.dice.suggestion } };
  }

  /**
   * Accepting the suggestion creates a manual quest (marked as a dice suggestion) and starts it.
   * The dice only offer it when no quest is waiting, so the server re-checks that here.
   */
  accept(playerId: string, suggestion: Suggestion): Quest {
    return this.tx(() => {
      if (this.pool().length > 0) throw new DiceError('quest_waiting');
      const { quest } = this.quests.open({
        title: suggestion.title,
        energy: suggestion.energy,
        minutes: suggestion.minutes,
        xp: suggestion.xp,
        source: 'dice_suggestion',
      });
      return this.quests.start(quest.id, playerId);
    });
  }

  private pool(): Quest[] {
    const { open, whenever } = this.quests.listVisible();
    return [...open, ...whenever];
  }
}
