(function(){
'use strict';
var __modules={};
var __cache={};
function __resolve(from,req){
  if(req.charAt(0)!==".") return req;
  var base=from.split("/").slice(0,-1);
  var ps=req.split("/");
  for(var i=0;i<ps.length;i++){var p=ps[i];
    if(p===""||p===".") continue;
    if(p==="..") base.pop(); else base.push(p);}
  return base.join("/");
}
function __require(from){
  return function(req){
    var id=__resolve(from,req);
    if(__cache[id]) return __cache[id].exports;
    var fn=__modules[id];
    if(!fn) throw new Error("Cannot find module "+req+" (resolved: "+id+")");
    var module={exports:{}};
    __cache[id]=module;
    fn(module,module.exports,__require(id));
    return module.exports;
  };
}
__modules["game.js"]=function(module,exports,require){
require('./js/game.js');

};
__modules["js/audio.js"]=function(module,exports,require){
// 梦幻花园 - 音效（只做音效，不碰游戏逻辑）
// 优先用 wx.createWebAudioContext 合成简单音效；不可用时静默，绝不抛错。
(function (root) {
  'use strict';

  var enabled = true;
  var actx = null;    // WebAudio 上下文
  var tried = false;  // 只尝试创建一次

  function getCtx() {
    if (tried) return actx;
    tried = true;
    try {
      if (typeof wx !== 'undefined' && wx &&
          typeof wx.createWebAudioContext === 'function') {
        actx = wx.createWebAudioContext();
      }
    } catch (e) {
      actx = null;
    }
    return actx;
  }

  // 单音：freq 频率，start 相对开始的秒数，dur 时长，vol 音量
  function beep(c, freq, start, dur, type, vol) {
    try {
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.2, c.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime + start);
      osc.stop(c.currentTime + start + dur);
    } catch (e) { /* 静默 */ }
  }

  // 白噪声（浇水“哗”）
  function noise(c, dur, vol, cutoff) {
    try {
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      var src = c.createBufferSource();
      src.buffer = buf;
      var gain = c.createGain();
      gain.gain.value = vol || 0.15;
      var node = gain;
      if (typeof c.createBiquadFilter === 'function') {
        var filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff || 900;
        src.connect(filter);
        filter.connect(gain);
      } else {
        src.connect(gain);
      }
      gain.connect(c.destination);
      src.start();
    } catch (e) { /* 静默 */ }
  }

  var SOUNDS = {
    // 种花：一声短“噗”（低频两段）
    plant: function (c) {
      beep(c, 180, 0, 0.12, 'sine', 0.25);
      beep(c, 120, 0.06, 0.1, 'sine', 0.2);
    },
    // 浇水：一声“哗”（白噪声 + 低通）
    water: function (c) {
      noise(c, 0.35, 0.15, 900);
    },
    // 收获：清脆“叮”（两个上行三角波）
    harvest: function (c) {
      beep(c, 880, 0, 0.15, 'triangle', 0.25);
      beep(c, 1318, 0.08, 0.2, 'triangle', 0.2);
    },
    // 卖出：金币“哗啦”（三连高频短音）
    sell: function (c) {
      beep(c, 1174, 0, 0.09, 'square', 0.1);
      beep(c, 1567, 0.07, 0.09, 'square', 0.1);
      beep(c, 2093, 0.14, 0.12, 'square', 0.1);
    },
    // 任务完成：三音上行（C5-E5-G5）
    task: function (c) {
      beep(c, 523, 0, 0.18, 'triangle', 0.22);
      beep(c, 659, 0.16, 0.18, 'triangle', 0.22);
      beep(c, 784, 0.32, 0.26, 'triangle', 0.22);
    }
  };

  function play(name) {
    if (!enabled) return;
    var fn = SOUNDS[name];
    if (!fn) return;
    var c = getCtx();
    if (!c) return; // 不可用时静默
    try {
      fn(c);
    } catch (e) { /* 静默 */ }
  }

  function setEnabled(v) {
    enabled = !!v;
  }
  function isEnabled() {
    return enabled;
  }

  root.DreamGardenAudio = { play: play, setEnabled: setEnabled, isEnabled: isEnabled };
})(typeof window !== 'undefined' ? window
  : typeof GameGlobal !== 'undefined' ? GameGlobal
  : globalThis);

};
__modules["js/game.js"]=function(module,exports,require){
// 梦幻花园 - 渲染 + 触摸操作 + 商店界面（chunk 2 入口）
// 全部画面用 Canvas 2D 手绘，不加载任何外部图片；不碰 DOM。
// 依赖 chunk 1 的 js/storage.js（存档）与 js/logic.js（纯逻辑）。
(function (root) {
  'use strict';

  var wxApi = (typeof wx !== 'undefined' && wx) ? wx : null;
  var G = (typeof GameGlobal !== 'undefined') ? GameGlobal : root;

  function tryRequire(p) {
    try { return (typeof require === 'function') ? require(p) : null; }
    catch (e) { return null; }
  }
  function ensure(name, path) {
    if (root[name] && typeof root[name] === 'object') return root[name];
    if (G[name] && typeof G[name] === 'object') return G[name];
    tryRequire(path); // require 副作用会让模块把全局挂上来
    return root[name] || G[name] || null;
  }
  var Logic = ensure('DreamGardenLogic', './logic.js');
  var Store = ensure('DreamGardenStorage', './storage.js');
  var Sfx = ensure('DreamGardenAudio', './audio.js');

  // ---------- 常量 ----------
  var TOOLS = [
    { id: 'shovel', name: '铲子' },
    { id: 'water', name: '水壶' },
    { id: 'basket', name: '篮子' }
  ];
  var FLOWER_ART = {
    sunflower: { petal: '#FFC53D', petalDark: '#E8A200', core: '#7A4A21' },
    rose:      { petal: '#E5484D', petalDark: '#B93840', core: '#FFD9CF' },
    tulip:     { petal: '#FF5A8A', petalDark: '#D93567', core: '#FFC7D9' },
    lavender:  { petal: '#9A6DD7', petalDark: '#7B4FB8', core: '#E4D6F7' },
    sakura:    { petal: '#FFB7D5', petalDark: '#F08CBB', core: '#FFE9F2' }
  };

  // ---------- 运行时状态 ----------
  var canvas = null, ctx = null;
  var W = 375, H = 667, dpr = 1;
  var state = null;
  var tool = 'shovel';
  var seed = 'sunflower';
  var shopOpen = false;
  var pressed = null;   // 按下的按钮（触摸反馈）
  var toast = null;     // {text, bad, until}
  var banner = null;    // {text, until}
  var ui = null;        // 布局与命中矩形
  var lastFrame = 0, lastTaskCheck = 0, timerId = null;
  var running = false;

  function now() { return Date.now(); }

  // ---------- 小工具 ----------
  function font(size, bold) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  }
  function textW(str, size) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      w += str.charCodeAt(i) > 255 ? size : size * 0.58;
    }
    return w;
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (color) ctx.fillStyle = color;
    ctx.fill();
  }
  // 椭圆（用缩放 + 圆实现，兼容不支持 ctx.ellipse 的环境）
  function ell(x, y, rx, ry, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.restore();
    if (color) ctx.fillStyle = color;
    ctx.fill();
  }
  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // ---------- 布局 ----------
  function buildLayout() {
    var topH = 58;
    var toolH = 62, seedH = 56;
    var gridTop = topH + 14;
    var bottomTotal = toolH + seedH + 10;
    var availH = H - gridTop - bottomTotal - 10;
    var cell = Math.max(44, Math.min((W - 30) / 4, availH / 4));
    var gx = Math.round((W - cell * 4) / 2);
    var gy = Math.round(gridTop + Math.max(4, (availH - cell * 4) / 2));
    var l = { topH: topH, grid: { x: gx, y: gy, cell: cell }, rects: [], shopRects: [] };

    for (var i = 0; i < 16; i++) {
      l.rects.push({
        id: 'plot:' + i,
        x: gx + (i % 4) * cell + 2,
        y: gy + Math.floor(i / 4) * cell + 2,
        w: cell - 4, h: cell - 4
      });
    }
    var toolsY = H - seedH - toolH - 4;
    TOOLS.forEach(function (t, i) {
      l.rects.push({ id: 'tool:' + t.id, x: 12 + i * 72, y: toolsY, w: 64, h: toolH - 8 });
    });
    var sw = (W - 16) / 5;
    Logic.FLOWERS.forEach(function (f, i) {
      l.rects.push({ id: 'seed:' + f.id, x: 8 + i * sw, y: H - seedH - 2, w: sw - 4, h: seedH - 6 });
    });
    l.rects.push({ id: 'audio', x: W - 118, y: 11, w: 38, h: 36 });
    l.rects.push({ id: 'shop', x: W - 76, y: 11, w: 66, h: 36 });

    // 商店覆盖层矩形（shopOpen 时才参与命中；顺序：遮罩 → 卡片 → 按钮）
    var cardH = Math.min(H - 30, 96 + Logic.FLOWERS.length * 52 + 62);
    var cardW = Math.min(W - 24, 352);
    var card = { x: (W - cardW) / 2, y: (H - cardH) / 2, w: cardW, h: cardH };
    l.card = card;
    l.shopRects.push({ id: 'shop:bg', x: 0, y: 0, w: W, h: H });
    l.shopRects.push({ id: 'shop:card', x: card.x, y: card.y, w: cardW, h: cardH });
    l.shopRects.push({ id: 'shop:close', x: card.x + cardW - 34, y: card.y + 10, w: 26, h: 26 });
    Logic.FLOWERS.forEach(function (f, i) {
      if (!Logic.isUnlocked(state, f.id)) {
        l.shopRects.push({
          id: 'shop:unlock:' + f.id,
          x: card.x + cardW - 104,
          y: card.y + 64 + i * 52 + 4,
          w: 92, h: 40
        });
      }
    });
    l.shopRects.push({ id: 'shop:sellall', x: card.x + 14, y: card.y + cardH - 58, w: cardW - 28, h: 44 });
    return l;
  }
  function rectOf(id) {
    if (!ui) return null;
    var lists = [ui.rects, ui.shopRects];
    for (var li = 0; li < lists.length; li++) {
      var list = lists[li];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
      }
    }
    return null;
  }
  function hitTest(x, y) {
    if (!ui) return null;
    var list = shopOpen ? ui.shopRects : ui.rects;
    for (var i = list.length - 1; i >= 0; i--) { // 后画的在上层
      var r = list[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return shopOpen ? { id: 'shop:bg' } : null;
  }
  function isPressed(id) {
    return !!pressed && pressed.id === id;
  }

  // ---------- 提示 ----------
  function showToast(text, bad) {
    toast = { text: String(text), bad: !!bad, until: now() + 1800 };
  }
  function sfx(name) {
    if (Sfx && typeof Sfx.play === 'function') Sfx.play(name);
  }
  function isAudioOn() {
    return !(Sfx && typeof Sfx.isEnabled === 'function') || Sfx.isEnabled();
  }

  // ---------- 操作 ----------
  function handlePlot(i) {
    var res;
    if (tool === 'shovel') res = Logic.plant(state, i, seed);
    else if (tool === 'water') res = Logic.water(state, i);
    else res = Logic.harvest(state, i);
    if (res.ok) {
      state = res.state;
      lastTaskCheck = 0; // 尽快结算任务
      if (tool === 'shovel') sfx('plant');
      else if (tool === 'water') sfx('water');
      else sfx('harvest');
      if (tool === 'basket') showToast('收获 1 朵' + Logic.getFlower(res.flowerId).name);
    } else {
      showToast(res.reason, true);
    }
  }
  function pickSeed(fid) {
    var f = Logic.getFlower(fid);
    if (!f) return;
    if (Logic.isUnlocked(state, fid)) {
      seed = fid;
      showToast('已选中 ' + f.name + ' 种子');
      return;
    }
    tryUnlock(fid); // 未解锁：尝试解锁（扣钱）
  }
  function tryUnlock(fid) {
    var f = Logic.getFlower(fid);
    if (!f) return;
    var res = Logic.unlockFlower(state, fid);
    if (res.ok) {
      state = res.state;
      lastTaskCheck = 0;
      showToast('已解锁 ' + f.name);
    } else {
      showToast(res.reason, true);
    }
  }
  function inventoryTotal() {
    var n = 0, id;
    for (id in state.inventory) {
      if (Object.prototype.hasOwnProperty.call(state.inventory, id)) n += state.inventory[id];
    }
    return n;
  }
  function inventoryValue() {
    var v = 0;
    Logic.FLOWERS.forEach(function (f) {
      v += Logic.inventoryCount(state, f.id) * f.sellPrice;
    });
    return v;
  }
  function sellAll() {
    var total = 0, n = 0;
    Logic.FLOWERS.forEach(function (f) {
      var c = Logic.inventoryCount(state, f.id);
      if (c > 0) {
        var r = Logic.sell(state, f.id, c);
        if (r.ok) { state = r.state; total += r.earned; n += c; }
      }
    });
    if (n > 0) {
      lastTaskCheck = 0;
      sfx('sell');
      showToast('卖出 ' + n + ' 朵花，+' + total + ' 金币');
    } else {
      showToast('背包里没有花', true);
    }
  }
  function handleTap(hit) {
    if (!state) return;
    var id = hit.id;
    if (id === 'shop') { shopOpen = true; return; }
    if (shopOpen) {
      if (id === 'shop:bg' || id === 'shop:close') { shopOpen = false; return; }
      if (id === 'shop:card') return;
      if (id.indexOf('shop:unlock:') === 0) { tryUnlock(id.slice(12)); return; }
      if (id === 'shop:sellall') { sellAll(); return; }
      return;
    }
    if (id.indexOf('plot:') === 0) { handlePlot(parseInt(id.slice(5), 10)); return; }
    if (id === 'audio') {
      var on = !(Sfx && typeof Sfx.isEnabled === 'function') || !Sfx.isEnabled();
      if (Sfx && typeof Sfx.setEnabled === 'function') Sfx.setEnabled(on);
      showToast(on ? '音效已开启' : '音效已关闭');
      return;
    }
    if (id.indexOf('tool:') === 0) { tool = id.slice(5); return; }
    if (id.indexOf('seed:') === 0) { pickSeed(id.slice(5)); return; }
  }

  // ---------- 触摸 / 生命周期 ----------
  function touchPoint(e) {
    if (!e) return null;
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return null;
    return {
      x: (t.clientX != null ? t.clientX : t.pageX) || 0,
      y: (t.clientY != null ? t.clientY : t.pageY) || 0
    };
  }
  function bindTouch() {
    if (!wxApi || typeof wxApi.onTouchStart !== 'function') return;
    wxApi.onTouchStart(function (e) {
      var p = touchPoint(e);
      if (p) pressed = hitTest(p.x, p.y);
    });
    wxApi.onTouchEnd(function (e) {
      var p = touchPoint(e);
      var hit = p ? hitTest(p.x, p.y) : null;
      if (pressed && hit && hit.id === pressed.id) handleTap(hit);
      pressed = null;
    });
    if (typeof wxApi.onTouchCancel === 'function') {
      wxApi.onTouchCancel(function () { pressed = null; });
    }
  }
  function saveGame() {
    if (!state || !Store) return false;
    return Store.save(state);
  }
  function bindLifecycle() {
    if (!wxApi) return;
    if (typeof wxApi.onHide === 'function') wxApi.onHide(function () { saveGame(); });
    if (typeof wxApi.onUnload === 'function') wxApi.onUnload(function () { saveGame(); });
  }
  function startAutosave() {
    if (typeof setInterval !== 'function') return;
    timerId = setInterval(function () { saveGame(); }, 10000);
  }

  // ---------- 任务结算 ----------
  function runTasks() {
    var res = Logic.checkTasks(state);
    if (res.reward > 0) {
      state = res.state;
      var names = res.completed.map(function (c) { return c.name; }).join('、');
      banner = { text: '任务完成 · ' + names + ' +' + res.reward + ' 金币', until: now() + 2000 };
      sfx('task');
    }
  }

  // ---------- 绘制：图标 ----------
  function drawIcon(kind, x, y, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    if (kind === 'shovel') {
      line(x, y - 9, x, y + 3);
      line(x - 4, y - 9, x + 4, y - 9);
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 3);
      ctx.lineTo(x + 4, y + 3);
      ctx.lineTo(x, y + 11);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'water') {
      rr(x - 6, y - 4, 12, 10, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y - 4, 4, Math.PI, 0);
      ctx.stroke();
      line(x - 6, y + 1, x - 11, y - 3);
      circle(x - 14, y + 2, 1.4);
      circle(x - 12, y + 6, 1.4);
    } else { // basket
      ctx.beginPath();
      ctx.arc(x, y + 1, 8, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y + 1, 5.5, Math.PI, 0);
      ctx.stroke();
      line(x - 4, y + 4, x - 2, y + 8);
      line(x + 4, y + 4, x + 2, y + 8);
    }
  }
  function drawSpeaker(x, y, on) {
    ctx.fillStyle = on ? '#FFECB3' : '#A89878';
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 3);
    ctx.lineTo(x - 3, y - 3);
    ctx.lineTo(x + 2, y - 7);
    ctx.lineTo(x + 2, y + 7);
    ctx.lineTo(x - 3, y + 3);
    ctx.lineTo(x - 7, y + 3);
    ctx.closePath();
    ctx.fill();
    if (on) {
      ctx.strokeStyle = '#FFECB3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 3, y, 5, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 3, y, 8.5, -0.9, 0.9);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#A89878';
      ctx.lineWidth = 2;
      line(x + 5, y - 5, x + 11, y + 5);
      line(x + 11, y - 5, x + 5, y + 5);
    }
  }
  function drawLock(x, y, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 2, 3, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = color;
    rr(x - 4.5, y - 2, 9, 7, 2);
    ctx.fill();
  }
  function miniFlower(x, y, id, locked) {
    if (locked) {
      circle(x, y, 7, '#C7BBA4');
      drawLock(x, y + 2, '#7A6B55');
      return;
    }
    var art = FLOWER_ART[id] || FLOWER_ART.sunflower;
    for (var k = 0; k < 6; k++) {
      var a = k / 6 * Math.PI * 2;
      circle(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 3.2, art.petal);
    }
    circle(x, y, 3, art.core);
  }
  function drawDrop(x, y) {
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now() / 250);
    ctx.fillStyle = '#3FB6F5';
    ctx.beginPath();
    ctx.arc(x, y + 1, 4.5, 0, Math.PI * 2);
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x - 4.2, y - 1.5);
    ctx.lineTo(x + 4.2, y - 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawCracks(x, y, w, h) {
    ctx.strokeStyle = 'rgba(52,32,14,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.3, y + h * 0.28);
    ctx.lineTo(x + w * 0.42, y + h * 0.4);
    ctx.lineTo(x + w * 0.34, y + h * 0.52);
    ctx.moveTo(x + w * 0.62, y + h * 0.24);
    ctx.lineTo(x + w * 0.55, y + h * 0.4);
    ctx.lineTo(x + w * 0.68, y + h * 0.55);
    ctx.moveTo(x + w * 0.22, y + h * 0.68);
    ctx.lineTo(x + w * 0.4, y + h * 0.76);
    ctx.stroke();
  }

  // ---------- 绘制：花 ----------
  function drawFlower(cx, cy, id, stage, t) {
    var art = FLOWER_ART[id] || FLOWER_ART.sunflower;
    if (stage === 0) { // 种子：小土包
      ell(cx, cy + 12, 10, 5, 0, '#6E4A26');
      circle(cx, cy + 10, 3, '#4A3016');
      return;
    }
    var stemLen = stage === 1 ? 8 : 14;
    var stemTop = cy + 16 - stemLen;
    ctx.strokeStyle = '#3E9B47';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    line(cx, cy + 16, cx, stemTop);
    // 两片叶
    ell(cx - 5, cy + 8, 6, 3, -0.6, '#4CAF50');
    ell(cx + 5, cy + 8, 6, 3, 0.6, '#4CAF50');
    if (stage === 2) { // 花苞
      ctx.fillStyle = '#3E9B47';
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy + 1);
      ctx.lineTo(cx + 4, cy + 1);
      ctx.lineTo(cx, cy + 6);
      ctx.closePath();
      ctx.fill();
      circle(cx, cy - 1, 5, art.petalDark);
      circle(cx, cy - 2, 3.5, art.petal);
    }
    if (stage === 3) { // 开花
      var hy = stemTop - 3;
      if (id === 'lavender') { // 穗状
        var rs = [4, 3.5, 3, 2.5];
        for (var k = 0; k < rs.length; k++) {
          circle(cx, stemTop - 1 - k * 5, rs[k], k % 2 ? art.petalDark : art.petal);
        }
      } else if (id === 'tulip') { // 杯状
        ell(cx - 5.5, hy + 1, 4.5, 8, -0.12, art.petalDark);
        ell(cx + 5.5, hy + 1, 4.5, 8, 0.12, art.petalDark);
        ell(cx, hy, 5.5, 9, 0, art.petal);
      } else {
        var n = id === 'rose' ? 7 : id === 'sakura' ? 5 : 10;
        var R = id === 'sakura' ? 8 : 9;
        for (var p = 0; p < n; p++) {
          var a = p / n * Math.PI * 2;
          ell(cx + Math.cos(a) * R, hy + Math.sin(a) * R, 6.5, 3.8, a, art.petal);
        }
        circle(cx, hy, 5.5, art.core);
      }
    }
  }

  // ---------- 绘制：各区域 ----------
  function buttonBg(r, color, isPressed) {
    var x = r.x + (isPressed ? 1.5 : 0);
    var y = r.y + (isPressed ? 1.5 : 0);
    var w = r.w - (isPressed ? 3 : 0);
    var h = r.h - (isPressed ? 3 : 0);
    ctx.fillStyle = color;
    rr(x, y, w, h, 8);
    ctx.fill();
    if (isPressed) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      rr(x, y, w, h, 8);
      ctx.fill();
    }
  }
  function drawTopBar() {
    ctx.fillStyle = '#5B4330';
    ctx.fillRect(0, 0, W, ui.topH);
    ctx.fillStyle = '#4A3626';
    ctx.fillRect(0, ui.topH - 4, W, 4);
    var cy = ui.topH / 2;
    // 金币
    circle(22, cy, 10, '#FFC53D');
    ctx.strokeStyle = '#E8A200';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(22, cy, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    font(15, true);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFECB3';
    ctx.fillText(String(state.coins), 38, cy);
    // 背包
    var bx = 118;
    ctx.fillStyle = '#C88A4B';
    rr(bx, cy - 8, 20, 15, 3);
    ctx.fill();
    ctx.strokeStyle = '#C88A4B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx + 10, cy - 8, 4.5, Math.PI, 0);
    ctx.stroke();
    font(14, true);
    ctx.fillStyle = '#FFD9B3';
    ctx.fillText(String(inventoryTotal()), bx + 26, cy);
    // 当前工具 / 种子
    var tName = '铲子';
    TOOLS.forEach(function (t) { if (t.id === tool) tName = t.name; });
    font(11, false);
    ctx.fillStyle = '#D7C3A8';
    ctx.fillText(tName + '·' + Logic.getFlower(seed).name, 184, cy);
    // 音效开关（小喇叭）
    var a = rectOf('audio');
    buttonBg(a, '#6B5138', isPressed('audio'));
    drawSpeaker(a.x + a.w / 2 - 2, a.y + a.h / 2, isAudioOn());
    // 商店按钮
    var r = rectOf('shop');
    buttonBg(r, '#FFB300', isPressed('shop'));
    font(14, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5B3A00';
    ctx.fillText('商店', r.x + r.w / 2, r.y + r.h / 2);
  }
  function drawGlow(x, y, w, h, t) {
    var pulse = 0.5 + 0.5 * Math.sin(t / 300);
    ctx.strokeStyle = 'rgba(255,197,61,' + (0.45 + 0.35 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 3;
    rr(x - 3, y - 3, w + 6, h + 6, 12);
    ctx.stroke();
  }
  function drawPlot(r, i, t) {
    var st = Logic.plotStatus(state, i);
    var isP = isPressed('plot:' + i);
    var inset = isP ? 3 : 0;
    var x = r.x + 2 + inset, y = r.y + 2 + inset;
    var w = r.w - 4 - inset * 2, h = r.h - 4 - inset * 2;
    // 土块
    ctx.fillStyle = isP ? '#7A4E2A' : '#8B5E3C';
    rr(x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = '#5E3B1E';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    rr(x + 3, y + 3, w - 6, 6, 3);
    ctx.fill();
    var cx = x + w / 2, cyy = y + h / 2;
    var dry = st.stage < 3 && st.water <= 20;
    if (dry) drawCracks(x, y, w, h);
    if (st.empty) {
      font(11, false);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,240,220,0.5)';
      ctx.fillText('空地', cx, cyy);
    } else {
      drawFlower(cx, cyy + 4, st.flower, st.stage, t);
      if (st.stage < 3) {
        var bw = w - 16;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        rr(cx - bw / 2, y + h - 12, bw, 5, 2.5);
        ctx.fill();
        if (st.water > 0) {
          ctx.fillStyle = st.water > 20 ? '#4FC3F7' : '#EF5350';
          rr(cx - bw / 2, y + h - 12, Math.max(3, bw * st.water / 100), 5, 2.5);
          ctx.fill();
        }
        if (dry) drawDrop(x + w - 14, y + 14);
      } else {
        drawGlow(x, y, w, h, t);
      }
    }
  }
  function drawGrid(t) {
    var g = ui.grid;
    for (var i = 0; i < 16; i++) {
      drawPlot({
        x: g.x + (i % 4) * g.cell,
        y: g.y + Math.floor(i / 4) * g.cell,
        w: g.cell, h: g.cell
      }, i, t);
    }
  }
  function drawToolCell(r, t) {
    var act = tool === t.id;
    var isP = isPressed(r.id);
    buttonBg(r, act ? '#FFB300' : '#F7EBD3', isP);
    ctx.strokeStyle = act ? '#C87F00' : '#D8C39B';
    ctx.lineWidth = act ? 2.5 : 1.5;
    rr(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 8);
    ctx.stroke();
    drawIcon(t.id, r.x + r.w / 2, r.y + 20, act ? '#5B3A00' : '#8A5A2B');
    font(11, act);
    ctx.textAlign = 'center';
    ctx.fillStyle = act ? '#5B3A00' : '#8A5A2B';
    ctx.fillText(t.name, r.x + r.w / 2, r.y + 42);
  }
  function drawSeedCell(r, f) {
    var locked = !Logic.isUnlocked(state, f.id);
    var sel = seed === f.id;
    var isP = isPressed(r.id);
    buttonBg(r, sel ? '#FFE9B8' : '#F7EBD3', isP);
    ctx.strokeStyle = sel ? '#E8A200' : '#D8C39B';
    ctx.lineWidth = sel ? 2.5 : 1.5;
    rr(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 8);
    ctx.stroke();
    var cx = r.x + r.w / 2;
    font(10, true);
    ctx.textAlign = 'center';
    if (locked) {
      drawLock(cx, r.y + 15, '#8A7A5F');
      ctx.fillStyle = '#9A8B77';
      ctx.fillText(f.name, cx, r.y + 31);
      font(9, true);
      ctx.fillStyle = '#8A5A2B';
      ctx.fillText('解锁 ' + f.unlockCost, cx, r.y + 42);
    } else {
      miniFlower(cx, r.y + 15, f.id, false);
      ctx.fillStyle = '#4A3620';
      ctx.fillText(f.name, cx, r.y + 31);
      var pw = textW(String(f.seedPrice), 10);
      var tx = cx + 3 + pw / 2;
      circle(tx - pw / 2 - 8, r.y + 41, 4, '#FFC53D');
      ctx.fillStyle = '#8A5A2B';
      ctx.textAlign = 'left';
      ctx.fillText(String(f.seedPrice), tx - pw / 2, r.y + 41);
      ctx.textAlign = 'center';
    }
  }
  function drawToolbar() {
    TOOLS.forEach(function (t) {
      var r = rectOf('tool:' + t.id);
      if (r) drawToolCell(r, t);
    });
    Logic.FLOWERS.forEach(function (f) {
      var r = rectOf('seed:' + f.id);
      if (r) drawSeedCell(r, f);
    });
  }
  function drawClose(x, y, isP) {
    circle(x, y, isP ? 10 : 12, 'rgba(90,60,30,0.28)');
    ctx.strokeStyle = '#6B4A26';
    ctx.lineWidth = 2.5;
    line(x - 4, y - 4, x + 4, y + 4);
    line(x + 4, y - 4, x - 4, y + 4);
  }
  function drawShop() {
    ctx.fillStyle = 'rgba(20,14,8,0.55)';
    ctx.fillRect(0, 0, W, H);
    var c = ui.card;
    ctx.fillStyle = '#FFF8EC';
    rr(c.x, c.y, c.w, c.h, 14);
    ctx.fill();
    ctx.strokeStyle = '#D9B98A';
    ctx.lineWidth = 2;
    ctx.stroke();
    font(18, true);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5A3E1B';
    ctx.fillText('花园商店', c.x + 18, c.y + 30);
    drawClose(c.x + c.w - 21, c.y + 23, isPressed('shop:close'));
    Logic.FLOWERS.forEach(function (f, i) {
      var ry = c.y + 64 + i * 52;
      if (i > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.07)';
        ctx.lineWidth = 1;
        line(c.x + 14, ry - 3, c.x + c.w - 14, ry - 3);
      }
      var locked = !Logic.isUnlocked(state, f.id);
      miniFlower(c.x + 30, ry + 26, f.id, locked);
      font(15, true);
      ctx.textAlign = 'left';
      ctx.fillStyle = locked ? '#9A8B77' : '#4A3620';
      ctx.fillText(f.name + (locked ? '（未解锁）' : ''), c.x + 54, ry + 20);
      font(12, false);
      ctx.fillStyle = '#7A6547';
      var inv = Logic.inventoryCount(state, f.id);
      ctx.fillText(
        '种子 ' + f.seedPrice + ' · 卖花 ' + f.sellPrice + ' · 生长 ' + f.growSeconds + ' 秒' +
        (inv > 0 ? ' · 背包 x' + inv : ''),
        c.x + 54, ry + 40
      );
      if (locked) {
        var btn = rectOf('shop:unlock:' + f.id);
        if (btn) {
          buttonBg(btn, '#8A5A2B', isPressed(btn.id));
          font(13, true);
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFF3E0';
          ctx.fillText('解锁 ' + f.unlockCost, btn.x + btn.w / 2, btn.y + btn.h / 2);
        }
      }
    });
    var sellBtn = rectOf('shop:sellall');
    var total = inventoryValue();
    var can = total > 0;
    buttonBg(sellBtn, can ? '#E8833A' : '#C9BBA4', isPressed('shop:sellall'));
    font(15, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = can ? '#FFF3E0' : '#7A6B55';
    ctx.fillText(
      can ? '一键卖出全部（+' + total + ' 金币）' : '背包是空的',
      sellBtn.x + sellBtn.w / 2, sellBtn.y + sellBtn.h / 2
    );
  }
  function drawToast() {
    if (toast && now() > toast.until) toast = null;
    if (!toast) return;
    var size = 14;
    var tw = textW(toast.text, size) + 26;
    var y = ui.grid.y - 20;
    ctx.fillStyle = toast.bad ? 'rgba(255,235,232,0.95)' : 'rgba(40,30,20,0.85)';
    rr((W - tw) / 2, y - 13, tw, 26, 13);
    ctx.fill();
    font(size, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = toast.bad ? '#D93025' : '#FFF6E5';
    ctx.fillText(toast.text, W / 2, y);
  }
  function drawBanner() {
    if (banner && now() > banner.until) banner = null;
    if (!banner) return;
    var size = 15;
    var tw = textW(banner.text, size) + 30;
    var y = ui.topH + 20;
    ctx.fillStyle = 'rgba(255,213,79,0.95)';
    rr((W - tw) / 2, y - 14, tw, 28, 14);
    ctx.fill();
    ctx.strokeStyle = '#E8A200';
    ctx.lineWidth = 1.5;
    rr((W - tw) / 2, y - 14, tw, 28, 14);
    ctx.stroke();
    font(size, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5B3A00';
    ctx.fillText(banner.text, W / 2, y);
  }
  function draw(t) {
    if (!ctx || !ui || !state) return;
    ui = buildLayout(); // 屏幕固定，重建成本极低，且跟随解锁状态
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#A5D68B'; // 草地
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#BEE3F0'; // 天空带
    ctx.fillRect(0, 0, W, ui.topH);
    drawTopBar();
    drawGrid(t);
    drawToolbar();
    drawToast();
    if (shopOpen) drawShop();
    drawBanner();
  }

  // ---------- 主循环 ----------
  function frame(ts) {
    if (!state) return;
    var t = (typeof ts === 'number' && isFinite(ts)) ? ts : now();
    if (!lastFrame) lastFrame = t;
    var dt = (t - lastFrame) / 1000;
    lastFrame = t;
    if (dt > 0) {
      state = Logic.tick(state, Math.min(dt, 3600)); // 真实流逝秒数推进生长
      if (t - lastTaskCheck > 400) {
        lastTaskCheck = t;
        runTasks();
      }
    }
    draw(t);
  }
  function loop(ts) {
    if (!running) return;
    try { frame(ts); } catch (e) { /* 单帧异常不中断主循环 */ }
    requestAnimationFrame(loop);
  }
  function start() {
    if (running || !ctx) return false;
    if (typeof requestAnimationFrame !== 'function') return false;
    running = true;
    lastFrame = 0;
    if (wxApi && typeof wxApi.setPreferredFramesPerSecond === 'function') {
      try { wxApi.setPreferredFramesPerSecond(30); } catch (e) { /* 可选能力 */ }
    }
    requestAnimationFrame(loop);
    return true;
  }

  // ---------- 初始化 ----------
  function init() {
    if (!Logic || !Store) return false;
    var info = null;
    if (wxApi && typeof wxApi.getSystemInfoSync === 'function') {
      try { info = wxApi.getSystemInfoSync(); } catch (e) { info = null; }
    }
    if (info) {
      if (info.windowWidth > 0) W = info.windowWidth;
      if (info.windowHeight > 0) H = info.windowHeight;
      dpr = info.pixelRatio > 0 ? info.pixelRatio : 1;
    }
    if (wxApi && typeof wxApi.createCanvas === 'function') {
      try {
        canvas = wxApi.createCanvas();
        ctx = canvas.getContext('2d');
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      } catch (e) { canvas = null; ctx = null; }
    }
    if (ctx && dpr !== 1 && typeof ctx.setTransform === 'function') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    state = Logic.fromSave(Store.load());
    ui = buildLayout();
    bindTouch();
    bindLifecycle();
    startAutosave();
    return true;
  }

  if (init()) start();

  // ---------- 对外接口（也便于自测） ----------
  root.DreamGardenGame = {
    state: function () { return state; },
    frame: frame,
    tap: function (x, y) {
      var hit = hitTest(x, y);
      if (hit) handleTap(hit);
      return hit;
    },
    press: function (x, y) { pressed = hitTest(x, y); return pressed; },
    release: function (x, y) {
      var hit = hitTest(x, y);
      if (pressed && hit && hit.id === pressed.id) handleTap(hit);
      pressed = null;
      return hit;
    },
    layout: function () { return ui; },
    screen: function () { return { width: W, height: H, dpr: dpr }; },
    selectedTool: function () { return tool; },
    selectedSeed: function () { return seed; },
    isShopOpen: function () { return shopOpen; },
    lastToast: function () { return toast; },
    lastBanner: function () { return banner; },
    save: saveGame,
    isRunning: function () { return running; }
  };
})(typeof window !== 'undefined' ? window
  : typeof GameGlobal !== 'undefined' ? GameGlobal
  : globalThis);

};
__modules["js/logic.js"]=function(module,exports,require){
// 梦幻花园 - 纯逻辑（不碰渲染 / wx / DOM）
// 所有规则函数都是纯函数：不修改传入的 state，返回新 state 或结果对象。
(function (root) {
  'use strict';

  var GRID_COLS = 4;
  var GRID_ROWS = 4;
  var PLOT_COUNT = GRID_COLS * GRID_ROWS;

  var START_COINS = 50;
  var PLANT_WATER = 50;      // 种下时自带的水量
  var WATER_PER_USE = 60;    // 每次浇水 +60
  var WATER_MAX = 100;
  var WATER_DRAIN = 1;       // 每秒耗水 1（即每 10 秒 -10）

  var STAGE_NAMES = ['种子', '幼苗', '花苞', '开花'];

  // waterNeed：从种下到开花大约需要浇几次水；unlockCost 为 0 表示开局即解锁
  var FLOWERS = [
    { id: 'sunflower', name: '向日葵', seedPrice: 10,  sellPrice: 25,  growSeconds: 60,  waterNeed: 1, unlockCost: 0 },
    { id: 'rose',      name: '玫瑰',   seedPrice: 25,  sellPrice: 60,  growSeconds: 120, waterNeed: 2, unlockCost: 0 },
    { id: 'tulip',     name: '郁金香', seedPrice: 40,  sellPrice: 95,  growSeconds: 180, waterNeed: 3, unlockCost: 100 },
    { id: 'lavender',  name: '薰衣草', seedPrice: 70,  sellPrice: 170, growSeconds: 300, waterNeed: 5, unlockCost: 250 },
    { id: 'sakura',    name: '樱花',   seedPrice: 120, sellPrice: 300, growSeconds: 480, waterNeed: 8, unlockCost: 500 }
  ];

  var TASKS = [
    { id: 'first_plant',     name: '种下第一朵花',   reward: 10, done: function (s) { return s.stats.planted >= 1; } },
    { id: 'harvest_5',       name: '收获 5 朵花',    reward: 30, done: function (s) { return s.stats.harvested >= 5; } },
    { id: 'coins_200',       name: '攒到 200 金币',  reward: 50, done: function (s) { return s.coins >= 200; } },
    { id: 'unlock_lavender', name: '解锁薰衣草',     reward: 80, done: function (s) { return s.unlockedFlowers.indexOf('lavender') !== -1; } },
    { id: 'plots_8',         name: '同时种满 8 块地', reward: 40, done: function (s) { return plantedCount(s) >= 8; } },
    { id: 'sell_10',         name: '卖出 10 朵花',   reward: 60, done: function (s) { return s.stats.sold >= 10; } }
  ];

  var DEFAULT_SAVE = {
    coins: START_COINS,
    plots: [],
    unlockedFlowers: ['sunflower', 'rose'],
    tasksDone: {},
    createdAt: 0
  };

  // ---------- 内部工具 ----------

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function fail(reason) {
    return { ok: false, reason: reason };
  }

  function emptyPlot() {
    return { flower: null, stage: 0, water: 0, plantedAt: null, growth: 0 };
  }

  function validIndex(state, i) {
    return typeof i === 'number' && i % 1 === 0 && i >= 0 && i < state.plots.length;
  }

  function stageFor(growth, growSeconds) {
    var p = growth / growSeconds;
    if (p >= 1) return 3;
    if (p >= 2 / 3) return 2;
    if (p >= 1 / 3) return 1;
    return 0;
  }

  function plantedCount(state) {
    var n = 0;
    for (var i = 0; i < state.plots.length; i++) {
      if (state.plots[i].flower) n++;
    }
    return n;
  }

  // ---------- 查询 ----------

  function getFlower(flowerId) {
    for (var i = 0; i < FLOWERS.length; i++) {
      if (FLOWERS[i].id === flowerId) return FLOWERS[i];
    }
    return null;
  }

  function isUnlocked(state, flowerId) {
    return state.unlockedFlowers.indexOf(flowerId) !== -1;
  }

  function canHarvest(state, plotIndex) {
    if (!validIndex(state, plotIndex)) return false;
    var plot = state.plots[plotIndex];
    return !!plot.flower && plot.stage === 3;
  }

  // 单块地的展示用状态
  function plotStatus(state, plotIndex) {
    if (!validIndex(state, plotIndex)) return null;
    var plot = state.plots[plotIndex];
    if (!plot.flower) {
      return { empty: true, flower: null, name: '空地', stage: 0, stageName: '', water: 0,
        progress: 0, remainingSeconds: 0, needsWater: false, canHarvest: false };
    }
    var f = getFlower(plot.flower);
    var growth = plot.growth || 0;
    return {
      empty: false,
      flower: plot.flower,
      name: f.name,
      stage: plot.stage,
      stageName: STAGE_NAMES[plot.stage],
      water: plot.water,
      progress: Math.min(1, growth / f.growSeconds),
      remainingSeconds: Math.max(0, f.growSeconds - growth),
      needsWater: plot.stage < 3 && plot.water <= 0,
      canHarvest: plot.stage === 3
    };
  }

  function inventoryCount(state, flowerId) {
    return (state.inventory && state.inventory[flowerId]) || 0;
  }

  // 所有任务及完成情况
  function taskList(state) {
    return TASKS.map(function (t) {
      return { id: t.id, name: t.name, reward: t.reward, done: !!state.tasksDone[t.id] };
    });
  }

  // ---------- 状态构造 ----------

  function createInitialState(now) {
    var plots = [];
    for (var i = 0; i < PLOT_COUNT; i++) plots.push(emptyPlot());
    return {
      coins: START_COINS,
      plots: plots,
      unlockedFlowers: DEFAULT_SAVE.unlockedFlowers.slice(),
      inventory: {},
      stats: { planted: 0, harvested: 0, sold: 0 },
      tasksDone: {},
      createdAt: typeof now === 'number' ? now : Date.now()
    };
  }

  // 把存档（可能缺字段）补全成完整 state
  function fromSave(save, now) {
    var state = createInitialState(now);
    if (!save || typeof save !== 'object') return state;
    if (typeof save.coins === 'number' && isFinite(save.coins)) state.coins = save.coins;
    if (Array.isArray(save.plots)) {
      for (var i = 0; i < PLOT_COUNT && i < save.plots.length; i++) {
        var p = save.plots[i];
        var f = p && getFlower(p.flower);
        if (!f) continue;
        var growth = Math.max(0, Math.min(f.growSeconds, Number(p.growth) || 0));
        state.plots[i] = {
          flower: f.id,
          stage: stageFor(growth, f.growSeconds),
          water: Math.max(0, Math.min(WATER_MAX, Number(p.water) || 0)),
          plantedAt: typeof p.plantedAt === 'number' ? p.plantedAt : null,
          growth: growth
        };
      }
    }
    if (Array.isArray(save.unlockedFlowers)) {
      save.unlockedFlowers.forEach(function (id) {
        if (getFlower(id) && state.unlockedFlowers.indexOf(id) === -1) state.unlockedFlowers.push(id);
      });
    }
    if (save.inventory && typeof save.inventory === 'object') {
      Object.keys(save.inventory).forEach(function (id) {
        var n = Math.floor(Number(save.inventory[id]) || 0);
        if (getFlower(id) && n > 0) state.inventory[id] = n;
      });
    }
    if (save.stats && typeof save.stats === 'object') {
      ['planted', 'harvested', 'sold'].forEach(function (k) {
        state.stats[k] = Math.max(0, Math.floor(Number(save.stats[k]) || 0));
      });
    }
    if (save.tasksDone && typeof save.tasksDone === 'object') {
      TASKS.forEach(function (t) {
        if (save.tasksDone[t.id]) state.tasksDone[t.id] = true;
      });
    }
    if (typeof save.createdAt === 'number' && save.createdAt > 0) state.createdAt = save.createdAt;
    return state;
  }

  // ---------- 规则 ----------

  // 种花：成功返回 {ok:true, state}，失败返回 {ok:false, reason}
  function plant(state, plotIndex, flowerId, now) {
    if (!validIndex(state, plotIndex)) return fail('没有这块地');
    var f = getFlower(flowerId);
    if (!f) return fail('没有这种花');
    if (state.plots[plotIndex].flower) return fail('这块地已经种了花');
    if (!isUnlocked(state, flowerId)) return fail(f.name + '还没解锁');
    if (state.coins < f.seedPrice) return fail('金币不够');
    var next = clone(state);
    next.coins -= f.seedPrice;
    next.plots[plotIndex] = {
      flower: f.id,
      stage: 0,
      water: PLANT_WATER,
      plantedAt: typeof now === 'number' ? now : Date.now(),
      growth: 0
    };
    next.stats.planted += 1;
    return { ok: true, state: next };
  }

  // 浇水：+60，上限 100
  function water(state, plotIndex) {
    if (!validIndex(state, plotIndex)) return fail('没有这块地');
    var plot = state.plots[plotIndex];
    if (!plot.flower) return fail('空地不用浇水');
    if (plot.stage === 3) return fail('花已经开了，不用浇水');
    if (plot.water >= WATER_MAX) return fail('水已经满了');
    var next = clone(state);
    next.plots[plotIndex].water = Math.min(WATER_MAX, plot.water + WATER_PER_USE);
    return { ok: true, state: next };
  }

  // 时间流逝：有水才长，长的同时耗水；水到 0 停长（不枯死）；开花后不再耗水
  function tick(state, dtSeconds) {
    var dt = Number(dtSeconds);
    if (!(dt > 0) || !isFinite(dt)) return state;
    var next = clone(state);
    for (var i = 0; i < next.plots.length; i++) {
      var plot = next.plots[i];
      if (!plot.flower || plot.stage === 3 || plot.water <= 0) continue;
      var f = getFlower(plot.flower);
      var grow = Math.min(dt, plot.water / WATER_DRAIN, f.growSeconds - plot.growth);
      plot.growth += grow;
      plot.water = Math.max(0, plot.water - grow * WATER_DRAIN);
      if (plot.growth > f.growSeconds - 1e-9) plot.growth = f.growSeconds;
      if (plot.water < 1e-9) plot.water = 0;
      plot.stage = stageFor(plot.growth, f.growSeconds);
    }
    return next;
  }

  // 收获：开花的地收 1 朵进背包并清空该地
  function harvest(state, plotIndex) {
    if (!validIndex(state, plotIndex)) return fail('没有这块地');
    var plot = state.plots[plotIndex];
    if (!plot.flower) return fail('这块地是空的');
    if (plot.stage !== 3) return fail('花还没开');
    var next = clone(state);
    var id = plot.flower;
    next.inventory[id] = (next.inventory[id] || 0) + 1;
    next.plots[plotIndex] = emptyPlot();
    next.stats.harvested += 1;
    return { ok: true, state: next, flowerId: id };
  }

  // 卖花：卖背包里的 n 朵（默认 1）
  function sell(state, flowerId, n) {
    var f = getFlower(flowerId);
    if (!f) return fail('没有这种花');
    var count = n === undefined ? 1 : n;
    if (typeof count !== 'number' || count % 1 !== 0 || count <= 0) return fail('数量不对');
    if (inventoryCount(state, flowerId) < count) return fail('背包里的' + f.name + '不够');
    var next = clone(state);
    var earned = f.sellPrice * count;
    next.inventory[flowerId] -= count;
    if (next.inventory[flowerId] === 0) delete next.inventory[flowerId];
    next.coins += earned;
    next.stats.sold += count;
    return { ok: true, state: next, earned: earned };
  }

  // 解锁花种：金币够就扣钱解锁
  function unlockFlower(state, flowerId) {
    var f = getFlower(flowerId);
    if (!f) return fail('没有这种花');
    if (isUnlocked(state, flowerId)) return fail(f.name + '已经解锁了');
    if (state.coins < f.unlockCost) return fail('金币不够，需要 ' + f.unlockCost + ' 金币');
    var next = clone(state);
    next.coins -= f.unlockCost;
    next.unlockedFlowers.push(flowerId);
    return { ok: true, state: next };
  }

  // 检查任务：返回 { state（已发奖励、已标记完成）, reward（本次新发的金币）, completed（新完成的任务）}
  function checkTasks(state) {
    var next = clone(state);
    var reward = 0;
    var completed = [];
    TASKS.forEach(function (t) {
      // 用发奖前的 state 判定，避免一次奖励连锁触发“攒金币”任务
      if (!next.tasksDone[t.id] && t.done(state)) {
        next.tasksDone[t.id] = true;
        reward += t.reward;
        completed.push({ id: t.id, name: t.name, reward: t.reward });
      }
    });
    next.coins += reward;
    return { state: next, reward: reward, completed: completed };
  }

  root.DreamGardenLogic = {
    GRID_COLS: GRID_COLS,
    GRID_ROWS: GRID_ROWS,
    PLOT_COUNT: PLOT_COUNT,
    START_COINS: START_COINS,
    PLANT_WATER: PLANT_WATER,
    WATER_PER_USE: WATER_PER_USE,
    WATER_MAX: WATER_MAX,
    STAGE_NAMES: STAGE_NAMES,
    FLOWERS: FLOWERS,
    TASKS: TASKS.map(function (t) { return { id: t.id, name: t.name, reward: t.reward }; }),
    DEFAULT_SAVE: DEFAULT_SAVE,
    createInitialState: createInitialState,
    fromSave: fromSave,
    getFlower: getFlower,
    isUnlocked: isUnlocked,
    canHarvest: canHarvest,
    plotStatus: plotStatus,
    plantedCount: plantedCount,
    inventoryCount: inventoryCount,
    taskList: taskList,
    plant: plant,
    water: water,
    tick: tick,
    harvest: harvest,
    sell: sell,
    unlockFlower: unlockFlower,
    checkTasks: checkTasks
  };
})(typeof window !== 'undefined' ? window
  : typeof GameGlobal !== 'undefined' ? GameGlobal
  : globalThis);

};
__modules["js/storage.js"]=function(module,exports,require){
// 梦幻花园 - 存档读写（只做存取，不含游戏逻辑）
(function (root) {
  'use strict';

  var KEY = 'dream-garden-save-v1';
  var memory = {}; // wx 不存在时的内存降级存储

  var hasWx = typeof wx !== 'undefined' && wx &&
    typeof wx.getStorageSync === 'function' &&
    typeof wx.setStorageSync === 'function';

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // 默认存档：优先取 logic.js 的 DEFAULT_SAVE，取不到用同结构兜底
  function defaultSave() {
    var logic = root.DreamGardenLogic;
    var base = logic && logic.DEFAULT_SAVE
      ? clone(logic.DEFAULT_SAVE)
      : { coins: 50, plots: [], unlockedFlowers: ['sunflower', 'rose'], tasksDone: {}, createdAt: 0 };
    if (!base.createdAt) base.createdAt = Date.now();
    return base;
  }

  function readRaw() {
    if (hasWx) {
      try {
        return wx.getStorageSync(KEY);
      } catch (e) {
        return null;
      }
    }
    return Object.prototype.hasOwnProperty.call(memory, KEY) ? memory[KEY] : null;
  }

  function writeRaw(text) {
    if (hasWx) {
      try {
        wx.setStorageSync(KEY, text);
        return true;
      } catch (e) {
        return false;
      }
    }
    memory[KEY] = text;
    return true;
  }

  // 读存档；读不到或损坏时返回默认存档
  function load() {
    var raw = readRaw();
    if (!raw) return defaultSave();
    var data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
    } catch (e) {
      return defaultSave();
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultSave();
    var def = defaultSave();
    if (typeof data.coins !== 'number' || !isFinite(data.coins)) data.coins = def.coins;
    if (!Array.isArray(data.plots)) data.plots = def.plots;
    if (!Array.isArray(data.unlockedFlowers)) data.unlockedFlowers = def.unlockedFlowers;
    if (!data.tasksDone || typeof data.tasksDone !== 'object') data.tasksDone = def.tasksDone;
    if (typeof data.createdAt !== 'number') data.createdAt = def.createdAt;
    return data;
  }

  // 写存档；返回是否成功
  function save(data) {
    if (!data || typeof data !== 'object') return false;
    var text;
    try {
      text = JSON.stringify(data);
    } catch (e) {
      return false;
    }
    return writeRaw(text);
  }

  // 重置为默认存档并返回它
  function reset() {
    var def = defaultSave();
    writeRaw(JSON.stringify(def));
    return clone(def);
  }

  root.DreamGardenStorage = { load: load, save: save, reset: reset };
})(typeof window !== 'undefined' ? window
  : typeof GameGlobal !== 'undefined' ? GameGlobal
  : globalThis);

};
__require("__entry__")("./game.js");
})();
