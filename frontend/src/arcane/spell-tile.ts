import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HassState, HomeAssistant } from '../hass-types';
import { parseService } from './bard';
import { ArcaneCard, ConfigError, fireMoreInfo, registerCard, v } from './base';
import { ARCANE_COPY } from './copy';
import { num } from './format';
import { isLightGroup } from './house';
import { ICON_COLOR, TILE_ICONS, isTileIcon, tileIcon, type TileIcon } from './icons';
import { ARCANE, FONT_BODY } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-spell-tile';
const HOLD_MS = 500;

type Variant = 'icon' | 'wide' | 'scene';
type Action = 'toggle' | 'call-service' | 'more-info' | 'none';
const ACTIONS: readonly Action[] = ['toggle', 'call-service', 'more-info', 'none'];
const TOGGLE_DOMAINS = ['light', 'switch', 'input_boolean', 'fan'];
const ON_STATES = ['on', 'playing', 'cleaning'];

interface TapAction {
  action: Action;
  service?: string;
  data?: Record<string, unknown>;
}

interface TileConfig {
  entity?: string;
  name?: string;
  icon?: string;
  variant: Variant;
  tone: 'gold' | 'green';
  state_text?: string;
  tap_action?: TapAction;
}

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const domainOf = (id: string): string => id.slice(0, id.indexOf('.'));
const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

type Effective = 'toggle' | 'turn_on' | 'press' | 'service' | 'more-info' | 'none';

interface Parts {
  pre: string;
  n?: string;
  post: string;
}
const plain = (p: Parts): string => `${p.pre}${p.n ?? ''}${p.post}`;

