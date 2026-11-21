/* Avatar World 捏脸换装馆 —— 保存画廊 / 导出 PNG / 分享链接（chunk 3）。
 * 依赖 avatar.js（drawAvatar）、state.js（render/DEFAULT_CFG）、ui.js（ui.apply）。
 * 所有 localStorage 与剪贴板操作都包 try/catch，隐私模式下页面不能崩。 */
(function (root) {
  'use strict';

  var ns = root.AvatarWorld = root.AvatarWorld || {};
  var KEY = 'avatar-world-saved';
  var MAX_SAVED = 12;
  var THUMB_W = 120, THUMB_H = 150;

  function gallery() {
    if (!ns.gallery) {
      ns.gallery = {
        ready: false,
        loadSaved: loadSaved,
        render: renderGallery,
        applyFromHash: applyFromHash
      };
    }
    return ns.gallery;
  }

  /* ---------- localStorage（全部包 try/catch） ---------- */

  function readStore() {
    try {
      var raw = root.localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (item) {
        return item && typeof item === 'object' && typeof item.time === 'number' && item.cfg;
      }).slice(-MAX_SAVED);
    } catch (e) {
      return []; // 解析失败或存储不可用：当作空画廊
    }
  }

  function writeStore(list) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_SAVED)));
      return true;
    } catch (e) {
      return false; // 隐私模式 / 超配额：只提示，不崩
    }
  }

  function loadSaved() {
    return readStore();
  }

  function saveCurrent() {
    var cfg = ns.ui && ns.ui.cfg;
    if (!cfg) return false;
    var list = readStore();
    list.push({ cfg: Object.assign({}, cfg), time: Date.now() });
    return writeStore(list); // 满了 writeStore 内部 slice(-12) 删最旧
  }

  function deleteAt(index) {
    var list = readStore();
    list.splice(index, 1);
    return writeStore(list);
  }

  /* ---------- 工具 ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatTime(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fileNameNow() {
    var d = new Date();
    return 'avatar-world-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.png';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- 画廊渲染 ---------- */

  function renderGallery() {
    var box = document.getElementById('gallery');
    if (!box) return;
    box.textContent = '';

    var list = readStore();
    if (!list.length) {
      box.appendChild(el('p', 'gallery-empty', '画廊还是空的，捏好一个形象点「保存这个形象」吧。'));
      return;
    }

    var head = el('h2', 'gallery-title', '我的形象画廊');
    box.appendChild(head);
    var grid = el('div', 'gallery-grid');
    list.forEach(function (item, index) {
      grid.appendChild(buildCard(item, index));
    });
    box.appendChild(grid);
  }

  function buildCard(item, index) {
    var card = el('div', 'gallery-card');
    card.title = '点击载入这个形象';

    var canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    canvas.className = 'gallery-thumb';
    canvas.setAttribute('aria-label', '已保存形象 ' + formatTime(item.time));
    var ctx = canvas.getContext('2d');
    ctx.scale(THUMB_W / 480, THUMB_H / 600);
    ns.drawAvatar(ctx, item.cfg);
    card.appendChild(canvas);

    card.appendChild(el('div', 'gallery-time', formatTime(item.time)));

    var del = el('button', 'gallery-del', '×');
    del.type = 'button';
    del.title = '删除这个形象';
    del.setAttribute('aria-label', '删除 ' + formatTime(item.time) + ' 保存的形象');
    del.addEventListener('click', function (event) {
      event.stopPropagation();
      deleteAt(index);
      renderGallery();
    });
    card.appendChild(del);

    card.addEventListener('click', function () {
      ns.ui.apply(Object.assign({}, item.cfg));
    });
    return card;
  }

  /* ---------- 导出 PNG ---------- */

  function exportPng() {
    var canvas = document.getElementById('avatar-canvas');
    if (!canvas || !canvas.toBlob) return;
    canvas.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileNameNow();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    }, 'image/png');
  }

  /* ---------- 分享链接 ---------- */

  function encodeCfg(cfg) {
    return 'cfg=' + encodeURIComponent(JSON.stringify(cfg));
  }

  function shareLink(btn) {
    var cfg = ns.ui && ns.ui.cfg;
    if (!cfg) return;
    var encoded = encodeCfg(cfg);
    try {
      if (root.location.hash.slice(1) !== encoded) root.location.hash = encoded;
    } catch (e) { /* 某些环境禁写 hash：继续复制当前 URL */ }

    var url = root.location.href;
    var done = function () { flash(btn, '已复制链接 ✓', '复制分享链接'); };
    var fallback = function () {
      // 剪贴板不可用（http / 未授权）：弹框让用户手动复制
      root.prompt('复制下面的分享链接：', url);
    };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(url).then(done, fallback);
    } else {
      fallback();
    }
  }

  function applyFromHash() {
    var hash = root.location.hash || '';
    var m = hash.match(/^#cfg=([\s\S]+)$/);
    if (!m) return false;
    try {
      var cfg = JSON.parse(decodeURIComponent(m[1]));
      var opts = ns.OPTIONS;
      for (var key in opts) {
        if (opts[key].indexOf(cfg[key]) < 0) return false; // 有非法维度就整体放弃
      }
      ns.ui.apply(Object.assign({}, cfg));
      return true;
    } catch (e) {
      return false; // 解析失败：忽略，用默认配置
    }
  }

  function flash(btn, text, restore) {
    if (!btn || btn.dataset.busy) return;
    btn.dataset.busy = '1';
    var old = btn.textContent;
    btn.textContent = text;
    setTimeout(function () {
      btn.textContent = restore !== undefined ? restore : old;
      delete btn.dataset.busy;
    }, 1200);
  }

  /* ---------- 初始化 ---------- */

  function init() {
    if (gallery().ready) return;
    var btnSave = document.getElementById('btn-save');
    var btnExport = document.getElementById('btn-export');
    var btnShare = document.getElementById('btn-share');
    if (!btnSave || !ns.OPTIONS) return;

    btnSave.addEventListener('click', function () {
      var ok = saveCurrent();
      renderGallery();
      flash(btnSave, ok ? '已保存 ✓' : '保存失败（存储不可用）', '保存这个形象');
    });
    if (btnExport) btnExport.addEventListener('click', exportPng);
    if (btnShare) btnShare.addEventListener('click', function () { shareLink(btnShare); });

    gallery().ready = true;
    var loaded = applyFromHash(); // ui 已先初始化并画了默认形象，hash 有效则覆盖
    if (!loaded) renderGallery();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
