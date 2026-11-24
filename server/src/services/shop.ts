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
  | 'no_chest_key'
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
  chestKeys: number;
  boostUntil: string | null;
  owned: Record<string, number>;
  equipped: Partial<Record<Slot, string>>;
  catalog: (ShopItem & { owned: boolean })[];
}

const POTION_MINUTES = 60;
const LOOT_CHANCE = 0.25;
const LOOT_MAX_COST = 60;

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
  private hub: Pick<BridgeHub, 'callServiceAwait' | 'isConnected'>;

  constructor(deps: {
    players: PlayersRepo;
    items: ItemsRepo;
    ledger: LedgerRepo;
    tx: <T>(fn: () => T) => T;
    clock: Clock;
    rng?: () => number;
    bus?: Bus;
    unlocks: UnlocksRepo;
    hub: Pick<BridgeHub, 'callServiceAwait' | 'isConnected'>;
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

  async buyTreat(playerId: string, itemId: string): Promise<BuyResult> {
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
    const res = await this.hub.callServiceAwait(domainOf(entityId), 'turn_on', {}, { entity_id: entityId });
    if (!res.ok) {
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
    // treats are asynchronous: use buyTreat()
    if (itemId.startsWith('treat:')) throw new ShopError('unknown_item');
    const item = findItem(itemId);
    if (!item || item.lootOnly) throw new ShopError('unknown_item');
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
      case 'mystery_chest':
        return this.drawChest(player.id, owned, false);
      default:
        this.items.grant(player.id, item.id);
        return { kind: 'item', itemId: item.id };
    }
  }

  /**
   * Mystery chest draw. Loot-only items are never in the chest, they stay drops.
   * A free (key) chest writes a ledger row only for gold, always a positive one.
   */
  private drawChest(playerId: string, owned: Record<string, number>, viaKey: boolean): BuyResult['result'] {
    const unowned = CATALOG.filter((i) => i.kind === 'wardrobe' && !i.lootOnly && !(owned[i.id] ?? 0));
    const wantItem = this.rng() < 0.5 && unowned.length > 0;
    if (wantItem) {
      const pick = unowned[Math.min(unowned.length - 1, Math.floor(this.rng() * unowned.length))] as ShopItem;
      this.items.grant(playerId, pick.id);
      return { kind: 'chest', itemId: pick.id };
    }
    const gold = 20 + Math.floor(this.rng() * 61);
    this.players.addRewards(playerId, 0, gold);
    this.ledger.add({
      playerId,
      questId: null,
      kind: 'purchase',
      xp: 0,
      gold,
      at: this.clock.now().toISOString(),
      meta: { itemId: 'mystery_chest', ...(viaKey ? { chestKey: true } : { chestReward: true }) },
    });
    return { kind: 'chest', gold };
  }

  /** Spends one chest key (earned every 5 quests) on a free mystery chest. */
  openChest(playerId: string): BuyResult {
    const out = this.tx((): BuyResult => {
      if (!this.players.get(playerId)) throw new ShopError('unknown_player');
      if (!this.players.consumeChestKey(playerId)) throw new ShopError('no_chest_key');
      const result = this.drawChest(playerId, this.items.owned(playerId), true);
      return { player: this.players.get(playerId) as Player, result };
    });
    this.bus?.emit('shop:changed', { playerId });
    return out;
  }

  /**
   * Loot drop after a quest: 25 % (always when guaranteed) for a random item the player
   * does not own yet, from wardrobe + decor costing at most 60 (loot-only items cost 0).
   * Runs inside the quest-done transaction; returns the granted item id or null.
   */
  rollLoot(playerId: string, guaranteed: boolean): string | null {
    if (!guaranteed && this.rng() >= LOOT_CHANCE) return null;
    const owned = this.items.owned(playerId);
    const pool = CATALOG.filter((i) => (i.kind === 'wardrobe' || i.kind === 'decor') && i.cost <= LOOT_MAX_COST && !(owned[i.id] ?? 0));
    if (pool.length === 0) return null;
    const pick = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))] as ShopItem;
    this.items.grant(playerId, pick.id);
    return pick.id;
  }

  /** The collection book: every wardrobe and decor item, loot-only included. */
  collection(playerId: string): { id: string; kind: 'wardrobe' | 'decor'; name: string; owned: boolean; lootOnly: boolean; slot?: string; palette?: Record<string, string> }[] {
    if (!this.players.get(playerId)) throw new ShopError('unknown_player');
    const owned = this.items.owned(playerId);
    return CATALOG.filter((i) => i.kind === 'wardrobe' || i.kind === 'decor').map((i) => {
      const has = (owned[i.id] ?? 0) > 0;
      return {
        id: i.id,
        kind: i.kind as 'wardrobe' | 'decor',
        name: i.name,
        owned: has,
        lootOnly: i.lootOnly === true,
        // Only owned wardrobe items need a preview.
        ...(has && i.kind === 'wardrobe' ? { slot: i.slot, palette: i.palette } : {}),
      };
    });
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
      chestKeys: player.chestKeys,
      boostUntil: player.boostUntil,
      owned,
      equipped: this.items.equipped(playerId),
      catalog: [
        ...CATALOG.filter((i) => !i.lootOnly).map((i) => ({ ...i, owned: (owned[i.id] ?? 0) > 0 })),
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
