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

/** "Tuesday 16:40" */
export function clockLine(d: Date, lang = 'en'): string {
  const day = new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(d);
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day} ${time}`;
}

export function toCelsius(v: number, unit: unknown): number {
  return unit === '°F' ? ((v - 32) * 5) / 9 : v;
}
