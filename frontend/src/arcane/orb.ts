import { html, nothing, svg, css, unsafeCSS, type SVGTemplateResult, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { fmtPercent, num } from './format';
import { collectFaults, lightStats, matches, onlineShare } from './house';
import { ARCANE, FONT_PIXEL } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-orb-card';

export type OrbColor = 'mana' | 'health' | 'glow';
export type OrbPreset = 'percent' | 'ratio' | 'online' | 'lights' | 'health';

export interface OrbItem {
  preset: OrbPreset;
  entity?: string;
  max?: number | string;
  color: OrbColor;
  label?: string;
  sublabel?: string;
  domains?: string[];
  integrations?: string[];
  exclude?: string[];
  battery_threshold?: number;
}

export interface OrbValue {
  p: number | null;
  text: string;
  label: string;
  sublabel: string;
  aria: string;
}

const PRESETS: readonly OrbPreset[] = ['percent', 'ratio', 'online', 'lights', 'health'];
const COLORS: readonly OrbColor[] = ['mana', 'health', 'glow'];
const DEFAULT_COLOR: Record<OrbPreset, OrbColor> = { percent: 'mana', ratio: 'mana', online: 'mana', health: 'health', lights: 'glow' };
const COLOR_NAME: Record<OrbColor, string> = { mana: C.orb.online.label, health: C.orb.health.label, glow: C.orb.lights.label };
const COLOR_TEXT: Record<OrbColor, string> = { mana: A.manaFrom, health: A.healthFrom, glow: A.lantern };
const GRADIENT: Record<OrbColor, [string, string]> = {
  mana: [A.manaFrom, A.manaTo],
  health: [A.healthFrom, A.healthTo],
  glow: [A.glowFrom, A.glowTo],
};

export function validateOrb(raw: unknown, tag: string): OrbItem {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${tag}: each orb must be an object`);
  const r = raw as Record<string, unknown>;
  v.str(r, 'preset', tag, true);
  const preset = v.oneOf(r, 'preset', tag, PRESETS, 'online');
  const needsEntity = preset === 'percent' || preset === 'ratio';
  const item: OrbItem = {
    preset,
    color: v.oneOf(r, 'color', tag, COLORS, DEFAULT_COLOR[preset]),
  };
  const entity = v.entity(r, 'entity', tag, undefined, needsEntity);
  if (entity) item.entity = entity;
  if (preset === 'ratio') {
    const m = r.max;
    if (typeof m === 'number' && Number.isFinite(m) && m > 0) item.max = m;
    else if (typeof m === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(m)) item.max = m;
    else throw new ConfigError(`${tag}: "max" must be a number above 0 or an entity id`);
  }
  const label = v.str(r, 'label', tag);
  if (label) item.label = label;
  const sublabel = v.str(r, 'sublabel', tag);
  if (sublabel) item.sublabel = sublabel;
  for (const k of ['domains', 'integrations', 'exclude'] as const) {
    const l = v.strings(r, k, tag);
    if (l.length) item[k] = l;
  }
  if (preset === 'health') item.battery_threshold = v.num(r, 'battery_threshold', tag, { def: 20, min: 1, max: 100 });
  return item;
}

const stateNum = (h: HomeAssistant, id: string | undefined): number | null => (id && h.states[id] ? num(h.states[id].state) : null);
const clamp = (p: number): number => Math.min(1, Math.max(0, p));
const pctOf = (p: number | null): number => Math.round(100 * (p ?? 0));

/** Entity ids this orb reads that are missing from hass (they get a warning instead of an orb). */
export function missingOrbEntity(h: HomeAssistant, item: OrbItem): string | null {
  for (const id of [item.entity, typeof item.max === 'string' ? item.max : undefined]) {
    if (id && !h.states[id]) return id;
  }
  return null;
}

export function orbValue(h: HomeAssistant, item: OrbItem): OrbValue {
  const name = item.label ?? COLOR_NAME[item.color];
  const out = (p: number | null, text: string, sublabel: string, aria: string): OrbValue => ({
    p: p === null ? null : clamp(p),
    text,
    label: name,
    sublabel: item.sublabel ?? sublabel,
    aria: p === null ? fill(C.orbAria.unknown, { name }) : aria,
  });
  switch (item.preset) {
    case 'percent': {
      const x = stateNum(h, item.entity);
      return out(x === null ? null : x / 100, fmtPercent(x), '', fill(C.orbAria.percent, { name, n: Math.round(x ?? 0) }));
    }
    case 'ratio': {
      const x = stateNum(h, item.entity);
      const max = typeof item.max === 'number' ? item.max : stateNum(h, item.max);
      const p = x === null || max === null || max <= 0 ? null : x / max;
      return out(p, fmtPercent(p === null ? null : 100 * p), '', fill(C.orbAria.percent, { name, n: pctOf(p) }));
    }
    case 'online': {
      const s = onlineShare(h, { domains: item.domains, integrations: item.integrations, exclude: item.exclude });
      const p = s.pct === null ? null : s.pct / 100;
      return out(p, fmtPercent(s.pct), C.orb.online.unit, fill(C.orbAria.online, { name, n: s.pct ?? 0 }));
    }
    case 'lights': {
      const ex = item.exclude ?? [];
      const s = lightStats(h, (id) => !matches(id, ex));
      const p = s.total === 0 ? null : s.on / s.total;
      const unit = s.on === 1 ? C.orb.lights.unitOne : C.orb.lights.unit;
      const aria = fill(s.on === 1 ? C.orbAria.lightsOne : C.orbAria.lights, { name, n: s.on, unit });
      const o = out(p, String(s.on), unit, aria);
      if (p === null) o.aria = aria;
      return o;
    }
    case 'health': {
      const f = collectFaults(h, { batteryThreshold: item.battery_threshold ?? 20, exclude: item.exclude ?? [] });
      const n = f.faults.length;
      const sub = n === 1 ? C.orb.health.unitOne : fill(C.orb.health.unit, { n });
      return out(f.health / 100, `${f.health}%`, sub, fill(C.orbAria.percent, { name, n: f.health }));
    }
  }
}

const WAVE_Y = (p: number): number => Number((86 - 104 * p).toFixed(2));

/** One liquid orb. `index` keeps gradient and clip-path ids unique inside a shadow root. */
export function renderOrb(v: OrbValue, color: OrbColor, index: number, size: number, opts: { ring: boolean }): SVGTemplateResult {
  const p = clamp(v.p ?? 0);
  const t = WAVE_Y(p);
  const back = Number((t - 2).toFixed(2));
  const [from, to] = GRADIENT[color];
  const clip = `orb-${index}-clip`;
  const grad = `orb-${index}-grad`;
  const small = size <= 72;
  const wave = (q: number) => `M0 26 Q15 ${q} 30 26 T60 26 T90 26 T120 26 T150 26 T180 26 T210 26 V140 H0 Z`;
  return svg`<svg class="orb" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${v.aria}">
    <defs><clipPath id="${clip}"><circle cx="60" cy="60" r="52"/></clipPath>
      <linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <circle cx="60" cy="60" r="52" fill="${A.well}"/>
    <g clip-path="url(#${clip})">
      ${color === 'mana' ? svg`<g data-wave="back" transform="translate(0,${back})"><g class="wave2"><path d="${wave(20)}" fill="${A.manaBack}" opacity="0.7"/></g></g>` : ''}
      <g data-wave="front" transform="translate(0,${t})"><g class="wave"><path d="${wave(18)}" fill="url(#${grad})"/></g></g>
      ${size < 96 ? '' : svg`<ellipse cx="42" cy="38" rx="14" ry="8" fill="#FFFFFF" opacity="0.18"/>`}
    </g>
    <circle cx="60" cy="60" r="54" fill="none" stroke="${A.gold}" stroke-width="${small ? 5 : 4}"/>
    ${opts.ring ? svg`<circle class="spin" cx="60" cy="60" r="58" fill="none" stroke="${A.gold}" stroke-width="1.5" stroke-dasharray="3 9" opacity="0.7"/>` : ''}
  </svg>`;
}

export const orbColorText = (c: OrbColor): string => COLOR_TEXT[c];

interface OrbCardConfig {
  orbs: OrbItem[];
}

const SPARKS = [
  { left: 60, bottom: 30, delay: 0, bg: A.waterText },
  { left: 190, bottom: 24, delay: 1.2, bg: '#FFD1C4' },
  { left: 310, bottom: 34, delay: 2.1, bg: A.lantern },
];

export class CuestOrbCard extends ArcaneCard<OrbCardConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .orbs{position:relative;display:flex;justify-content:space-around;padding:16px 8px 12px;overflow:hidden}
      .cell{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
      .cell .line{font-family:${u(FONT_PIXEL)};font-size:14px}
      .cell .sub{font-size:11px;color:${u(A.muted)}}
      .cell .warn{max-width:120px}
    `,
  ];

  static getStubConfig(): object {
    return { preset: 'online' };
  }

  protected validate(raw: Record<string, unknown>): OrbCardConfig {
    if (raw.orbs === undefined || raw.orbs === null) return { orbs: [validateOrb(raw, TAG)] };
    const list = v.list(raw, 'orbs', TAG, 4);
    if (list.length === 0) throw new ConfigError(`${TAG}: "orbs" must have at least 1 item`);
    return { orbs: list.map((o) => validateOrb(o, TAG)) };
  }

  protected signature(h: HomeAssistant): string {
    return JSON.stringify(this.config.orbs.map((o) => [orbValue(h, o), missingOrbEntity(h, o)]));
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions() {
    return { columns: 12, rows: 'auto' as const };
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    return html`<div class="panel rim orbs">
      ${SPARKS.map((s) => html`<span class="spark" style="left:${s.left}px;bottom:${s.bottom}px;animation-delay:${s.delay}s;background:${s.bg}"></span>`)}
      ${this.config.orbs.map((item, i) => this.cell(h, item, i))}
    </div>`;
  }

  private cell(h: HomeAssistant, item: OrbItem, i: number): TemplateResult {
    const gone = missingOrbEntity(h, item);
    if (gone) return html`<div class="cell">${this.missing(gone)}</div>`;
    const val = orbValue(h, item);
    return html`<div class="cell">
      ${renderOrb(val, item.color, i, 96, { ring: item.color === 'mana' })}
      <span class="line" style="color:${COLOR_TEXT[item.color]}">${val.label} <span class="num">${val.text}</span></span>
      ${val.sublabel ? html`<span class="sub">${val.sublabel}</span>` : nothing}
    </div>`;
  }
}

registerCard(TAG, CuestOrbCard, { name: 'Cuest orbs', description: 'Liquid mana, health or glow orbs for your house.' });
