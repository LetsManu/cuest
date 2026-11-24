import type { StateEvent, QuestTemplate } from '../domain/types.js';
import type { TemplatesRepo } from '../repos/templates.js';
import type { QuestService } from './quests.js';

interface PowerState {
  running: boolean;
  belowSince: Date | null;
}

const IGNORED = new Set(['unavailable', 'unknown']);

export class RuleEngine {
  private templates: TemplatesRepo;
  private quests: QuestService;
  private power = new Map<string, PowerState>();

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
    for (const t of this.ruled()) {
      const rule = t.rule!;
      if (rule.entityId !== ev.entityId) continue;
      if (rule.type === 'state') {
        if (
          rule.to.includes(ev.newState) &&
          ev.newState !== ev.oldState &&
          (!rule.from || (ev.oldState !== null && rule.from.includes(ev.oldState)))
        ) {
          this.fire(t);
        }
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
