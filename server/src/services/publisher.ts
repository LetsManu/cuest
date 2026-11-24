import type { BridgeHub } from '../bridge/hub.js';
import type { SnapshotPlayer, SnapshotQuest } from '../bridge/protocol.js';
import type { Bus } from '../bus.js';
import type { Clock } from '../clock.js';
import { levelForXp, titleForLevel } from '../domain/levels.js';
import type { ItemsRepo } from '../repos/items.js';
import { findItem } from '../shop/catalog.js';
import type { PlayersRepo } from '../repos/players.js';
import type { QuestService } from './quests.js';

/** Pushes the game state and notable events to the Home Assistant bridge. */
export class Publisher {
  private readonly hub: Pick<BridgeHub, 'send'>;
  private readonly players: PlayersRepo;
  private readonly quests: QuestService;
  private readonly items: ItemsRepo;

  constructor(deps: {
    bus: Bus;
    hub: Pick<BridgeHub, 'send'> & Partial<Pick<BridgeHub, 'onAuthenticated'>>;
    players: PlayersRepo;
    quests: QuestService;
    items: ItemsRepo;
    clock: Clock;
  }) {
    this.hub = deps.hub;
    this.players = deps.players;
    this.quests = deps.quests;
    this.items = deps.items;
    const snap = (): void => this.publishSnapshot();

    deps.bus.on('quest:opened', (q) => {
      snap();
      this.hub.send({
        type: 'fire_event',
        event: 'cuest_quest_opened',
        data: { quest_id: q.id, title: q.title, xp: q.xp, minutes: q.minutes },
      });
    });
    deps.bus.on('quest:started', snap);
    deps.bus.on('quest:whenever', snap);
    deps.bus.on('quest:snoozed', snap);
    deps.bus.on('shop:changed', snap);
    deps.bus.on('quest:done', ({ quest, reward, player }) => {
      snap();
      this.hub.send({
        type: 'fire_event',
        event: 'cuest_quest_done',
        data: {
          quest_id: quest.id,
          title: quest.title,
          player_id: player.id,
          player_name: player.name,
          xp: reward.xp,
          gold: reward.gold,
        },
      });
      const before = levelForXp(player.xp - reward.xp).level;
      const after = levelForXp(player.xp).level;
      if (after > before) {
        this.hub.send({
          type: 'fire_event',
          event: 'cuest_level_up',
          data: { player_id: player.id, player_name: player.name, level: after, title: titleForLevel(after) },
        });
      }
    });
    deps.hub.onAuthenticated?.(snap);
  }

  publishSnapshot(): void {
    const players: SnapshotPlayer[] = this.players.list().map((p) => {
      const { level, intoLevel, toNext } = levelForXp(p.xp);
      const equipped = this.items.equipped(p.id);
      const owned = this.items.owned(p.id);
      const palette: Record<string, string> = {};
      for (const slot of ['hood', 'scarf', 'broom'] as const) {
        const id = equipped[slot];
        if (id) Object.assign(palette, findItem(id)?.palette ?? {});
      }
      return {
        id: p.id, name: p.name, haPerson: p.haPerson, level, title: titleForLevel(level),
        xp: p.xp, gold: p.gold, intoLevel, toNext,
        outfit: {
          items: { hood: equipped.hood ?? null, scarf: equipped.scarf ?? null, broom: equipped.broom ?? null },
          palette,
        },
        decor: Object.keys(owned).filter((id) => (owned[id] ?? 0) > 0 && findItem(id)?.kind === 'decor'),
        restTokens: p.restTokens,
        boostUntil: p.boostUntil,
      };
    });
    const v = this.quests.listVisible();
    const quests: SnapshotQuest[] = [...v.active, ...v.open, ...v.whenever].map((q) => ({
      id: q.id,
      title: q.title,
      status: q.status as SnapshotQuest['status'],
      claimedBy: q.claimedBy,
      xp: q.xp,
      minutes: q.minutes,
      templateId: q.templateId,
      createdAt: q.createdAt,
    }));
    this.hub.send({ type: 'snapshot', players, quests });
  }
}
