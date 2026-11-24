import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, registerCard, v } from './base';
import { ARCANE_COPY } from './copy';
import { batteries, type Battery } from './house';
import { ARCANE } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-stamina-card';
const SEGMENTS = 5;

interface StaminaConfig {
  title: string;
  entities?: string[];
  exclude: string[];
  limit: number;
  threshold: number;
}

export class CuestStaminaCard extends ArcaneCard<StaminaConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .stamina{display:flex;flex-direction:column;gap:8px}
      .panel.bars{display:flex;flex-direction:column;gap:12px}
      .stamina-row{display:flex;align-items:center;gap:10px;font-size:13px}
      .name{width:120px;flex:none;font-weight:600;overflow-wrap:anywhere}
      .segs{flex:1;display:flex;gap:3px}
      .seg{flex:1;height:12px;border-radius:2px}
      .pct{width:48px;flex:none;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:${u(A.muted)}}
    `,
  ];

  static getStubConfig(): object {
    return {};
  }

  protected validate(raw: Record<string, unknown>): StaminaConfig {
    const entities = v.strings(raw, 'entities', TAG);
    return {
      title: v.str(raw, 'title', TAG) ?? C.staminaTitle,
      ...(entities.length ? { entities } : {}),
      exclude: v.strings(raw, 'exclude', TAG),
      limit: v.num(raw, 'limit', TAG, { def: 8, min: 1, max: 100 }),
      threshold: v.num(raw, 'threshold', TAG, { def: 20, min: 0, max: 100 }),
    };
  }

  private model(h: HomeAssistant): Battery[] {
    return batteries(h, { entities: this.config.entities, exclude: this.config.exclude, limit: this.config.limit });
  }

  protected signature(h: HomeAssistant): string {
    return JSON.stringify(this.model(h));
  }

  getCardSize(): number {
    return 1 + (this._hass && this.config ? Math.max(1, this.model(this._hass).length) : 1);
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const list = this.model(h);
    return html`<div class="stamina">
      <h2>${this.config.title}</h2>
      ${list.length === 0
        ? html`<div class="done">${C.staminaNone}</div>`
        : html`<div class="panel bars">${list.map((b) => this.row(b))}</div>`}
    </div>`;
  }

  private row(b: Battery): TemplateResult {
    const pct = Math.min(100, Math.max(0, Math.round(b.pct)));
    const filled = Math.ceil(pct / 20);
    const low = pct <= this.config.threshold;
    const color = low ? A.staminaLow : A.staminaOk;
    const segs = Array.from({ length: SEGMENTS }, (_, i) =>
      html`<i class="seg ${low && i === 0 ? 'pulse' : ''}" style="background:${i < filled || (low && i === 0) ? color : A.staminaEmpty}"></i>`,
    );
    return html`<div class="stamina-row" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${b.name} battery ${pct} percent">
      <span class="name">${b.name}</span>
      <span class="segs" aria-hidden="true">${segs}</span>
      <span class="pct"><span class="num">${pct}</span> %</span>
    </div>`;
  }
}

registerCard(TAG, CuestStaminaCard, { name: 'Cuest stamina', description: 'Battery levels as stamina bars.' });