export class CuestSpellTile extends ArcaneCard<TileConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .tile{width:100%;box-sizing:border-box;min-height:56px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 10px;border:2px solid ${u(A.panelBorder)};background:${u(A.panel)};color:${u(A.text)};border-radius:14px;font:600 12px ${u(FONT_BODY)};cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
      .tile.icon{min-height:80px;flex-direction:column;text-align:center}
      .tile.wide{min-height:64px;flex-direction:row;justify-content:flex-start;gap:12px;padding:8px 14px;text-align:left}
      .tile.scene{min-height:56px;flex-direction:row;gap:8px;padding:0 14px;border-radius:999px}
      .tile[aria-disabled="true"]{opacity:.6;cursor:default}
      .tile.lit{border-color:${u(A.gold)};color:${u(A.litText)}}
      .tile.lit.icon,.tile.lit.scene{background:${u(A.litIconBg)}}
      .tile.lit.wide{background:${u(A.litWideBg)}}
      .tile.green{border-color:${u(A.wellDoneBorder)};background:${u(A.wellDoneBg)};color:${u(A.wellDoneText)}}
      .tile.green.lit{animation:none;box-shadow:0 0 14px rgba(127,209,126,.4)}
      .text{display:flex;flex-direction:column;min-width:0;gap:2px}
      .name{display:block;font-size:12px;overflow-wrap:anywhere}
      .wide .name{font-size:14px}
      .state{display:block;font-size:12px;font-weight:500;color:${u(A.soft)}}
      .lit .state{color:${u(A.litText)}}
      .glyph{flex:none;display:flex;align-items:center;justify-content:center}
      ha-icon.glyph{--mdc-icon-size:24px;width:24px;height:24px}
      .num{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums}
      .note{margin:6px 0 0;font-size:12px;color:${u(A.soft)}}
    `,
  ];

  private _busy = false;
  private _note = false;
  private _held = false;
  private _holdTimer?: ReturnType<typeof setTimeout>;

  static getStubConfig(h?: HomeAssistant): object {
    const hit = h && Object.keys(h.states).find((id) => id.startsWith('light.'));
    return { entity: hit ?? '' };
  }

  protected validate(raw: Record<string, unknown>): TileConfig {
    const entity = v.entity(raw, 'entity', TAG);
    const cfg: TileConfig = {
      variant: v.oneOf(raw, 'variant', TAG, ['icon', 'wide', 'scene'] as const, 'icon'),
      tone: v.oneOf(raw, 'tone', TAG, ['gold', 'green'] as const, 'gold'),
    };
    if (entity) cfg.entity = entity;
    const name = v.str(raw, 'name', TAG);
    if (name) cfg.name = name;
    const icon = v.str(raw, 'icon', TAG);
    if (icon) {
      if (!isTileIcon(icon) && !/^mdi:[a-z0-9-]+$/.test(icon)) throw new ConfigError(`${TAG}: "icon" must be one of ${TILE_ICONS.join(', ')} or an mdi: name`);
      cfg.icon = icon;
    }
    const st = v.str(raw, 'state_text', TAG);
    if (st) cfg.state_text = st;
    const ta = raw.tap_action;
    if (ta !== undefined && ta !== null) {
      if (!isObject(ta)) throw new ConfigError(`${TAG}: "tap_action" must be an object`);
      const action = v.oneOf(ta, 'action', `${TAG}: "tap_action"`, ACTIONS, 'none');
      const tap: TapAction = { action };
      if (action === 'call-service') {
        const service = v.str(ta, 'service', `${TAG}: "tap_action"`, true) as string;
        parseService(service, TAG);
        tap.service = service;
        if (ta.data !== undefined && ta.data !== null) {
          if (!isObject(ta.data)) throw new ConfigError(`${TAG}: "tap_action" "data" must be an object`);
          tap.data = ta.data;
        }
      }
      cfg.tap_action = tap;
    }
    if (!cfg.entity && cfg.tap_action?.action !== 'call-service') {
      throw new ConfigError(`${TAG}: needs an "entity" or a call-service "tap_action"`);
    }
    return cfg;
  }

  getCardSize(): number {
    return this.config?.variant === 'scene' ? 1 : 2;
  }

  getGridOptions() {
    const g = { icon: { columns: 3, rows: 2 }, wide: { columns: 6, rows: 2 }, scene: { columns: 4, rows: 1 } };
    return g[this.config?.variant ?? 'icon'];
  }

  protected signature(h: HomeAssistant): string {
    const s = this.config.entity ? h.states[this.config.entity] : undefined;
    if (!s) return '';
    return JSON.stringify([s.state, s.attributes.brightness, s.attributes.friendly_name, this.groupOn(h, s)]);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopHold();
  }

  private stopHold(): void {
    if (this._holdTimer !== undefined) clearTimeout(this._holdTimer);
    this._holdTimer = undefined;
  }

  private groupMembers(h: HomeAssistant, s: HassState): string[] | null {
    const id = this.config.entity;
    if (!id || domainOf(id) !== 'light' || !isLightGroup(h, id)) return null;
    const m = s.attributes.entity_id;
    return Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : null;
  }

  /** Members on; members hidden from this user fall back to the list length. */
  private groupOn(h: HomeAssistant, s: HassState): number | null {
    const m = this.groupMembers(h, s);
    if (!m || s.state !== 'on') return null;
    const known = m.filter((id) => h.states[id]);
    return known.length ? known.filter((id) => h.states[id].state === 'on').length : m.length;
  }

  private effective(): Effective {
    const cfg = this.config;
    const a = cfg.tap_action?.action;
    if (a === 'call-service') return 'service';
    if (a === 'toggle') return 'toggle';
    if (a === 'more-info') return 'more-info';
    if (a === 'none') return 'none';
    const d = cfg.entity ? domainOf(cfg.entity) : '';
    if (TOGGLE_DOMAINS.includes(d)) return 'toggle';
    if (d === 'scene' || d === 'script') return 'turn_on';
    if (d === 'button') return 'press';
    return 'more-info';
  }

  private tap(): void {
    if (this._held) {
      this._held = false;
      return;
    }
    const h = this._hass;
    const cfg = this.config;
    if (!h || this._busy) return;
    const id = cfg.entity;
    const eff = this.effective();
    let call: (() => Promise<unknown>) | null = null;
    if (eff === 'more-info') {
      if (id) fireMoreInfo(this, id);
      return;
    }
    if (eff === 'toggle' && id) {
      const d = domainOf(id);
      call = () => (TOGGLE_DOMAINS.includes(d) ? h.callService(d, 'toggle', { entity_id: id }) : h.callService('homeassistant', 'toggle', { entity_id: id }));
    } else if (eff === 'turn_on' && id) call = () => h.callService(domainOf(id), 'turn_on', { entity_id: id });
    else if (eff === 'press' && id) call = () => h.callService('button', 'press', { entity_id: id });
    else if (eff === 'service' && cfg.tap_action?.service) {
      const [d, s] = parseService(cfg.tap_action.service, TAG);
      const data = cfg.tap_action.data ? { ...cfg.tap_action.data } : {};
      call = () => h.callService(d, s, data);
    }
    if (!call) return;
    this._busy = true;
    this._note = false;
    this.requestUpdate();
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(call());
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      () => undefined,
      () => {
        this._note = true;
      },
    ).then(() => {
      this._busy = false;
      this.requestUpdate();
    });
  }

  private down(): void {
    const id = this.config.entity;
    this.stopHold();
    this._held = false;
    if (!id) return;
    this._holdTimer = setTimeout(() => {
      this._holdTimer = undefined;
      this._held = true;
      fireMoreInfo(this, id);
    }, HOLD_MS);
  }

  private up(): void {
    this.stopHold();
  }

  private cancel(): void {
    this.stopHold();
    this._held = false;
  }

  private stateParts(h: HomeAssistant, s: HassState): Parts | null {
    const cfg = this.config;
    if (cfg.state_text) return { pre: cfg.state_text, post: '' };
    if (!cfg.entity) return null;
    const d = domainOf(cfg.entity);
    if (s.state === 'unavailable' || s.state === 'unknown') return { pre: '—', post: '' };
    if (d === 'scene' || d === 'button') return null;
    if (d === 'light') {
      if (s.state !== 'on') return { pre: s.state === 'off' ? C.spellOff : '—', post: '' };
      const n = this.groupOn(h, s);
      if (n !== null) return { pre: '', n: String(n), post: ' on' };
      const b = num(s.attributes.brightness);
      if (b === null) return { pre: C.spellOn, post: '' };
      return { pre: `${C.spellOn} · `, n: String(Math.round((Math.min(255, Math.max(0, b)) / 255) * 100)), post: ' %' };
    }
    if (s.state === 'on') return { pre: C.spellOn, post: '' };
    if (s.state === 'off') return { pre: C.spellOff, post: '' };
    const word = s.state.replace(/_/g, ' ');
    return { pre: word.charAt(0).toUpperCase() + word.slice(1), post: '' };
  }

  private defaultIcon(): string {
    const d = this.config.entity ? domainOf(this.config.entity) : '';
    if (d === 'light') return 'bulb';
    if (d === 'media_player') return 'tv';
    if (d === 'binary_sensor' || d === 'alarm_control_panel') return 'shield';
    return 'spark';
  }

  private glyph(size: number): TemplateResult {
    const icon = this.config.icon ?? this.defaultIcon();
    const color = this.config.tone === 'green' ? A.greenIcon : undefined;
    if (isTileIcon(icon)) return html`<span class="glyph">${tileIcon(icon as TileIcon, size, color ?? ICON_COLOR[icon as TileIcon])}</span>`;
    return html`<ha-icon class="glyph" icon="${icon}" aria-hidden="true" style="color:${color ?? A.goldText}"></ha-icon>`;
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const cfg = this.config;
    const id = cfg.entity;
    const s = id ? h.states[id] : undefined;
    if (id && !s) return html`${this.missing(id)}`;
    const name = cfg.name ?? (s ? str(s.attributes.friendly_name) : '');
    const label = name || (id ? id.slice(id.indexOf('.') + 1) : cfg.tap_action?.service?.split('.')[1] ?? '');
    const lit = !!s && ON_STATES.includes(s.state);
    const parts = cfg.variant === 'wide' && (s || cfg.state_text) ? this.stateParts(h, s ?? ({ state: '', attributes: {}, last_changed: '' } as HassState)) : null;
    const pressed = id && this.effective() === 'toggle' ? (lit ? 'true' : 'false') : null;
    const aria = parts ? `${label}, ${plain(parts)}` : label;
    const size = cfg.variant === 'scene' ? 20 : 24;
    const cls = ['tile', cfg.variant, lit ? 'lit' : '', cfg.tone === 'green' ? 'green' : ''].filter(Boolean).join(' ');
    return html`<button type="button" class="${cls}" aria-label="${aria}" aria-pressed="${pressed ?? nothing}" aria-disabled="${this._busy ? 'true' : nothing}"
        @click=${() => this.tap()} @pointerdown=${() => this.down()} @pointerup=${() => this.up()} @keydown=${() => (this._held = false)} @pointerleave=${() => this.cancel()} @pointercancel=${() => this.cancel()} @contextmenu=${(e: Event) => e.preventDefault()}>
        ${this.glyph(size)}
        <span class="text"><span class="name">${label}</span>${parts ? html`<span class="state">${parts.pre}${parts.n === undefined ? nothing : html`<span class="num">${parts.n}</span>`}${parts.post}</span>` : nothing}</span>
      </button>${this._note ? html`<p class="note" role="status">${C.spellFailed}</p>` : nothing}`;
  }
}

registerCard(TAG, CuestSpellTile, { name: 'Arcane spell tile', description: 'A gold-glowing tile that toggles or runs a service.' });
