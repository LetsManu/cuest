import { describe, expect, it } from 'vitest';
import { spriteShadow, stageForLevel } from '../src/sprite';

describe('sprite', () => {
  it('maps levels to stages', () => {
    expect(stageForLevel(1)).toBe(1);
    expect(stageForLevel(3)).toBe(1);
    expect(stageForLevel(4)).toBe(2);
    expect(stageForLevel(8)).toBe(3);
  });

  it('applies palette overrides (Ember hood changes G)', () => {
    const base = spriteShadow(2, 4);
    const ember = spriteShadow(2, 4, { G: '#B5523B', L: '#D47A5E', g: '#8E3E2C' });
    expect(base).toContain('#4E8A6E');
    expect(ember).not.toContain('#4E8A6E');
    expect(ember).toContain('#B5523B');
  });

  it('renders stage 0 as a silhouette', () => {
    const s = spriteShadow(0, 2);
    expect(s).toContain('#CFC3A8');
    expect(s).not.toContain('#2B2A33');
  });
});
