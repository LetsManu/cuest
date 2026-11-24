import { LitElement, css, html, nothing, unsafeCSS } from 'lit';
import type { HassState, HomeAssistant } from './hass-types';
import { COLORS, FONT_BODY } from './palette';
import { SPRITE_H, SPRITE_W, spriteShadow, stageForLevel, type Palette } from './sprite';
import { STRINGS } from './strings';

interface TodoItem { uid: string; summary: string; status?: string }
interface CardPlayer {
  id: string;
  person: string | null;
  level?: HassState;
  gold?: HassState;
  xp?: HassState;
}

const PX = 4;

export class CuestCard extends LitElement {
  static properties = {
    _items: { state: true },
    _busy: { state: true },
    _hassTick: { state: true },
  };

  static styles = css`
    :host{display:block;font-family:${unsafeCSS(FONT_BODY)}}
    ha-card{overflow:hidden}
    .scene{background:${unsafeCSS(COLORS.dusk)};padding:14px 16px;display:flex;align-items:flex-end;gap:16px;color:${unsafeCSS(COLORS.card)};position:relative}
    .scene::after{content:"";position:absolute;left:0;right:0;bottom:0;height:14px;background:${unsafeCSS(COLORS.grass)}}
    .sprite{position:relative;overflow:hidden;flex:none;z-index:1;margin-bottom:-2px}
    .dot{position:absolute}
    .info{flex:1;min-width:0;padding-bottom:20px;z-index:1}
    .name{font-size:13px;opacity:.8}
    .lvl{font-size:18px;font-weight:600;margin:2px 0 8px}
    .bar{height:10px;background:rgba(255,249,236,.2);border-radius:5px;overflow:hidden}
    .fill{height:100%;background:${unsafeCSS(COLORS.amber)};border-radius:5px}
    .meta{display:flex;justify-content:space-between;font-size:12px;margin-top:4px;opacity:.9}
    .decor{font-size:12px;margin-top:4px;opacity:.8}
    .quests{padding:8px 16px 12px;color:var(--primary-text-color)}
    .row{display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--divider-color,rgba(127,127,127,.3))}
    .row:first-of-type{border-top:0}
    .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    button{background:${unsafeCSS(COLORS.grass)};color:${unsafeCSS(COLORS.card)};border:0;border-radius:16px;padding:6px 14px;font:inherit;cursor:pointer;min-height:44px;min-width:44px}
    button:disabled{opacity:.5;cursor:default}
    .empty,.msg{color:var(--secondary-text-color);padding:8px 0}
    .head{font-size:12px;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  `;

  private _config: { person?: string } = {};
  private _hass: HomeAssistant | null = null;
  private _todoId: string | null = null;
  private _todoStamp: string | null = null;
  declare _items: TodoItem[];
  declare _busy: Record<string, boolean>;
  declare _hassTick: number;

  constructor() {
    super();
    this._items = [];
    this._busy = {};
    this._hassTick = 0;
  }

  static getStubConfig() { return {}; }

  setConfig(config: { person?: string } | null) {
    this._config = config || {};
    this._hassTick++;
  }

