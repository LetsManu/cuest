import { randomUUID } from 'node:crypto';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private current: Date;
  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(d: Date): void {
    this.current = new Date(d.getTime());
  }
  advance(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(
  d: Date,
  tz: string,
): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour) % 24,
    mm: Number(p.minute),
    weekday: WEEKDAYS[p.weekday as string] as number,
  };
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h as number) * 60 + (m as number);
}

export function isQuiet(now: Date, tz: string, start: string, end: string): boolean {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (s === e) return false;
  const { hh, mm } = localParts(now, tz);
  const cur = hh * 60 + mm;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

export function newId(): string {
  return randomUUID();
}
