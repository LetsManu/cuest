import type { HomeAssistant } from '../hass-types';
import { num } from './format';

export interface Sample {
  /** Milliseconds since the epoch. */
  t: number;
  /** null for states that are not numbers. */
  v: number | null;
}

interface RawEntry {
  s?: unknown;
  lu?: unknown;
  state?: unknown;
  last_updated?: unknown;
}

const MAX_POINTS = 48;

function toSample(e: RawEntry): Sample | null {
  const secs = typeof e.lu === 'number' ? e.lu : null;
  const ms = secs !== null ? Math.round(secs * 1000) : typeof e.last_updated === 'string' ? Date.parse(e.last_updated) : NaN;
  if (!Number.isFinite(ms)) return null;
  return { t: ms, v: num(e.s ?? e.state) };
}

/** One `history/history_during_period` call for all entities (minimal, no attributes). */
export async function fetchHistory(
  h: HomeAssistant,
  entityIds: string[],
  start: Date,
  end: Date,
): Promise<Record<string, Sample[]>> {
  const res = await h.callWS<Record<string, RawEntry[]> | null | undefined>({
    type: 'history/history_during_period',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    entity_ids: entityIds,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  const out: Record<string, Sample[]> = {};
  for (const id of entityIds) {
    const rows = res && Array.isArray(res[id]) ? res[id] : [];
    out[id] = rows.map(toSample).filter((x): x is Sample => x !== null);
  }
  return out;
}

/** Step-function resample: point i sits at start + (i + 1)·span/points and takes the last sample at or before it. */
export function resample(samples: Sample[], start: number, end: number, points = MAX_POINTS): (number | null)[] {
  const n = Math.max(0, Math.min(Math.floor(points), MAX_POINTS));
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const out: (number | null)[] = [];
  let k = -1;
  for (let i = 0; i < n; i++) {
    const at = start + ((i + 1) * (end - start)) / n;
    while (k + 1 < sorted.length && sorted[k + 1].t <= at) k++;
    out.push(k < 0 ? null : sorted[k].v);
  }
  return out;
}

export interface TrailGeometry {
  segments: string[][];
  area: string;
  last: { x: number; y: number } | null;
  min: number;
  max: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function trailGeometry(series: (number | null)[][], w = 326, h = 110, pad = 0.08): TrailGeometry | null {
  const all = series.flat().filter((x): x is number => x !== null && Number.isFinite(x));
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const lo = min === max ? min - 0.5 : min;
  const hi = min === max ? max + 0.5 : max;
  const top = pad * h;
  const span = h - 2 * top;
  const y = (v: number): number => r2(h - top - ((v - lo) / (hi - lo)) * span);

  const segments: string[][] = [];
  const runs: { x: number; y: number }[][][] = [];
  let last: { x: number; y: number } | null = null;
  series.forEach((s, si) => {
    const x = (i: number): number => r2(s.length < 2 ? w : (i * w) / (s.length - 1));
    const sRuns: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    s.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (cur.length) sRuns.push(cur);
        cur = [];
      } else {
        cur.push({ x: x(i), y: y(v) });
      }
    });
    if (cur.length) sRuns.push(cur);
    runs.push(sRuns);
    segments.push(sRuns.map((r) => r.map((p) => `${p.x},${p.y}`).join(' ')));
    if (si === 0 && sRuns.length) last = sRuns[sRuns.length - 1][sRuns[sRuns.length - 1].length - 1];
  });

  const area = (runs[0] ?? [])
    .map((r) => `M${r.map((p) => `${p.x},${p.y}`).join(' L')} L${r[r.length - 1].x},${h} L${r[0].x},${h} Z`)
    .join(' ');
  return { segments, area, last, min, max };
}
