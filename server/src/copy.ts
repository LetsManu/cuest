import type { Quest } from './domain/types.js';

const repeatTemplates: ((title: string) => string)[] = [
  (t) => `No rush. "${t}" is still here whenever you're ready.`,
  (t) => `Even 2 minutes counts. "${t}" is waiting for you.`,
  (t) => `Your hero believes in you. "${t}" whenever you like.`,
];

export const copy = {
  reward: {
    base: 'Quest',
    keepGoing: 'Kept going',
    fresh: 'Fresh quest',
    combo: (n: number): string => `Combo ×${n}`,
    questOfDay: 'Quest of the day',
    doubleXp: 'Double XP hour',
  },
  streak: {
    restarted: 'New streak started — welcome back!',
    restUsed: 'Rest day used — your streak is safe.',
  },
  newQuestTitle: (q: Quest): string => `New quest: ${q.title}`,
  newQuestMessage: (q: Quest): string => `A ${q.minutes}-minute quest is waiting. +${q.xp} XP.`,
  repeatMessage: (q: Quest, n: number): string => {
    const i = (((n - 1) % repeatTemplates.length) + repeatTemplates.length) % repeatTemplates.length;
    return (repeatTemplates[i] as (title: string) => string)(q.title);
  },
  alreadyClaimed: 'Someone else is already on this one. Thanks for checking!',
  notFound: 'Not found',
  alreadyDone: 'This quest is already done. Nice!',
  dice: {
    suggestion: { title: 'Quick tidy: put 5 things back where they belong', minutes: 2, xp: 10, energy: 'low' as const },
  },
  sprint: {
    logLabel: 'Sprint note',
    finishLabel: 'Power sprint',
    errors: {
      sprint_running: 'A sprint is already going. Finish it first, then start a fresh one!',
      no_sprint: 'No sprint is running right now.',
      log_limit: "That's 10 notes for this sprint. Great focus, keep going!",
      unknown_player: 'Not found',
    },
  },
  actions: { start: 'Start 2 min', done: 'Already done', later: 'Later' },
  shop: {
    errors: {
      unknown_item: 'Not found',
      unknown_player: 'Not found',
      not_enough_gold: "Not quite enough gold yet. A few more quests and it's yours!",
      already_owned: 'You already have this one.',
      bridge_offline: "Home Assistant isn't connected right now, so this treat can't switch on. Your gold is safe.",
      not_owned: 'Get this one in the shop first.',
      no_chest_key: 'No chest key yet. Every 5 quests brings one!',
    },
    items: {
      hood_ember: 'Ember hood',
      hood_night: 'Night-sky hood',
      scarf_teal: 'Teal scarf',
      broom_gold: 'Golden broom',
      lantern: 'Village lantern',
      flowers: 'Flower bed',
      cat: 'Village cat',
      fountain: 'Little fountain',
      rest_token: 'Rest-day token',
      mystery_chest: 'Mystery chest',
      xp_potion: 'Double XP hour',
      hood_starry: 'Starry cloak',
      broom_moss: 'Mossy broom',
      owl: 'Sleepy owl',
    },
  },
};
