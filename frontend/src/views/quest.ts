import { css, html, unsafeCSS, type TemplateResult } from 'lit';
import { COLORS, FONT_PIXEL } from '../palette';
import { STRINGS } from '../strings';

export const QUEST_SECONDS = 120;
const R = 96;
const CIRC = 2 * Math.PI * R;

export interface QuestViewProps {
  title: string;
  startedAtMs: number;
  nowMs: number;
  xp: number;
  boosted: boolean;
  busy: boolean;
  onDone(): void;
  onBack(): void;
}

export const questStyles = css`
  .quest{background:${unsafeCSS(COLORS.dusk)};color:${unsafeCSS(COLORS.card)};border-radius:18px;padding:22px 16px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
  .quest .eyebrow{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#D8D2C4;font-weight:800}
  .quest h1{font-family:${unsafeCSS(FONT_PIXEL)};font-size:22px;margin:0;color:${unsafeCSS(COLORS.card)};overflow-wrap:anywhere}
  .ring{position:relative;width:220px;height:220px;max-width:100%}
  .ring svg{display:block;width:100%;height:100%}
  .ring .t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0 34px}
  .ring .big{font-family:${unsafeCSS(FONT_PIXEL)};font-size:44px;font-weight:700;font-variant-numeric:tabular-nums}
  .ring .small{font-size:13px;color:#D8D2C4;line-height:1.3}
  .quest p{margin:0;color:#D8D2C4;line-height:1.45}
  .qactions{display:flex;flex-direction:column;align-items:stretch;gap:6px;width:100%}
  .quest .btn.amber{align-self:stretch;background:${unsafeCSS(COLORS.amber)};color:${unsafeCSS(COLORS.ink)};min-height:52px;font-size:17px;font-family:${unsafeCSS(FONT_PIXEL)}}
  .linkish{background:none;border:none;min-height:44px;font:inherit;font-weight:800;color:${unsafeCSS(COLORS.card)};text-decoration:underline;cursor:pointer}
  .quest .btn.amber:disabled{opacity:.6}
`;

export function questView(p: QuestViewProps): TemplateResult {
  const elapsed = Math.max(0, (p.nowMs - p.startedAtMs) / 1000);
  const left = Math.max(0, QUEST_SECONDS - elapsed);
  const over = left <= 0;
  const secs = Math.ceil(left);
  const big = over ? '2:00' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const off = over ? 0 : CIRC * (1 - left / QUEST_SECONDS);
  return html`<section class="quest">
    <div class="eyebrow">${STRINGS.questStarted}</div>
    <h1>${p.title}</h1>
    <div class="ring"><svg viewBox="0 0 220 220" aria-hidden="true">
      <circle cx="110" cy="110" r="${R}" fill="none" stroke="#1E2338" stroke-width="16"></circle>
      <circle class="arc" cx="110" cy="110" r="${R}" fill="none" stroke="${COLORS.amber}" stroke-width="16" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 110 110)"></circle></svg>
      <div class="t"><div class="big" role="timer" data-role="clock">${big}</div><div class="small">${over ? STRINGS.minutesDone : STRINGS.leftOf}</div></div></div>
    <p>${STRINGS.onlyTwo}</p>
    <div class="qactions">
      <button type="button" class="btn amber" data-act="done" ?disabled=${p.busy} @click=${p.onDone}>${STRINGS.doneBtn} +${p.boosted ? p.xp * 2 : p.xp} XP</button>
      <button type="button" class="linkish" data-act="stop" ?disabled=${p.busy} @click=${p.onDone}>${STRINGS.stopForNow}</button>
      <button type="button" class="linkish" data-go="village" @click=${p.onBack}>${STRINGS.back}</button>
    </div></section>`;
}

export interface Reward { xp: number; gold: number; level: number | null; title: string }

export const toastStyles = css`
  .toast{display:flex;align-items:center;justify-content:space-between;gap:10px;background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.forest)};border-radius:12px;padding:6px 6px 6px 14px;font-weight:800}
  .toast.levelup{background:${unsafeCSS(COLORS.amber)};border-color:#B07A1E;color:${unsafeCSS(COLORS.ink)};font-family:${unsafeCSS(FONT_PIXEL)};font-size:17px}
  .toast small{display:block;font-family:inherit;font-weight:700;font-size:13px}
  .toast button{background:none;border:none;min-width:44px;min-height:44px;font:inherit;font-weight:800;color:inherit;text-decoration:underline;cursor:pointer}
`;

export function rewardToast(r: Reward, onDismiss: () => void): TemplateResult {
  const line = `+${r.xp} ${STRINGS.rewardXp} · +${r.gold} ${STRINGS.rewardGold}`;
  return r.level !== null
    ? html`<div class="toast levelup" role="status" data-role="toast"><span>${STRINGS.levelUp} ${r.level}! ${r.title}<small>${line} · ${STRINGS.levelUpHint}</small></span><button type="button" @click=${onDismiss}>${STRINGS.dismiss}</button></div>`
    : html`<div class="toast" role="status" data-role="toast"><span>${line}</span><button type="button" @click=${onDismiss}>${STRINGS.dismiss}</button></div>`;
}
