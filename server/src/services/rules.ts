import type { StateEvent, QuestTemplate } from '../domain/types.js';
import type { TemplatesRepo } from '../repos/templates.js';
import { normalizeState } from '../domain/vocab.js';
import type { QuestService } from './quests.js';

interface PowerState {
  running: boolean;
  belowSince: Date | null;
}

interface StopState {
  running: boolean;
  stoppedSince: Date | null;
}

const IGNORED = new Set(['unavailable', 'unknown']);

export class RuleEngine {
  private templates: TemplatesRepo;
  private quests: QuestService;
  private power = new Map<string, PowerState>();
  private stops = new Map<string, StopState>();
  private lastGood = new Map<string, string>();

  constructor(deps: { templates: TemplatesRepo; quests: QuestService }) {
    this.templates = deps.templates;
    this.quests = deps.quests;
  }

  private ruled(): QuestTemplate[] {
    return this.templates.list({ enabledOnly: true }).filter((t) => t.rule !== null);
  }

  entities(): string[] {
    return [...new Set(this.ruled().map((t) => t.rule!.entityId))].sort();
  }

  onState(ev: StateEvent): void {
    if (IGNORED.has(ev.newState)) return;
    // A blip through unavailable/unknown must not look like a transition: compare with the last known good state.
    const reported = ev.oldState !== null && !IGNORED.has(ev.oldState) ? ev.oldState : null;
    const oldGood = reported ?? this.lastGood.get(ev.entityId) ?? null;
    this.lastGood.set(ev.entityId, ev.newState);
    for (const t of this.ruled()) {
      const rule = t.rule!;
      if (rule.entityId !== ev.entityId) continue;
      if (rule.type === 'state') {
        const n = rule.normalize ? normalizeState(ev.newState) : ev.newState;
        const o = oldGood !== null && rule.normalize ? normalizeState(oldGood) : oldGood;
        if (o !== null && rule.to.includes(n) && n !== o && (!rule.from || rule.from.includes(o))) {
          this.fire(t);
        }
      } else if (rule.type === 'running_stops') {
        const n = normalizeState(ev.newState);
        const num = ev.newState.trim() === '' ? NaN : Number(ev.newState);
        const s = this.stopFor(t.id);
        if (
          rule.runningStates.includes(n) ||
          n === 'on' ||
          (rule.numericAbove !== undefined && Number.isFinite(num) && num > rule.numericAbove)
        ) {
          s.running = true;
          s.stoppedSince = null;
        } else if (rule.pauseStates.includes(n)) {
          s.stoppedSince = null;
        } else if (s.running) {
          s.stoppedSince ??= ev.at;
        }
        this.checkStop(t, ev.at);
      } else {
        const w = ev.newState.trim() === '' ? NaN : Number(ev.newState);
        if (!Number.isFinite(w)) continue;
        const s = this.stateFor(t.id);
        if (w > rule.runningAboveW) {
          s.running = true;
          s.belowSince = null;
        } else if (s.running && w < rule.idleBelowW) {
          s.belowSince ??= ev.at;
        } else {
          s.belowSince = null;
        }
        this.checkPower(t, ev.at);
      }
    }
  }

  tick(now: Date): void {
    for (const t of this.ruled()) {
      if (t.rule!.type === 'power_below') this.checkPower(t, now);
      else if (t.rule!.type === 'running_stops') this.checkStop(t, now);
    }
  }

  private stateFor(id: string): PowerState {
    let s = this.power.get(id);
    if (!s) {
      s = { running: false, belowSince: null };
      this.power.set(id, s);
    }
    return s;
  }

  private stopFor(id: string): StopState {
    let s = this.stops.get(id);
    if (!s) {
      s = { running: false, stoppedSince: null };
      this.stops.set(id, s);
    }
    return s;
  }

  private checkStop(t: QuestTemplate, now: Date): void {
    const rule = t.rule;
    if (rule?.type !== 'running_stops') return;
    const s = this.stopFor(t.id);
    if (s.running && s.stoppedSince && now.getTime() - s.stoppedSince.getTime() >= rule.forMinutes * 60_000) {
      s.running = false;
      s.stoppedSince = null;
      this.fire(t);
    }
  }

  private checkPower(t: QuestTemplate, now: Date): void {
    const rule = t.rule;
    if (rule?.type !== 'power_below') return;
    const s = this.stateFor(t.id);
    if (s.running && s.belowSince && now.getTime() - s.belowSince.getTime() >= rule.forMinutes * 60_000) {
      s.running = false;
      s.belowSince = null;
      this.fire(t);
    }
  }

  private fire(t: QuestTemplate): void {
    this.quests.open({
      templateId: t.id,
      title: t.title,
      energy: t.energy,
      minutes: t.minutes,
      xp: t.xp,
      gold: t.gold,
      wheneverAfterHours: t.wheneverAfterHours,
    });
  }
}
