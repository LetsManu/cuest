import type { Player, ShopItem, Slot } from '../domain/types.js';
import type { Clock } from '../clock.js';
import type { Bus } from '../bus.js';
import type { PlayersRepo } from '../repos/players.js';
import type { ItemsRepo } from '../repos/items.js';
import type { LedgerRepo } from '../repos/ledger.js';
import type { UnlocksRepo } from '../repos/unlocks.js';
import type { BridgeHub } from '../bridge/hub.js';
import { CATALOG, findItem } from '../shop/catalog.js';

export type ShopErrorCode =
  | 'unknown_item'
  | 'already_owned'
  | 'not_enough_gold'
  | 'not_owned'
  | 'unknown_player'
  | 'bridge_offline';

export class ShopError extends Error {
  constructor(public readonly code: ShopErrorCode) {
    super(code);
    this.name = 'ShopError';
  }
}

export type BuyResult = {
  player: Player;
  result:
    | { kind: 'item'; itemId: string }
    | { kind: 'treat'; itemId: string }
    | { kind: 'rest_token' }
    | { kind: 'potion'; boostUntil: string }
    | { kind: 'chest'; itemId: string }
    | { kind: 'chest'; gold: number };
};

export interface ShopView {
  gold: number;
  restTokens: number;
  boostUntil: string | null;
  owned: Record<string, number>;
  equipped: Partial<Record<Slot, string>>;
  catalog: (ShopItem & { owned: boolean })[];
}

const POTION_MINUTES = 60;

const domainOf = (entityId: string): string => entityId.split('.')[0] as string;

export class ShopService {
  private players: PlayersRepo;
  private items: ItemsRepo;
  private ledger: LedgerRepo;
  private tx: <T>(fn: () => T) => T;
  private clock: Clock;
  private rng: () => number;
  private bus: Bus | undefined;
  private unlocks: UnlocksRepo;
  private hub: Pick<BridgeHub, 'callService' | 'isConnected'>;

  constructor(deps: {
    players: PlayersRepo;
    items: ItemsRepo;
    ledger: LedgerRepo;
    tx: <T>(fn: () => T) => T;
    clock: Clock;
    rng?: () => number;
    bus?: Bus;
    unlocks: UnlocksRepo;
    hub: Pick<BridgeHub, 'callService' | 'isConnected'>;
  }) {
    this.players = deps.players;
    this.items = deps.items;
    this.ledger = deps.ledger;
    this.tx = deps.tx;
    this.clock = deps.clock;
    this.rng = deps.rng ?? Math.random;
    this.bus = deps.bus;
    this.unlocks = deps.unlocks;
    this.hub = deps.hub;
  }

  private treatItem(itemId: string): { item: ShopItem; entityId: string } | null {
    if (!itemId.startsWith('treat:')) return null;
    const u = this.unlocks.get(itemId.slice('treat:'.length));
    if (!u || !u.enabled) return null;
    return { item: { id: itemId, kind: 'treat', name: u.name, cost: u.cost }, entityId: u.entityId };
  }

  private buyTreat(playerId: string, itemId: string): BuyResult {
    const treat = this.treatItem(itemId);
    if (!treat) throw new ShopError('unknown_item');
    if (!this.hub.isConnected()) throw new ShopError('bridge_offline');
    const { item, entityId } = treat;
    const out = this.tx((): BuyResult => {
      if (!this.players.get(playerId)) throw new ShopError('unknown_player');
      this.players.spendGold(playerId, item.cost);
      this.ledger.add({
        playerId,
        questId: null,
        kind: 'purchase',
        xp: 0,
        gold: -item.cost,
        at: this.clock.now().toISOString(),
        meta: { itemId },
      });
      return { player: this.players.get(playerId) as Player, result: { kind: 'treat', itemId } };
    });
    const ok = this.hub.callService(domainOf(entityId), 'turn_on', {}, { entity_id: entityId });
    if (!ok) {
      this.tx(() => {
        this.players.addRewards(playerId, 0, item.cost);
        this.ledger.add({
          playerId,
          questId: null,
          kind: 'purchase',
          xp: 0,
          gold: item.cost,
          at: this.clock.now().toISOString(),
          meta: { itemId, refund: true },
        });
      });
      this.bus?.emit('shop:changed', { playerId });
      throw new ShopError('bridge_offline');
    }
    this.bus?.emit('shop:changed', { playerId });
    return out;
  }

