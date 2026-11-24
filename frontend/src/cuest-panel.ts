import { LitElement, css, html, nothing, unsafeCSS } from 'lit';
import { CuestApi, toApiError, type BuyResult, type QuestLists, type Quest, type ShopItem, type ShopView, type Summary, type WhoAmI } from './api';
import type { HomeAssistant } from './hass-types';
import { COLORS, FONT_BODY, FONT_PIXEL } from './palette';
import { cuestSignature, playersFromSensors } from './sensors';
import type { Palette } from './sprite';
import { STRINGS } from './strings';
import { levelForXp, titleForLevel } from './levels';
import { heroStyles, heroView } from './views/hero';
import { questStyles, questView, rewardToast, toastStyles, type Reward } from './views/quest';
import { clock24, noticeToast, shopStyles, shopView, type ShopTab } from './views/shop';
import { villageStyles, villageView } from './views/village';

type View = 'village' | 'shop' | 'hero' | 'quest';
const STORE_KEY = 'cuest.player';
const REFRESH_MS = 30_000;

function readStored(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function clearStored() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}
function writeStored(id: string) {
  try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode: just don't remember */ }
}

export class CuestPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
    _who: { state: true },
    _playerId: { state: true },
    _summary: { state: true },
    _quests: { state: true },
    _view: { state: true },
    _questId: { state: true },
    _offline: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _poolOpen: { state: true },
    _loaded: { state: true },
    _switching: { state: true },
    _reward: { state: true },
    _tick: { state: true },
    _shop: { state: true },
    _shopTab: { state: true },
    _notice: { state: true },
  };

  static styles = [
    villageStyles,
    heroStyles,
    questStyles,
    toastStyles,
    shopStyles,
    css`
    :host{display:block;min-height:100%;background:${unsafeCSS(COLORS.parchment)};color:${unsafeCSS(COLORS.ink)};font-family:${unsafeCSS(FONT_BODY)};font-size:15px;box-sizing:border-box}
    *{box-sizing:border-box}
    .shell{max-width:720px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
    main{flex:1;padding:18px 16px 24px;display:flex;flex-direction:column;gap:14px}
    .menu{display:flex;align-items:center;min-height:44px}
    .banner{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.amber)};border-radius:12px;padding:10px 12px;font-weight:700;color:${unsafeCSS(COLORS.ink)}}
    .error{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:12px;padding:10px 12px}
    .centerbox{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:10px;line-height:1.45}
    h1,h2{font-family:${unsafeCSS(FONT_PIXEL)};margin:0;color:${unsafeCSS(COLORS.forest)}}
    .pick{display:flex;flex-direction:column;gap:8px}
    .pick button{min-height:44px;border-radius:12px;border:2px solid ${unsafeCSS(COLORS.line)};background:${unsafeCSS(COLORS.parchment)};font:inherit;font-weight:800;color:${unsafeCSS(COLORS.ink)};cursor:pointer}
    nav{position:sticky;bottom:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:${unsafeCSS(COLORS.card)};border-top:2px solid ${unsafeCSS(COLORS.line)}}
    nav button{background:none;border:none;min-height:54px;font:inherit;font-weight:700;color:${unsafeCSS(COLORS.muted)};font-size:14px;cursor:pointer}
    nav button[aria-current="page"]{color:${unsafeCSS(COLORS.forest)};font-weight:800;box-shadow:inset 0 3px 0 ${unsafeCSS(COLORS.forest)}}
    button:focus-visible{outline:3px solid ${unsafeCSS(COLORS.amber)};outline-offset:2px}
    .btn{border-radius:12px;min-height:44px;padding:0 14px;font:inherit;font-weight:800;border:2px solid #C9B791;background:transparent;color:#4A4033;cursor:pointer;align-self:flex-start}
  `];

  declare hass: HomeAssistant;
  declare narrow: boolean;
  declare route: unknown;
  declare panel: unknown;
  declare _who: WhoAmI | null;
  declare _playerId: string | null;
  declare _summary: Summary | null;
  declare _quests: QuestLists | null;
  declare _view: View;
  declare _questId: string | null;
  declare _offline: boolean;
  declare _error: string;
  declare _busy: Record<string, boolean>;
  declare _poolOpen: boolean;
  declare _loaded: boolean;
  declare _switching: boolean;
  declare _reward: Reward | null;
  declare _tick: number;
  declare _shop: ShopView | null;
  declare _shopTab: ShopTab;
  declare _notice: string;

  /** Injectable clock (ms) so tests can drive the quest timer. */
  now: () => number = () => Date.now();

  private _api: CuestApi | null = null;
  private _sig: string | null = null;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _loading = false;
  private _pending = false;
  private _qTimer: ReturnType<typeof setInterval> | undefined;
  private _toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.narrow = false;
    this._who = null;
    this._playerId = null;
    this._summary = null;
    this._quests = null;
    this._shop = null;
    this._view = 'village';
    this._questId = null;
    this._offline = false;
    this._error = '';
    this._busy = {};
    this._poolOpen = false;
    this._loaded = false;
    this._switching = false;
    this._reward = null;
    this._tick = 0;
    this._shop = null;
    this._shopTab = 'treat';
    this._notice = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void this._refresh(); }, REFRESH_MS);
    if (this._view === 'quest') this._armTick();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
    this._stopTick();
    clearTimeout(this._toastTimer);
  }

  protected updated(changed: Map<string, unknown>) {
    if (!changed.has('_view')) return;
    if (this._view === 'quest') {
      this._armTick();
    } else this._stopTick();
  }

  private _armTick() {
    if (!this._qTimer) this._qTimer = setInterval(() => { this._tick++; }, 1000);
  }

  private _stopTick() {
    clearInterval(this._qTimer);
    this._qTimer = undefined;
  }

  private _setReward(r: Reward | null) {
    clearTimeout(this._toastTimer);
    this._reward = r;
    this._notice = '';
    if (r) this._toastTimer = setTimeout(() => { this._reward = null; }, 8000);
  }

  private _setNotice(text: string) {
    clearTimeout(this._toastTimer);
    this._reward = null;
    this._notice = text;
    if (text) this._toastTimer = setTimeout(() => { this._notice = ''; }, 8000);
  }

  private _finish = (q: Quest) => {
    const pid = this._playerId;
    const api = this._api;
    if (!pid || !api) return;
    void this._act(q, async () => {
      const res = await api.done(q.id, pid);
      const r = res.reward as { xp: number; gold: number };
      const xp = res.player?.xp;
      const level = typeof xp === 'number' ? levelForXp(xp).level : 0;
      const up = typeof xp === 'number' && level > levelForXp(xp - r.xp).level;
      this._setReward({ xp: r.xp, gold: r.gold, level: up ? level : null, title: up ? titleForLevel(level) : '' });
    }, () => { this._view = 'village'; this._questId = null; });
  };

  protected willUpdate(changed: Map<string, unknown>) {
    if (!changed.has('hass') || !this.hass) return;
    if (this._api) this._api.setHass(this.hass);
    else this._api = new CuestApi(this.hass);
    const sig = cuestSignature(this.hass);
    const first = this._sig === null;
    if (first || sig !== this._sig) {
      this._sig = sig;
      void this._refresh();
    }
  }

  private async _refresh() {
    if (!this._api) return;
    if (this._loading) { this._pending = true; return; }
    this._loading = true;
    try {
      if (!this._who || !this._playerId) {
        this._who = await this._api.whoami();
        if (!this._playerId && !this._switching) this._playerId = this._choosePlayer(this._who);
      }
      this._offline = false;
      if (this._playerId) {
        const pid = this._playerId;
        const [summary, quests, shop] = await Promise.all([this._api.summary(pid), this._api.quests(), this._api.shop(pid)]);
        if (pid !== this._playerId) return;
        this._summary = summary;
        this._quests = quests;
        this._shop = Array.isArray(shop?.catalog) ? shop : null;
      }
      this._error = '';
    } catch (e) {
      const err = toApiError(e);
      if (err.offline) this._offline = true;
      else this._error = err.message;
    } finally {
      this._loaded = true;
      this._loading = false;
    }
    if (this._pending) { this._pending = false; await this._refresh(); }
  }

  private _choosePlayer(who: WhoAmI): string | null {
    const stored = readStored();
    if (stored && who.players.some((p) => p.id === stored)) return stored;
    return who.playerId;
  }

  private _pick(id: string) {
    writeStored(id);
    this._switching = false;
    this._playerId = id;
    this._summary = null;
    this._quests = null;
    this._shop = null;
    void this._refresh();
  }

  private _switch = () => {
    clearStored();
    this._switching = true;
    this._playerId = null;
    this._summary = null;
    this._quests = null;
    this._view = 'village';
  };

  private _menu() {
    return this.narrow ? html`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>` : nothing;
  }

  private async _act(q: Quest, fn: () => Promise<unknown>, after?: () => void) {
    this._busy = { ...this._busy, [q.id]: true };
    let failure = '';
    try {
      await fn();
      this._error = '';
      this._offline = false;
      after?.();
    } catch (e) {
      const err = toApiError(e);
      if (err.offline) this._offline = true;
      else failure = err.message;
    }
    const { [q.id]: _gone, ...rest } = this._busy;
    this._busy = rest;
    await this._refresh();
    if (failure) this._error = failure;
  }

  private _start = (q: Quest) => {
    const pid = this._playerId;
    if (!pid || !this._api) return;
    const api = this._api;
    // An already-running quest just opens; otherwise start it first.
    if (q.status === 'active') { this._questId = q.id; this._view = 'quest'; return; }
    void this._act(q, () => api.start(q.id, pid), () => { this._questId = q.id; this._view = 'quest'; });
  };

  private _later = (q: Quest) => {
    const api = this._api;
    if (api) void this._act(q, () => api.later(q.id));
  };

  /**
   * Outfit and decor come from ONE source: the shop view (`equipped` + catalog
   * palettes, `owned` decor), re-fetched on every refresh and after every buy or
   * equip, so changes show at once. Only before the first shop response do we fall
   * back to the level sensor's `outfit_palette` / `decor` attributes.
   */
  private _palette(): Palette {
    if (this._shop) {
      const pal: Palette = {};
      for (const id of Object.values(this._shop.equipped)) {
        const item = this._shop.catalog.find((c) => c.id === id);
        if (item?.palette) Object.assign(pal, item.palette);
      }
      return pal;
    }
    const a = this._sensorAttrs();
    return (a.outfit_palette as Palette | undefined) ?? {};
  }

  private _decor(): string[] {
    if (this._shop) return this._shop.catalog.filter((c) => c.kind === 'decor' && c.owned).map((c) => c.id);
    const a = this._sensorAttrs();
    return Array.isArray(a.decor) ? (a.decor as string[]) : [];
  }

  private _sensorAttrs(): Record<string, unknown> {
    const p = this._sensorPlayer();
    return (p?.level as { attributes?: Record<string, unknown> } | undefined)?.attributes ?? {};
  }

  private _boostUntil(): string | null {
    const b = this._summary?.player.boostUntil ?? this._shop?.boostUntil ?? null;
    return b && Date.parse(b) > this.now() ? b : null;
  }

  /** Run one shop call under a per-item busy flag (the double-tap guard), then refresh. */
  private async _shopAct(key: string, fn: () => Promise<string>) {
    if (this._busy[key]) return;
    this._busy = { ...this._busy, [key]: true };
    let msg = '';
    try {
      msg = await fn();
      this._error = '';
    } catch (e) {
      const err = toApiError(e);
      // A 503 with the server's own text is treat-specific ("Your gold is safe"): toast only.
      if (err.offline && !err.serverMessage) this._offline = true;
      else msg = err.serverMessage || err.message || STRINGS.shopFailed;
    }
    const { [key]: _gone, ...rest } = this._busy;
    this._busy = rest;
    await this._refresh();
    if (msg) this._setNotice(msg);
  }

  private _buy = (item: ShopItem) => {
    const pid = this._playerId;
    const api = this._api;
    if (!pid || !api) return;
    void this._shopAct(`shop:${item.id}`, async () => this._buyMessage(item, (await api.buy(pid, item.id)).result));
  };

  private _equip = (item: ShopItem) => {
    const pid = this._playerId;
    const api = this._api;
    if (!pid || !api || !item.slot) return;
    const slot = item.slot;
    const on = this._shop?.equipped[slot] === item.id;
    void this._shopAct(`shop:${item.id}`, async () => { await api.equip(pid, slot, on ? null : item.id); return ''; });
  };

  private _buyMessage(item: ShopItem, r: BuyResult['result']): string {
    const nameOf = (id: string) => this._shop?.catalog.find((c) => c.id === id)?.name ?? id;
    switch (r.kind) {
      case 'treat': return STRINGS.enjoy;
      case 'rest_token': return STRINGS.restTokenGot;
      case 'potion': return `${STRINGS.boostUntil} ${clock24(r.boostUntil)}`;
      case 'chest': return 'gold' in r ? `${STRINGS.chestHeld} ${r.gold} ${STRINGS.gold}!` : `${STRINGS.chestHeld} ${nameOf(r.itemId)}!`;
      default: return `${STRINGS.boughtItem} ${nameOf(r.itemId || item.id)}!`;
    }
  }

  private _sensorPlayer() {
    if (!this.hass) return undefined;
    return playersFromSensors(this.hass).find((p) => p.id === this._playerId);
  }

  private _body() {
    if (!this._who) {
      return this._loaded ? nothing : html`<div class="centerbox">${STRINGS.loading}</div>`;
    }
    if (!this._playerId) {
      if (!this._who.players.length) {
        return html`<div class="centerbox"><h1>${STRINGS.onboardTitle}</h1><p>${STRINGS.onboardBody}</p></div>`;
      }
      return html`<div class="centerbox"><h1>${STRINGS.whoTitle}</h1><p>${STRINGS.whoHint}</p>
        <div class="pick">${this._who.players.map((p) => html`<button type="button" data-player="${p.id}" @click=${() => this._pick(p.id)}>${p.name}</button>`)}</div></div>`;
    }
    if (this._view === 'village') {
      return villageView({
        summary: this._summary,
        playerId: this._playerId,
        leading: this._menu(),
        canSwitch: this._who.players.length > 1,
        onSwitch: this._switch,
        quests: this._quests,
        palette: this._palette(),
        decor: this._decor(),
        boostUntil: this._boostUntil(),
        busy: this._busy,
        poolOpen: this._poolOpen,
        onStart: this._start,
        onLater: this._later,
        onTogglePool: () => { this._poolOpen = !this._poolOpen; },
      });
    }
    if (this._view === 'quest') {
      const q = this._quests && [...this._quests.active, ...this._quests.open, ...this._quests.whenever].find((x) => x.id === this._questId);
      if (!q) return html`<div class="centerbox"><p>${STRINGS.questTakenCare}</p><button type="button" class="btn" data-go="village" @click=${() => { this._view = 'village'; }}>${STRINGS.back}</button></div>`;
      const now = this.now();
      const started = q.startedAt ? Date.parse(q.startedAt) : now;
      const boost = this._summary?.player.boostUntil;
      return questView({
        title: q.title,
        startedAtMs: Number.isNaN(started) ? now : started,
        nowMs: now,
        xp: q.xp,
        boosted: !!boost && Date.parse(boost) > now,
        busy: !!this._busy[q.id],
        onDone: () => this._finish(q),
        onBack: () => { this._view = 'village'; },
      });
    }
    if (this._view === 'hero') {
      return heroView({
        summary: this._summary,
        leading: this._menu(),
        canSwitch: this._who.players.length > 1,
        onSwitch: this._switch,
        palette: this._palette(),
        decor: this._decor(),
      });
    }
    return shopView({
      shop: this._shop,
      level: this._summary?.level ?? 1,
      tab: this._shopTab,
      leading: this._menu(),
      canSwitch: this._who.players.length > 1,
      busy: this._busy,
      onSwitch: this._switch,
      onTab: (t) => { this._shopTab = t; },
      onBuy: this._buy,
      onEquip: this._equip,
    });
  }

  protected render() {
    const nav = this._who && this._playerId && this._view !== 'quest';
    const item = (v: View, label: string) => html`<button type="button" data-go="${v}" aria-current=${this._view === v ? 'page' : nothing} @click=${() => { this._view = v; }}>${label}</button>`;
    return html`<div class="shell">
      <main>
        ${this.narrow && !(this._who && this._playerId && this._view === 'village') ? html`<div class="menu">${this._menu()}</div>` : nothing}
        ${this._offline ? html`<div class="banner" role="status">${STRINGS.offlineBanner}</div>` : nothing}
        ${this._reward ? rewardToast(this._reward, () => this._setReward(null)) : nothing}
        ${this._notice ? noticeToast(this._notice, () => this._setNotice('')) : nothing}
        ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
        ${this._body()}
      </main>
      ${nav ? html`<nav aria-label="${STRINGS.navLabel}">${item('village', STRINGS.navVillage)}${item('shop', STRINGS.navShop)}${item('hero', STRINGS.navHero)}</nav>` : nothing}
    </div>`;
  }
}

if (!customElements.get('cuest-panel')) customElements.define('cuest-panel', CuestPanel);
