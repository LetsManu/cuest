import { css, html, type TemplateResult } from 'lit';

/** Pixel decor placed around the hero in the village card. One module so every screen draws it the same way. */
export const decorStyles = css`
  .decor{position:absolute;bottom:8px;z-index:1}
`;

const LANTERN = html`<span class="decor" aria-hidden="true" style="right:96px;bottom:20px;width:6px;height:34px;background:#4A3A2A"></span><span class="decor" aria-hidden="true" style="right:92px;bottom:50px;width:14px;height:14px;background:#F7D27A;box-shadow:0 0 14px 4px rgba(247,210,122,.6)"></span>`;
const FLOWERS = html`<span class="decor" aria-hidden="true" style="right:40px;bottom:6px;width:6px;height:6px;background:#E89A8A;box-shadow:10px 2px 0 #F7D27A,20px 0 0 #E89A8A,30px 3px 0 #F7D27A,5px -6px 0 #6FAE8C"></span>`;
const CAT = html`<span class="decor" aria-hidden="true" style="right:14px;bottom:4px;width:16px;height:8px;background:#2B2A33;box-shadow:12px -6px 0 -1px #2B2A33,-4px -2px 0 -2px #2B2A33"></span>`;
const FOUNTAIN = html`<span class="decor" aria-hidden="true" style="right:132px;bottom:6px;width:26px;height:10px;background:#9AA3B5;box-shadow:inset 0 3px 0 #7CC4BF"></span><span class="decor" aria-hidden="true" style="right:142px;bottom:16px;width:6px;height:16px;background:#9AA3B5;box-shadow:-5px -6px 0 -1px #BFE3E0,5px -6px 0 -1px #BFE3E0,0 -10px 0 -1px #BFE3E0"></span>`;

const SHAPES: Record<string, TemplateResult> = { lantern: LANTERN, flowers: FLOWERS, cat: CAT, fountain: FOUNTAIN };

/** Decorations for the owned decor ids; unknown ids are ignored. */
export function decorTemplate(owned: string[]): TemplateResult[] {
  return owned.filter((id) => SHAPES[id]).map((id) => SHAPES[id]);
}
