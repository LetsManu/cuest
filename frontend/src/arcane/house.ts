import type { HassDevice, HassState, HomeAssistant } from '../hass-types';
import { playersFromSensors } from '../sensors';
import { ARCANE_COPY, fill } from './copy';
import { domainOf, fmtNumber, num, toCelsius } from './format';

const C = ARCANE_COPY;

function attr(s: HassState | undefined, key: string): unknown {
  return s?.attributes?.[key];
}

function lang(h: HomeAssistant): string {
  return h.locale?.language ?? 'en';
}

interface MemoEntry {
  deps: unknown[];
  value: unknown;
}
const MEMO = new WeakMap<object, Map<string, MemoEntry>>();

/**
 * Whole-house scans run once per `h.states` object (Home Assistant replaces it on every state change), per
 * options and per registry/language. Several cards on one dashboard then share one result. Callers must not
 * mutate what they get back.
 */
function memo<T>(h: HomeAssistant, name: string, opts: unknown, compute: () => T): T {
  let byStates = MEMO.get(h.states);
  if (!byStates) {
    byStates = new Map();
    MEMO.set(h.states, byStates);
  }
  const key = `${name}:${JSON.stringify(opts) ?? ''}`;
  const deps = [h.entities, h.devices, h.areas, h.locale?.language];
  const hit = byStates.get(key);
  if (hit && hit.deps.every((d, i) => d === deps[i])) return hit.value as T;
  const value = compute();
  byStates.set(key, { deps, value });
  return value;
}

/** Glob match on an entity id: `*` matches any run of characters, everything else is literal. */
export function matches(entityId: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(entityId));
}

export function deviceOf(h: HomeAssistant, entityId: string): HassDevice | null {
  const did = h.entities?.[entityId]?.device_id;
  return (did && h.devices?.[did]) || null;
}

/** The entity's own area, else its device's. */
export function areaOf(h: HomeAssistant, entityId: string): string | null {
  return h.entities?.[entityId]?.area_id || deviceOf(h, entityId)?.area_id || null;
}

function areaName(h: HomeAssistant, entityId: string): string | null {
  const a = areaOf(h, entityId);
  return a ? (h.areas?.[a]?.name ?? null) : null;
}

export function displayName(h: HomeAssistant, entityId: string): string {
  const d = deviceOf(h, entityId);
  const dev = d?.name_by_user || d?.name;
  if (dev) return dev;
  const fn = attr(h.states[entityId], 'friendly_name');
  if (typeof fn === 'string' && fn) return fn.replace(/ (Battery|Temperature)$/, '') || fn;
  return entityId;
}

export function isLightGroup(h: HomeAssistant, id: string): boolean {
  return (
    Array.isArray(attr(h.states[id], 'entity_id')) ||
    attr(h.states[id], 'is_hue_group') === true ||
    h.entities?.[id]?.platform === 'group' ||
    /^group$/i.test(deviceOf(h, id)?.model ?? '')
  );
}

export function lightStats(h: HomeAssistant, filter?: (id: string) => boolean): { on: number; total: number } {
  return filter ? countLights(h, filter) : memo(h, 'lights', null, () => countLights(h));
}

function countLights(h: HomeAssistant, filter?: (id: string) => boolean): { on: number; total: number } {
  let on = 0;
  let total = 0;
  for (const id of Object.keys(h.states)) {
    if (!id.startsWith('light.') || isLightGroup(h, id) || h.states[id].state === 'unavailable') continue;
    if (filter && !filter(id)) continue;
    total++;
    if (h.states[id].state === 'on') on++;
  }
  return { on, total };
}

const SKIPPED_DOMAINS = ['automation', 'script', 'scene', 'zone', 'sun', 'person', 'update'];

export function onlineShare(
  h: HomeAssistant,
  opts: { domains?: string[]; integrations?: string[]; exclude?: string[] },
): { online: number; total: number; pct: number | null } {
  return memo(h, 'online', opts, () => countOnline(h, opts));
}

function countOnline(
  h: HomeAssistant,
  opts: { domains?: string[]; integrations?: string[]; exclude?: string[] },
): { online: number; total: number; pct: number | null } {
  let online = 0;
  let total = 0;
  for (const id of Object.keys(h.states)) {
    const d = domainOf(id);
    if (opts.domains?.length ? !opts.domains.includes(d) : SKIPPED_DOMAINS.includes(d) || d.startsWith('input_')) continue;
    if (opts.integrations?.length && !opts.integrations.includes(h.entities?.[id]?.platform ?? '')) continue;
    if (opts.exclude?.length && matches(id, opts.exclude)) continue;
    total++;
    if (h.states[id].state !== 'unavailable') online++;
  }
  return { online, total, pct: total === 0 ? null : Math.round((100 * online) / total) };
}

