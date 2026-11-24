import { css, html, nothing, svg, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { clockLine, clockZone, fmtTemp, num } from './format';
import { lightStats } from './house';
import { missingOrbEntity, orbColorText, orbValue, renderOrb, validateOrb, type OrbItem } from './orb';
import { ARCANE, FONT_BODY, FONT_PIXEL } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-arcane-header';

interface HeaderConfig {
  title: string;
  mood: string;
  outside?: string;
  inside?: string;
  variant: 'phone' | 'wide';
  orbs: OrbItem[];
}

/** Lit windows out of 5: none when no light is on, otherwise at least one. */
export const litWindows = (on: number, total: number): number => (on === 0 || total === 0 ? 0 : Math.max(1, Math.min(5, Math.round((5 * on) / total))));

const STARS_PHONE = [
  { left: '30px', top: '20px', delay: 0 },
  { left: '96px', top: '46px', delay: 0.8 },
  { left: '170px', top: '18px', delay: 1.6 },
  { left: '250px', top: '40px', delay: 0.4 },
  { left: '330px', top: '24px', delay: 2.2 },
];
const STARS_WIDE = [
  { left: '6%', top: '18px', delay: 0 },
  { left: '22%', top: '40px', delay: 0.8 },
  { left: '48%', top: '16px', delay: 1.6 },
  { left: '66%', top: '34px', delay: 0.4 },
  { left: '88%', top: '22px', delay: 2.2 },
];

// Window order W1..W5; lit ones fill from the first. y = 210 - bottom - height.
const WINDOWS = [
  { x: 42, y: 128, w: 16, h: 16, delay: 0 },
  { x: 68, y: 128, w: 16, h: 16, delay: 1 },
  { x: 94, y: 128, w: 16, h: 16, delay: 0 },
  { x: 172, y: 148, w: 12, h: 12, delay: 2 },
  { x: 245, y: 124, w: 16, h: 12, delay: 0 },
];

export class CuestArcaneHeader extends ArcaneCard<HeaderConfig> {
  readonly tag = TAG;
  private _first?: ReturnType<typeof setTimeout>;
  private _tick?: ReturnType<typeof setInterval>;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .sky{position:relative;overflow:hidden;background:linear-gradient(${u(A.skyTop)},${u(A.skyBottom)});border-bottom:3px solid ${u(A.rim)};border-radius:var(--arc-radius)}
      .sky.phone{height:210px}
      .titles{display:flex;flex-direction:column;gap:4px}
      .phone .titles{position:absolute;left:16px;top:18px}
      h1{margin:0;font-family:${u(FONT_PIXEL)};font-weight:500;color:${u(A.goldText)};font-size:28px}
      .wide h1{font-size:34px}
      .status{font-size:13px;color:${u(A.soft)}}
      .wide .status{font-size:14px;margin-top:4px}
      .moon{position:absolute;right:40px;top:30px;width:34px;height:34px;border-radius:99px;background:#F3E6C0;box-shadow:0 0 24px #F3E6C0}
      .moon-cut{position:absolute;right:30px;top:26px;width:30px;height:30px;border-radius:99px;background:#1A1F3E}
      .village{position:absolute;left:0;bottom:0;width:100%;height:210px}
      .win.lit{animation:flicker 4s ease-in-out infinite}
      .temps{position:absolute;right:16px;bottom:44px;font-size:12px;color:${u(A.soft)};text-align:right}
      .inner{max-width:1280px;margin:0 auto;padding:22px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:24px;position:relative}
      .inner .titles{flex:1 1 260px}
      .orbrow{display:flex;gap:22px;flex-wrap:wrap}
      .orbitem{display:flex;align-items:center;gap:10px}
      .orbitem .val{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums;font-size:18px}
      .orbitem .what{font-size:12px;color:${u(A.muted)}}
      @media (prefers-reduced-motion: reduce){.win.lit{animation:none}}
    `,
  ];

  static getStubConfig(): object {
    return {};
  }

  protected validate(raw: Record<string, unknown>): HeaderConfig {
    const variant = v.oneOf(raw, 'variant', TAG, ['phone', 'wide'] as const, 'phone');
    if (raw.orbs !== undefined && raw.orbs !== null && variant !== 'wide') {
      throw new ConfigError(`${TAG}: "orbs" works only with variant: wide`);
    }
    return {
      title: v.str(raw, 'title', TAG) ?? C.header.title,
      mood: v.str(raw, 'mood', TAG) ?? C.header.mood,
      outside: v.entity(raw, 'outside', TAG),
      inside: v.entity(raw, 'inside', TAG),
      variant,
      orbs: v.list(raw, 'orbs', TAG, 4).map((o) => validateOrb(o, TAG)),
    };
  }

  private temp(h: HomeAssistant, id: string | undefined, template: string): string | null {
    const s = id ? h.states[id] : undefined;
    if (!s) return null;
    const t = num(s.state) ?? num(s.attributes?.current_temperature);
    return t === null ? null : fill(template, { t: fmtTemp(t, h.locale?.language) });
  }

  protected signature(h: HomeAssistant): string {
    const c = this.config;
    const lights = lightStats(h);
    return JSON.stringify([
      c.orbs.map((o) => [orbValue(h, o), missingOrbEntity(h, o)]),
      litWindows(lights.on, lights.total),
      c.outside ? h.states[c.outside]?.state : null,
      c.inside ? h.states[c.inside]?.state : null,
    ]);
  }

  getCardSize(): number {
    return this.config?.variant === 'wide' ? 3 : 4;
  }

  getGridOptions() {
    return { columns: 'full' as const, rows: this.config?.variant === 'wide' ? 3 : 4 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.stopClock();
    this._first = setTimeout(() => {
      this._first = undefined;
      this.requestUpdate();
      this._tick = setInterval(() => this.requestUpdate(), 60_000);
    }, 60_000 - (Date.now() % 60_000));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopClock();
  }

  private stopClock(): void {
    if (this._first !== undefined) clearTimeout(this._first);
    if (this._tick !== undefined) clearInterval(this._tick);
    this._first = this._tick = undefined;
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    return this.config.variant === 'wide' ? this.wide(h) : this.phone(h);
  }

  private clock(h: HomeAssistant): string {
    return clockLine(new Date(), h.locale?.language, clockZone(h.locale, h.config));
  }

  private stars(list: typeof STARS_PHONE): TemplateResult[] {
    return list.map((s) => html`<span class="star" style="left:${s.left};top:${s.top};animation-delay:${s.delay}s"></span>`);
  }

  private phone(h: HomeAssistant): TemplateResult {
    const c = this.config;
    const l = lightStats(h);
    const lit = litWindows(l.on, l.total);
    const out = this.temp(h, c.outside, C.header.outside);
    const inn = this.temp(h, c.inside, C.header.inside);
    return html`<div class="sky phone">
      ${this.stars(STARS_PHONE)}
      <span class="moon"></span><span class="moon-cut"></span>
      <div class="titles"><h1>${c.title}</h1><span class="status">${this.clock(h)} · ${c.mood}</span></div>
      <svg class="village" width="100%" height="210" viewBox="0 0 390 210" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
        <rect class="ground" x="-1200" y="176" width="2790" height="34" fill="${A.wellDoneBg}"/>
        <g class="house"><rect x="28" y="114" width="96" height="62" fill="#3B3226"/><polygon points="20,114 132,114 76,78" fill="#6B3A2E"/><rect x="64" y="150" width="18" height="26" fill="#2A2018"/></g>
        <g class="house"><rect x="150" y="132" width="64" height="44" fill="#34302A"/><polygon points="144,132 220,132 182,106" fill="#5A3328"/></g>
        <rect x="250" y="136" width="6" height="40" fill="#3B3226"/>
        ${WINDOWS.map((w, i) =>
          i < lit
            ? svg`<rect class="win lit" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="${A.goldText}" style="animation-delay:${w.delay}s"/>`
            : svg`<rect class="win" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="${A.windowDark}" style="animation:none"/>`,
        )}
      </svg>
      ${out || inn ? html`<div class="temps">${out ? html`<div>${out}</div>` : nothing}${inn ? html`<div>${inn}</div>` : nothing}</div>` : nothing}
    </div>`;
  }

  private wide(h: HomeAssistant): TemplateResult {
    const c = this.config;
    const out = this.temp(h, c.outside, C.header.outside);
    const inn = this.temp(h, c.inside, C.header.inside);
    const status = [this.clock(h), c.mood, out, inn].filter(Boolean).join(' · ');
    return html`<div class="sky wide">
      ${this.stars(STARS_WIDE)}
      <div class="inner">
        <div class="titles"><h1>${c.title}</h1><div class="status">${status}</div></div>
        ${c.orbs.length ? html`<div class="orbrow">${c.orbs.map((o, i) => this.orbItem(h, o, i))}</div>` : nothing}
      </div>
    </div>`;
  }

  private orbItem(h: HomeAssistant, o: OrbItem, i: number): TemplateResult {
    const gone = missingOrbEntity(h, o);
    if (gone) return html`<div class="orbitem">${this.missing(gone)}</div>`;
    const val = orbValue(h, o);
    return html`<div class="orbitem">
      ${renderOrb(val, o.color, i, 72, { ring: false })}
      <div><div class="val num" style="color:${orbColorText(o.color)}">${val.text}</div>
        <div class="what">${val.sublabel ? `${val.label} · ${val.sublabel}` : val.label}</div></div>
    </div>`;
  }
}

registerCard(TAG, CuestArcaneHeader, { name: 'Cuest header', description: 'Night village header with the clock, mood and optional orbs.' });
