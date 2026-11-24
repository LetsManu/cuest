import type { Bus } from '../bus.js';
import type { BridgeHub } from '../bridge/hub.js';
import { isQuiet, type Clock } from '../clock.js';
import { copy } from '../copy.js';
import { DEFAULT_NUDGE, type NudgeConfig, type Quest } from '../domain/types.js';
import type { PlayersRepo } from '../repos/players.js';
import type { QuestsRepo } from '../repos/quests.js';
import type { TemplatesRepo } from '../repos/templates.js';
import { QuestError, type QuestService } from './quests.js';

export type ActionVerb = 'START' | 'DONE' | 'LATER';

export function encodeAction(verb: ActionVerb, questId: string, playerId: string): string {
  return `CUEST|${verb}|${questId}|${playerId}`;
}

export function decodeAction(s: string): { verb: ActionVerb; questId: string; playerId: string } | null {
  const parts = s.split('|');
  if (parts.length !== 4 || parts[0] !== 'CUEST') return null;
  const [, verb, questId, playerId] = parts as [string, string, string, string];
  if (verb !== 'START' && verb !== 'DONE' && verb !== 'LATER') return null;
  if (!questId || !playerId) return null;
  return { verb, questId, playerId };
}

export interface NudgeDeps {
  bus: Bus;
  hub: Pick<BridgeHub, 'callService'>;
  quests: QuestService;
  questsRepo: QuestsRepo;
  templates: TemplatesRepo;
  players: PlayersRepo;
  clock: Clock;
  tz: string;
}

export class NudgeService {
  constructor(private deps: NudgeDeps) {
    const { bus } = deps;
    bus.on('quest:opened', (q) => this.onOpened(q));
    bus.on('quest:started', (q) => this.onResolved(q));
    bus.on('quest:done', (e) => this.onResolved(e.quest));
    bus.on('quest:whenever', (q) => this.onResolved(q));
  }

  tick(now: Date): void {
    for (const q of this.deps.questsRepo.listByStatus(['open'])) {
      try {
        this.tickQuest(q, now);
      } catch (err) {
        console.error(`nudge tick failed for quest ${q.id}`, err);
      }
    }
  }

  handleAction(action: string): void {
    const a = decodeAction(action);
    if (!a) {
      console.warn(`ignoring malformed nudge action: ${action}`);
      return;
    }
    try {
      if (a.verb === 'START') this.deps.quests.start(a.questId, a.playerId);
      else if (a.verb === 'DONE') this.deps.quests.done(a.questId, a.playerId);
      else this.deps.quests.later(a.questId, 60);
    } catch (err) {
      if (err instanceof QuestError) {
        console.warn(`ignoring stale nudge action ${a.verb} for quest ${a.questId}: ${err.code}`);
        return;
      }
      console.error('nudge action failed', err);
    }
  }

  private nudgeFor(q: Quest): NudgeConfig {
    if (!q.templateId) return { ...DEFAULT_NUDGE, notify: false };
    return this.deps.templates.get(q.templateId)?.nudge ?? { ...DEFAULT_NUDGE, notify: false };
  }

  private quiet(now: Date, n: NudgeConfig): boolean {
    return isQuiet(now, this.deps.tz, n.quietStart, n.quietEnd);
  }

  private onOpened(q: Quest): void {
    try {
      const nudge = this.nudgeFor(q);
      const now = this.deps.clock.now();
      if (nudge.notify && !this.quiet(now, nudge)) this.sendNotification(q, now, copy.newQuestTitle(q), copy.newQuestMessage(q));
      if (nudge.light) {
        this.deps.hub.callService('light', 'turn_on', { rgb_color: nudge.light.rgb }, { entity_id: nudge.light.entityId });
      }
    } catch (err) {
      console.error(`nudge on open failed for quest ${q.id}`, err);
    }
  }

  private tickQuest(q: Quest, now: Date): void {
    const nudge = this.nudgeFor(q);
    if (!nudge.notify) return;
    if (q.snoozedUntil && new Date(q.snoozedUntil).getTime() > now.getTime()) return;
    if (this.quiet(now, nudge)) return;
    if (q.nudgeCount === 0) {
      this.sendNotification(q, now, copy.newQuestTitle(q), copy.newQuestMessage(q));
    } else if (q.nudgeCount <= nudge.maxRepeats && q.lastNudgeAt) {
      const elapsed = now.getTime() - new Date(q.lastNudgeAt).getTime();
      if (elapsed >= nudge.repeatEveryMinutes * 60_000) {
        this.sendNotification(q, now, copy.newQuestTitle(q), copy.repeatMessage(q, q.nudgeCount));
      }
    }
  }

  private sendNotification(q: Quest, now: Date, title: string, message: string): void {
    for (const p of this.deps.players.list()) {
      if (!p.notifyService) continue;
      this.deps.hub.callService('notify', p.notifyService, {
        title,
        message,
        data: {
          tag: `cuest-${q.id}`,
          url: '/cuest',
          actions: [
            { action: encodeAction('START', q.id, p.id), title: copy.actions.start },
            { action: encodeAction('DONE', q.id, p.id), title: copy.actions.done },
            { action: encodeAction('LATER', q.id, p.id), title: copy.actions.later },
          ],
        },
      });
    }
    this.deps.questsRepo.update(q.id, { nudgeCount: q.nudgeCount + 1, lastNudgeAt: now.toISOString() });
  }

  private onResolved(q: Quest): void {
    try {
      const nudge = this.nudgeFor(q);
      if (nudge.notify) {
        for (const p of this.deps.players.list()) {
          if (!p.notifyService) continue;
          this.deps.hub.callService('notify', p.notifyService, { message: 'clear_notification', data: { tag: `cuest-${q.id}` } });
        }
      }
      if (nudge.light) {
        const entityId = nudge.light.entityId;
        const stillWaiting = this.deps.questsRepo
          .listByStatus(['open'])
          .some((o) => o.id !== q.id && this.nudgeFor(o).light?.entityId === entityId);
        if (!stillWaiting) this.deps.hub.callService('light', 'turn_off', {}, { entity_id: entityId });
      }
    } catch (err) {
      console.error(`nudge clear failed for quest ${q.id}`, err);
    }
  }
}
