import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import type { Quest, Sprint } from '../api';
import { COLORS, FONT_PIXEL } from '../palette';
import { STRINGS } from '../strings';

export const SPRINT_LENGTHS = [5, 15, 25] as const;
// Keep in sync with server/src/services/sprint.ts (XP_PER_MINUTE, XP_PER_LOG, MAX_LOGS, MAX_NOTE).
export const XP_PER_MINUTE = 2;
export const XP_PER_LOG = 5;
export const MAX_LOGS = 10;
export const MAX_NOTE = 80;

export interface SprintSummary { minutes: number; logs: number; xp: number }

export interface SprintViewProps {
  sprint: Sprint | null;
  summary: SprintSummary | null;
  nowMs: number;
  note: string;
  quests: Quest[];
  busy: boolean;
  onStart(minutes: number): void;
  onNote(text: string): void;
  onLog(): void;
  onFinish(): void;
  onQuestDone(q: Quest): void;
  onAgain(): void;
  onBack(): void;
}

export const endsAtMs = (s: Sprint): number => Date.parse(s.startedAt) + s.minutes * 60_000;

/** Whole minutes elapsed (capped at the sprint length) x2, plus 5 per quick-log: the server's rule. */
export function sprintXp(s: Sprint, nowMs: number): number {
  const start = Date.parse(s.startedAt);
  const minutes = Math.min(s.minutes, Math.max(0, Math.floor((nowMs - start) / 60_000)));
  return minutes * XP_PER_MINUTE + s.logs * XP_PER_LOG;
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Spoken only when the whole minute changes, so screen readers are not told every second. */
export function minutesLeft(ms: number): string {
  const m = Math.ceil(Math.max(0, ms) / 60_000);
  return m <= 0 ? STRINGS.sprintTimeUp : m === 1 ? STRINGS.sprintOneMinuteLeft : `${m} ${STRINGS.sprintMinutesLeft}`;
}

export const sprintStyles = css`
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .sp{display:flex;flex-direction:column;gap:14px}
  .sp .sphead{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
  .sp h1{font-size:24px}
  .sp .sphint{margin:0;color:${unsafeCSS(COLORS.muted)};line-height:1.45}
  .splen{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .splen button{min-height:64px;border-radius:14px;border:2px solid ${unsafeCSS(COLORS.line)};background:${unsafeCSS(COLORS.card)};font:inherit;font-weight:800;color:${unsafeCSS(COLORS.ink)};cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
  .splen button b{font-size:22px;font-family:${unsafeCSS(FONT_PIXEL)}}
  .splen button span{font-size:12px;color:${unsafeCSS(COLORS.muted)};font-variant-numeric:tabular-nums}
  .splen button:disabled{opacity:.6}
  .spclock{background:${unsafeCSS(COLORS.dusk)};border-radius:18px;padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;color:#FFF9EC}
  .spclock .lbl{font-size:13px;opacity:.85}
  .spclock .time{font-family:${unsafeCSS(FONT_PIXEL)};font-size:52px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:2px}
  .spbar{align-self:stretch;height:14px;border-radius:999px;background:rgba(255,249,236,.2);overflow:hidden}
  .spbar i{display:block;height:100%;background:${unsafeCSS(COLORS.amber)};border-radius:999px;transition:width 1s linear}
  @media (prefers-reduced-motion:reduce){.spbar i{transition:none}}
  .spxp{display:flex;align-items:baseline;justify-content:space-between;gap:8px;background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:14px;padding:10px 14px}
  .spxp b{font-size:22px;font-variant-numeric:tabular-nums;color:${unsafeCSS(COLORS.forest)}}
  .sp h2{font-size:16px;margin:0}
  .spquests{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .spquests li{display:flex;align-items:center;gap:10px;background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:14px;padding:6px 6px 6px 12px}
  .spquests .qt{flex:1;min-width:0;font-weight:700;overflow-wrap:anywhere}
  .spquests .btn{align-self:center;flex:none}
  .splog{display:flex;flex-direction:column;gap:8px}
  .splog .row{display:flex;gap:8px;align-items:stretch}
  .splog input{flex:1;min-width:0;min-height:44px;border-radius:12px;border:2px solid ${unsafeCSS(COLORS.line)};background:${unsafeCSS(COLORS.card)};font:inherit;padding:0 12px;color:${unsafeCSS(COLORS.ink)}}
  .splog .count{font-size:12px;color:${unsafeCSS(COLORS.muted)};font-variant-numeric:tabular-nums;text-align:right}
  .splog .full{margin:0;color:${unsafeCSS(COLORS.forest)};font-weight:700;line-height:1.4}
  .sp .btn.primary{background:${unsafeCSS(COLORS.forest)};color:${unsafeCSS(COLORS.card)};border-color:${unsafeCSS(COLORS.forest)};flex:none}
  .sp .btn.wide{align-self:stretch}
  .spsum{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}
  .spsum dl{margin:0;display:grid;grid-template-columns:1fr auto;gap:6px 12px}
  .spsum dt{color:${unsafeCSS(COLORS.muted)}}
  .spsum dd{margin:0;font-weight:800;text-align:right;font-variant-numeric:tabular-nums}
`;

function summaryView(p: SprintViewProps, s: SprintSummary): TemplateResult {
  return html`<article class="spsum" role="status" data-role="sprint-summary">
    <h2>${STRINGS.sprintDoneTitle}</h2>
    <p class="sphint">${STRINGS.sprintDoneBody}</p>
    <dl><dt>${STRINGS.sprintSummaryMinutes}</dt><dd>${s.minutes}</dd><dt>${STRINGS.sprintSummaryLogs}</dt><dd>${s.logs}</dd><dt>${STRINGS.sprintSummaryXp}</dt><dd>+${s.xp} XP</dd></dl>
    <button type="button" class="btn primary wide" data-act="sprint-again" @click=${p.onAgain}>${STRINGS.sprintAgain}</button>
  </article>`;
}

function runningView(p: SprintViewProps, s: Sprint): TemplateResult {
  const total = s.minutes * 60_000;
  const left = Math.max(0, endsAtMs(s) - p.nowMs);
  const pct = Math.min(100, Math.max(0, Math.floor(((total - left) / total) * 100)));
  const full = s.logs >= MAX_LOGS;
  const canLog = !full && !p.busy && p.note.trim().length > 0;
  return html`
    <section class="spclock" aria-label="${STRINGS.sprintLeft}">
      <span class="lbl">${STRINGS.sprintLeft}</span>
      <div class="time" role="timer" data-role="countdown">${mmss(left)}</div>
      <span class="sr" aria-live="polite" data-role="countdown-live">${minutesLeft(left)}</span>
      <div class="spbar" role="progressbar" aria-label="${STRINGS.sprintProgress}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    </section>
    <div class="spxp"><span>${STRINGS.sprintXpSoFar}</span><b data-role="sprint-xp">+${sprintXp(s, p.nowMs)} XP</b></div>
    <section><h2>${STRINGS.sprintTickTitle}</h2>
      ${p.quests.length ? html`<ul class="spquests" data-role="sprint-quests">${p.quests.map((q) => html`<li><span class="qt">${q.title}</span>
        <button type="button" class="btn" data-act="sprint-quest-done" ?disabled=${p.busy} @click=${() => p.onQuestDone(q)}>${STRINGS.sprintDone}</button></li>`)}</ul>`
        : html`<p class="sphint">${STRINGS.sprintTickEmpty}</p>`}
    </section>
    <section class="splog"><h2>${STRINGS.sprintLogTitle}</h2>
      <div class="row">
        <input type="text" data-role="log-input" maxlength="${MAX_NOTE}" aria-label="${STRINGS.sprintLogLabel}" placeholder="${STRINGS.sprintLogPlaceholder}" .value=${p.note} ?disabled=${full}
          @input=${(e: Event) => p.onNote((e.target as HTMLInputElement).value)} />
        <button type="button" class="btn primary" data-act="sprint-log" ?disabled=${!canLog} @click=${p.onLog}>${STRINGS.sprintLogAdd}</button>
      </div>
      <div class="count" data-role="log-count">${p.note.length}/${MAX_NOTE}</div>
      ${full ? html`<p class="full" data-role="log-full">${STRINGS.sprintLogFull}</p>` : nothing}
    </section>
    <button type="button" class="btn wide" data-act="sprint-finish" ?disabled=${p.busy} @click=${p.onFinish}>${STRINGS.sprintEnd}</button>`;
}

export function sprintView(p: SprintViewProps): TemplateResult {
  const idle = !p.sprint && !p.summary;
  return html`<div class="sp">
    <div class="sphead"><button type="button" class="btn" data-go="village" @click=${p.onBack}>${STRINGS.back}</button><h1>${STRINGS.sprintTitle}</h1></div>
    ${p.summary ? summaryView(p, p.summary) : nothing}
    ${p.sprint ? runningView(p, p.sprint) : nothing}
    ${idle ? html`<p class="sphint">${STRINGS.sprintHint}</p>
      <div class="splen" role="group" aria-label="${STRINGS.sprintLengthLabel}">${SPRINT_LENGTHS.map((m) => html`<button type="button" data-minutes="${m}" ?disabled=${p.busy} @click=${() => p.onStart(m)}><b>${m}</b><span>${STRINGS.sprintMin} · ${STRINGS.sprintUpTo} ${m * XP_PER_MINUTE} XP</span></button>`)}</div>` : nothing}
  </div>`;
}
