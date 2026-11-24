import { describe, expect, it } from 'vitest';
import { copy } from '../src/copy.js';
import type { Quest } from '../src/domain/types.js';

const q = { title: 'Dishes', minutes: 10, xp: 30 } as Quest;

describe('copy', () => {
  it('never uses shaming words', () => {
    const strings = [
      ...Object.values(copy.reward).map((v) => (typeof v === 'function' ? v(3) : v)),
      copy.newQuestTitle(q),
      copy.newQuestMessage(q),
      ...[1, 2, 3, 4, 5, 6].map((n) => copy.repeatMessage(q, n)),
      ...Object.values(copy.actions),
    ];
    for (const s of strings) expect(s).not.toMatch(/\b(overdue|late|failed|missed|penalty)\b/i);
  });

  it('cycles repeat messages', () => {
    expect(copy.repeatMessage(q, 1)).toBe(`No rush. "Dishes" is still here whenever you're ready.`);
    expect(copy.repeatMessage(q, 4)).toBe(copy.repeatMessage(q, 1));
  });
});
