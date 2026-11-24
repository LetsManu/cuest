import { html, nothing, css, unsafeCSS, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ArcaneCard, ConfigError, navigate, registerCard, v } from './base';
import { ARCANE_COPY, fill } from './copy';
import { collectFaults, type Fault } from './house';
import { renderOrb } from './orb';
import { ARCANE, FONT_BODY, FONT_PIXEL } from './theme';

const C = ARCANE_COPY;
const A = ARCANE;
const u = unsafeCSS;
const TAG = 'cuest-quest-board';

interface BoardConfig {
  title?: string;
  battery_threshold: number;
  exclude: string[];
  variant: 'full' | 'compact';
  limit: number | null;
  more_path?: string;
  show_summary: boolean;
  allow_add: boolean;
}

type AddState = 'added' | 'already' | 'failed';

/** Digits in Inter 700 tabular, words stay in the pixel face. */
const withNums = (s: string): TemplateResult[] =>
  s.split(/(\d+)/).map((part, i) => (i % 2 ? html`<span class="num">${part}</span>` : html`${part}`));

export class CuestQuestBoard extends ArcaneCard<BoardConfig> {
  readonly tag = TAG;

  /** Synchronous guard: a second tap while a request is in flight does nothing. */
  private busy = new Set<string>();
  private results = new Map<string, AddState>();

  static styles = [
    ...ArcaneCard.styles,
    css`
      .board{display:flex;flex-direction:column;gap:12px}
      .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .link{background:none;border:0;padding:0 2px;min-height:44px;color:${u(A.goldText)};font:600 14px ${u(FONT_BODY)};cursor:pointer}
      .link:hover{color:${u(A.lantern)}}
      .summary{display:flex;align-items:center;gap:14px}
      .summary .info{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}
      .health{font-family:${u(FONT_PIXEL)};font-size:20px;color:${u(A.healthFrom)}}
      .sum{font-size:13px;color:${u(A.soft)}}
      .chips{display:flex;gap:6px;flex-wrap:wrap}
      .chip{background:#2A2F48;border-radius:999px;padding:3px 9px;font-size:11px}
      .num{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums}
      .scroll{background:${u(A.parchment)};border:2px solid ${u(A.parchmentBorder)};border-radius:6px;box-shadow:3px 3px 0 ${u(A.parchmentShadow)};padding:12px;color:${u(A.ink)};display:flex;flex-direction:column;gap:10px}
      .top{display:flex;gap:10px;align-items:flex-start}
      .badge{font-family:${u(FONT_PIXEL)};background:${u(A.scrollBang)};border-radius:4px;padding:2px 7px;font-size:13px;color:${u(A.ink)}}
      .badge.up{background:${u(A.scrollUpdate)}}
      .body{flex:1;min-width:0}
      .title{display:block;font-weight:700;font-size:15px;overflow-wrap:anywhere}
      .detail{font-size:13px;color:${u(A.inkDetail)}}
      .xp{font-family:${u(FONT_PIXEL)};font-size:13px;color:${u(A.xpBadgeText)};white-space:nowrap}
      .btn{align-self:flex-start;min-height:44px;border:2px solid ${u(A.xpBadgeText)};background:${u(A.xpBadgeText)};color:${u(A.parchment)};border-radius:10px;padding:0 14px;font:600 13px ${u(FONT_BODY)};cursor:pointer}
      .btn:disabled{opacity:.6;cursor:default}
      .note{font-size:13px;font-weight:600;color:${u(A.xpBadgeText)}}
      .note.soft{color:${u(A.inkDetail)}}
      .done{background:${u(A.wellDoneBg)};border:2px solid ${u(A.wellDoneBorder)};border-radius:14px;padding:12px;font-size:13px;color:${u(A.wellDoneText)}}
      .row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;min-height:44px;text-align:left;background:${u(A.parchment)};border:2px solid ${u(A.parchmentBorder)};border-radius:6px;box-shadow:3px 3px 0 ${u(A.parchmentShadow)};padding:10px 12px;color:${u(A.ink)};font-family:${u(FONT_BODY)}}
      button.row{cursor:pointer}
      .row .body{font-size:14px}
      .row .detail{font-size:12px}
    `,
  ];

  static getStubConfig(): object {
    return {};
  }

