import type { Player, Quest } from './domain/types.js';
import type { StreakResult } from './services/daily.js';
import type { Reward } from './domain/rewards.js';

export type BusEvents = {
  'quest:opened': Quest;
  'quest:started': Quest;
  'quest:done': { quest: Quest; reward: Reward; player: Player; streak?: StreakResult };
  'quest:whenever': Quest;
  'quest:snoozed': Quest;
  'daily:picked': { questId: string | null };
  'shop:changed': { playerId: string };
};

type Listener<K extends keyof BusEvents> = (e: BusEvents[K]) => void;

export class Bus {
  private listeners: { [K in keyof BusEvents]?: Listener<K>[] } = {};

  on<K extends keyof BusEvents>(k: K, fn: (e: BusEvents[K]) => void): void {
    const list = (this.listeners[k] ?? (this.listeners[k] = [])) as Listener<K>[];
    list.push(fn);
  }

  emit<K extends keyof BusEvents>(k: K, e: BusEvents[K]): void {
    const list = (this.listeners[k] ?? []) as Listener<K>[];
    for (const fn of list) {
      try {
        fn(e);
      } catch (err) {
        console.error(`bus listener for ${k} failed`, err);
      }
    }
  }
}