export type FaultKind = 'battery_critical' | 'problem' | 'temperature' | 'battery_low' | 'update';

export interface Fault {
  id: string;
  kind: FaultKind;
  title: string;
  detail: string;
  xp: number;
  minutes: number;
  entityIds: string[];
}

const KIND_ORDER: FaultKind[] = ['battery_critical', 'problem', 'temperature', 'battery_low', 'update'];
const XP: Record<FaultKind, number> = { battery_critical: 30, problem: 20, temperature: 10, battery_low: 5, update: 10 };
const MINUTES: Record<FaultKind, number> = { battery_critical: 5, problem: 10, temperature: 5, battery_low: 5, update: 5 };

function fault(kind: FaultKind, f: Omit<Fault, 'kind' | 'xp' | 'minutes'>): Fault {
  return { ...f, kind, xp: XP[kind], minutes: MINUTES[kind] };
}

function isBatteryPct(s: HassState | undefined, id: string): boolean {
  return id.startsWith('sensor.') && attr(s, 'device_class') === 'battery' && attr(s, 'unit_of_measurement') === '%';
}

export interface FaultReport {
  faults: Fault[];
  checked: number;
  faultyEntities: number;
  health: number;
}

export function collectFaults(h: HomeAssistant, opts: { batteryThreshold: number; exclude: string[] }): FaultReport {
  return memo(h, 'faults', [opts.batteryThreshold, opts.exclude], () => findFaults(h, opts));
}

function findFaults(h: HomeAssistant, opts: { batteryThreshold: number; exclude: string[] }): FaultReport {
  const l = lang(h);
  const checked = new Set<string>();
  const faults: Fault[] = [];
  const batteryByDevice = new Map<string, Fault>();
  const problems: string[] = [];
  const impossible: { id: string; c: number }[] = [];

  for (const id of Object.keys(h.states).sort()) {
    if (matches(id, opts.exclude)) continue;
    const s = h.states[id];
    const cls = attr(s, 'device_class');
    if (isBatteryPct(s, id)) {
      const v = num(s.state);
      if (v === null) continue;
      checked.add(id);
      if (v > opts.batteryThreshold) continue;
      const kind: FaultKind = v <= 5 ? 'battery_critical' : 'battery_low';
      const f = fault(kind, {
        id: `battery:${id}`,
        title: fill(kind === 'battery_critical' ? C.batteryCritical : C.batteryLow, { name: displayName(h, id) }),
        detail: fill(C.batteryDetail, { n: fmtNumber(v, l, 0) }),
        entityIds: [id],
      });
      faults.push(f);
      const did = h.entities?.[id]?.device_id;
      if (did) batteryByDevice.set(did, f);
    } else if (id.startsWith('binary_sensor.') && cls === 'battery') {
      checked.add(id);
      if (s.state !== 'on') continue;
      const f = fault('battery_low', {
        id: `battery:${id}`,
        title: fill(C.batteryLow, { name: displayName(h, id) }),
        detail: C.batteryLowBinary,
        entityIds: [id],
      });
      faults.push(f);
      const did = h.entities?.[id]?.device_id;
      if (did) batteryByDevice.set(did, f);
    } else if (id.startsWith('binary_sensor.') && cls === 'problem') {
      checked.add(id);
      if (s.state === 'on') problems.push(id);
    } else if (id.startsWith('sensor.') && cls === 'temperature') {
      const v = num(s.state);
      if (v === null) continue;
      checked.add(id);
      const c = toCelsius(v, attr(s, 'unit_of_measurement'));
      if (c < -50 || c > 100) impossible.push({ id, c });
    } else if (id.startsWith('update.')) {
      checked.add(id);
      if (s.state !== 'on') continue;
      const inst = attr(s, 'installed_version');
      const latest = attr(s, 'latest_version');
      const fn = attr(s, 'friendly_name');
      faults.push(
        fault('update', {
          id: `update:${id}`,
          title: typeof fn === 'string' && fn ? fn : id,
          detail: inst && latest ? fill(C.updateDetail, { installed: String(inst), latest: String(latest) }) : C.updateDetailUnknown,
          entityIds: [id],
        }),
      );
    }
  }

  for (const { id, c } of impossible) {
    const host = batteryByDevice.get(h.entities?.[id]?.device_id ?? '');
    const v = fmtNumber(c, l, 1);
    if (host) {
      host.detail += fill(C.tempMerged, { v });
      host.entityIds.push(id);
    } else {
      faults.push(
        fault('temperature', {
          id: `temperature:${id}`,
          title: fill(C.tempOwn, { name: displayName(h, id) }),
          detail: fill(C.tempOwnDetail, { v }),
          entityIds: [id],
        }),
      );
    }
  }

  const byModel = new Map<string, string[]>();
  const loose: string[] = [];
  for (const id of problems) {
    const model = deviceOf(h, id)?.model;
    if (!model) loose.push(id);
    else byModel.set(model, [...(byModel.get(model) ?? []), id]);
  }
  const places = (ids: string[]): string => {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const a = areaName(h, id);
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return sorted.map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ');
  };
  const problemDetail = (p: string, one: boolean): string =>
    p ? fill(one ? C.problemDetailOne : C.problemDetail, { places: p }) : C.problemDetailNoArea;
  for (const [model, ids] of byModel) {
    if (ids.length < 2) {
      loose.push(...ids);
      continue;
    }
    const p = places(ids);
    faults.push(fault('problem', { id: `problem:model:${model}`, title: fill(C.problemGroup, { n: ids.length, model }), detail: problemDetail(p, false), entityIds: ids }));
  }
  for (const id of loose) {
    const p = places([id]);
    faults.push(fault('problem', { id: `problem:${id}`, title: fill(C.problemOne, { name: displayName(h, id) }), detail: problemDetail(p, true), entityIds: [id] }));
  }

  faults.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title));
  const faulty = new Set(faults.flatMap((f) => f.entityIds));
  const health = checked.size === 0 ? 100 : Math.round((100 * (checked.size - faulty.size)) / checked.size);
  return { faults, checked: checked.size, faultyEntities: faulty.size, health };
}

