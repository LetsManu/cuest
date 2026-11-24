import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { restingAllies, type Ally } from './house';
import { ARCANE, FONT_BODY } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-allies-card';

interface AlliesConfig {
  title?: string;
  ignore: string[];
  limit: number;
  min_entities: number;
  names?: Record<string, string>;
}

export class CuestAlliesCard extends ArcaneCard<AlliesConfig> {
  readonly tag = TAG;
  private expanded = false;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .allies{display:flex;flex-direction:column;gap:10px}
      .ally{display:flex;align-items:center;gap:10px;font-size:13px}
      .name{width:100px;flex:none;font-weight:600;overflow-wrap:anywhere}
      .track{flex:1;height:10px;background:${u(A.track)};border-radius:3px}
      .fill{display:block;height:100%;border-radius:3px}
      .count{width:74px;flex:none;text-align:right;color:${u(A.muted)}}
      .num{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums}
      .more{align-self:flex-start;min-height:44px;background:none;border:0;padding:0 2px;color:${u(A.goldText)};font:600 14px ${u(FONT_BODY)};cursor:pointer}
      .more:hover{color:${u(A.lantern)}}
      .done{background:${u(A.wellDoneBg)};border:2px solid ${u(A.wellDoneBorder)};border-radius:14px;padding:12px;font-size:13px;color:${u(A.wellDoneText)}}
    `,
  ];

  static getStubConfig(): object {
    return {};
  }

  protected validate(raw: Record<string, unknown>): AlliesConfig {
    const ignore = v.list(raw, 'ignore', TAG);
    if (!ignore.every((x) => typeof x === 'string')) throw new ConfigError(`${TAG}: "ignore" must be a list of text`);
    let names: Record<string, string> | undefined;
    if (raw.names !== undefined && raw.names !== null) {
      const n = raw.names;
      if (typeof n !== 'object' || Array.isArray(n) || !Object.values(n as object).every((x) => typeof x === 'string')) {
        throw new ConfigError(`${TAG}: "names" must map integration names to text`);
      }
      names = n as Record<string, string>;
    }
    const title = v.str(raw, 'title', TAG);
    return {
      ...(title ? { title } : {}),
      ignore: ignore as string[],
      limit: v.num(raw, 'limit', TAG, { def: 4, min: 1, max: 50 }),
      min_entities: v.num(raw, 'min_entities', TAG, { def: 1, min: 1 }),
      ...(names ? { names } : {}),
    };
  }

  private allies(h: HomeAssistant): Ally[] {
    return restingAllies(h, { ignore: this.config.ignore, minEntities: this.config.min_entities, names: this.config.names });
  }

  protected signature(h: HomeAssistant): string {
    return JSON.stringify(this.allies(h));
  }

  setConfig(raw: unknown): void {
    super.setConfig(raw);
    this.expanded = false;
  }

  getCardSize(): number {
    return 2 + (this._hass && this.config ? Math.min(this.allies(this._hass).length, this.config.limit) : 0);
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const all = this.allies(h);
    const shown = this.expanded ? all : all.slice(0, this.config.limit);
    const hidden = all.length - shown.length;
    return html`<div class="allies">
      <h2>${this.config.title ?? C.alliesTitle}</h2>
      ${all.length === 0
        ? html`<div class="done">${C.alliesNone}</div>`
        : html`<div class="panel allies">
            ${shown.map((a) => this.row(a))}
            ${hidden > 0
              ? html`<button type="button" class="more" @click=${() => { this.expanded = true; this.requestUpdate(); }}>${hidden === 1 ? C.alliesMoreOne : fill(C.alliesMore, { n: hidden })}</button>`
              : nothing}
          </div>`}
    </div>`;
  }

  private row(a: Ally): TemplateResult {
    const pct = Math.max(4, Math.round((100 * a.awake) / a.total));
    const color = a.awake === 0 ? A.emberText : A.manaFrom;
    return html`<div class="ally">
      <span class="name">${a.name}</span>
      <span class="track" role="img" aria-label="${a.name}: ${a.awake} of ${a.total} awake"><span class="fill" style="width:${pct}%;background:${color}"></span></span>
      <span class="count"><span class="num">${a.awake}</span> of <span class="num">${a.total}</span></span>
    </div>`;
  }
}

registerCard(TAG, CuestAlliesCard, { name: 'Cuest resting allies', description: 'Integrations that are resting right now.' });
