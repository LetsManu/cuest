import { describe, expect, it } from 'vitest';
import { computeReward, nextCombo } from '../src/domain/rewards.js';
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

  const base = { createdAt: '2026-11-24T11:00:00.000Z' };
  const q30 = { xp: 30, gold: 10, ...base } as Quest;
  const at = (min: number) => new Date(doneAt.getTime() - min * 60_000);

  it('keep-going: +5 XP per full minute beyond 2', () => {
    const r = computeReward({ quest: q30, startedAt: at(7), doneAt });
    expect(r.xp).toBe(55);
    expect(r.lines[1]).toEqual({ label: 'Kept going', xp: 25, gold: 0 });
  });

  it('keep-going caps at +50 and ignores 2 minutes or less', () => {
    expect(computeReward({ quest: q30, startedAt: at(20), doneAt }).lines[1]).toEqual({ label: 'Kept going', xp: 50, gold: 0 });
    expect(computeReward({ quest: q30, startedAt: at(2.9), doneAt }).lines).toHaveLength(1);
  });

  it('fresh: started within 15 min of creation gives +quest.xp', () => {
    const quest = { ...q30, createdAt: '2026-11-24T11:50:00.000Z' } as Quest;
    const r = computeReward({ quest, startedAt: new Date('2026-11-24T12:00:00Z'), doneAt: new Date('2026-11-24T12:01:00Z') });
    expect(r.lines.map((l) => l.label)).toEqual(['Quest', 'Fresh quest']);
    expect(r.xp).toBe(60);
  });

  it('fresh: exactly 15:00 after creation still counts, 15:01 does not', () => {
    const quest = { ...q30, createdAt: '2026-11-24T11:45:00.000Z' } as Quest;
    const fresh = (startedAt: string) =>
      computeReward({ quest, startedAt: new Date(startedAt), doneAt: new Date('2026-11-24T12:01:00Z') }).lines.some((l) => l.label === 'Fresh quest');
    expect(fresh('2026-11-24T12:00:00.000Z')).toBe(true);
    expect(fresh('2026-11-24T12:00:01.000Z')).toBe(false);
  });

  it('fresh: none when started 20 minutes after creation or never started', () => {
    const quest = { ...q30, createdAt: '2026-11-24T11:40:00.000Z' } as Quest;
    expect(computeReward({ quest, startedAt: new Date('2026-11-24T12:00:00Z'), doneAt: new Date('2026-11-24T12:01:00Z') }).xp).toBe(30);
    expect(computeReward({ quest: { ...q30, createdAt: doneAt.toISOString() } as Quest, startedAt: null, doneAt }).xp).toBe(30);
  });

  it('combo: second done 5 min after the first gives x2 line +25%', () => {
    const r = computeReward({ quest: q30, startedAt: null, doneAt, lastDoneAt: at(5), comboCount: 1 });
    expect(r.lines[1]).toEqual({ label: 'Combo ×2', xp: 8, gold: 0 });
    expect(r.xp).toBe(38);
  });

  it('combo caps at +quest.xp', () => {
    const r = computeReward({ quest: q30, startedAt: null, doneAt, lastDoneAt: at(5), comboCount: 5 });
    expect(r.lines[1]).toEqual({ label: 'Combo ×6', xp: 30, gold: 0 });
    const r2 = computeReward({ quest: q30, startedAt: null, doneAt, lastDoneAt: at(5), comboCount: 9 });
    expect(r2.lines[1]).toEqual({ label: 'Combo ×10', xp: 30, gold: 0 });
  });

  it('combo resets with an 11 min gap', () => {
    const r = computeReward({ quest: q30, startedAt: null, doneAt, lastDoneAt: at(11), comboCount: 4 });
    expect(r.lines).toHaveLength(1);
    expect(nextCombo(at(11), doneAt, 4)).toBe(1);
    expect(nextCombo(at(10), doneAt, 4)).toBe(5);
    expect(nextCombo(null, doneAt, 0)).toBe(1);
  });

  it('quest of the day gives +2 x quest.xp', () => {
    const r = computeReward({ quest: q30, startedAt: null, doneAt, questOfDay: true });
    expect(r.lines[1]).toEqual({ label: 'Quest of the day', xp: 60, gold: 0 });
    expect(r.xp).toBe(90);
  });

  it('double XP doubles the summed XP; gold stays quest.gold', () => {
    const r = computeReward({
      quest: q30, startedAt: at(7), doneAt, lastDoneAt: at(5), comboCount: 1, questOfDay: true,
      boostUntil: '2026-11-24T12:30:00.000Z',
    });
    expect(r.lines.map((l) => l.label)).toEqual(['Quest', 'Kept going', 'Combo ×2', 'Quest of the day', 'Double XP hour']);
    expect(r.lines[4]).toEqual({ label: 'Double XP hour', xp: 30 + 25 + 8 + 60, gold: 0 });
    expect(r.xp).toBe((30 + 25 + 8 + 60) * 2);
    expect(r.gold).toBe(10);
  });
});
