export function levelForXp(xp: number): { level: number; intoLevel: number; toNext: number } {
  let level = 1;
  // cumulative XP at the start of level L is 50 * L * (L - 1); L -> L+1 costs 100 * L
  while (xp >= 50 * (level + 1) * level) level++;
  return { level, intoLevel: xp - 50 * level * (level - 1), toNext: 100 * level };
}

export function titleForLevel(level: number): 'Apprentice' | 'Hearthkeeper' | 'Hearth Warden' {
  if (level <= 3) return 'Apprentice';
  if (level <= 7) return 'Hearthkeeper';
  return 'Hearth Warden';
}
