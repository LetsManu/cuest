export const normalizeState = (s: string): string => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

export const DONE_WORDS: readonly string[] = [
  'finished', 'finish', 'program_ended', 'programme_ended', 'end', 'ended', 'complete', 'completed',
  'done', 'fertig', 'beendet', 'programmende', 'ende',
];
export const RUNNING_WORDS: readonly string[] = [
  'run', 'running', 'washing', 'wash', 'main_wash', 'rinse', 'rinsing', 'spin', 'spinning', 'drying', 'dry',
  'in_use', 'program_running', 'active', 'läuft', 'waschen', 'trocknen', 'spülen',
];
export const PAUSE_WORDS: readonly string[] = [
  'pause', 'paused', 'delayed_start', 'delayedstart', 'action_required', 'actionrequired', 'pausiert',
];

const DISHWASHER = ['dishwasher', 'dish_washer', 'geschirrspüler', 'geschirrspueler', 'spülmaschine', 'spuelmaschine'];
const DRYER = ['dryer', 'tumble', 'trockner'];
const WASHER = ['washer', 'washing', 'waschmaschine', 'laundry'];

export function classifyAppliance(text: string): 'dishwasher' | 'dryer' | 'washer' | null {
  const t = normalizeState(text);
  const has = (words: string[]) => words.some((w) => t.includes(w));
  if (has(DISHWASHER)) return 'dishwasher';
  if (has(WASHER)) return 'washer';
  if (has(DRYER)) return 'dryer';
  return null;
}