export interface Ally {
  platform: string;
  name: string;
  awake: number;
  total: number;
}

const ALLY_NAMES: Record<string, string> = {
  fritz: 'FRITZ!Box',
  fritzbox: 'FRITZ!Box',
  smartthings: 'SmartThings',
  tuya: 'Tuya',
  music_assistant: 'Music Assistant',
};

function titleCase(s: string): string {
  return s
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function restingAllies(h: HomeAssistant, opts: { ignore: string[]; minEntities: number; names?: Record<string, string> }): Ally[] {
  return memo(h, 'allies', opts, () => findAllies(h, opts));
}

function findAllies(h: HomeAssistant, opts: { ignore: string[]; minEntities: number; names?: Record<string, string> }): Ally[] {
  const groups = new Map<string, { total: number; down: number }>();
  for (const [id, e] of Object.entries(h.entities ?? {})) {
    const s = h.states[id];
    if (!e.platform || !s) continue;
    const g = groups.get(e.platform) ?? { total: 0, down: 0 };
    g.total++;
    if (s.state === 'unavailable') g.down++;
    groups.set(e.platform, g);
  }
  return [...groups]
    .filter(([p, g]) => !opts.ignore.includes(p) && g.total >= opts.minEntities && g.down * 2 >= g.total && g.down > 0)
    .sort((a, b) => b[1].down - a[1].down || a[0].localeCompare(b[0]))
    .map(([platform, g]) => ({ platform, name: opts.names?.[platform] ?? ALLY_NAMES[platform] ?? titleCase(platform), awake: g.total - g.down, total: g.total }));
}

export interface Battery {
  entityId: string;
  name: string;
  pct: number;
}

export function batteries(h: HomeAssistant, opts: { entities?: string[]; exclude: string[]; limit: number }): Battery[] {
  return memo(h, 'batteries', opts, () => findBatteries(h, opts));
}

function findBatteries(h: HomeAssistant, opts: { entities?: string[]; exclude: string[]; limit: number }): Battery[] {
  const ids = opts.entities?.length ? opts.entities : Object.keys(h.states).filter((id) => isBatteryPct(h.states[id], id));
  const out: Battery[] = [];
  for (const id of ids) {
    if (matches(id, opts.exclude) || !h.states[id]) continue;
    const pct = num(h.states[id].state);
    if (pct !== null) out.push({ entityId: id, name: displayName(h, id), pct });
  }
  out.sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
  return out.slice(0, opts.limit);
}

export interface RoomRow {
  areaId: string;
  name: string;
  temp: number | null;
  tempState: 'ok' | 'none' | 'battery' | 'check';
  lit: number;
}

type RoomConfig = string | { area: string; name?: string; temperature?: string };

function findArea(h: HomeAssistant, key: string): { area_id: string; name: string } | null {
  const k = key.trim().toLowerCase();
  const areas = Object.values(h.areas ?? {});
  return areas.find((a) => a.area_id.toLowerCase() === k) ?? areas.find((a) => a.name.toLowerCase() === k) ?? null;
}

function plausibleTemp(h: HomeAssistant, id: string): number | null {
  const s = h.states[id];
  const v = s ? num(s.state) : null;
  if (v === null) return null;
  const c = toCelsius(v, attr(s, 'unit_of_measurement'));
  return c < -50 || c > 100 ? null : c;
}

function deviceBatteryLow(h: HomeAssistant, entityId: string, threshold: number): boolean {
  const did = h.entities?.[entityId]?.device_id;
  if (!did) return false;
  return Object.keys(h.states).some((id) => {
    if (h.entities?.[id]?.device_id !== did) return false;
    const s = h.states[id];
    if (isBatteryPct(s, id)) {
      const v = num(s.state);
      return v !== null && v <= threshold;
    }
    return id.startsWith('binary_sensor.') && attr(s, 'device_class') === 'battery' && s.state === 'on';
  });
}

export function roomRows(h: HomeAssistant, opts: { areas?: RoomConfig[]; batteryThreshold: number }): RoomRow[] {
  return memo(h, 'rooms', opts, () => buildRooms(h, opts));
}

function buildRooms(h: HomeAssistant, opts: { areas?: RoomConfig[]; batteryThreshold: number }): RoomRow[] {
  const wanted: { area: { area_id: string; name: string }; name?: string; temperature?: string }[] = [];
  if (opts.areas?.length) {
    for (const c of opts.areas) {
      const cfg = typeof c === 'string' ? { area: c } : c;
      const area = findArea(h, cfg.area);
      if (area) wanted.push({ area, name: (cfg as { name?: string }).name, temperature: (cfg as { temperature?: string }).temperature });
    }
  } else {
    for (const area of Object.values(h.areas ?? {}).sort((a, b) => a.name.localeCompare(b.name))) wanted.push({ area });
  }
  return wanted.map(({ area, name, temperature }) => {
    const candidates = temperature
      ? h.states[temperature]
        ? [temperature]
        : []
      : Object.keys(h.states)
          .filter((id) => id.startsWith('sensor.') && attr(h.states[id], 'device_class') === 'temperature' && areaOf(h, id) === area.area_id)
          .sort();
    let temp: number | null = null;
    let tempState: RoomRow['tempState'] = 'none';
    if (candidates.length) {
      const good = candidates.find((id) => plausibleTemp(h, id) !== null);
      if (good) {
        temp = plausibleTemp(h, good);
        tempState = 'ok';
      } else {
        tempState = candidates.some((id) => deviceBatteryLow(h, id, opts.batteryThreshold)) ? 'battery' : 'check';
      }
    }
    return { areaId: area.area_id, name: name ?? area.name, temp, tempState, lit: lightStats(h, (id) => areaOf(h, id) === area.area_id).on };
  });
}

export interface HeroModel {
  name: string;
  level: number;
  title: string;
  into: number;
  span: number;
  remaining: number;
  pct: number;
  streak: number;
  chestKeys: number;
}

export function heroFor(h: HomeAssistant, playerId?: string): HeroModel | null {
  const players = playersFromSensors(h);
  const uid = h.user?.id;
  const p =
    (playerId ? players.find((x) => x.id === playerId) : undefined) ??
    (uid ? players.find((x) => x.person && h.states[x.person]?.attributes?.user_id === uid) : undefined) ??
    players[0];
  const level = p?.level as HassState | undefined;
  if (!p || !level) return null;
  const a = level.attributes ?? {};
  const into = Number(a.into_level) || 0;
  const span = Number(a.to_next) || 0;
  const streak = p.streak as HassState | undefined;
  return {
    name: (a.player_name as string) || '',
    level: parseInt(level.state, 10) || 1,
    title: (a.title as string) || '',
    into,
    span,
    remaining: Math.max(0, span - into),
    pct: span > 0 ? Math.max(0, Math.min(100, Math.round((100 * into) / span))) : 0,
    streak: num(streak?.state) ?? 0,
    chestKeys: Number(streak?.attributes?.chest_keys) || 0,
  };
}
