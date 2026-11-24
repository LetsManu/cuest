import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { heroFor } from './house';
import { ARCANE, FONT_BODY, FONT_PIXEL } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-hero-card';

interface HeroConfig {
  player?: string;
}

/** Digits in Inter 700 tabular, words stay in the pixel face. */
const withNums = (s: string): TemplateResult[] =>
  s.split(/(\d+)/).map((part, i) => (i % 2 ? html`<span class="num">${part}</span>` : html`${part}`));

export class CuestHeroCard extends ArcaneCard<HeroConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .hero{display:flex;flex-direction:column;gap:8px}
      .head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
      .title{font-family:${u(FONT_PIXEL)};font-size:17px;color:${u(A.goldText)}}
      .streak{font-size:12px;color:${u(A.emberText)};font-variant-numeric:tabular-nums}
      .bar{position:relative;height:14px;background:${u(A.well)};border:2px solid ${u(A.gold)};border-radius:8px;overflow:hidden}
      .fill{height:100%;background:linear-gradient(90deg,${u(A.glowTo)},${u(A.lantern)})}
      .rest{font-size:12px;color:${u(A.muted)};font-variant-numeric:tabular-nums}
      .num{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums}
    `,
  ];

  static getStubConfig(): object {
    return {};
  }

  protected validate(raw: Record<string, unknown>): HeroConfig {
    const player = v.str(raw, 'player', TAG);
    return player ? { player } : {};
  }

  protected signature(h: HomeAssistant): string {
    return JSON.stringify(heroFor(h, this.config.player));
  }

  getCardSize(): number {
    return 2;
  }

  getGridOptions() {
    return { columns: 12, rows: 2 };
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const hero = heroFor(h, this.config.player);
    if (!hero) return html`<div class="panel rim"><span class="rest">${C.heroMissing}</span></div>`;
    const keys = hero.chestKeys > 0 ? ` · ${hero.chestKeys === 1 ? C.keyOne : fill(C.keys, { n: hero.chestKeys })}` : '';
    const rest = fill(C.heroRest, { xp: hero.remaining, next: hero.level + 1 }) + keys;
    const line = fill(C.heroLine, { level: hero.level, title: hero.title }).trim();
    return html`<div class="panel rim hero">
      <div class="head">
        <span class="title">${withNums(line)}</span>
        ${hero.streak > 0 ? html`<span class="streak">${fill(C.streak, { n: hero.streak })}</span>` : nothing}
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hero.pct}" aria-label="${line}">
        <div class="fill" style="width:${hero.pct}%"></div><div class="shimmer"></div>
      </div>
      <span class="rest">${rest}</span>
    </div>`;
  }
}

registerCard(TAG, CuestHeroCard, { name: 'Cuest hero', description: 'Level, XP bar, streak and chest keys.' });
