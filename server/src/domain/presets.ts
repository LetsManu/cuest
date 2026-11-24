import { DEFAULT_NUDGE, type Energy, type QuestTemplate, type Rule } from './types.js';

export type PresetName =
  | 'washer_power' | 'washer_state'
  | 'dryer_power' | 'dryer_state'
  | 'dishwasher_power' | 'dishwasher_state'
  | 'vacuum' | 'vacuum_bin_sensor';

type PresetTemplate = Omit<QuestTemplate, 'id' | 'createdAt' | 'lastSpawnedAt'>;

const DEFAULT_DONE_STATES = ['finished', 'complete', 'completed', 'end', 'done'];

const make = (title: string, energy: Energy, minutes: number, xp: number, rule: Rule): PresetTemplate => ({
  title,
  energy,
  minutes,
  xp,
  gold: Math.round(xp / 3),
  source: 'rule',
  rule,
  schedule: null,
  nudge: DEFAULT_NUDGE,
  wheneverAfterHours: 12,
  enabled: true,
});

const APPLIANCES = {
  washer: { title: 'Hang up the laundry', energy: 'low', minutes: 5, xp: 30 },
  dryer: { title: 'Fold the dry laundry', energy: 'medium', minutes: 10, xp: 40 },
  dishwasher: { title: 'Unload the dishwasher', energy: 'medium', minutes: 6, xp: 35 },
} as const;

export function presetTemplates(
  preset: PresetName,
  opts: { entityId: string; doneStates?: string[] },
): PresetTemplate[] {
  const { entityId } = opts;
  if (preset === 'vacuum') {
    return [
      make('Empty the vacuum bin', 'low', 1, 10, { type: 'state', entityId, to: ['docked'], from: ['cleaning', 'returning'] }),
      make('Rescue the robot vacuum', 'low', 2, 15, { type: 'state', entityId, to: ['error'] }),
    ];
  }
  if (preset === 'vacuum_bin_sensor') {
    return [make('Empty the vacuum bin', 'low', 1, 10, { type: 'state', entityId, to: ['on'] })];
  }
  const [kind, mode] = preset.split('_') as [keyof typeof APPLIANCES, 'power' | 'state'];
  const a = APPLIANCES[kind];
  const rule: Rule =
    mode === 'power'
      ? { type: 'power_below', entityId, runningAboveW: 10, idleBelowW: 3, forMinutes: 3 }
      : { type: 'state', entityId, to: opts.doneStates ?? DEFAULT_DONE_STATES };
  return [make(a.title, a.energy, a.minutes, a.xp, rule)];
}
