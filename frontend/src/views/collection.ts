import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import type { CollectionItem } from '../api';
import { COLORS, FONT_PIXEL } from '../palette';
import { SPRITE_H, SPRITE_W, spriteShadow, stageForLevel, type Palette } from '../sprite';
import { STRINGS } from '../strings';
import { decorPreview } from './decor';

export const collectionStyles = css`
  .colgrid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .coltile{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:14px;padding:8px 4px;min-height:112px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;text-align:center;min-width:0}
  .coltile.on{border-color:${unsafeCSS(COLORS.forest)};background:#EEF3EC}
  .coltile b{font-size:13px;overflow-wrap:break-word;hyphens:auto;max-width:100%}
  .coltile .hint{font-size:12px;color:${unsafeCSS(COLORS.muted)};overflow-wrap:break-word;max-width:100%}
  .colbox{position:relative;width:56px;height:60px;flex:none;border-radius:10px;background:#EDE3CC;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .colbox .mini{position:relative;width:${SPRITE_W * 2}px;height:${SPRITE_H * 2}px;flex:none;transform:scale(.95);transform-origin:center}
  .colbox .decorwrap{position:relative;height:24px;display:flex;align-items:flex-end;justify-content:center;transform:scale(1.4);transform-origin:center}
  .colbox.locked{background:#E4DCC8;color:${unsafeCSS(COLORS.muted)};font-family:${unsafeCSS(FONT_PIXEL)};font-size:22px;font-weight:700}
  .colbox.locked .mini{position:absolute;opacity:.35}
  .colbox.locked .q{position:relative}
  .colcount{font-size:13px;color:${unsafeCSS(COLORS.muted)};font-variant-numeric:tabular-nums}
`;

function preview(it: CollectionItem, level: number): TemplateResult {
  if (it.kind === 'wardrobe') {
    const pal: Palette = it.palette ?? {};
    return html`<div class="colbox" data-preview="wardrobe" aria-hidden="true"><div class="mini">
      <div style="position:absolute;left:-2px;top:-2px;width:2px;height:2px;box-shadow:${spriteShadow(stageForLevel(level), 2, pal)}"></div></div></div>`;
  }
  return html`<div class="colbox" data-preview="decor" aria-hidden="true"><span class="decorwrap">${decorPreview(it.id) ?? nothing}</span></div>`;
}

function locked(it: CollectionItem): TemplateResult {
  const dark = it.kind === 'wardrobe'
    ? html`<div class="mini"><div style="position:absolute;left:-2px;top:-2px;width:2px;height:2px;box-shadow:${spriteShadow(0, 2)}"></div></div>`
    : nothing;
  return html`<div class="colbox locked" aria-hidden="true">${dark}<span class="q">?</span></div>`;
}

function tile(it: CollectionItem, level: number): TemplateResult {
  if (it.owned) {
    return html`<li class="coltile on" data-item="${it.id}" aria-label="${it.name}, ${STRINGS.collectionFound}">${preview(it, level)}<b>${it.name}</b></li>`;
  }
  const where = it.lootOnly ? STRINGS.collectionAriaLoot : STRINGS.collectionAriaShop;
  return html`<li class="coltile" data-item="${it.id}" aria-label="${STRINGS.collectionUnknown}, ${where}">${locked(it)}<span class="hint">${it.lootOnly ? STRINGS.collectionLoot : STRINGS.collectionShop}</span></li>`;
}

/** The collection book: every wardrobe and decor item, with the unfound ones as silhouettes. */
export function collectionView(items: CollectionItem[] | null, level: number): TemplateResult | typeof nothing {
  if (!items || !items.length) return nothing;
  const found = items.filter((i) => i.owned).length;
  return html`<section data-collection>
    <div class="h2row"><h2>${STRINGS.collectionTitle}</h2><span class="colcount" data-role="collection-count">${STRINGS.collectionCount(found, items.length)}</span></div>
    <ul class="colgrid" aria-label="${STRINGS.collectionLabel}">${items.map((i) => tile(i, level))}</ul>
  </section>`;
}
