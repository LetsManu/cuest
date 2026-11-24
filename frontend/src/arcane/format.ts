import { html, type TemplateResult } from 'lit';

/** "light.kitchen" -> "light". */
export const domainOf = (id: string): string => id.slice(0, Math.max(0, id.indexOf('.')));

/** Digits in Inter 700 tabular (class `num`), words stay in the surrounding face. */
export const withNums = (s: string): TemplateResult[] =>
  s.split(/(\d+)/).map((part, i) => (i % 2 ? html`<span class="num">${part}</span>` : html`${part}`));

/** A finite number from a state or attribute, otherwise null. */
export function num(state: unknown): number | null {
  if (typeof state === 'number') return Number.isFinite(state) ? state : null;
  if (typeof state !== 'string' || state.trim() === '') return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

export function fmtNumber(v: number | null, lang = 'en', digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const s = new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v);
  return /^[-−]0$/.test(s) ? '0' : s;
}

export function fmtTemp(v: number | null, lang = 'en'): string {
  return v === null ? '—' : `${fmtNumber(v, lang)}°`;
}

export function fmtPercent(p: number | null): string {
  return p === null || !Number.isFinite(p) ? '—' : `${Math.round(p)}%`;
}

/** "Tuesday 16:40" in `timeZone` (an IANA name), or in the browser's zone when it is missing or unknown. */
export function clockLine(d: Date, lang = 'en', timeZone?: string): string {
  let tz = timeZone;
  try {
    if (tz) new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    tz = undefined;
  }
  const day = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
  return `${day} ${time}`;
}

/** Home Assistant's own zone unless the user's profile asks for the browser's ("local"). */
export function clockZone(locale: { time_zone?: string } | undefined, config: { time_zone?: string } | undefined): string | undefined {
  return locale?.time_zone === 'local' ? undefined : config?.time_zone || undefined;
}

export function toCelsius(v: number, unit: unknown): number {
  return unit === '°F' ? ((v - 32) * 5) / 9 : v;
}
