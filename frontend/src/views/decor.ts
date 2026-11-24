import { css, html, type TemplateResult } from 'lit';

/**
 * Pixel decor for the village card. Everything sits in one row on the grass strip
 * (below the XP bar); each item has a fixed-width slot so none can overlap.
 */
export const decorStyles = css`
  .decorrow{position:absolute;left:12px;right:12px;bottom:0;height:24px;display:flex;justify-content:flex-end;align-items:flex-end;gap:10px;z-index:1;pointer-events:none}
  .slot{position:relative;height:24px;flex:none}
  .slot i{position:absolute;display:block}
`;

const FOUNTAIN = html`<span class="slot" style="width:30px" aria-hidden="true">
  <i style="left:0;bottom:0;width:30px;height:6px;background:#9AA3B5"></i>
  <i style="left:3px;bottom:6px;width:24px;height:3px;background:#7CC4BF"></i>
  <i style="left:13px;bottom:9px;width:4px;height:9px;background:#BFE3E0"></i>
  <i style="left:9px;bottom:14px;width:3px;height:3px;background:#BFE3E0"></i>
  <i style="left:18px;bottom:14px;width:3px;height:3px;background:#BFE3E0"></i></span>`;
const LANTERN = html`<span class="slot" style="width:20px" aria-hidden="true">
  <i style="left:8px;bottom:0;width:4px;height:14px;background:#4A3A2A"></i>
  <i style="left:4px;bottom:13px;width:12px;height:10px;background:#F7D27A;box-shadow:0 0 10px 3px rgba(247,210,122,.6)"></i></span>`;
const FLOWERS = html`<span class="slot" style="width:30px" aria-hidden="true">
  <i style="left:3px;bottom:4px;width:4px;height:4px;background:#E89A8A;box-shadow:9px 2px 0 #F7D27A,18px 0 0 #E89A8A"></i>
  <i style="left:4px;bottom:0;width:2px;height:4px;background:#6FAE8C;box-shadow:9px 0 0 #6FAE8C,18px 0 0 #6FAE8C"></i></span>`;
const CAT = html`<span class="slot" style="width:26px" aria-hidden="true">
  <i style="left:6px;bottom:2px;width:14px;height:8px;background:#2B2A33"></i>
  <i style="left:16px;bottom:6px;width:8px;height:8px;background:#2B2A33"></i>
  <i style="left:16px;bottom:14px;width:3px;height:3px;background:#2B2A33"></i>
  <i style="left:21px;bottom:14px;width:3px;height:3px;background:#2B2A33"></i>
  <i style="left:18px;bottom:9px;width:2px;height:2px;background:#F7D27A;box-shadow:3px 0 0 #F7D27A"></i>
  <i style="left:2px;bottom:4px;width:4px;height:3px;background:#2B2A33"></i>
  <i style="left:0;bottom:6px;width:3px;height:6px;background:#2B2A33"></i></span>`;

const SHAPES: Record<string, TemplateResult> = { fountain: FOUNTAIN, lantern: LANTERN, flowers: FLOWERS, cat: CAT };
const ORDER = ['fountain', 'lantern', 'flowers', 'cat'];

/** One grass-strip row with the owned decor ids; unknown ids are ignored. */
export function decorTemplate(owned: string[]): TemplateResult {
  return html`<div class="decorrow">${ORDER.filter((id) => owned.includes(id)).map((id) => SHAPES[id])}</div>`;
}
