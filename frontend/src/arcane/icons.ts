import { html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { ARCANE } from './theme';

export const TILE_ICONS = ['bulb', 'tv', 'pc', 'shield', 'spark'] as const;
export type TileIcon = (typeof TILE_ICONS)[number];
export type TransportIcon = 'play' | 'pause' | 'prev' | 'next';

export const ICON_COLOR: Record<TileIcon, string> = {
  bulb: ARCANE.iconBulb,
  tv: ARCANE.iconTv,
  pc: ARCANE.iconPc,
  shield: ARCANE.iconShield,
  spark: ARCANE.iconSpark,
};

export const isTileIcon = (s: string): s is TileIcon => (TILE_ICONS as readonly string[]).includes(s);

/** Stroke icons from the Arcane Hearth mockups; the spark is drawn to match them (the mockups have none). */
export function tileIcon(name: TileIcon, size = 24, color: string = ICON_COLOR[name]): TemplateResult {
  const open = (body: SVGTemplateResult) =>
    html`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  switch (name) {
    case 'bulb':
      return open(svg`<path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />`);
    case 'tv':
      return open(svg`<rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" />`);
    case 'pc':
      return open(svg`<rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4" />`);
    case 'shield':
      return open(svg`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />`);
    case 'spark':
      return open(svg`<path d="M12 3v5M12 16v5M3 12h5M16 12h5" /><path d="M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />`);
  }
}

/** Filled transport glyphs from FinalControl.dc.html. */
export function transportIcon(name: TransportIcon, size: number, color: string): TemplateResult {
  const d: Record<TransportIcon, string> = {
    prev: 'M18 5L8 12l10 7zM6 5h2v14H6z',
    next: 'M6 5l10 7-10 7zM16 5h2v14h-2z',
    pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
    play: 'M7 4l13 8-13 8z',
  };
  return html`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><path d="${d[name]}" /></svg>`;
}
