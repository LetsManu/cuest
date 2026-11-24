import type { Quest } from './domain/types.js';

const repeatTemplates: ((title: string) => string)[] = [
  (t) => `No rush. "${t}" is still here whenever you're ready.`,
  (t) => `Even 2 minutes counts. "${t}" is waiting for you.`,
  (t) => `Your hero believes in you. "${t}" whenever you like.`,
];

export const copy = {
  rewardBaseLabel: 'Quest',
  newQuestTitle: (q: Quest): string => `New quest: ${q.title}`,
  newQuestMessage: (q: Quest): string => `A ${q.minutes}-minute quest is waiting. +${q.xp} XP.`,
  repeatMessage: (q: Quest, n: number): string => {
    const i = (((n - 1) % repeatTemplates.length) + repeatTemplates.length) % repeatTemplates.length;
    return (repeatTemplates[i] as (title: string) => string)(q.title);
  },
  alreadyClaimed: 'Someone else is already on this one. Thanks for checking!',
  notFound: 'Not found',
  alreadyDone: 'This quest is already done. Nice!',
  actions: { start: 'Start 2 min', done: 'Already done', later: 'Later' },
};
