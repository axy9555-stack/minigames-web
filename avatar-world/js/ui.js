/* Avatar World 捏脸换装馆 —— 定制面板 UI（chunk 2）。
 * 只负责 DOM 与交互；选项一律取自 avatar.js 的 OPTIONS，渲染一律走 AvatarWorld.render。
 * 不碰浏览器存储、不导出（chunk 3 的活）。 */
(function (root) {
  'use strict';

  var ns = root.AvatarWorld = root.AvatarWorld || {};

  // 分组顺序与标题；swatch=true 的组用色块圆点展示
  var GROUPS = [
    { key: 'bg', title: '背景' },
    { key: 'skin', title: '肤色', swatch: true },
    { key: 'hair', title: '发型' },
    { key: 'hairColor', title: '发色', swatch: true },
    { key: 'eyes', title: '眼睛' },
    { key: 'brows', title: '眉毛' },
    { key: 'mouth', title: '嘴巴' },
    { key: 'blush', title: '腮红' },
    { key: 'outfit', title: '服装' },
    { key: 'accessory', title: '配饰' }
  ];

  function ui() {
    if (!ns.ui) {
      ns.ui = {
        cfg: null,
        ready: false,
        render: function () { if (ns.render) ns.render(this.cfg); },
        refresh: refreshSelection,
        apply: applyCfg
      };
    }
    return ns.ui;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- 面板构建 ---------- */

  function buildPanel(panel) {
    var opts = ns.OPTIONS;
    var title = el('h2', 'panel-title', '定制');
    panel.appendChild(title);

    var presetBar = el('div', 'preset-bar');
    presetBar.appendChild(el('span', 'preset-label', '预设'));
    ns.state.PRESETS.forEach(function (preset, i) {
      var btn = el('button', 'preset-btn' + (i === 1 ? ' preset-btn-dark' : ''), preset.name);
      btn.type = 'button';
      btn.dataset.preset = String(i);
      btn.setAttribute('aria-label', '应用预设：' + preset.name);
      presetBar.appendChild(btn);
    });
    panel.appendChild(presetBar);

    var groups = el('div', 'groups');
    GROUPS.forEach(function (group) {
      var section = el('section', 'group');
      section.appendChild(el('h3', 'group-title', group.title));
      var row = el('div', 'options' + (group.swatch ? ' options-swatch' : ''));
      opts[group.key].forEach(function (value) {
        var btn = el('button', 'opt');
        btn.type = 'button';
        btn.dataset.dim = group.key;
        btn.dataset.value = value;
        btn.setAttribute('aria-pressed', 'false');
        if (group.swatch) {
          btn.title = group.title + '：' + colorLabel(value);
          var dot = el('span', 'swatch-dot');
          dot.style.background = value;
          btn.appendChild(dot);
        } else {
          btn.textContent = value;
        }
        row.appendChild(btn);
      });
      section.appendChild(row);
      groups.appendChild(section);
    });
    panel.appendChild(groups);
    return groups;
  }

  function colorLabel(value) {
    // 色值维度：给色块加可读名，避免 hover 全是 #xxxxxx
    var map = {
      '#ffe0c4': '浅暖', '#f6c9a0': '暖杏', '#e0a877': '小麦', '#b97a50': '蜜棕', '#7d4f33': '深棕',
      '#2b2118': '墨黑', '#6b4226': '棕栗', '#d9a441': '亚麻金', '#ff8fb1': '樱粉',
      '#7b5cd6': '雾紫', '#c9d6e8': '银灰蓝'
    };
    return map[value] || value;
  }

  /* ---------- 选中态 ---------- */

  function refreshSelection() {
    var cfg = ui().cfg;
    var buttons = document.querySelectorAll('#panel .opt');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var active = cfg[btn.dataset.dim] === btn.dataset.value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  /* ---------- 状态变更 ---------- */

  function applyCfg(cfg) {
    var u = ui();
    u.cfg = cfg;
    u.render();
    refreshSelection();
  }

  function setDim(dim, value) {
    ui().cfg[dim] = value;
    ui().render();
    refreshSelection();
  }

  /* ---------- 初始化 ---------- */

  function init() {
    if (ui().ready) return;
    var panel = document.getElementById('panel');
    var canvas = document.getElementById('avatar-canvas');
    if (!panel || !canvas || !ns.OPTIONS || !ns.state) return;

    var groups = buildPanel(panel);
    groups.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.opt') : null;
      if (btn && panel.contains(btn)) setDim(btn.dataset.dim, btn.dataset.value);
    });
    panel.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.preset-btn') : null;
      if (!btn || !panel.contains(btn)) return;
      var preset = ns.state.PRESETS[Number(btn.dataset.preset)];
      if (preset) applyCfg(Object.assign({}, preset.cfg));
    });

    var btnRandom = document.getElementById('btn-random');
    var btnReset = document.getElementById('btn-reset');
    if (btnRandom) {
      btnRandom.addEventListener('click', function () {
        applyCfg(ns.state.createRandom());
      });
    }
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        applyCfg(Object.assign({}, ns.state.DEFAULT_CFG));
      });
    }

    ui().ready = true;
    applyCfg(Object.assign({}, ns.state.DEFAULT_CFG));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
