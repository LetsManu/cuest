import { html, nothing, svg, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { fmtNumber, fmtTemp, num } from './format';
import { fetchHistory, resample, trailGeometry, type Sample } from './history';
import { ARCANE, FONT_PIXEL } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-trail-card';
const W = 326;
const H = 110;

export const HISTORY_REFRESH_MS = 300_000;

interface TrailConfig {
  entity: string;
  entity2?: string;
  hours: number;
  title: string;
  name?: string;
  name2?: string;
}

interface Loaded {
  start: number;
  end: number;
  samples: Record<string, Sample[]>;
}

const liveNum = (h: HomeAssistant, id: string | undefined): number | null => (id && h.states[id] ? num(h.states[id].state) : null);

export class CuestTrailCard extends ArcaneCard<TrailConfig> {
  readonly tag = TAG;

  private _loaded?: Loaded;
  private _lastFetch = 0;
  private _token = 0;
  private _pending = -1;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .trail{display:flex;flex-direction:column;gap:8px}
      .head{display:flex;justify-content:space-between;align-items:baseline}
      h2{margin:0;font-family:${u(FONT_PIXEL)};font-size:18px;font-weight:400;color:${u(A.goldText)}}
      .hours{font-size:12px;color:${u(A.muted)}}
      .plot{position:relative}
      svg.graph{display:block;width:100%;height:110px}
      .dot{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:${u(A.lantern)}}
      .legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:${u(A.muted)}}
      .legend b{font-weight:700}
    `,
  ];

  static getStubConfig(h?: HomeAssistant): object {
    const hit = h && Object.entries(h.states).find(([id, s]) => id.startsWith('sensor.') && s.attributes.device_class === 'temperature');
    return { entity: hit ? hit[0] : '' };
  }

  protected validate(raw: Record<string, unknown>): TrailConfig {
    const entity = v.entity(raw, 'entity', TAG, undefined, true) as string;
    const cfg: TrailConfig = {
      entity,
      hours: v.num(raw, 'hours', TAG, { def: 24, min: 1, max: 168 }),
      title: v.str(raw, 'title', TAG) ?? C.trailTitle,
    };
    const entity2 = v.entity(raw, 'entity2', TAG);
    if (entity2) cfg.entity2 = entity2;
    const name = v.str(raw, 'name', TAG);
    if (name) cfg.name = name;
    const name2 = v.str(raw, 'name2', TAG);
    if (name2) cfg.name2 = name2;
    return cfg;
  }

  setConfig(raw: unknown): void {
    super.setConfig(raw);
    this._token++;
    this._pending = -1;
    this._loaded = undefined;
    this._lastFetch = 0;
    if (this._hass) this.maybeFetch(this._hass);
  }

  set hass(h: HomeAssistant) {
    super.hass = h;
    if (this.config) this.maybeFetch(h);
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  protected entityIds(): string[] {
    return this.config.entity2 ? [this.config.entity, this.config.entity2] : [this.config.entity];
  }

  protected signature(h: HomeAssistant): string {
    return `${super.signature(h)}|${this._token}:${this._loaded ? this._loaded.end : 'x'}`;
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions() {
    return { columns: 12, rows: 3 };
  }

  private maybeFetch(h: HomeAssistant): void {
    const ids = this.entityIds();
    if (ids.some((id) => !h.states[id])) return;
    if (this._pending === this._token) return;
    if (this._lastFetch !== 0 && Date.now() - this._lastFetch < HISTORY_REFRESH_MS) return;
    const token = this._token;
    const end = Date.now();
    const start = end - this.config.hours * 3_600_000;
    this._pending = token;
    this._lastFetch = end;
    fetchHistory(h, ids, new Date(start), new Date(end)).then(
      (samples) => {
        if (token !== this._token) return;
        this._pending = -1;
        this._loaded = { start, end, samples };
        this.requestUpdate();
      },
      () => {
        if (token !== this._token) return;
        this._pending = -1;
        this.requestUpdate();
      },
    );
  }

  private nameOf(h: HomeAssistant, id: string, given?: string): string {
    if (given) return given;
    const f = h.states[id]?.attributes.friendly_name;
    return typeof f === 'string' && f ? f : id;
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const cfg = this.config;
    const gone = this.entityIds().find((id) => !h.states[id]);
    if (gone) return this.missing(gone);

    const lang = h.locale?.language ?? 'en';
    const series: (number | null)[][] = this.entityIds().map((id) => {
      const l = this._loaded;
      if (!l) return [];
      const pts = resample(l.samples[id] ?? [], l.start, l.end);
      const now = liveNum(h, id);
      if (pts.length && now !== null) pts[pts.length - 1] = now;
      return pts;
    });
    const geo = trailGeometry(series, W, H);
    const name1 = this.nameOf(h, cfg.entity, cfg.name);
    const name2 = cfg.entity2 ? this.nameOf(h, cfg.entity2, cfg.name2) : '';
    const cur = (id: string): string => (geo ? fmtTemp(liveNum(h, id), lang) : '—');
    const unit = String(h.states[cfg.entity].attributes.unit_of_measurement ?? '');
    const own = geo ? series[0].filter((x): x is number => x !== null) : [];
    const aria = own.length
      ? fill(C.trailAria, {
          name: name1,
          hours: cfg.hours,
          min: fmtNumber(Math.min(...own), lang),
          max: fmtNumber(Math.max(...own), lang),
          unit,
        }).replace(/\s+\.?$/, '')
      : fill(C.trailAriaEmpty, { name: name1, hours: cfg.hours });

    return html`<div class="panel trail">
      <div class="head"><h2>${cfg.title}</h2><span class="hours">${fill(C.trailHours, { n: cfg.hours })}</span></div>
      ${geo
        ? html`<div class="plot"><svg class="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${aria}">
            <defs>
              <linearGradient id="trail-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${A.ember}" stop-opacity="0.45"/><stop offset="1" stop-color="${A.ember}" stop-opacity="0"/></linearGradient>
              <linearGradient id="trail-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFD27A"/><stop offset="1" stop-color="#FF7A6B"/></linearGradient>
            <clipPath id="trail-clip"><rect class="reveal" x="0" y="-5" width="${W}" height="${H + 10}"/></clipPath>
            </defs>
            <line x1="0" y1="30" x2="${W}" y2="30" stroke="${A.track}" stroke-dasharray="2 6" vector-effect="non-scaling-stroke"/>
            <line x1="0" y1="70" x2="${W}" y2="70" stroke="${A.track}" stroke-dasharray="2 6" vector-effect="non-scaling-stroke"/>
            <g class="lines" clip-path="url(#trail-clip)">
              ${geo.area ? svg`<path d="${geo.area}" fill="url(#trail-fill)"/>` : nothing}
              ${geo.segments[0].map((p) => svg`<polyline points="${p}" fill="none" stroke="url(#trail-line)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`)}
              ${(geo.segments[1] ?? []).map((p) => svg`<polyline points="${p}" fill="none" stroke="${A.manaFrom}" stroke-width="2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`)}
            </g>
          </svg>${geo.last ? html`<span class="dot pulse" style="left:${(100 * geo.last.x) / W}%;top:${(100 * geo.last.y) / H}%"></span>` : nothing}</div>`
        : nothing}
      <div class="legend">
        <span><b style="color:${A.emberText}">—</b> ${name1} <span class="num">${cur(cfg.entity)}</span></span>
        ${cfg.entity2 ? html`<span><b style="color:${A.manaFrom}">- -</b> ${name2} <span class="num">${cur(cfg.entity2)}</span></span>` : nothing}
      </div>
    </div>`;
  }
}

registerCard(TAG, CuestTrailCard, { name: 'Arcane warmth trail', description: 'Temperature history drawn as a glowing spell trail.' });
