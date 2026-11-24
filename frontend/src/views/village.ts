import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import type { Quest, QuestLists, Summary } from '../api';
import { COLORS, FONT_PIXEL } from '../palette';
import { SPRITE_H, SPRITE_W, spriteShadow, stageForLevel, type Palette } from '../sprite';
import { STRINGS } from '../strings';
import { decorStyles, decorTemplate } from './decor';

const PX = 4;

export interface VillageProps {
  summary: Summary | null;
  playerId: string | null;
  leading: unknown;
  canSwitch: boolean;
  onSwitch(): void;
  quests: QuestLists | null;
  palette: Palette;
  decor: string[];
  busy: Record<string, boolean>;
  poolOpen: boolean;
  onStart(q: Quest): void;
  onLater(q: Quest): void;
  onTogglePool(): void;
}

export const villageStyles = [
  decorStyles,
  css`
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .topleft{display:flex;align-items:center;gap:4px;min-width:0}
  .topright{display:flex;align-items:center;gap:8px}
  .switch{background:transparent;border:2px solid #C9B791;border-radius:12px;min-height:44px;min-width:44px;padding:0 10px;font:inherit;font-weight:800;font-size:13px;color:#4A4033;cursor:pointer}
  .someone{color:${unsafeCSS(COLORS.muted)};font-weight:700;font-size:14px;padding:6px 0}
  .ttl{font-family:${unsafeCSS(FONT_PIXEL)};font-size:15px;color:#F7D27A}
  .brand{font-family:${unsafeCSS(FONT_PIXEL)};font-weight:700;font-size:26px;color:${unsafeCSS(COLORS.forest)}}
  .gold{display:flex;align-items:center;gap:6px;background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:999px;padding:5px 12px;font-weight:800;font-variant-numeric:tabular-nums}
  .coin{width:14px;height:14px;background:${unsafeCSS(COLORS.amber)};border:2px solid #B07A1E;border-radius:3px}
  .herocard{position:relative;overflow:hidden;background:${unsafeCSS(COLORS.dusk)};color:${unsafeCSS(COLORS.card)};border-radius:18px;padding:14px 14px 34px;display:flex;gap:12px;align-items:center}
  .herocard::after{content:"";position:absolute;left:0;right:0;bottom:0;height:24px;background:${unsafeCSS(COLORS.grass)}}
  .star{position:absolute;width:3px;height:3px;background:#F7D27A}
  .herocard .info{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;gap:5px;min-width:0}
  .herocard .sprite{position:relative;z-index:1;overflow:hidden;flex:none}
  .dot{position:absolute}
  .lvl{font-family:${unsafeCSS(FONT_PIXEL)};font-size:19px;font-weight:700}
  .sub{font-size:13px;color:#D8D2C4;font-variant-numeric:tabular-nums}
  .bar{height:12px;background:#1E2338;border:2px solid #4A5275;border-radius:3px;overflow:hidden}
  .bar>i{display:block;height:100%;background:${unsafeCSS(COLORS.amber)};transition:width .5s ease}
  .h2row{display:flex;align-items:baseline;justify-content:space-between}
  .h2row h2{margin:0;font-family:${unsafeCSS(FONT_PIXEL)};font-size:19px}
  .h2row span{font-size:13px;color:${unsafeCSS(COLORS.muted)}}
  .qcard{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px}
  .qcard.active{border-color:${unsafeCSS(COLORS.forest)};background:#EEF3EC}
  .qrow{display:flex;gap:12px;align-items:center}
  .qicon{width:42px;height:42px;flex:none;border-radius:12px;background:#DCEAE2;display:flex;align-items:center;justify-content:center;color:${unsafeCSS(COLORS.forest)}}
  .qtext{flex:1;min-width:0}
  .qtitle{font-weight:800;font-size:16px;overflow-wrap:anywhere}
  .qmeta{font-size:13px;color:${unsafeCSS(COLORS.muted)}}
  .qxp{font-family:${unsafeCSS(FONT_PIXEL)};font-weight:700;color:${unsafeCSS(COLORS.forest)};white-space:nowrap}
  .btnrow{display:flex;gap:8px}
  .btn{border-radius:12px;min-height:44px;min-width:44px;padding:0 14px;font:inherit;font-weight:800;font-size:15px;border:2px solid transparent;cursor:pointer}
  .btn:disabled{opacity:.55;cursor:default}
  .btn.primary{flex:1;background:${unsafeCSS(COLORS.forest)};color:${unsafeCSS(COLORS.card)}}
  .btn.ghost{background:transparent;border-color:#C9B791;color:#4A4033}
  .empty{background:${unsafeCSS(COLORS.card)};border:2px dashed #C9B791;border-radius:16px;padding:18px;text-align:center;color:${unsafeCSS(COLORS.muted)};line-height:1.45}
  .empty strong{display:block;color:${unsafeCSS(COLORS.ink)};font-family:${unsafeCSS(FONT_PIXEL)};font-size:18px;margin-bottom:4px}
  .pool{font-size:13px;color:${unsafeCSS(COLORS.muted)};display:flex;flex-direction:column;gap:8px}
  .pool button.link{background:none;border:none;padding:0 4px;min-height:44px;min-width:44px;color:${unsafeCSS(COLORS.forest)};font:inherit;font-weight:800;text-decoration:underline;cursor:pointer}
  .poolitem{display:flex;justify-content:space-between;align-items:center;gap:8px;background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:12px;padding:8px 10px;color:${unsafeCSS(COLORS.ink)}}
  .poolitem span{min-width:0;overflow-wrap:anywhere}
`];

