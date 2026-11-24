import { describe, expect, it } from 'vitest';
import { computeReward } from '../src/domain/rewards.js';
import type { Quest } from '../src/domain/types.js';

const quest = { xp: 30, gold: 10 } as Quest;
const doneAt = new Date('2026-11-24T12:00:00Z');

describe('computeReward', () => {
  it('base reward without boost', () => {
    const r = computeReward({ quest, startedAt: null, doneAt });
    expect(r).toMatchObject({ xp: 30, gold: 10 });
    expect(r.lines).toHaveLength(1);
  });

  it('doubles XP during boost, gold unchanged', () => {
    const r = computeReward({ quest, startedAt: null, doneAt, boostUntil: '2026-11-24T12:30:00.000Z' });
    expect(r.xp).toBe(60);
    expect(r.gold).toBe(10);
    expect(r.lines[1]).toEqual({ label: 'Double XP hour', xp: 30, gold: 0 });
  });

  it('normal after boost ended or when null', () => {
    expect(computeReward({ quest, startedAt: null, doneAt, boostUntil: '2026-11-24T12:00:00.000Z' }).xp).toBe(30);
    expect(computeReward({ quest, startedAt: null, doneAt, boostUntil: '2026-11-24T11:00:00.000Z' }).xp).toBe(30);
    expect(computeReward({ quest, startedAt: null, doneAt, boostUntil: null }).xp).toBe(30);
  });
});
