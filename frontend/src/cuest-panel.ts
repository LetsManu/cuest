import { LitElement, css, html } from 'lit';
import { STRINGS } from './strings';

/** Placeholder until the full panel lands. */
export class CuestPanel extends LitElement {
  static styles = css`:host{display:block;padding:16px}`;
  render() {
    return html`<p>${STRINGS.panelPlaceholder}</p>`;
  }
}

if (!customElements.get('cuest-panel')) customElements.define('cuest-panel', CuestPanel);
