import type { HomeAssistant } from './hass-types';
import { STRINGS } from './strings';

export interface WhoAmI {
  playerId: string | null;
  isAdmin: boolean;
  players: { id: string; name: string }[];
}
export interface Quest {
  id: string;
  title: string;
  minutes: number;
  xp: number;
  gold: number;
  status: string;
  createdAt: string;
  startedAt: string | null;
  claimedBy: string | null;
  templateId: string | null;
  snoozedUntil: string | null;
}
export interface QuestLists { active: Quest[]; open: Quest[]; whenever: Quest[] }
export interface Summary {
  player: { id: string; name: string; xp: number; gold: number; restTokens: number; boostUntil: string | null };
  level: number;
  title: string;
  intoLevel: number;
  toNext: number;
}
export interface ShopItem { id: string; kind: string; name: string; cost: number; slot?: string; palette?: Record<string, string>; [k: string]: unknown }
export interface ShopView {
  gold: number;
  restTokens: number;
  boostUntil: string | null;
  owned: string[];
  equipped: Record<string, string | undefined>;
  catalog: ShopItem[];
}

/** An API failure carrying the server's friendly message. */
export class CuestApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
  get offline(): boolean {
    return this.status === 503 || this.code === 'bridge_offline';
  }
}

/** Read the status, code and message out of whatever callApi rejected with. */
export function toApiError(e: unknown): CuestApiError {
  if (e instanceof CuestApiError) return e;
  const o = (e ?? {}) as Record<string, any>;
  let body: any = o.body ?? o.error ?? o.data ?? null;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = { message: body }; }
  }
  const status = Number(o.status_code ?? o.status ?? body?.status ?? 0) || 0;
  const code = String(body?.error ?? o.code ?? '');
  const offline = status === 503 || code === 'bridge_offline';
  const message = offline
    ? STRINGS.offlineBanner
    : (typeof body?.message === 'string' && body.message) || (typeof o.message === 'string' && status !== 0 && o.message) || STRINGS.genericError;
  return new CuestApiError(status, code, message);
}

export class CuestApi {
  constructor(private hass: HomeAssistant) {}

  setHass(hass: HomeAssistant) { this.hass = hass; }

  private async call<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    try {
      if (!this.hass.callApi) throw new CuestApiError(0, 'no_api', STRINGS.genericError);
      return await this.hass.callApi<T>(method, path, body);
    } catch (e) {
      throw toApiError(e);
    }
  }

  whoami() { return this.call<WhoAmI>('GET', 'cuest_whoami'); }
  quests() { return this.call<QuestLists>('GET', 'cuest/quests'); }
  summary(playerId: string) { return this.call<Summary>('GET', `cuest/players/${encodeURIComponent(playerId)}/summary`); }
  shop(playerId: string) { return this.call<ShopView>('GET', `cuest/shop?playerId=${encodeURIComponent(playerId)}`); }
  start(questId: string, playerId: string) { return this.call<{ quest: Quest }>('POST', `cuest/quests/${encodeURIComponent(questId)}/start`, { playerId }); }
  done(questId: string, playerId: string) { return this.call<{ quest: Quest; reward: unknown; player: Summary['player'] }>('POST', `cuest/quests/${encodeURIComponent(questId)}/done`, { playerId }); }
  later(questId: string) { return this.call<{ quest: Quest }>('POST', `cuest/quests/${encodeURIComponent(questId)}/later`, {}); }
  buy(playerId: string, itemId: string) { return this.call<unknown>('POST', 'cuest/shop/buy', { playerId, itemId }); }
  equip(playerId: string, slot: string, itemId: string | null) { return this.call<unknown>('POST', 'cuest/shop/equip', { playerId, slot, itemId }); }
}
