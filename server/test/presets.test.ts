import { describe, expect, it } from 'vitest';
import { presetTemplates } from '../src/domain/presets.js';
import { DEFAULT_NUDGE } from '../src/domain/types.js';

describe('presetTemplates', () => {
  it('vacuum returns bin and rescue templates', () => {
    const ts = presetTemplates('vacuum', { entityId: 'vacuum.robo' });
    expect(ts).toHaveLength(2);
    expect(ts[0]).toMatchObject({
      title: 'Empty the vacuum bin', energy: 'low', minutes: 1, xp: 10, gold: 3,
      rule: { type: 'state', entityId: 'vacuum.robo', to: ['docked'], from: ['cleaning', 'returning'] },
    });
    expect(ts[1]).toMatchObject({
      title: 'Rescue the robot vacuum', energy: 'low', minutes: 2, xp: 15, gold: 5,
      rule: { type: 'state', entityId: 'vacuum.robo', to: ['error'] },
    });
  });

  it('washer_state uses given doneStates and defaults', () => {
    const custom = presetTemplates('washer_state', { entityId: 'sensor.w', doneStates: ['idle'] })[0]!;
    expect(custom.rule).toEqual({ type: 'state', entityId: 'sensor.w', to: ['idle'] });
    const dflt = presetTemplates('washer_state', { entityId: 'sensor.w' })[0]!;
    expect(dflt.rule).toMatchObject({ to: ['finished', 'complete', 'completed', 'end', 'done'] });
  });

  it('power presets and common fields', () => {
    const w = presetTemplates('washer_power', { entityId: 'sensor.p' })[0]!;
    expect(w).toMatchObject({
      title: 'Hang up the laundry', energy: 'low', minutes: 5, xp: 30, gold: 10, source: 'rule',
      nudge: DEFAULT_NUDGE, wheneverAfterHours: 12, enabled: true, schedule: null,
      rule: { type: 'power_below', entityId: 'sensor.p', runningAboveW: 10, idleBelowW: 3, forMinutes: 3 },
    });
    expect(presetTemplates('dryer_power', { entityId: 'x' })[0]).toMatchObject({ title: 'Fold the dry laundry', energy: 'medium', minutes: 10, xp: 40, gold: 13 });
    expect(presetTemplates('dishwasher_state', { entityId: 'x' })[0]).toMatchObject({ title: 'Unload the dishwasher', energy: 'medium', minutes: 6, xp: 35, gold: 12 });
    expect(presetTemplates('vacuum_bin_sensor', { entityId: 'x' })[0]).toMatchObject({ title: 'Empty the vacuum bin', xp: 10, rule: { type: 'state', to: ['on'] } });
  });
});
