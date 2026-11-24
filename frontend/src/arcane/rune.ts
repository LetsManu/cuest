import { html, nothing, svg, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HassState, HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { fmtNumber, fmtTemp, num } from './format';
import { ARCANE, FONT_BODY } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-rune-gauge';
const CIRCUMFERENCE = 277;
const DEBOUNCE_MS = 800;

export type RuneKind = 'fire' | 'water' | 'arcane';
const RUNES: readonly RuneKind[] = ['fire', 'water', 'arcane'];
const PRESET: Record<RuneKind, { arc: string; text: string; ring: string; name: string }> = {
  fire: { arc: A.ember, text: A.lantern, ring: A.rim, name: 'Fire' },
  water: { arc: A.manaFrom, text: A.waterText, ring: A.waterRing, name: 'Water' },
  arcane: { arc: A.arcane, text: A.arcaneText, ring: A.rim, name: 'Arcane' },
};

interface RuneConfig {
  entity: string;
  rune?: RuneKind;
  name?: string;
  min?: number;
  max?: number;
  controls: boolean;
}

export interface RuneView {
  rune: RuneKind;
  p: number;
  centre: string;
  sub: string;
  label: string;
  /** Climate target the +/- buttons start from; null when there are no buttons. */
  adjust: { target: number; min: number; max: number; step: number } | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const frac = (x: number | null, min: number, max: number): number => (x === null ? 0 : clamp((x - min) / (max - min), 0, 1));
const unavailable = (s: HassState): boolean => s.state === 'unavailable' || s.state === 'unknown';
const unitOf = (s: HassState): string => (typeof s.attributes.unit_of_measurement === 'string' ? s.attributes.unit_of_measurement : '');

function climateView(s: HassState, cfg: RuneConfig, target: number | null): RuneView {
  const rune = cfg.rune ?? 'fire';
  const rn = PRESET[rune].name;
  const a = s.attributes;
  const min = num(a.min_temp) ?? 7;
  const max = num(a.max_temp) ?? 35;
  const step = num(a.target_temp_step) || 0.5;
  const cur = num(a.current_temperature);
  const resting = fill(C.runeResting, { Rune: rn });
  if (unavailable(s)) return { rune, p: 0, centre: '—', sub: '', label: resting, adjust: null };
  if (s.state === 'off') return { rune, p: 0, centre: fmtTemp(cur), sub: '', label: resting, adjust: null };
  const action = typeof a.hvac_action === 'string' && a.hvac_action ? a.hvac_action : 'idle';
  const title = fill(C.runeTitle, { Rune: rn, action });
  const now = cur === null ? '' : fill(C.runeNow, { v: fmtTemp(cur) });
  const tgt = target ?? num(a.temperature);
  if (tgt === null) {
    const lo = num(a.target_temp_low);
    const hi = num(a.target_temp_high);
    if (lo !== null && hi !== null) {
      return { rune, p: frac(hi, min, max), centre: `${fmtNumber(lo)}–${fmtTemp(hi)}`, sub: now, label: title, adjust: null };
    }
    return { rune, p: 0, centre: '—', sub: now, label: title, adjust: null };
  }
  const p = frac(tgt, min, max);
  if (!cfg.controls) return { rune, p, centre: fmtTemp(cur), sub: '', label: fill(C.runeTo, { Rune: rn, t: fmtTemp(tgt) }), adjust: null };
  return { rune, p, centre: fmtTemp(tgt), sub: now, label: title, adjust: { target: tgt, min, max, step } };
}

function sensorView(s: HassState, cfg: RuneConfig): RuneView {
  const rune = cfg.rune ?? (s.attributes.device_class === 'humidity' ? 'water' : 'arcane');
  const rn = PRESET[rune].name;
  const fn = typeof s.attributes.friendly_name === 'string' ? s.attributes.friendly_name : '';
  const name = cfg.name ?? fn;
  const min = cfg.min ?? 0;
  const max = cfg.max ?? 100;
  const x = num(s.state);
  if (x === null) return { rune, p: 0, centre: '—', sub: '', label: fill(C.runeResting, { Rune: rn }), adjust: null };
  return { rune, p: frac(x, min, max), centre: `${fmtNumber(x)}${unitOf(s)}`, sub: '', label: fill(C.runeTitle, { Rune: rn, action: name }).replace(/ · $/, ''), adjust: null };
}

export function runeView(s: HassState, entity: string, cfg: RuneConfig, target: number | null = null): RuneView {
  return entity.startsWith('climate.') ? climateView(s, cfg, target) : sensorView(s, cfg);
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class CuestRuneGauge extends ArcaneCard<RuneConfig> {
  readonly tag = TAG;

  static styles = [
    ...ArcaneCard.styles,
    css`
      .rune{display:flex;align-items:center;gap:12px}
      .rune.compact{flex-direction:column;justify-content:center;text-align:center}
      .side{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
      .label{font-size:15px;font-weight:700}
      .btns{display:flex;gap:8px}
      .btn{width:48px;height:48px;min-width:48px;min-height:48px;border-radius:12px;border:2px solid ${u(A.panelBorder)};background:${u(A.bg)};font:700 20px ${u(FONT_BODY)};cursor:pointer;padding:0}
      .btn.cool{color:${u(A.manaFrom)}}
      .btn.warm{color:${u(A.emberText)};border-color:${u(A.rim)}}
      .num{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums}
      .gauge-sub{font-family:${u(FONT_BODY)}}
    `,
  ];

  private _pending: number | null = null;
  private _base: number | null = null;
  private _timer?: ReturnType<typeof setTimeout>;

  static getStubConfig(h?: HomeAssistant): object {
    const hit = h && Object.keys(h.states).find((id) => id.startsWith('climate.'));
    return { entity: hit ?? '' };
  }

  protected validate(raw: Record<string, unknown>): RuneConfig {
    const entity = v.entity(raw, 'entity', TAG, ['climate', 'sensor'], true) as string;
    const cfg: RuneConfig = { entity, controls: v.bool(raw, 'controls', TAG, true) };
    if (raw.rune !== undefined && raw.rune !== null) cfg.rune = v.oneOf(raw, 'rune', TAG, RUNES, 'fire');
    const name = v.str(raw, 'name', TAG);
    if (name) cfg.name = name;
    if (raw.min !== undefined && raw.min !== null) cfg.min = v.num(raw, 'min', TAG, { def: 0 });
    if (raw.max !== undefined && raw.max !== null) cfg.max = v.num(raw, 'max', TAG, { def: 100 });
    if ((cfg.min ?? 0) >= (cfg.max ?? 100)) throw new ConfigError(`${TAG}: "min" must be below "max"`);
    this.cancel();
    return cfg;
  }

  protected signature(h: HomeAssistant): string {
    const s = h.states[this.config.entity];
    return s ? JSON.stringify([s.state, s.attributes]) : '';
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions() {
    return this.config?.controls === false ? { columns: 6, rows: 3 } : { columns: 12, rows: 3 };
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancel();
  }

  private cancel(): void {
    if (this._timer !== undefined) clearTimeout(this._timer);
    this._timer = undefined;
    this._pending = null;
    this._base = null;
  }

  private tap(dir: 1 | -1, view: RuneView): void {
    const a = view.adjust;
    if (!a) return;
    const from = this._pending ?? a.target;
    if (this._pending === null) this._base = a.target;
    this._pending = clamp(round4(from + dir * a.step), a.min, a.max);
    if (this._timer !== undefined) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.send(), DEBOUNCE_MS);
    this.requestUpdate();
  }

  private send(): void {
    this._timer = undefined;
    const target = this._pending;
    const h = this._hass;
    if (target === null || !h || target === this._base) {
      this._pending = null;
      this.requestUpdate();
      return;
    }
    Promise.resolve(h.callService('climate', 'set_temperature', { entity_id: this.config.entity, temperature: target })).catch(() => {
      this._pending = null;
      this.requestUpdate();
    });
  }

  /** The pending tap wins until the thermostat reports a different target than the one tapped from. */
  private shown(s: HassState): number | null {
    if (this._pending === null) return null;
    if (this._timer === undefined && num(s.attributes.temperature) !== this._base) {
      this._pending = null;
      return null;
    }
    return this._pending;
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    const id = this.config.entity;
    const s = h.states[id];
    if (!s) return html`${this.missing(id)}`;
    const view = runeView(s, id, this.config, this.shown(s));
    const pr = PRESET[view.rune];
    const compact = !view.adjust && (this.config.controls === false || !id.startsWith('climate.'));
    const aria = view.sub ? `${pr.name} rune: ${view.centre}, ${view.sub}` : `${pr.name} rune: ${view.centre}`;
    const dash = `${Number((CIRCUMFERENCE * view.p).toFixed(1))} ${CIRCUMFERENCE}`;
    const y = view.sub ? 58 : 66;
    return html`<div class="panel"><div class="rune ${compact ? 'compact' : ''}">
      <svg width="110" height="110" viewBox="0 0 120 120" role="img" aria-label="${aria}">
        <circle class="spin" cx="60" cy="60" r="56" fill="none" stroke="${pr.ring}" stroke-width="2" stroke-dasharray="1 7"/>
        ${view.rune === 'arcane' ? svg`<polygon class="spinr" points="60,14 100,83 20,83" fill="none" stroke="${A.arcaneRing}" stroke-width="1.5"/>` : nothing}
        <circle cx="60" cy="60" r="44" fill="none" stroke="${A.track}" stroke-width="10"/>
        <circle data-arc cx="60" cy="60" r="44" fill="none" stroke="${pr.arc}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash}" transform="rotate(-90 60 60)"/>
        <text class="num" x="60" y="${y}" text-anchor="middle" font-size="22" fill="${pr.text}">${view.centre}</text>
        ${view.sub ? svg`<text class="gauge-sub" x="60" y="78" text-anchor="middle" font-size="11" fill="${A.muted}">${view.sub}</text>` : nothing}
      </svg>
      <div class="side">
        <span class="label">${view.label}</span>
        ${view.adjust
          ? html`<div class="btns">
              <button type="button" class="btn cool" aria-label="Cooler" @click=${() => this.tap(-1, view)}>−</button>
              <button type="button" class="btn warm" aria-label="Warmer" @click=${() => this.tap(1, view)}>+</button>
            </div>`
          : nothing}
      </div>
    </div></div>`;
  }
}

registerCard(TAG, CuestRuneGauge, { name: 'Arcane rune gauge', description: 'A fire, water or arcane rune for a thermostat or sensor.' });
