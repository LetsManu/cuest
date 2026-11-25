import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { HassState, HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, callSafely, fireMoreInfo, isObject, parseService, registerCard, stubEntity, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { num } from './format';
import { areaOf } from './house';
import { transportIcon } from './icons';
import { ARCANE, FONT_BODY, FONT_PIXEL } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-bard-card';
const EXPIRY_MS = 3000;
const MAX_SOURCES = 4;

interface Source {
  name: string;
  service: string;
  data?: Record<string, unknown>;
}

interface BardConfig {
  entity: string;
  name?: string;
  variant: 'full' | 'compact';
  sources: Source[];
}

const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
const RESTING = ['unavailable', 'unknown', 'off'];
const DELAYS = ['0s', '.2s', '.5s', '.3s', '.7s'];
const PULSE_HEIGHTS = [40, 90, 60, 75];
const PULSE_DELAYS = ['0s', '.4s', '.8s', '1.2s'];

export class CuestBardCard extends ArcaneCard<BardConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .bard{background:${u(A.bardPanel)};border:2px solid ${u(A.rim)};border-radius:18px;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px}
      .bard.compact{padding:14px;flex-direction:row;align-items:center;gap:12px}
      .head{display:flex;align-items:center;gap:12px}
      .compact .head{flex:1;min-width:0}
      .bars{display:flex;align-items:flex-end;justify-content:center;gap:3px;box-sizing:border-box;flex:none}
      .bars.big{width:64px;height:64px;border-radius:12px;background:${u(A.panel)};border:2px solid ${u(A.gold)};padding:10px}
      .bars.small{width:44px;height:40px}
      .bars i{display:block;background:${u(A.goldText)}}
      .bars.big i{width:6px;height:100%;transform:scaleY(.3);transform-origin:bottom}
      .bars.big i.eq{transform:none}
      .bars.small i{flex:1}
      .bars.small.idle i{opacity:.55}
      .title{flex:1;min-width:0;min-height:44px;display:flex;flex-direction:column;justify-content:center;text-align:left;background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer}
      .name{display:block;font-family:${u(FONT_PIXEL)};font-weight:500;font-size:18px;color:${u(A.goldText)};overflow-wrap:anywhere}
      .compact .name{font-size:16px}
      .sub{display:block;font-size:13px;color:${u(A.soft)};overflow-wrap:anywhere}
      .compact .sub{font-size:12px}
      .track{height:6px;background:${u(A.controlBorder)};border-radius:3px;overflow:hidden}
      .fill{height:100%;background:linear-gradient(90deg,${u(A.glowTo)},${u(A.glowFrom)});border-radius:3px}
      .ctls{display:flex;align-items:center;justify-content:center;gap:16px}
      .ctl{width:48px;height:48px;min-width:48px;min-height:48px;border-radius:999px;border:2px solid ${u(A.controlBorder)};background:transparent;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;color:${u(A.text)}}
      .main{width:62px;height:62px;min-width:62px;min-height:62px;border-radius:999px;border:3px solid ${u(A.gold)};background:${u(A.goldText)};display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;flex:none}
      .compact .main{width:48px;height:48px;min-width:48px;min-height:48px;border:0}
      button:disabled,input:disabled,button[aria-disabled="true"]{opacity:.45;cursor:default}
      label.vol{display:flex;align-items:center;gap:10px;font-size:13px}
      input[type="range"]{flex:1;min-height:44px;margin:0;accent-color:${u(A.goldText)}}
      .srcs{display:flex;gap:8px}
      .src{flex:1;min-height:44px;border:2px solid ${u(A.controlBorder)};background:transparent;color:${u(A.text)};border-radius:12px;font:600 13px ${u(FONT_BODY)};cursor:pointer;padding:0 8px}
      .note{margin:0;font-size:13px;color:${u(A.soft)}}
    `,
  ];

  private _busy = new Set<string>();
  private _note = false;
  private _volPending: number | null = null;
  private _volSent: number | null = null;
  private _volQueued: number | null = null;
  private _volInflight = false;
  private _volGen = 0;
  private _expiry?: ReturnType<typeof setTimeout>;

  static getStubConfig(h?: HomeAssistant): object {
    return { entity: stubEntity(h, [(id) => id.startsWith('media_player.')], 'media_player.living_room') };
  }

  protected validate(raw: Record<string, unknown>): BardConfig {
    const entity = v.entity(raw, 'entity', TAG, ['media_player'], true) as string;
    const cfg: BardConfig = { entity, variant: v.oneOf(raw, 'variant', TAG, ['full', 'compact'] as const, 'full'), sources: [] };
    const name = v.str(raw, 'name', TAG);
    if (name) cfg.name = name;
    for (const item of v.list(raw, 'sources', TAG, MAX_SOURCES)) {
      if (!isObject(item)) throw new ConfigError(`${TAG}: "sources" must be a list of { name, service } items`);
      const where = `${TAG}: "sources" item`;
      const sName = v.str(item, 'name', where, true) as string;
      const service = v.str(item, 'service', where, true) as string;
      parseService(service, TAG);
      const src: Source = { name: sName, service };
      if (item.data !== undefined && item.data !== null) {
        if (!isObject(item.data)) throw new ConfigError(`${where}: "data" must be an object`);
        src.data = item.data;
      }
      cfg.sources.push(src);
    }
    return cfg;
  }

  setConfig(raw: unknown): void {
    const prev = this.config?.entity;
    super.setConfig(raw);
    if (prev !== this.config.entity) this.resetVolume();
  }

  getCardSize(): number {
    return this.config?.variant === 'compact' ? 2 : 5;
  }

  getGridOptions() {
    return { columns: 12, rows: 'auto' as const };
  }

  protected signature(h: HomeAssistant): string {
    const s = h.states[this.config.entity];
    return s ? JSON.stringify([s.state, s.attributes, this.nameFor(h)]) : '';
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // A volume waiting behind an in-flight call goes out now; the in-flight reply is ignored after the reset.
    const queued = this._volQueued;
    const h = this._hass;
    this.resetVolume();
    if (queued !== null && h) {
      void callSafely(() => h.callService('media_player', 'volume_set', { entity_id: this.config.entity, volume_level: queued / 100 }));
    }
  }

  private resetVolume(): void {
    if (this._expiry !== undefined) clearTimeout(this._expiry);
    this._expiry = undefined;
    this._volPending = null;
    this._volSent = null;
    this._volQueued = null;
    this._volInflight = false;
    this._volGen++;
  }

  private nameFor(h: HomeAssistant): string {
    if (this.config.name) return this.config.name;
    const area = areaOf(h, this.config.entity);
    const an = area ? h.areas?.[area]?.name : undefined;
    return an || text(h.states[this.config.entity]?.attributes.friendly_name) || this.config.entity;
  }

  private run(key: string, call: () => Promise<unknown>): void {
    if (this._busy.has(key)) return;
    this._busy.add(key);
    this._note = false;
    this.requestUpdate();
    void callSafely(call).then((ok) => {
      if (!ok) this._note = true;
      this._busy.delete(key);
      this.requestUpdate();
    });
  }

  private service(domain: string, service: string, key: string, data: Record<string, unknown>): void {
    const h = this._hass;
    if (!h) return;
    this.run(key, () => h.callService(domain, service, data));
  }

  private changeVolume(pct: number): void {
    if (!Number.isFinite(pct)) return;
    this._volPending = pct;
    this._note = false;
    if (this._expiry !== undefined) clearTimeout(this._expiry);
    this._expiry = undefined;
    if (this._volInflight) this._volQueued = pct;
    else this.sendVolume(pct);
    this.requestUpdate();
  }

  private sendVolume(pct: number): void {
    const h = this._hass;
    if (!h || pct === this._volSent) return this.armExpiry();
    this._volSent = pct;
    this._volInflight = true;
    const gen = this._volGen;
    void callSafely(() => h.callService('media_player', 'volume_set', { entity_id: this.config.entity, volume_level: pct / 100 })).then((ok) => {
      if (gen !== this._volGen) return;
      this._volInflight = false;
      const q = this._volQueued;
      this._volQueued = null;
      const same = q === this._volSent;
      this._volSent = null;
      if (ok) {
        if (q !== null && !same) this.sendVolume(q);
        else this.armExpiry();
        return;
      }
      if (q !== null) {
        this.sendVolume(q);
        return;
      }
      this._note = true;
      this.resetVolume();
      this.requestUpdate();
    });
  }

  /** Without a hass echo the slider goes back to the player's own level. */
  private armExpiry(): void {
    if (this._expiry !== undefined) clearTimeout(this._expiry);
    this._expiry = setTimeout(() => {
      this._expiry = undefined;
      this._volPending = null;
      this._volSent = null;
      this.requestUpdate();
    }, EXPIRY_MS);
  }

  private progress(s: HassState): number | null {
    const dur = num(s.attributes.media_duration);
    if (dur === null || dur <= 0) return null;
    let pos = num(s.attributes.media_position) ?? 0;
    const stamp = typeof s.attributes.media_position_updated_at === 'string' ? Date.parse(s.attributes.media_position_updated_at) : NaN;
    if (s.state === 'playing' && Number.isFinite(stamp)) pos += Math.max(0, (Date.now() - stamp) / 1000);
    return Number((Math.min(100, Math.max(0, (pos / dur) * 100))).toFixed(1));
  }

  private subline(s: HassState, resting: boolean): string {
    if (resting) return C.bardResting;
    const title = text(s.attributes.media_title);
    if (s.state !== 'playing' || !title) return C.bardIdle;
    const by = text(s.attributes.media_artist) || text(s.attributes.app_name);
    return by ? `${title} · ${by}` : title;
  }

  private bars(playing: boolean, compact: boolean): TemplateResult {
    if (compact) {
      return html`<div class="bars small ${playing ? '' : 'idle'}" aria-hidden="true">${PULSE_HEIGHTS.map(
        (hgt, i) => html`<i class="${playing ? 'pulse' : ''}" style="height:${hgt}%;animation-delay:${PULSE_DELAYS[i]}"></i>`,
      )}</div>`;
    }
    return html`<div class="bars big" aria-hidden="true">${DELAYS.map((d) => html`<i class="${playing ? 'eq' : ''}" style="animation-delay:${d}"></i>`)}</div>`;
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const id = this.config.entity;
    const s = h.states[id];
    if (!s) return html`${this.missing(id)}`;
    const compact = this.config.variant === 'compact';
    const resting = RESTING.includes(s.state);
    const playing = s.state === 'playing';
    const busy = (k: string): boolean => this._busy.has(k);
    const pp = playing ? C.bardPause : C.bardPlay;
    const main = html`<button type="button" class="main" aria-label="${pp}" ?disabled=${resting} aria-disabled="${busy('pp') ? 'true' : nothing}" @click=${() => this.service('media_player', 'media_play_pause', 'pp', { entity_id: id })}>${transportIcon(playing ? 'pause' : 'play', compact ? 20 : 22, A.bardPanel)}</button>`;
    const head = html`<div class="head">
      ${this.bars(playing && !resting, compact)}
      <button type="button" class="title" @click=${() => fireMoreInfo(this, id)}>
        <span class="name">${this.nameLine(h)}</span><span class="sub">${this.subline(s, resting)}</span>
      </button>
    </div>`;
    const note = this._note ? html`<p class="note" role="status">${C.bardFailed}</p>` : nothing;
    if (compact) return html`<div class="bard compact">${head}${main}${note}</div>`;
    const pct = resting ? null : this.progress(s);
    const level = num(s.attributes.volume_level);
    const vol = this._volPending ?? (level === null ? 0 : Math.round(Math.min(1, Math.max(0, level)) * 100));
    return html`<div class="bard">
      ${head}
      ${pct === null ? nothing : html`<div class="track" role="progressbar" aria-label="${C.bardProgress}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="fill" style="width:${pct}%"></div></div>`}
      <div class="ctls">
        <button type="button" class="ctl" aria-label="${C.bardPrev}" ?disabled=${resting} aria-disabled="${busy('prev') ? 'true' : nothing}" @click=${() => this.service('media_player', 'media_previous_track', 'prev', { entity_id: id })}>${transportIcon('prev', 18, A.text)}</button>
        ${main}
        <button type="button" class="ctl" aria-label="${C.bardNext}" ?disabled=${resting} aria-disabled="${busy('next') ? 'true' : nothing}" @click=${() => this.service('media_player', 'media_next_track', 'next', { entity_id: id })}>${transportIcon('next', 18, A.text)}</button>
      </div>
      <label class="vol">${C.bardVolume}<input type="range" min="0" max="100" step="1" aria-label="${C.bardVolume}" .value=${live(String(vol))} ?disabled=${resting} @change=${(e: Event) => this.changeVolume(Number((e.target as HTMLInputElement).value))} /></label>
      ${this.config.sources.length
        ? html`<div class="srcs">${this.config.sources.map((src, i) => html`<button type="button" class="src" ?disabled=${resting} aria-disabled="${busy(`src${i}`) ? 'true' : nothing}" @click=${() => this.callSource(src, i)}>${src.name}</button>`)}</div>`
        : nothing}
      ${note}
    </div>`;
  }

  private nameLine(h: HomeAssistant): string {
    return fill(C.bardTitle, { name: this.nameFor(h) });
  }

  private callSource(src: Source, i: number): void {
    const [d, s] = parseService(src.service, TAG);
    this.service(d, s, `src${i}`, src.data ? { ...src.data } : {});
  }
}

registerCard(TAG, CuestBardCard, { name: 'Cuest bard', description: 'A media player with an equaliser, controls, volume and source buttons.' });
