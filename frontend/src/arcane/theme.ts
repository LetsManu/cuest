import { css, unsafeCSS } from 'lit';

/** Arcane Hearth palette. Values come from the design spec in docs/superpowers/specs/arcane-hearth. */
export const ARCANE = {
  bg: '#14172A',
  panel: '#1D2140',
  panelBorder: '#33395F',
  rim: '#6B5A2E',
  gold: '#C9A14A',
  goldText: '#F7D27A',
  lantern: '#FFE7A8',
  text: '#ECE4D2',
  muted: '#A9A3BE',
  soft: '#CFC8DB',
  well: '#0E1124',
  track: '#2C3256',
  manaFrom: '#8FDCFF',
  manaTo: '#3550D6',
  manaBack: '#2B45B8',
  healthFrom: '#FF9A8A',
  healthTo: '#B8323A',
  glowFrom: '#FFE7A8',
  glowTo: '#D9862B',
  ember: '#FF8A5B',
  emberText: '#FFB27A',
  arcane: '#B98CFF',
  arcaneText: '#DCCBFF',
  arcaneRing: '#3A3F66',
  waterText: '#BFE6FF',
  waterRing: '#2E5E7A',
  bardPanel: '#2E3450',
  controlBorder: '#4A5070',
  parchment: '#F4EAD5',
  parchmentBorder: '#C9A14A',
  parchmentShadow: '#6B5A2E',
  ink: '#2B2620',
  inkDetail: '#6B5F4E',
  xpBadgeText: '#2E5E4E',
  scrollBang: '#E0A33A',
  scrollUpdate: '#8FB3D9',
  wellDoneBg: '#1F3A2C',
  wellDoneBorder: '#3E7A55',
  wellDoneText: '#CFEBD6',
  staminaLow: '#FF8A7A',
  staminaOk: '#7FD17E',
  staminaEmpty: '#2C3256',
  skyTop: '#0F1226',
  skyBottom: '#232A52',
  litIconBg: '#2A2340',
  litWideBg: '#3A2E25',
  litText: '#FFE7A8',
  greenIcon: '#7FD17E',
  iconBulb: '#F7D27A',
  iconTv: '#B98CFF',
  iconPc: '#8FDCFF',
  iconShield: '#7FD17E',
  iconSpark: '#FFE7A8',
  windowDark: '#4A5070',
} as const;

export const FONT_PIXEL = "'Pixelify Sans', ui-monospace, monospace";
export const FONT_BODY = "Inter, system-ui, sans-serif";

const FONTS_ID = 'cuest-arcane-fonts';
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;700&family=Inter:wght@400;500;600&display=swap';

/** Adds the Google Fonts link once per document. */
export function ensureFonts(doc: Document = document): void {
  if (doc.getElementById(FONTS_ID)) return;
  const link = doc.createElement('link');
  link.id = FONTS_ID;
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  doc.head.appendChild(link);
}

const A = ARCANE;
const u = unsafeCSS;

/** Shared tokens, panel styles, keyframes and animation classes for every Arcane card. */
export const arcaneBase = css`
  :host{display:block;font-family:${u(FONT_BODY)};color:${u(A.text)};
    --arc-bg:${u(A.bg)};--arc-panel:${u(A.panel)};--arc-panel-border:${u(A.panelBorder)};--arc-rim:${u(A.rim)};
    --arc-gold:${u(A.gold)};--arc-gold-text:${u(A.goldText)};--arc-lantern:${u(A.lantern)};--arc-text:${u(A.text)};
    --arc-muted:${u(A.muted)};--arc-soft:${u(A.soft)};--arc-well:${u(A.well)};--arc-track:${u(A.track)};
    --arc-ember:${u(A.ember)};--arc-arcane:${u(A.arcane)};--arc-font-pixel:${u(FONT_PIXEL)}}
  .panel{background:${u(A.panel)};border:2px solid ${u(A.panelBorder)};border-radius:18px;padding:14px 16px;box-sizing:border-box;color:${u(A.text)}}
  .panel.rim{border-color:${u(A.rim)}}
  .warn{background:${u(A.panel)};border:2px solid ${u(A.scrollBang)};border-radius:18px;padding:14px 16px;color:${u(A.soft)};font-size:13px}
  .num{font-family:${u(FONT_BODY)};font-weight:700;font-variant-numeric:tabular-nums}
  .done{background:${u(A.wellDoneBg)};border:2px solid ${u(A.wellDoneBorder)};border-radius:14px;padding:12px;font-size:13px;color:${u(A.wellDoneText)}}
  h2{margin:0;font-family:${u(FONT_PIXEL)};font-weight:500;font-size:18px;color:${u(A.goldText)}}
  @keyframes wave{from{transform:translateX(0)}to{transform:translateX(-60px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes spinr{to{transform:rotate(-360deg)}}
  @keyframes draw{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
  @keyframes reveal{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  @keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}
  @keyframes twinkle{0%,100%{opacity:.25}50%{opacity:1}}
  @keyframes flicker{0%,100%{opacity:1}45%{opacity:.8}55%{opacity:.95}}
  @keyframes shimmer{from{left:-50px}to{left:100%}}
  @keyframes rise{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-60px);opacity:0}}
  @keyframes eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
  @keyframes glow{0%,100%{box-shadow:0 0 10px rgba(247,210,122,.35)}50%{box-shadow:0 0 22px rgba(247,210,122,.7)}}
  .wave{animation:wave 3.2s linear infinite}
  .wave2{animation:wave 5s linear infinite reverse}
  .spin{transform-origin:50% 50%;transform-box:fill-box;animation:spin 18s linear infinite}
  .spinr{transform-origin:50% 50%;transform-box:fill-box;animation:spinr 9s linear infinite}
  .draw{stroke-dasharray:1000;animation:draw 2.4s ease-out both}
  .reveal{transform-box:fill-box;transform-origin:0 50%;animation:reveal 2.4s ease-out both}
  .pulse{animation:pulse 2.4s ease-in-out infinite}
  .star{position:absolute;width:3px;height:3px;background:#FFF3D0;animation:twinkle 3s ease-in-out infinite}
  .win{animation:flicker 4s ease-in-out infinite}
  .shimmer{position:absolute;top:0;left:-50px;width:50px;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:shimmer 3s ease-in-out infinite}
  .spark{position:absolute;width:4px;height:4px;background:${u(A.waterText)};animation:rise 3.6s ease-in infinite}
  .eq{transform-origin:bottom;animation:eq 1.1s ease-in-out infinite}
  .lit{animation:glow 3s ease-in-out infinite}
  @media (prefers-reduced-motion: reduce){
    .wave,.wave2,.spin,.spinr,.draw,.reveal,.pulse,.star,.win,.shimmer,.spark,.eq,.lit{animation:none}
    .spark,.shimmer{display:none}
  }
`;
