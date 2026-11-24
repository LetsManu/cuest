import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import type { ShopItem, ShopView } from '../api';
import { COLORS, FONT_PIXEL } from '../palette';
import { SPRITE_H, SPRITE_W, spriteShadow, stageForLevel, type Palette } from '../sprite';
import { STRINGS } from '../strings';

export type ShopTab = 'treat' | 'wardrobe' | 'decor' | 'helper';
export const SHOP_TABS: ShopTab[] = ['treat', 'wardrobe', 'decor', 'helper'];

export interface ShopProps {
  shop: ShopView | null;
  level: number;
  tab: ShopTab;
  leading: unknown;
  canSwitch: boolean;
  busy: Record<string, boolean>;
  onSwitch(): void;
  onTab(t: ShopTab): void;
  onBuy(item: ShopItem): void;
  onEquip(item: ShopItem): void;
}

/** 24-hour local HH:MM, e.g. "07:05"; '' when the date is missing or invalid. */
export function clock24(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const shopStyles = css`
  .shophead{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .shophead .hint{font-size:13px;color:${unsafeCSS(COLORS.muted)}}
  .tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
  .tabs button{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:10px;min-height:44px;font:inherit;font-weight:800;font-size:12px;color:${unsafeCSS(COLORS.ink)};padding:0 4px;cursor:pointer;overflow-wrap:anywhere}
  .tabs button[aria-pressed="true"]{background:${unsafeCSS(COLORS.forest)};border-color:${unsafeCSS(COLORS.forest)};color:${unsafeCSS(COLORS.card)}}
  .shopitem{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:10px}
  .shopitem .text{flex:1;min-width:0}
  .shopitem .name{font-weight:800;overflow-wrap:anywhere}
  .shopitem .desc{font-size:12px;color:${unsafeCSS(COLORS.muted)}}
  .swatch{width:40px;height:40px;flex:none;border-radius:10px;border:2px solid rgba(43,42,51,.15);display:flex;align-items:center;justify-content:center;font-family:${unsafeCSS(FONT_PIXEL)};font-weight:700;overflow:hidden;position:relative}
  .swatch .mini{position:relative;width:${SPRITE_W}px;height:${SPRITE_H}px;flex:none}
  .shopitem .btn{min-height:44px;font-size:13px;padding:0 10px;flex:none;border:2px solid transparent;border-radius:12px;font-weight:800;cursor:pointer}
  .shopitem .btn.amber{background:${unsafeCSS(COLORS.amber)};color:${unsafeCSS(COLORS.ink)}}
  .shopitem .btn.owned{background:#DCEAE2;color:#1F4238}
  .shopitem .btn.saving{background:transparent;border:2px dashed #C9B791;color:${unsafeCSS(COLORS.muted)};cursor:default}
  .shopitem .btn:disabled:not(.saving){opacity:.55;cursor:default}
  .shopfoot{margin:0;font-size:12px;color:${unsafeCSS(COLORS.muted)};text-align:center}
`;

const MARKS: Record<string, { bg: string; fg: string; mark: string }> = {
  lantern: { bg: '#F7D27A', fg: '#2B2A33', mark: '▮' },
  flowers: { bg: '#E89A8A', fg: '#2B2A33', mark: '✿' },
  cat: { bg: '#4A3A2A', fg: '#FFF9EC', mark: 'ᓚ' },
  fountain: { bg: '#BFE3E0', fg: '#2B2A33', mark: '≈' },
  rest_token: { bg: '#DCEAE2', fg: '#2B2A33', mark: 'R' },
  mystery_chest: { bg: '#A8743F', fg: '#FFF9EC', mark: '?' },
  xp_potion: { bg: '#F6E2B8', fg: '#2B2A33', mark: '×2' },
};

function describe(it: ShopItem): string {
  return STRINGS.itemDesc[it.id] ?? (it.kind === 'treat' ? STRINGS.treatDesc : '');
}

function swatch(it: ShopItem, level: number): TemplateResult {
  if (it.kind === 'wardrobe') {
    const pal: Palette = it.palette ?? {};
    return html`<div class="swatch" style="background:#EDE3CC" aria-hidden="true" data-swatch="wardrobe"><div class="mini">
      <div style="position:absolute;left:-1px;top:-1px;width:1px;height:1px;box-shadow:${spriteShadow(stageForLevel(level), 1, pal)}"></div></div></div>`;
  }
  const m = MARKS[it.id] ?? { bg: '#DCEAE2', fg: '#2B2A33', mark: it.kind === 'treat' ? '☾' : '' };
  return html`<div class="swatch" style="background:${m.bg};color:${m.fg}" aria-hidden="true">${m.mark}</div>`;
}

function button(p: ShopProps, it: ShopItem, gold: number): TemplateResult {
  const busy = !!p.busy[`shop:${it.id}`];
  if (it.kind === 'wardrobe' && it.owned) {
    const on = !!it.slot && p.shop?.equipped[it.slot] === it.id;
    return html`<button type="button" class="btn owned" data-item="${it.id}" data-act="equip" aria-pressed="${on}" ?disabled=${busy} @click=${() => p.onEquip(it)}>${on ? STRINGS.wearing : STRINGS.wear}</button>`;
  }
  if (it.kind === 'decor' && it.owned) return html`<button type="button" class="btn owned" data-item="${it.id}" disabled>${STRINGS.inVillage}</button>`;
  if (gold >= it.cost) return html`<button type="button" class="btn amber" data-item="${it.id}" data-act="buy" ?disabled=${busy} @click=${() => p.onBuy(it)}>${it.cost} ${STRINGS.goldBtn}</button>`;
  return html`<button type="button" class="btn saving" data-item="${it.id}" disabled>${it.cost - gold} ${STRINGS.toGo}</button>`;
}

export function noticeToast(text: string, onDismiss: () => void): TemplateResult {
  return html`<div class="toast" role="status" data-role="toast"><span>${text}</span><button type="button" @click=${onDismiss}>${STRINGS.dismiss}</button></div>`;
}

export function shopView(p: ShopProps): TemplateResult {
  const s = p.shop;
  const gold = s?.gold ?? 0;
  const items = (s?.catalog ?? []).filter((i) => i.kind === p.tab);
  return html`
    <div class="topbar"><span class="topleft">${p.leading}<span class="brand">${STRINGS.shopTitle}</span></span>
      <span class="topright">${p.canSwitch ? html`<button type="button" class="switch" data-act="switch" @click=${p.onSwitch}>${STRINGS.switchPlayer}</button>` : nothing}<span class="gold" aria-label="${gold} ${STRINGS.gold}"><span class="coin"></span>${gold}</span></span></div>
    <div class="shophead"><span class="hint">${STRINGS.shopHint}</span></div>
    <div class="tabs" role="group" aria-label="${STRINGS.shopTabsLabel}">${SHOP_TABS.map((t) => html`<button type="button" data-tab="${t}" aria-pressed="${p.tab === t}" @click=${() => p.onTab(t)}>${STRINGS.shopTabs[t]}</button>`)}</div>
    ${!s ? html`<div class="empty">${STRINGS.shopLoading}</div>` : nothing}
    ${s && !items.length ? html`<div class="empty">${p.tab === 'treat' ? STRINGS.noTreats : STRINGS.nothingHere}</div>` : nothing}
    ${items.map((it) => html`<div class="shopitem">${swatch(it, p.level)}
      <div class="text"><div class="name">${it.name}</div><div class="desc">${describe(it)}</div></div>${button(p, it, gold)}</div>`)}
    <p class="shopfoot">${STRINGS.shopFooter}</p>`;
}