  protected validate(raw: Record<string, unknown>): BoardConfig {
    const variant = v.oneOf(raw, 'variant', TAG, ['full', 'compact'] as const, 'full');
    const exclude = v.list(raw, 'exclude', TAG);
    if (!exclude.every((x) => typeof x === 'string')) throw new ConfigError(`${TAG}: "exclude" must be a list of text`);
    const title = v.str(raw, 'title', TAG);
    const more = v.str(raw, 'more_path', TAG);
    return {
      ...(title ? { title } : {}),
      battery_threshold: v.num(raw, 'battery_threshold', TAG, { def: 20, min: 1, max: 100 }),
      exclude: exclude as string[],
      variant,
      limit: raw.limit === undefined || raw.limit === null ? (variant === 'compact' ? 2 : null) : v.num(raw, 'limit', TAG, { def: 2, min: 1, max: 100 }),
      ...(more ? { more_path: more } : {}),
      show_summary: v.bool(raw, 'show_summary', TAG, false),
      allow_add: v.bool(raw, 'allow_add', TAG, true),
    };
  }

  private model(h: HomeAssistant) {
    return collectFaults(h, { batteryThreshold: this.config.battery_threshold, exclude: this.config.exclude });
  }

  protected signature(h: HomeAssistant): string {
    const m = this.model(h);
    return JSON.stringify([m.faults, this.config.show_summary ? [m.health, m.checked] : null, !!h.user?.is_admin]);
  }

  private shown(h: HomeAssistant): Fault[] {
    const all = this.model(h).faults;
    return this.config.limit === null ? all : all.slice(0, this.config.limit);
  }

  getCardSize(): number {
    return 2 + (this._hass && this.config ? this.shown(this._hass).length : 0);
  }

  private openQuestTitles(h: HomeAssistant): string[] {
    const q = h.states['sensor.cuest_open_quests']?.attributes?.quests;
    return Array.isArray(q) ? q.filter((x): x is string => typeof x === 'string') : [];
  }

  private async add(f: Fault): Promise<void> {
    const h = this._hass;
    if (!h || this.busy.has(f.id) || (this.results.has(f.id) && this.results.get(f.id) !== 'failed')) return;
    this.busy.add(f.id);
    this.results.delete(f.id);
    try {
      if (this.openQuestTitles(h).includes(f.title)) {
        this.results.set(f.id, 'already');
        return;
      }
      this.requestUpdate();
      await h.callApi?.('POST', 'cuest/quests', { title: f.title, energy: 'low', minutes: f.minutes, xp: f.xp });
      this.results.set(f.id, 'added');
    } catch {
      this.results.set(f.id, 'failed');
    } finally {
      this.busy.delete(f.id);
      this.requestUpdate();
    }
  }

  private async install(f: Fault): Promise<void> {
    const h = this._hass;
    if (!h || this.busy.has(f.id)) return;
    this.busy.add(f.id);
    this.results.delete(f.id);
    this.requestUpdate();
    try {
      await h.callService('update', 'install', { entity_id: f.entityIds[0] });
    } catch {
      this.results.set(f.id, 'failed');
    } finally {
      this.busy.delete(f.id);
      this.requestUpdate();
    }
  }

  protected render(): TemplateResult | typeof nothing {
    const h = this._hass;
    if (!h || !this.config) return nothing;
    return this.config.variant === 'compact' ? this.compact(h) : this.full(h);
  }

  private chips(faults: Fault[]): TemplateResult[] {
    const count = (kinds: Fault['kind'][]) => faults.filter((f) => kinds.includes(f.kind)).length;
    const devices = faults.filter((f) => f.kind === 'problem').reduce((n, f) => n + f.entityIds.length, 0);
    const defs: [number, string, string][] = [
      [devices, C.chips.device, C.chips.devices],
      [count(['battery_critical', 'battery_low']), C.chips.battery, C.chips.batteries],
      [count(['update']), C.chips.update, C.chips.updates],
      [count(['temperature']), C.chips.sensor, C.chips.sensors],
    ];
    return defs.filter(([n]) => n > 0).map(([n, one, many]) => html`<span class="chip">${withNums(n === 1 ? one : fill(many, { n }))}</span>`);
  }

