import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import type { CollectionItem, Summary } from '../api';
import { COLORS, FONT_PIXEL } from '../palette';
import { SPRITE_H, SPRITE_W, spriteShadow, stageForLevel, type Palette } from '../sprite';
import { STRINGS } from '../strings';
import { collectionView } from './collection';
import { decorTemplate } from './decor';

export interface HeroProps {
  summary: Summary | null;
  leading: unknown;
  canSwitch: boolean;
  onSwitch(): void;
  palette: Palette;
  decor: string[];
  collection?: CollectionItem[] | null;
}

export const heroStyles = css`
  .herobig{position:relative;overflow:hidden;background:${unsafeCSS(COLORS.dusk)};color:${unsafeCSS(COLORS.card)};border-radius:18px;padding:16px 16px 40px;display:flex;flex-direction:column;align-items:center;gap:8px}
  .herobig::after{content:"";position:absolute;left:0;right:0;bottom:0;height:24px;background:${unsafeCSS(COLORS.grass)}}
  .herobig>*{position:relative;z-index:1}
  .herobig>.decorrow{position:absolute}
  .herobig .lvl{font-family:${unsafeCSS(FONT_PIXEL)};font-size:22px;font-weight:700}
  .herobig .sprite{position:relative;overflow:hidden;flex:none}
  .xpwrap{width:100%;display:flex;flex-direction:column;gap:4px}
  .xprow{display:flex;justify-content:space-between;font-size:13px;color:#D8D2C4;font-variant-numeric:tabular-nums}
  .path{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .stage{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:14px;padding:8px 2px;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;min-width:0}
  .stage.on{border-color:${unsafeCSS(COLORS.forest)};background:#EEF3EC}
  .stage b{font-size:12px;overflow-wrap:normal;word-break:normal;hyphens:auto}
  .stage span{font-size:12px;color:${unsafeCSS(COLORS.muted)}}
  .stage .sprite{position:relative;overflow:hidden}
  .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .stat{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:14px;padding:10px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;min-width:0}
  .stat b{font-family:${unsafeCSS(FONT_PIXEL)};font-size:20px;color:${unsafeCSS(COLORS.forest)};font-variant-numeric:tabular-nums}
  .stat span{font-size:12px;color:${unsafeCSS(COLORS.muted)}}
`;

function sprite(stage: number, px: number, palette: Palette | undefined, label: string): TemplateResult {
  return html`<div class="sprite" role="img" aria-label="${label}" data-stage="${stage}" style="width:${SPRITE_W * px}px;height:${SPRITE_H * px}px">
    <div style="position:absolute;left:${-px}px;top:${-px}px;width:${px}px;height:${px}px;box-shadow:${spriteShadow(stage, px, palette)}"></div></div>`;
}

export function heroView(p: HeroProps): TemplateResult {
  const s = p.summary;
  const level = s?.level ?? 1;
  const title = s?.title ?? '';
  const into = s?.intoLevel ?? 0;
  const span = into + (s?.toNext ?? 0);
  const pct = span > 0 ? Math.max(0, Math.min(100, Math.round((100 * into) / span))) : 0;
  const cur = stageForLevel(level);
  return html`
    <div class="topbar"><span class="topleft">${p.leading}<span class="brand">${STRINGS.brand}</span></span>
      <span class="topright">${p.canSwitch ? html`<button type="button" class="switch" data-act="switch" @click=${p.onSwitch}>${STRINGS.switchPlayer}</button>` : nothing}</span></div>
    <section class="herobig" data-role="hero">
      ${decorTemplate(p.decor)}
      <div class="lvl">${STRINGS.level} ${level}</div>${title ? html`<div class="ttl">${title}</div>` : nothing}
      ${sprite(cur, 7, p.palette, `${STRINGS.yourHero}${title ? `, ${title}` : ''}`)}
      <div class="xpwrap"><div class="xprow"><span>${into} / ${span} XP</span><span>${STRINGS.nextLevel} ${level + 1}</span></div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>
    </section>
    <div class="h2row"><h2>${STRINGS.pathTitle}</h2></div>
    <div class="path">${STRINGS.stageNames.map((name, i) => {
      const st = i + 1;
      const reached = cur >= st;
      return html`<div class="stage${cur === st ? ' on' : ''}" data-stage-box="${st}">${sprite(reached ? st : 0, 3, reached && st === cur ? p.palette : undefined, reached ? name : `${STRINGS.lockedPrefix} ${name}`)}<b>${name}</b><span>${cur === st ? STRINGS.youAreHere : `${STRINGS.level} ${STRINGS.stageLevels[i]}`}</span></div>`;
    })}</div>
    <div class="stats">
      <div class="stat"><b>${s?.player.xp ?? 0}</b><span>${STRINGS.statXp}</span></div>
      <div class="stat"><b>${s?.player.gold ?? 0}</b><span>${STRINGS.statGold}</span></div>
      <div class="stat"><b>${s?.player.restTokens ?? 0}</b><span>${STRINGS.statRest}</span></div>
    </div>
    ${collectionView(p.collection ?? null, level)}`;
}