  buy(playerId: string, itemId: string): BuyResult {
    if (itemId.startsWith('treat:')) return this.buyTreat(playerId, itemId);
    const item = findItem(itemId);
    if (!item) throw new ShopError('unknown_item');
    const out = this.tx((): BuyResult => {
      const player = this.players.get(playerId);
      if (!player) throw new ShopError('unknown_player');
      const owned = this.items.owned(playerId);
      if ((item.kind === 'wardrobe' || item.kind === 'decor') && (owned[item.id] ?? 0) > 0) {
        throw new ShopError('already_owned');
      }
      this.players.spendGold(playerId, item.cost);
      const result = this.apply(player, item, owned);
      const now = this.clock.now();
      this.ledger.add({
        playerId,
        questId: null,
        kind: 'purchase',
        xp: 0,
        gold: -item.cost,
        at: now.toISOString(),
        meta: { itemId: item.id },
      });
      return { player: this.players.get(playerId) as Player, result };
    });
    this.bus?.emit('shop:changed', { playerId });
    return out;
  }

  private apply(player: Player, item: ShopItem, owned: Record<string, number>): BuyResult['result'] {
    switch (item.id) {
      case 'rest_token':
        this.players.addRestTokens(player.id, 1);
        return { kind: 'rest_token' };
      case 'xp_potion': {
        const now = this.clock.now().getTime();
        const cur = player.boostUntil ? new Date(player.boostUntil).getTime() : 0;
        const until = new Date(Math.max(now, cur) + POTION_MINUTES * 60_000).toISOString();
        this.players.setBoostUntil(player.id, until);
        return { kind: 'potion', boostUntil: until };
      }
      case 'mystery_chest': {
        const unowned = CATALOG.filter((i) => i.kind === 'wardrobe' && !(owned[i.id] ?? 0));
        const wantItem = this.rng() < 0.5 && unowned.length > 0;
        if (wantItem) {
          const pick = unowned[Math.min(unowned.length - 1, Math.floor(this.rng() * unowned.length))] as ShopItem;
          this.items.grant(player.id, pick.id);
          return { kind: 'chest', itemId: pick.id };
        }
        const gold = 20 + Math.floor(this.rng() * 61);
        this.players.addRewards(player.id, 0, gold);
        this.ledger.add({
          playerId: player.id,
          questId: null,
          kind: 'purchase',
          xp: 0,
          gold,
          at: this.clock.now().toISOString(),
          meta: { itemId: 'mystery_chest', chestReward: true },
        });
        return { kind: 'chest', gold };
      }
      default:
        this.items.grant(player.id, item.id);
        return { kind: 'item', itemId: item.id };
    }
  }

  equip(playerId: string, slot: Slot, itemId: string | null): Player {
    const player = this.players.get(playerId);
    if (!player) throw new ShopError('unknown_player');
    if (itemId !== null) {
      const item = findItem(itemId);
      if (!item || item.kind !== 'wardrobe' || item.slot !== slot) throw new ShopError('not_owned');
      if (!(this.items.owned(playerId)[itemId] ?? 0)) throw new ShopError('not_owned');
    }
    this.items.equip(playerId, slot, itemId);
    this.bus?.emit('shop:changed', { playerId });
    return player;
  }

  view(playerId: string): ShopView {
    const player = this.players.get(playerId);
    if (!player) throw new ShopError('unknown_player');
    const owned = this.items.owned(playerId);
    return {
      gold: player.gold,
      restTokens: player.restTokens,
      boostUntil: player.boostUntil,
      owned,
      equipped: this.items.equipped(playerId),
      catalog: [
        ...CATALOG.map((i) => ({ ...i, owned: (owned[i.id] ?? 0) > 0 })),
        ...this.unlocks.list({ enabledOnly: true }).map((u) => ({
          id: `treat:${u.id}`,
          kind: 'treat' as const,
          name: u.name,
          cost: u.cost,
          owned: false,
        })),
      ],
    };
  }
}
