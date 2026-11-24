/** Player-facing UI text. English first, translation-ready. */
export const STRINGS = {
  cardName: 'Cuest',
  cardDescription: 'Your Cuest hero, level and open quests.',
  notReady: 'Cuest is not ready yet. Check that the Cuest integration is set up and connected.',
  questsHeading: 'Quests',
  noQuests: 'No open quests. Enjoy the quiet.',
  done: 'Done',
  gold: 'gold',
  level: 'Level',
  xpToNext: 'XP to next level',
  heroLabel: 'Hero',
  village: 'Village',
  panelPlaceholder: 'Cuest panel is coming soon.',
  decorNames: {
    lantern: 'Village lantern',
    flowers: 'Flower bed',
    cat: 'Village cat',
    fountain: 'Little fountain',
  } as Record<string, string>,
} as const;
