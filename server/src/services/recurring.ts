import { localParts, minutesOfDay } from '../clock.js';
import type { Schedule } from '../domain/types.js';
import type { TemplatesRepo } from '../repos/templates.js';
import type { QuestService } from './quests.js';

const DAY_MS = 86_400_000;

/** Convert a local wall-clock time in `tz` to a UTC instant (corrects once for DST edges). */
function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    ts -= shown - wall;
  }
  return new Date(ts);
}

/** Most recent occurrence of the schedule at or before `now`, or null if none within the search window. */
export function lastOccurrence(schedule: Schedule, now: Date, tz: string): Date | null {
  const today = localParts(now, tz);
  const mins = minutesOfDay(schedule.time);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const span = schedule.type === 'weekly' ? 7 : schedule.n;
  const start = schedule.type === 'every_n_days' ? Date.parse(`${schedule.startDate}T00:00:00Z`) : 0;
  for (let back = 0; back <= span; back++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d - back));
    const matches =
      schedule.type === 'weekly'
        ? schedule.days.includes(day.getUTCDay())
        : day.getTime() >= start && Math.round((day.getTime() - start) / DAY_MS) % schedule.n === 0;
    if (!matches) continue;
    const at = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (at.getTime() <= now.getTime()) return at;
  }
  return null;
}

export class RecurringScheduler {
  private templates: TemplatesRepo;
  private quests: QuestService;
  private tz: string;

  constructor(deps: { templates: TemplatesRepo; quests: QuestService; tz: string }) {
    this.templates = deps.templates;
    this.quests = deps.quests;
    this.tz = deps.tz;
  }

  tick(now: Date): void {
    for (const t of this.templates.list({ enabledOnly: true })) {
      if (!t.schedule) continue;
      const occ = lastOccurrence(t.schedule, now, this.tz);
      if (!occ) continue;
      if (t.lastSpawnedAt && occ.getTime() <= Date.parse(t.lastSpawnedAt)) continue;
      this.quests.open({
        templateId: t.id,
        title: t.title,
        energy: t.energy,
        minutes: t.minutes,
        xp: t.xp,
        gold: t.gold,
        wheneverAfterHours: t.wheneverAfterHours,
      });
      this.templates.update(t.id, { lastSpawnedAt: now.toISOString() });
    }
  }
}
