import type { EntityInfo } from '../bridge/protocol.js';
import { presetTemplates } from '../domain/presets.js';
import type { QuestTemplate, Rule } from '../domain/types.js';
import { classifyAppliance, DONE_WORDS, normalizeState, PAUSE_WORDS, RUNNING_WORDS } from '../domain/vocab.js';

export type TemplateDraft = Omit<QuestTemplate, 'id' | 'createdAt' | 'lastSpawnedAt'>;
type Kind = 'washer' | 'dryer' | 'dishwasher';

export interface Suggestion {
  key: string;
  kind: Kind | 'vacuum';
  deviceName: string;
  entityId: string;
  method: 'finished_state' | 'running_stops' | 'power' | 'vacuum_state' | 'bin_sensor';
  templates: TemplateDraft[];
}

const STATE_KEYS = new Set([
  'operation_state', 'status', 'job_state', 'machine_state', 'run_state', 'current_status', 'program_phase',
]);

const withRule = (kind: Kind, rule: Rule): TemplateDraft[] => {
  const base = presetTemplates(`${kind}_state`, { entityId: rule.entityId })[0]!;
  return [{ ...base, rule }];
};

const norm = (s: string | null | undefined): string => (s ? normalizeState(s) : '');

function classify(group: EntityInfo[]): Kind | null {
  const first = group[0]!;
  const device = classifyAppliance([first.deviceName, first.model].filter(Boolean).join(' '));
  if (device) return device;
  return classifyAppliance(
    group.flatMap((e) => [e.entityId, e.name, e.translationKey]).filter(Boolean).join(' '),
  );
}

function applianceSuggestion(kind: Kind, group: EntityInfo[], deviceName: string): Suggestion | null {
  const mk = (e: EntityInfo, method: Suggestion['method'], templates: TemplateDraft[]): Suggestion => ({
    key: `${method}:${e.entityId}`, kind, deviceName, entityId: e.entityId, method, templates,
  });
  const running = (e: EntityInfo, forMinutes: number) =>
    mk(e, 'running_stops', withRule(kind, {
      type: 'running_stops', entityId: e.entityId, runningStates: [...RUNNING_WORDS],
      pauseStates: [...PAUSE_WORDS], forMinutes,
    }));

  for (const e of group) {
    if (e.domain !== 'sensor') continue;
    const done = (e.options ?? []).map(normalizeState).filter((o) => DONE_WORDS.includes(o));
    if (done.length > 0 || (e.translationKey !== null && STATE_KEYS.has(e.translationKey))) {
      const to = done.length > 0 ? [...new Set(done)] : [...DONE_WORDS];
      return mk(e, 'finished_state', withRule(kind, { type: 'state', entityId: e.entityId, to, normalize: true }));
    }
  }
  const bins = group.filter((e) => e.domain === 'binary_sensor');
  const b1 = bins.find((e) => e.deviceClass === 'running' || e.deviceClass === 'power');
  if (b1) return running(b1, 2);
  const b2 = bins.find((e) => e.deviceClass === 'vibration');
  if (b2) return running(b2, 5);
  const p = group.find((e) => e.domain === 'sensor' && e.deviceClass === 'power' && e.unit === 'W');
  if (p) return mk(p, 'power', presetTemplates(`${kind}_power`, { entityId: p.entityId }));
  const s = group.find((e) => e.domain === 'sensor' && e.state !== null && RUNNING_WORDS.includes(normalizeState(e.state)));
  if (s) return running(s, 3);
  return null;
}

export function detect(entities: EntityInfo[]): Suggestion[] {
  const groups = new Map<string, EntityInfo[]>();
  for (const e of entities) {
    const k = e.deviceId ?? `entity:${e.entityId}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const appliances: Suggestion[] = [];
  const vacuums: Suggestion[] = [];
  for (const group of groups.values()) {
    const kind = classify(group);
    if (kind) {
      const s = applianceSuggestion(kind, group, group[0]!.deviceName ?? group[0]!.name ?? group[0]!.entityId);
      if (s) appliances.push(s);
    }
    for (const e of group) {
      const deviceName = e.deviceName ?? e.name ?? e.entityId;
      if (e.domain === 'vacuum') {
        vacuums.push({
          key: `vacuum_state:${e.entityId}`, kind: 'vacuum', deviceName, entityId: e.entityId,
          method: 'vacuum_state', templates: presetTemplates('vacuum', { entityId: e.entityId }),
        });
      } else if (e.domain === 'binary_sensor') {
        const t = `${norm(e.translationKey)} ${norm(e.name)}`;
        if (t.includes('bin_full') || t.includes('dustbin')) {
          vacuums.push({
            key: `bin_sensor:${e.entityId}`, kind: 'vacuum', deviceName, entityId: e.entityId,
            method: 'bin_sensor', templates: presetTemplates('vacuum_bin_sensor', { entityId: e.entityId }),
          });
        }
      }
    }
  }
  return [...appliances, ...vacuums];
}
