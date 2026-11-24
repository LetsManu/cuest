import { describe, expect, it } from 'vitest';
import { levelForXp, titleForLevel } from '../src/levels';

describe('levels', () => {
  it('computes level, progress and cost to next', () => {
    expect(levelForXp(0)).toEqual({ level: 1, intoLevel: 0, toNext: 100 });
    expect(levelForXp(99)).toEqual({ level: 1, intoLevel: 99, toNext: 100 });
    expect(levelForXp(100)).toEqual({ level: 2, intoLevel: 0, toNext: 200 });
    expect(levelForXp(940)).toEqual({ level: 4, intoLevel: 340, toNext: 400 });
  });
  it('maps levels to titles', () => {
    expect(titleForLevel(3)).toBe('Apprentice');
    expect(titleForLevel(4)).toBe('Hearthkeeper');
    expect(titleForLevel(7)).toBe('Hearthkeeper');
    expect(titleForLevel(8)).toBe('Hearth Warden');
  });
});
