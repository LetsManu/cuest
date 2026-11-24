import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, navigate, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { fmtTemp, withNums } from './format';
import { roomRows, type RoomRow } from './house';
import { ARCANE } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-rooms-card';

type AreaConfig = string | { area: string; name?: string; temperature?: string };

interface RoomsConfig {
  title: string | null;
  areas?: AreaConfig[];
  path?: string;
  battery_threshold: number;
  heading: 'outside' | 'inside';
}

export class CuestRoomsCard extends ArcaneCard<RoomsConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .rooms{display:flex;flex-direction:column;gap:8px}
      .panel.list{padding:0;overflow:hidden}
      .panel.list h2{padding:13px 16px 4px}
      .row{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;box-sizing:border-box;padding:13px 16px;margin:0;background:none;border:0;border-bottom:1px solid ${u(A.track)};color:${u(A.text)};font:inherit;text-align:left}
      .row:last-child{border-bottom:0}
      button.row{cursor:pointer}
      button.row:hover{background:rgba(255,255,255,.04)}
      button.row:focus-visible{outline:2px solid ${u(A.goldText)};outline-offset:-2px}
      .name{flex:1;font-weight:600;overflow-wrap:anywhere}
      .temp{font-family:var(--arc-font-pixel);font-size:18px}
      .status{min-width:52px;flex:none;white-space:nowrap;text-align:right;font-size:12px;color:${u(A.muted)}}
      .status.lit-on{color:${u(A.lantern)}}
      .muted{color:${u(A.muted)}}
      .warn-text{color:${u(A.emberText)}}
      .none{padding:14px 16px;font-size:13px;color:${u(A.soft)}}
    `,
  ];

  static getStubConfig(): object {
    return {};
  }

  protected validate(raw: Record<string, unknown>): RoomsConfig {
    let title: string | null = C.roomsTitle;
    if (raw.title === null) title = null;
    else if (raw.title !== undefined && raw.title !== '') title = v.str(raw, 'title', TAG) ?? C.roomsTitle;
    const list = v.list(raw, 'areas', TAG);
    const areas = list.map((a): AreaConfig => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const o = a as Record<string, unknown>;
        const area = v.str(o, 'area', `${TAG}: "areas" item`, true) as string;
        const name = v.str(o, 'name', `${TAG}: "areas" item`);
        const temperature = v.entity(o, 'temperature', `${TAG}: "areas" item`, ['sensor']);
        return { area, ...(name ? { name } : {}), ...(temperature ? { temperature } : {}) };
      }
      throw new ConfigError(`${TAG}: "areas" must be a list of area names or { area } items`);
    });
    const path = v.str(raw, 'path', TAG);
    return {
      title,
      ...(areas.length ? { areas } : {}),
      ...(path ? { path } : {}),
      battery_threshold: v.num(raw, 'battery_threshold', TAG, { def: 20, min: 1, max: 100 }),
      heading: v.oneOf(raw, 'heading', TAG, ['outside', 'inside'] as const, 'outside'),
    };
  }

  private rows(h: HomeAssistant): RoomRow[] {
    return roomRows(h, { areas: this.config.areas, batteryThreshold: this.config.battery_threshold });
  }

  protected signature(h: HomeAssistant): string {
    return JSON.stringify([this.rows(h), h.locale?.language]);
  }

  getCardSize(): number {
    return 1 + (this._hass && this.config ? this.rows(this._hass).length : 0);
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const rows = this.rows(h);
    const heading = this.config.title === null ? nothing : html`<h2>${this.config.title}</h2>`;
    const inside = this.config.heading === 'inside';
    const lang = h.locale?.language ?? 'en';
    return html`<div class="rooms">
      ${inside ? nothing : heading}
      <div class="panel list">
        ${inside ? heading : nothing}
        ${rows.length === 0 ? html`<div class="none">${C.noRooms}</div>` : rows.map((r) => this.row(r, lang))}
      </div>
    </div>`;
  }

  private row(r: RoomRow, lang: string): TemplateResult {
    const warn = r.tempState === 'battery' || r.tempState === 'check';
    const temp =
      r.tempState === 'ok' ? html`<span class="temp"><span class="num">${fmtTemp(r.temp, lang)}</span></span>`
      : warn ? html`<span class="temp warn-text">?</span>`
      : html`<span class="temp muted">—</span>`;
    const status =
      r.tempState === 'battery' ? html`<span class="status warn-text">${C.battery}</span>`
      : r.tempState === 'check' ? html`<span class="status warn-text">${C.check}</span>`
      : r.lit > 0 ? html`<span class="status lit-on">${withNums(fill(C.lit, { n: r.lit }))}</span>`
      : html`<span class="status">${C.dark}</span>`;
    const inner = html`<span class="name">${r.name}</span> ${temp} ${status}`;
    const path = this.config.path;
    return path
      ? html`<button type="button" class="row" @click=${() => navigate(path.replace(/\{area\}/g, r.areaId))}>${inner}</button>`
      : html`<div class="row">${inner}</div>`;
  }
}

registerCard(TAG, CuestRoomsCard, { name: 'Cuest rooms', description: 'Temperature and lit lights for each area.' });