  private summary(h: HomeAssistant, m: ReturnType<CuestQuestBoard['model']>): TemplateResult {
    const n = m.faults.length;
    const val = { p: m.health / 100, text: `${m.health}%`, label: C.orb.health.label, sublabel: '', aria: `${C.orb.health.label}: ${m.health} percent` };
    return html`<div class="panel rim summary">
      ${renderOrb(val, 'health', 0, 80, { ring: false })}
      <div class="info">
        <div class="health">${C.orb.health.label} <span class="num">${val.text}</span></div>
        ${n > 0 ? html`<div class="sum">${withNums(n === 1 ? C.boardSummaryOne : fill(C.boardSummary, { n }))}</div>` : nothing}
        <div class="chips">${this.chips(m.faults)}</div>
      </div>
    </div>`;
  }

  private full(h: HomeAssistant): TemplateResult {
    const m = this.model(h);
    const faults = this.shown(h);
    const admin = !!h.user?.is_admin && this.config.allow_add;
    return html`<div class="board">
      ${this.config.title ? html`<h2>${this.config.title}</h2>` : nothing}
      ${this.config.show_summary ? this.summary(h, m) : nothing}
      <h2>${C.quickQuests}</h2>
      ${faults.length === 0
        ? html`<div class="done">${C.boardEmpty}</div>`
        : html`${faults.map((f, i) => this.questScroll(f, i === 0, admin))}<div class="done">${C.boardFooter}</div>`}
    </div>`;
  }

  private questScroll(f: Fault, first: boolean, admin: boolean): TemplateResult {
    const isUpdate = f.kind === 'update';
    const res = this.results.get(f.id);
    const busy = this.busy.has(f.id);
    let action: TemplateResult | typeof nothing = nothing;
    if (admin && isUpdate) {
      action = html`<button type="button" class="btn" ?disabled=${busy} @click=${() => this.install(f)}>${C.install}</button>`;
    } else if (admin && res !== 'added' && res !== 'already') {
      action = html`<button type="button" class="btn" ?disabled=${busy} @click=${() => this.add(f)}>${C.add}</button>`;
    }
    const note = res === 'added' ? html`<span class="note" role="status">${C.added}</span>` : res === 'already' ? html`<span class="note soft" role="status">${C.already}</span>` : res === 'failed' ? html`<span class="note soft" role="status">${C.addFailed}</span>` : nothing;
    const showXp = !(admin && isUpdate);
    return html`<div class="scroll">
      <div class="top">
        <span class="badge ${isUpdate ? 'up' : ''} ${first ? 'pulse' : ''}" aria-hidden="true">${isUpdate ? '↑' : '!'}</span>
        <div class="body"><span class="title">${f.title}</span><div class="detail">${f.detail}</div></div>
        ${showXp ? html`<span class="xp">${withNums(`+${f.xp} XP`)}</span>` : nothing}
      </div>
      ${action}${note}
    </div>`;
  }

  private compact(h: HomeAssistant): TemplateResult {
    const all = this.model(h).faults;
    const faults = this.shown(h);
    const path = this.config.more_path;
    const rest = all.length - faults.length;
    const go = path ? () => navigate(path) : undefined;
    return html`<div class="board">
      <div class="head">
        <h2>${this.config.title ?? C.boardTitle}</h2>
        ${path ? html`<button type="button" class="link" @click=${go}>${withNums(fill(C.allLink, { n: all.length }))}</button>` : nothing}
      </div>
      ${faults.length === 0
        ? html`<div class="done">${C.boardEmpty}</div>`
        : faults.map((f) => this.row(f, go))}
      ${rest > 0 && path ? html`<button type="button" class="link" @click=${go}>${withNums(fill(C.more, { n: rest }))}</button>` : nothing}
    </div>`;
  }

  private row(f: Fault, go?: () => void): TemplateResult {
    const isUpdate = f.kind === 'update';
    const inner = html`<span class="badge ${isUpdate ? 'up' : ''}" aria-hidden="true">${isUpdate ? '↑' : '!'}</span>
      <span class="body"><span class="title">${f.title}</span><div class="detail">${f.detail}</div></span>
      <span class="xp">${withNums(`+${f.xp} XP`)}</span>`;
    return go ? html`<button type="button" class="row" @click=${go}>${inner}</button>` : html`<div class="row">${inner}</div>`;
  }
}

registerCard(TAG, CuestQuestBoard, { name: 'Cuest quest board', description: 'Small quests from your house: low batteries, problems and updates.' });