  getCardSize() { return 3 + Math.min(this._items.length, 5); }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const todoId = this._findTodo();
    const todo = todoId ? hass.states[todoId] : undefined;
    const oq = Object.keys(hass.states)
      .filter((id) => id.startsWith('sensor.') && hass.entities?.[id]?.platform === 'cuest' && Array.isArray(hass.states[id].attributes?.quests))
      .map((id) => JSON.stringify(hass.states[id].attributes.quests))
      .join('|');
    const stamp = todo ? `${todo.last_changed}|${todo.state}|${oq}` : null;
    if (todoId !== this._todoId || stamp !== this._todoStamp) {
      this._todoId = todoId;
      this._todoStamp = stamp;
      void this._loadItems();
    }
    this._hassTick++;
  }

  private _findTodo(): string | null {
    const h = this._hass;
    if (!h) return null;
    const ids = Object.keys(h.states).filter((id) => id.startsWith('todo.') && h.entities?.[id]?.platform === 'cuest');
    if (ids.length) return ids[0];
    return h.states['todo.cuest_quests'] ? 'todo.cuest_quests' : null;
  }

  private async _loadItems() {
    const id = this._todoId;
    if (!id || !this._hass) { this._items = []; return; }
    try {
      const res = await this._hass.callWS<{ items?: TodoItem[] }>({ type: 'todo/item/list', entity_id: id });
      if (id !== this._todoId) return;
      this._items = (res?.items ?? []).filter((i) => i.status !== 'completed');
    } catch {
      /* keep the last list */
    }
  }

  private _player(): CardPlayer | null {
    const h = this._hass;
    if (!h) return null;
    const players: Record<string, CardPlayer & Record<string, unknown>> = {};
    for (const id of Object.keys(h.states)) {
      if (!id.startsWith('sensor.') || h.entities?.[id]?.platform !== 'cuest') continue;
      const a = h.states[id].attributes ?? {};
      const pid = a.cuest_player_id as string | undefined;
      const kind = a.cuest_kind as string | undefined;
      if (!pid || !kind) continue;
      const p = players[pid] ?? (players[pid] = { id: pid, person: null });
      p.person = (a.ha_person as string | undefined) ?? null;
      p[kind] = h.states[id];
    }
    const list = Object.values(players);
    if (!list.length) return null;
    const want = this._config.person;
    return (want && list.find((p) => p.person === want)) || list[0];
  }

  private async _done(item: TodoItem) {
    this._busy = { ...this._busy, [item.uid]: true };
    try {
      await this._hass!.callService('cuest', 'complete_quest', { quest_id: item.uid });
    } catch {
      /* HA shows the error */
    }
    const { [item.uid]: _gone, ...rest } = this._busy;
    this._busy = rest;
    await this._loadItems();
  }

  protected render() {
    if (!this._hass) return nothing;
    const p = this._player();
    if (!p || !p.level) {
      return html`<ha-card><div class="quests"><div class="msg">${STRINGS.notReady}</div></div></ha-card>`;
    }
    const a = p.level.attributes ?? {};
    const level = parseInt(p.level.state, 10) || 1;
    const title = (a.title as string) || '';
    const name = (a.player_name as string) || '';
    const into = Number(a.into_level) || 0;
    const toNext = Number(a.to_next) || 0;
    const pct = into + toNext > 0 ? Math.max(0, Math.min(100, Math.round((100 * into) / (into + toNext)))) : 0;
    const palette = (a.outfit_palette as Palette | undefined) ?? {};
    const decor = Array.isArray(a.decor) ? (a.decor as string[]) : [];
    const decorText = decor.map((d) => STRINGS.decorNames[d] ?? d).join(', ');
    return html`<ha-card>
      <div class="scene">
        <div class="sprite" role="img" aria-label="${STRINGS.heroLabel} ${name}, ${title}" style="width:${SPRITE_W * PX}px;height:${SPRITE_H * PX}px">
          <div class="dot" style="left:${-PX}px;top:${-PX}px;width:${PX}px;height:${PX}px;box-shadow:${spriteShadow(stageForLevel(level), PX, palette)}"></div>
        </div>
        <div class="info">
          <div class="name">${name}</div>
          <div class="lvl">${STRINGS.level} ${level}${title ? ` · ${title}` : ''}</div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="fill" style="width:${pct}%"></div></div>
          <div class="meta"><span>${toNext} ${STRINGS.xpToNext}</span><span>${p.gold ? p.gold.state : '0'} ${STRINGS.gold}</span></div>
          ${decorText ? html`<div class="decor">${STRINGS.village}: ${decorText}</div>` : nothing}
        </div>
      </div>
      <div class="quests">
        <div class="head">${STRINGS.questsHeading}</div>
        ${this._items.length ? nothing : html`<div class="empty">${STRINGS.noQuests}</div>`}
        ${this._items.map((item) => html`<div class="row"><span class="title">${item.summary || ''}</span><button ?disabled=${!!this._busy[item.uid]} @click=${() => this._done(item)}>${STRINGS.done}</button></div>`)}
      </div>
    </ha-card>`;
  }
}

if (!customElements.get('cuest-card')) {
  customElements.define('cuest-card', CuestCard);
  const w = window as unknown as { customCards?: unknown[] };
  w.customCards = w.customCards || [];
  w.customCards.push({ type: 'cuest-card', name: STRINGS.cardName, description: STRINGS.cardDescription });
}
