/* Cuest dashboard card: pixel hero, level, XP bar, gold and open quests.
 * No external requests. Quest titles are always set via textContent. */
(function () {
  'use strict';

  var ROWS = ['..........KKKK..........','........KKLLGGKK........','.......KLLGGGGGgK.......','......KLGGGGGGGGgK......','.....KLGGGGGGGGGGgK.....','....KLGGKKKKKKKKGGgK....','....KGGKHHHHHHHHKGgK....','....KGKHHhHHHHhHHKgK....','....KGKHSSHSSHSSHKgK....','....KGKSSSSSSSSSSKgK....','....KGKSKWSSSSKWSKgK....','....KGKSKKSSSSKKSKgK....','....KGKSPSSKKSSPSKgK....','....KGKsSSSSSSSSsKgK....','....KGGKKsSSSSsKKGgK....','....KGKyYYYYYYYYYKgK....','...KGGKRRRYYYYRRRKGgK...','...KGGKRRRRYYRRRrKGgK...','...KGGKRRRRRRRRRrKGgK...','...KSGKBBBBYYBBBBKGSK...','...KGGKRRRRRRRRRrKGgK...','...KgGKrRRRRRRRRrKGgK...','...KKKKKNNNKKNNNKKKKK...','.......KNNNKKNNNK.......','......KOOOOKKOOOOK......','......KooooKKooooK......','......KKKKKKKKKKKK......','.....ZZZZZZZZZZZZZZ.....'];
  var spriteCache = {};

  function stageForLevel(l) { return l >= 8 ? 3 : l >= 4 ? 2 : 1; }

  function spriteShadow(stage, px) {
    var key = stage + ':' + px;
    if (spriteCache[key]) return spriteCache[key];
    var g = ROWS.map(function (r) { return r.split(''); });
    function put(x, y, c) { if (g[y]) g[y][x] = c; }
    for (var y = 5; y <= 23; y++) put(21, y, 'T');
    put(20, 19, 'S');
    [20, 21, 22].forEach(function (x) { put(x, 24, 'B'); });
    [19, 20, 21, 22, 23].forEach(function (x, i) { put(x, 25, 'F'); put(x, 26, i % 2 ? 'f' : 'F'); put(x, 27, i % 2 ? 'F' : 'f'); });
    if (stage >= 2) { put(21, 2, 'y'); put(20, 3, 'y'); put(21, 3, 'Y'); put(22, 3, 'y'); put(21, 4, 'y'); }
    if (stage === 3) { [[21, 1], [19, 3], [23, 3], [20, 2], [22, 2], [20, 4], [22, 4]].forEach(function (p) { put(p[0], p[1], 'Q'); }); }
    var pal = { K: '#2B2A33', G: '#4E8A6E', L: '#6FAE8C', g: '#3B6E57', H: '#8B4A2B', h: '#6B3820', S: '#F2C9A0', s: '#D9A57E', W: '#FFF9EC', P: '#E89A8A', y: '#F7D27A', Y: '#E0A43A', R: '#B5523B', r: '#8E3E2C', B: '#6B4A2B', N: '#4A3A2A', O: '#7A4E2E', o: '#5A3A24', T: '#8B5E34', F: '#E0A43A', f: '#B07A1E', Z: 'rgba(43,42,51,0.18)', Q: 'rgba(247,210,122,0.55)' };
    if (stage === 1) { pal.G = '#8C7A5B'; pal.L = '#A8957A'; pal.g = '#6E5E44'; pal.y = '#C9C1B0'; pal.Y = '#A9A091'; }
    if (stage === 3) { pal.G = '#3D5A8A'; pal.L = '#F7D27A'; pal.g = '#2C4370'; pal.R = '#7A3E6E'; pal.r = '#5C2E53'; }
    var out = [];
    g.forEach(function (row, yy) {
      row.forEach(function (c, x) {
        if (c === '.') return;
        var col = pal[c];
        if (col) out.push(((x + 1) * px) + 'px ' + ((yy + 1) * px) + 'px 0 0 ' + col);
      });
    });
    return (spriteCache[key] = out.join(','));
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function spriteEl(stage, px, label) {
    var box = el('div', 'sprite');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', label);
    box.style.width = (24 * px) + 'px';
    box.style.height = (28 * px) + 'px';
    var dot = el('div', 'dot');
    dot.style.left = (-px) + 'px';
    dot.style.top = (-px) + 'px';
    dot.style.width = px + 'px';
    dot.style.height = px + 'px';
    dot.style.boxShadow = spriteShadow(stage, px);
    box.appendChild(dot);
    return box;
  }

  var STYLE = [
    ':host{display:block}',
    'ha-card{overflow:hidden}',
    '.scene{background:#2E3550;padding:14px 16px;display:flex;align-items:flex-end;gap:16px;color:#FFF9EC;position:relative}',
    '.scene::after{content:"";position:absolute;left:0;right:0;bottom:0;height:14px;background:#3F6B4F}',
    '.sprite{position:relative;overflow:hidden;flex:none;z-index:1;margin-bottom:-2px}',
    '.dot{position:absolute}',
    '.info{flex:1;min-width:0;padding-bottom:20px;z-index:1}',
    '.name{font-size:13px;opacity:.8}',
    '.lvl{font-size:18px;font-weight:600;margin:2px 0 8px}',
    '.bar{height:10px;background:rgba(255,249,236,.2);border-radius:5px;overflow:hidden}',
    '.fill{height:100%;background:#E0A43A;border-radius:5px}',
    '.meta{display:flex;justify-content:space-between;font-size:12px;margin-top:4px;opacity:.9}',
    '.quests{padding:8px 16px 12px;color:var(--primary-text-color)}',
    '.row{display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--divider-color,rgba(127,127,127,.3))}',
    '.row:first-child{border-top:0}',
    '.title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    'button{background:#3F6B4F;color:#FFF9EC;border:0;border-radius:16px;padding:6px 14px;font:inherit;cursor:pointer;min-height:32px}',
    'button:disabled{opacity:.5;cursor:default}',
    '.empty,.msg{color:var(--secondary-text-color);padding:8px 0}',
    '.head{font-size:12px;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}'
  ].join('');

  class CuestCard extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._hass = null;
      this._items = [];
      this._todoStamp = null;
      this._todoId = null;
      this._busy = {};
      this._sig = null;
      this.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      style.textContent = STYLE;
      this._card = document.createElement('ha-card');
      this.shadowRoot.appendChild(style);
      this.shadowRoot.appendChild(this._card);
    }

    static getStubConfig() { return {}; }

    setConfig(config) {
      this._config = config || {};
      this._sig = null;
      this._render();
    }

    getCardSize() { return 3 + Math.min(this._items.length, 5); }

    set hass(hass) {
      this._hass = hass;
      var todoId = this._findTodo();
      var todo = todoId && hass.states[todoId];
      var oq = Object.keys(hass.states).filter(function (id) {
        return id.indexOf('sensor.') === 0 && hass.entities && hass.entities[id] && hass.entities[id].platform === 'cuest' &&
          hass.states[id].attributes && Array.isArray(hass.states[id].attributes.quests);
      }).map(function (id) { return JSON.stringify(hass.states[id].attributes.quests); }).join('|');
      var stamp = todo ? todo.last_changed + '|' + todo.state + '|' + oq : null;
      if (todoId !== this._todoId || stamp !== this._todoStamp) {
        this._todoId = todoId;
        this._todoStamp = stamp;
        this._loadItems();
      }
      this._render();
    }

    _findTodo() {
      var h = this._hass;
      if (!h) return null;
      var ids = Object.keys(h.states).filter(function (id) {
        return id.indexOf('todo.') === 0 && h.entities && h.entities[id] && h.entities[id].platform === 'cuest';
      });
      if (ids.length) return ids[0];
      return h.states['todo.cuest_quests'] ? 'todo.cuest_quests' : null;
    }

    _loadItems() {
      var self = this;
      var id = this._todoId;
      if (!id || !this._hass) { this._items = []; return; }
      this._hass.callWS({ type: 'todo/item/list', entity_id: id }).then(function (res) {
        if (id !== self._todoId) return;
        self._items = ((res && res.items) || []).filter(function (i) { return i.status !== 'completed'; });
        self._render();
      }).catch(function () { /* keep the last list */ });
    }

    _player() {
      var h = this._hass;
      var players = {};
      Object.keys(h.states).forEach(function (id) {
        if (id.indexOf('sensor.') !== 0) return;
        var ent = h.entities && h.entities[id];
        if (!ent || ent.platform !== 'cuest') return;
        var a = h.states[id].attributes || {};
        if (!a.cuest_player_id || !a.cuest_kind) return;
        var p = players[a.cuest_player_id] || (players[a.cuest_player_id] = { id: a.cuest_player_id, order: Object.keys(players).length });
        p.person = a.ha_person || null;
        p[a.cuest_kind] = h.states[id];
      });
      var list = Object.keys(players).map(function (k) { return players[k]; });
      if (!list.length) return null;
      var want = this._config.person;
      var match = want && list.filter(function (p) { return p.person === want; })[0];
      return match || list[0];
    }

    _render() {
      if (!this._hass) return;
      var p = this._player();
      var sig = JSON.stringify([
        p && [p.level && p.level.state, p.level && p.level.attributes, p.xp && p.xp.state, p.gold && p.gold.state],
        this._items.map(function (i) { return [i.uid, i.summary]; }),
        this._busy
      ]);
      if (sig === this._sig) return;
      this._sig = sig;
      var card = this._card;
      while (card.firstChild) card.removeChild(card.firstChild);
      if (!p || !p.level) {
        card.appendChild(el('div', 'quests', null)).appendChild(el('div', 'msg', 'Cuest is not ready yet. Check that the Cuest integration is set up and connected.'));
        return;
      }
      var a = p.level.attributes || {};
      var level = parseInt(p.level.state, 10) || 1;
      var title = a.title || '';
      var name = a.player_name || '';
      var into = Number(a.into_level) || 0;
      var toNext = Number(a.to_next) || 0;
      var pct = into + toNext > 0 ? Math.max(0, Math.min(100, Math.round(100 * into / (into + toNext)))) : 0;

      var scene = el('div', 'scene');
      scene.appendChild(spriteEl(stageForLevel(level), 4, 'Hero ' + name + ', ' + title));
      var info = el('div', 'info');
      info.appendChild(el('div', 'name', name));
      info.appendChild(el('div', 'lvl', 'Level ' + level + (title ? ' · ' + title : '')));
      var bar = el('div', 'bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(pct));
      var fill = el('div', 'fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      info.appendChild(bar);
      var meta = el('div', 'meta');
      meta.appendChild(el('span', '', toNext + ' XP to next level'));
      meta.appendChild(el('span', '', (p.gold ? p.gold.state : '0') + ' gold'));
      info.appendChild(meta);
      scene.appendChild(info);
      card.appendChild(scene);

      var q = el('div', 'quests');
      q.appendChild(el('div', 'head', 'Quests'));
      if (!this._items.length) {
        q.appendChild(el('div', 'empty', 'No open quests. Enjoy the quiet.'));
      }
      var self = this;
      this._items.forEach(function (item) {
        var row = el('div', 'row');
        row.appendChild(el('span', 'title', item.summary || ''));
        var btn = el('button', '', 'Done');
        btn.disabled = !!self._busy[item.uid];
        btn.addEventListener('click', function () { self._done(item); });
        row.appendChild(btn);
        q.appendChild(row);
      });
      card.appendChild(q);
    }

    _done(item) {
      var self = this;
      this._busy[item.uid] = true;
      this._sig = null;
      this._render();
      this._hass.callService('cuest', 'complete_quest', { quest_id: item.uid }).catch(function () { /* HA shows the error */ }).then(function () {
        delete self._busy[item.uid];
        self._sig = null;
        self._loadItems();
        self._render();
      });
    }
  }

  if (customElements.get('cuest-card')) return;
  customElements.define('cuest-card', CuestCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'cuest-card',
    name: 'Cuest',
    description: 'Your Cuest hero, level and open quests.'
  });
})();