function hhmm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ICON = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7"></path><path d="M6 10v10h12V10"></path><path d="M10 20v-5h4v5"></path></svg>`;

function questMeta(q: Quest): string {
  const mins = `${STRINGS.about} ${q.minutes} ${STRINGS.min}`;
  if (q.status === 'active') return `${STRINGS.inProgressSince} ${hhmm(q.startedAt)} · ${mins}`;
  if (q.snoozedUntil && new Date(q.snoozedUntil).getTime() > Date.now()) return `${STRINGS.restingUntil} ${hhmm(q.snoozedUntil)} · ${mins}`;
  return `${STRINGS.waiting} · ${mins}`;
}

function questCard(p: VillageProps, q: Quest): TemplateResult {
  const active = q.status === 'active';
  const busy = !!p.busy[q.id];
  return html`<article class="qcard${active ? ' active' : ''}">
    <div class="qrow"><div class="qicon">${ICON}</div>
      <div class="qtext"><div class="qtitle">${q.title}</div><div class="qmeta">${questMeta(q)}</div></div>
      <div class="qxp">+${q.xp} XP</div></div>
    <div class="btnrow">
      <button type="button" class="btn primary" data-act="start" ?disabled=${busy} @click=${() => p.onStart(q)}>${active ? STRINGS.continueQuest : STRINGS.justTwo}</button>
      ${active ? nothing : html`<button type="button" class="btn ghost" data-act="later" ?disabled=${busy} @click=${() => p.onLater(q)}>${STRINGS.later}</button>`}
    </div></article>`;
}

function claimedByOther(p: VillageProps, q: Quest): boolean {
  return q.status === 'active' && !!q.claimedBy && !!p.playerId && q.claimedBy !== p.playerId;
}

function otherCard(q: Quest): TemplateResult {
  return html`<article class="qcard"><div class="qrow"><div class="qicon">${ICON}</div>
    <div class="qtext"><div class="qtitle">${q.title}</div><div class="someone" data-act="someone">${STRINGS.someoneOnIt}</div></div>
    <div class="qxp">+${q.xp} XP</div></div></article>`;
}

export function villageView(p: VillageProps): TemplateResult {
  const s = p.summary;
  const level = s?.level ?? 1;
  const title = s?.title ?? '';
  const into = s?.intoLevel ?? 0;
  const toNext = s?.toNext ?? 0;
  const pct = into + toNext > 0 ? Math.max(0, Math.min(100, Math.round((100 * into) / (into + toNext)))) : 0;
  const q = p.quests;
  const open = q ? [...q.active, ...q.open] : [];
  const pool = q?.whenever ?? [];
  return html`
    <div class="topbar"><span class="topleft">${p.leading}<span class="brand">${STRINGS.brand}</span></span>
      <span class="topright">${p.canSwitch ? html`<button type="button" class="switch" data-act="switch" @click=${p.onSwitch}>${STRINGS.switchPlayer}</button>` : nothing}<span class="gold" aria-label="${s?.player.gold ?? 0} ${STRINGS.gold}"><span class="coin"></span>${s?.player.gold ?? 0}</span></span></div>
    <section class="herocard">
      <span class="star" style="left:22px;top:12px"></span><span class="star" style="left:150px;top:9px"></span><span class="star" style="right:26px;top:20px"></span>
      ${decorTemplate(p.decor)}
      <div class="sprite" role="img" aria-label="${STRINGS.heroLabel}${title ? `, ${title}` : ''}" style="width:${SPRITE_W * PX}px;height:${SPRITE_H * PX}px">
        <div class="dot" style="left:${-PX}px;top:${-PX}px;width:${PX}px;height:${PX}px;box-shadow:${spriteShadow(stageForLevel(level), PX, p.palette)}"></div>
      </div>
      <div class="info"><div class="lvl">${STRINGS.level} ${level}</div>${title ? html`<div class="ttl">${title}</div>` : nothing}
        <div class="sub">${toNext} ${STRINGS.xpToLevel} ${level + 1}</div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>
    </section>
    <div class="h2row"><h2>${STRINGS.houseNeedsYou}</h2><span>${open.length} ${open.length === 1 ? STRINGS.questOne : STRINGS.questMany}</span></div>
    ${q && !open.length ? html`<div class="empty"><strong>${STRINGS.allQuiet}</strong>${STRINGS.allQuietBody}</div>` : nothing}
    ${open.map((x) => (claimedByOther(p, x) ? otherCard(x) : questCard(p, x)))}
    ${pool.length ? html`<div class="pool"><div>${pool.length} ${pool.length === 1 ? STRINGS.poolOne : STRINGS.poolMany}
      <button type="button" class="link" data-act="pool" aria-expanded="${p.poolOpen}" @click=${p.onTogglePool}>${p.poolOpen ? STRINGS.hide : STRINGS.show}</button></div>
      ${p.poolOpen ? pool.map((x) => html`<div class="poolitem"><span>${x.title}</span><button type="button" class="btn ghost" data-act="start" ?disabled=${!!p.busy[x.id]} @click=${() => p.onStart(x)}>${STRINGS.doItNow}</button></div>`) : nothing}</div>` : nothing}`;
}
