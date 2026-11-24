import { css, html, nothing, svg, unsafeCSS, type TemplateResult } from 'lit';
import type { DiceResult, Energy } from '../api';
import { COLORS, FONT_PIXEL } from '../palette';
import { STRINGS } from '../strings';

export interface DiceViewProps {
  energy: Energy;
  result: DiceResult | null;
  rolling: boolean;
  busy: boolean;
  onEnergy(e: Energy): void;
  onRoll(): void;
  onStart(): void;
  onBack(): void;
}

const LEVELS: { id: Energy; label: string; pips: number }[] = [
  { id: 'low', label: STRINGS.diceLow, pips: 2 },
  { id: 'medium', label: STRINGS.diceMedium, pips: 4 },
  { id: 'high', label: STRINGS.diceHigh, pips: 6 },
];
const PIP_AT: Record<number, [number, number][]> = {
  2: [[3, 3], [9, 9]],
  4: [[3, 3], [9, 3], [3, 9], [9, 9]],
  6: [[3, 2], [9, 2], [3, 6], [9, 6], [3, 10], [9, 10]],
};

export const diceStyles = css`
  .dicehead{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
  .dicehead h1{font-size:24px}
  .dicehint{margin:0;color:${unsafeCSS(COLORS.muted)};line-height:1.45}
  .seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .seg button{min-height:44px;border-radius:12px;border:2px solid ${unsafeCSS(COLORS.line)};background:${unsafeCSS(COLORS.card)};font:inherit;font-weight:800;color:${unsafeCSS(COLORS.ink)};cursor:pointer}
  .seg button[aria-pressed="true"]{background:${unsafeCSS(COLORS.forest)};border-color:${unsafeCSS(COLORS.forest)};color:${unsafeCSS(COLORS.card)}}
  .stage{background:${unsafeCSS(COLORS.dusk)};border-radius:18px;padding:22px 16px;display:flex;flex-direction:column;align-items:center;gap:14px}
  .die{width:112px;height:112px;display:block}
  .die.rolling{animation:diceroll .6s ease-in-out infinite}
  @keyframes diceroll{0%{transform:rotate(0) translateY(0)}25%{transform:rotate(-14deg) translateY(-8px)}50%{transform:rotate(10deg) translateY(0)}75%{transform:rotate(-8deg) translateY(-4px)}100%{transform:rotate(0) translateY(0)}}
  @media (prefers-reduced-motion:reduce){.die.rolling{animation:none;opacity:.7}}
  .stage .rollbtn{align-self:stretch}
  .result{background:${unsafeCSS(COLORS.card)};border:2px solid ${unsafeCSS(COLORS.line)};border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px}
  .result .rtitle{font-weight:800;font-size:18px;overflow-wrap:anywhere}
  .result .rmeta{display:flex;gap:8px;flex-wrap:wrap}
  .chip{background:#DCEAE2;color:${unsafeCSS(COLORS.forest)};border-radius:999px;padding:3px 10px;font-weight:800;font-size:13px;font-variant-numeric:tabular-nums}
  .result .btn.primary{flex:none;background:${unsafeCSS(COLORS.forest)};color:${unsafeCSS(COLORS.card)}}
  .result .why{margin:0;color:${unsafeCSS(COLORS.muted)};line-height:1.4;font-size:14px}
`;

function dieSvg(pips: number, rolling: boolean): TemplateResult {
  const dots = (PIP_AT[pips] ?? PIP_AT[4]!).map(([x, y]) => svg`<rect x="${x}" y="${y}" width="2" height="2" fill="#2B2A33"></rect>`);
  return html`<svg class="die${rolling ? ' rolling' : ''}" data-role="die" viewBox="0 0 14 14" shape-rendering="crispEdges" aria-hidden="true">
    <path fill="#2B2A33" d="M2 0h10v1h1v1h1v10h-1v1h-1v1H2v-1H1v-1H0V2h1V1h1z"></path>
    <path fill="#FFF9EC" d="M2 1h10v1h1v10h-1v1H2v-1H1V2h1z"></path>
    <path fill="#E3D3B2" d="M2 12h10v1H2zM12 2h1v10h-1z"></path>
    ${dots}</svg>`;
}

function whyLine(energy: Energy, r: DiceResult): string {
  if ('suggestion' in r) return STRINGS.diceWhySuggestion;
  return !r.quest.energy || r.quest.energy === energy ? STRINGS.diceWhyMatch : STRINGS.diceWhyNear;
}

export function diceView(p: DiceViewProps): TemplateResult {
  const pips = LEVELS.find((l) => l.id === p.energy)?.pips ?? 4;
  const r = p.result && !p.rolling ? p.result : null;
  const item = r ? ('quest' in r ? r.quest : r.suggestion) : null;
  const isQuest = !!r && 'quest' in r;
  return html`
    <div class="dicehead"><button type="button" class="btn" data-act="dice-back" @click=${p.onBack}>${STRINGS.back}</button><h1>${STRINGS.diceTitle}</h1></div>
    <p class="dicehint">${STRINGS.diceHint}</p>
    <div class="seg" role="group" aria-label="${STRINGS.diceEnergyLabel}">${LEVELS.map((l) => html`<button type="button" data-energy="${l.id}" aria-pressed="${p.energy === l.id}" @click=${() => p.onEnergy(l.id)}>${l.label}</button>`)}</div>
    <section class="stage">${dieSvg(pips, p.rolling)}
      <button type="button" class="btn amber rollbtn" data-act="roll" ?disabled=${p.rolling || p.busy} @click=${p.onRoll}>${p.rolling ? STRINGS.diceRolling : r ? STRINGS.diceAnother : STRINGS.diceRoll}</button></section>
    ${item ? html`<article class="result" role="status" aria-label="${STRINGS.diceResultLabel}" data-role="dice-result">
      <div class="rtitle">${item.title}</div>
      <div class="rmeta"><span class="chip">${STRINGS.about} ${item.minutes} ${STRINGS.min}</span><span class="chip">+${item.xp} XP</span></div>
      <p class="why">${whyLine(p.energy, r!)}</p>
      <button type="button" class="btn primary" data-act="dice-start" ?disabled=${p.busy} @click=${p.onStart}>${isQuest ? STRINGS.diceStart : STRINGS.diceStartSuggestion}</button>
    </article>` : nothing}`;
}
