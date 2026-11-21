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
'use strict';
// 入口 + Hub（解压小游戏合集）+ 游戏屏幕包装器。
// 游戏模块本身在 js/gameXX.js（chunks 2-3 提供）；这里只负责装载与路由。

var engine = require('./js/engine.js');
var audio = require('./js/audio.js');
var storage = require('./js/storage.js');

// ---------- 屏幕与画布 ----------
function getSysInfo() {
  try {
    if (typeof wx.getSystemInfoSync === 'function') return wx.getSystemInfoSync() || {};
  } catch (e) { /* fallthrough */ }
  try {
    if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo() || {};
  } catch (e) { /* fallthrough */ }
  return {};
}

var info = getSysInfo();
var W = info.windowWidth || 375;
var H = info.windowHeight || 667;
var dpr = info.pixelRatio || 1;

var canvas = wx.createCanvas();
canvas.width = Math.round(W * dpr);
canvas.height = Math.round(H * dpr);
var ctx = canvas.getContext('2d');
try { ctx.scale(dpr, dpr); } catch (e) { /* 保险 */ }

var app = engine.createApp(canvas, ctx, W, H, dpr);

// ---------- 小工具 ----------
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

var PASTELS = [
  '#f9c0b2', '#fcd9b8', '#f6e7a9', '#c8e6c4', '#a7d8c8',
  '#a9c8e8', '#b6b3e8', '#d9b6e6', '#f2b6d4', '#e6c9a8'
];

function drawSpeaker(c, cx, cy, muted) {
  c.fillStyle = '#5a6b8c';
  c.beginPath();
  c.moveTo(cx - 7, cy - 3);
  c.lineTo(cx - 3, cy - 3);
  c.lineTo(cx + 1, cy - 7);
  c.lineTo(cx + 1, cy + 7);
  c.lineTo(cx - 3, cy + 3);
  c.lineTo(cx - 7, cy + 3);
  c.closePath();
  c.fill();
  if (muted) {
    c.strokeStyle = '#d97b7b';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx + 4, cy - 4);
    c.lineTo(cx + 10, cy + 4);
    c.moveTo(cx + 10, cy - 4);
    c.lineTo(cx + 4, cy + 4);
    c.stroke();
  } else {
    c.strokeStyle = '#5a6b8c';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx + 2, cy, 5, -0.9, 0.9);
    c.stroke();
    c.beginPath();
    c.arc(cx + 2, cy, 9, -0.8, 0.8);
    c.stroke();
  }
}

// ---------- Hub（合集主页） ----------
function createHub() {
  var triedMap = storage.get('tried', {});
  if (typeof triedMap !== 'object' || triedMap === null || Array.isArray(triedMap)) triedMap = {};

  var scrollY = 0;
  var dragging = false;
  var scrolled = false;
  var startY = 0;
  var lastY = 0;
  var iconMods = {}; // num -> 模块（含 drawIcon）或 null，缓存避免每帧 require

  var state = { toastText: '', toastTimer: 0, wiggleNum: 0, wiggleT: 0 };

  var layout = {
    gridTop: 104, cardW: 0, cardH: 0, gap: 8, left: 10,
    scrollY: 0, contentH: 0,
    mute: { x: W - 28, y: 30, r: 17 }
  };
  layout.cardW = (W - 20 - 24) / 4;
  layout.cardH = layout.cardW * 1.18;
  var rows = Math.ceil(engine.GAMES.length / 4);
  layout.contentH = rows * layout.cardH + (rows - 1) * layout.gap;

  function clampScroll() {
    var maxS = Math.max(0, layout.contentH - (H - layout.gridTop));
    if (scrollY < 0) scrollY = 0;
    if (scrollY > maxS) scrollY = maxS;
  }

  function triedCount() {
    var n = 0;
    for (var k in triedMap) {
      if (Object.prototype.hasOwnProperty.call(triedMap, k)) {
        var v = parseInt(k, 10);
        if (v >= 1 && v <= 10 && triedMap[k]) n++;
      }
    }
    return n;
  }

  function iconModule(entry) {
    if (Object.prototype.hasOwnProperty.call(iconMods, entry.num)) return iconMods[entry.num];
    var mod = engine.loadGameModule(entry);
    if (!(mod && typeof mod.drawIcon === 'function')) mod = null;
    iconMods[entry.num] = mod;
    return mod;
  }

  function drawGenericIcon(c, x, y, size, entry) {
    var cx = x + size / 2;
    var cy = y + size / 2;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#5a6b8c';
    c.font = 'bold ' + Math.round(size * 0.48) + 'px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(entry.name.charAt(0), cx, cy + 1);
  }

  function drawLock(c, cx, cy, s) {
    c.strokeStyle = '#a8afb9';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy - s * 0.1, s * 0.24, Math.PI, 0);
    c.stroke();
    c.fillStyle = '#b8bfc8';
    rr(c, cx - s * 0.32, cy - s * 0.1, s * 0.64, s * 0.5, 3);
    c.fill();
  }

  function drawCard(c, entry, x, y) {
    var w = layout.cardW;
    var h = layout.cardH;
    var nameFont = (entry.name.length > 5 ? '9px' : '11px') + ' sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (entry.playable) {
      c.fillStyle = PASTELS[(entry.num - 1) % PASTELS.length];
      rr(c, x, y, w, h, 10);
      c.fill();
      var isz = w - 20;
      var ix = x + 10;
      var iy = y + 8;
      var mod = iconModule(entry);
      var drawn = false;
      if (mod) {
        try {
          mod.drawIcon(c, ix, iy, isz);
          drawn = true;
        } catch (e) { drawn = false; }
      }
      if (!drawn) drawGenericIcon(c, ix, iy, isz, entry);
      c.fillStyle = '#4a5568';
      c.font = nameFont;
      c.fillText(entry.name, x + w / 2, y + h - 14);
    } else {
      c.fillStyle = '#e7e9ee';
      rr(c, x, y, w, h, 10);
      c.fill();
      drawLock(c, x + w / 2, y + h * 0.36, w * 0.42);
      c.fillStyle = '#9aa2ad';
      c.font = nameFont;
      c.fillText(entry.name, x + w / 2, y + h - 22);
      c.font = '8px sans-serif';
      c.fillText('即将上线', x + w / 2, y + h - 10);
    }
  }

  function draw(c) {
    // 背景：柔和粉彩渐变 + 两个淡淡的装饰圆
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#dde8f5');
    g.addColorStop(1, '#f7e9ee');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath();
    c.arc(W - 30, H - 60, 70, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(20, H * 0.55, 50, 0, Math.PI * 2);
    c.fill();

    // 标题
    c.fillStyle = '#5a6b8c';
    c.font = 'bold 30px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText('Relax', W / 2, 46);
    c.fillStyle = '#8a97ad';
    c.font = '13px sans-serif';
    c.fillText('解压小游戏合集', W / 2, 68);
    c.font = '12px sans-serif';
    c.fillText('已试玩 ' + triedCount() + '/10', W / 2, 90);

    // 静音按钮
    var m = layout.mute;
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath();
    c.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    c.fill();
    drawSpeaker(c, m.x, m.y, audio.isMuted());

    // 卡片网格（可滚动）
    clampScroll();
    layout.scrollY = scrollY;
    for (var i = 0; i < engine.GAMES.length; i++) {
      var entry = engine.GAMES[i];
      var row = (i / 4) | 0;
      var col = i % 4;
      var x = layout.left + col * (layout.cardW + layout.gap);
      var y = layout.gridTop + row * (layout.cardH + layout.gap) - scrollY;
      if (y + layout.cardH < layout.gridTop - 20 || y > H + 20) continue;
      var dx = 0;
      if (state.wiggleNum === entry.num && state.wiggleT < 0.4) {
        dx = Math.sin(state.wiggleT * 45) * 4 * (1 - state.wiggleT / 0.4);
      }
      drawCard(c, entry, x + dx, y);
    }

    // toast
    if (state.toastTimer > 0) {
      var a = Math.min(1, state.toastTimer / 0.3);
      c.globalAlpha = a;
      c.fillStyle = 'rgba(60,70,90,0.85)';
      rr(c, W / 2 - 62, H * 0.42, 124, 36, 18);
      c.fill();
      c.fillStyle = '#ffffff';
      c.font = '14px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(state.toastText, W / 2, H * 0.42 + 18);
      c.globalAlpha = 1;
    }
  }

  function hitCard(x, y) {
    var px = x - layout.left;
    var py = y - layout.gridTop + scrollY;
    var col = Math.floor(px / (layout.cardW + layout.gap));
    var row = Math.floor(py / (layout.cardH + layout.gap));
    if (col < 0 || col > 3 || row < 0 || row >= rows) return -1;
    var lx = px - col * (layout.cardW + layout.gap);
    var ly = py - row * (layout.cardH + layout.gap);
    if (lx < 0 || lx > layout.cardW || ly < 0 || ly > layout.cardH) return -1;
    var idx = row * 4 + col;
    if (idx >= engine.GAMES.length) return -1;
    return idx;
  }

  function toast(text) {
    state.toastText = text;
    state.toastTimer = 1.2;
  }

  // 点击可玩卡片：模块存在且有 create() 就进入游戏；否则 toast 兜底（chunks 2-3 补模块）。
  function openEntry(entry) {
    var mod = engine.loadGameModule(entry);
    var screenObj = null;
    if (mod && typeof mod.create === 'function') {
      screenObj = createGameScreen(entry, mod);
    }
    if (screenObj) {
      triedMap[entry.num] = true;
      storage.set('tried', triedMap);
      audio.play('chime');
      app.setScreen(screenObj);
    } else {
      toast('即将上线');
    }
  }

  var screen = {
    layout: layout,
    state: state,
    update: function (dt) {
      if (state.toastTimer > 0) state.toastTimer -= dt;
      if (state.wiggleNum) {
        state.wiggleT += dt;
        if (state.wiggleT > 0.4) {
          state.wiggleNum = 0;
          state.wiggleT = 0;
        }
      }
      layout.scrollY = scrollY;
    },
    draw: draw,
    onTouchStart: function (x, y) {
      dragging = true;
      scrolled = false;
      startY = y;
      lastY = y;
    },
    onTouchMove: function (x, y) {
      if (!dragging) return;
      var dy = y - lastY;
      lastY = y;
      if (!scrolled && Math.abs(y - startY) > 10) scrolled = true;
      if (scrolled) {
        scrollY -= dy;
        clampScroll();
      }
    },
    onTouchEnd: function (x, y) {
      dragging = false;
      if (scrolled) return;
      var m = layout.mute;
      var ddx = x - m.x;
      var ddy = y - m.y;
      if (ddx * ddx + ddy * ddy <= (m.r + 8) * (m.r + 8)) {
        audio.toggleMute();
        return;
      }
      var idx = hitCard(x, y);
      if (idx < 0) return;
      var entry = engine.GAMES[idx];
      if (!entry.playable) {
        state.wiggleNum = entry.num; // 占位卡：小幅抖动，不导航
        state.wiggleT = 0;
        return;
      }
      openEntry(entry);
    }
  };

  return screen;
}

// ---------- 游戏屏幕包装器 ----------
// 负责顶部“返回合集”与静音按钮；其余触摸全部转给游戏对象。
function createGameScreen(entry, mod) {
  var game;
  try {
    game = mod.create();
  } catch (e) {
    return null;
  }
  if (!game) return null;

  var back = { x: 10, y: 12, w: 86, h: 32 };
  var mute = { x: W - 28, y: 28, r: 17 };
  var pressed = null;

  function inBack(x, y) {
    return x >= back.x && x <= back.x + back.w && y >= back.y && y <= back.y + back.h;
  }
  function inMute(x, y) {
    var dx = x - mute.x;
    var dy = y - mute.y;
    return dx * dx + dy * dy <= (mute.r + 8) * (mute.r + 8);
  }

  return {
    entry: entry,
    update: function (dt) {
      if (typeof game.update === 'function') game.update(dt);
    },
    draw: function (c) {
      if (typeof game.draw === 'function') game.draw(c);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      rr(c, back.x, back.y, back.w, back.h, 16);
      c.fill();
      c.fillStyle = '#5a6b8c';
      c.font = '13px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('返回合集', back.x + back.w / 2, back.y + back.h / 2);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.beginPath();
      c.arc(mute.x, mute.y, mute.r, 0, Math.PI * 2);
      c.fill();
      drawSpeaker(c, mute.x, mute.y, audio.isMuted());
    },
    onTouchStart: function (x, y) {
      if (inBack(x, y)) { pressed = 'back'; return; }
      if (inMute(x, y)) { pressed = 'mute'; return; }
      if (typeof game.onTouchStart === 'function') game.onTouchStart(x, y);
    },
    onTouchMove: function (x, y) {
      if (pressed) return;
      if (typeof game.onTouchMove === 'function') game.onTouchMove(x, y);
    },
    onTouchEnd: function (x, y) {
      if (pressed) {
        var b = pressed;
        pressed = null;
        if (b === 'back' && inBack(x, y)) {
          app.setScreen(hubScreen);
          return;
        }
        if (b === 'mute' && inMute(x, y)) {
          audio.toggleMute();
        }
        return;
      }
      if (typeof game.onTouchEnd === 'function') game.onTouchEnd(x, y);
    },
    onEnter: function () {
      if (typeof game.onEnter === 'function') game.onEnter();
    },
    onExit: function () {
      if (typeof game.onExit === 'function') game.onExit();
    }
  };
}

// ---------- 启动 ----------
var hubScreen = createHub();
app.setScreen(hubScreen);

function wireTouch() {
  wx.onTouchStart(function (e) {
    var t = e && e.touches && e.touches[0];
    if (t) app.touchStart(t.clientX * dpr, t.clientY * dpr);
  });
  wx.onTouchMove(function (e) {
    var t = e && e.touches && e.touches[0];
    if (t) app.touchMove(t.clientX * dpr, t.clientY * dpr);
  });
  wx.onTouchEnd(function (e) {
    var t = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0]);
    if (t) app.touchEnd(t.clientX * dpr, t.clientY * dpr);
  });
}

var started = false;
function start() {
  if (started) return;
  started = true;
  var last = 0;
  function loop(ts) {
    var dt = last > 0 ? (ts - last) / 1000 : 1 / 60;
    last = ts;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05;
    app.frame(dt);
    canvas.requestAnimationFrame(loop);
  }
  canvas.requestAnimationFrame(loop);
}

// 真机/开发者工具里 game.js 是入口脚本，自动启动；node 自测里 stub 的
// requestAnimationFrame 只记录回调不执行帧，由 selftest 驱动帧。
if (typeof wx !== 'undefined' && wx && typeof wx.onTouchStart === 'function') {
  wireTouch();
  start();
}

module.exports = {
  app: app,
  engine: engine,
  audio: audio,
  start: start,
  createHub: createHub,
  createGameScreen: createGameScreen,
  W: W,
  H: H,
  dpr: dpr
};

};
__modules["js/audio.js"]=function(module,exports,require){
'use strict';
// 合成音效：首次播放时才尝试 wx.createWebAudioContext()；
// 不可用时全部静默 no-op，绝不崩溃。静音状态经 storage.js 持久化（key 'muted'）。

var storage = require('./storage.js');

var ac = null;
var probed = false;
var muted = !!storage.get('muted', false);

function ensure() {
  if (probed) return ac;
  probed = true;
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.createWebAudioContext === 'function') {
      ac = wx.createWebAudioContext() || null;
    }
  } catch (e) {
    ac = null;
  }
  return ac;
}

// 单个音符：type 波形，f0→f1 频率滑动，dur 秒，vol 音量，delay 起始延迟。
function tone(type, f0, f1, dur, vol, delay) {
  var c = ensure();
  if (!c || muted) return;
  try {
    var t0 = (c.currentTime || 0) + (delay || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch (e) { /* 静默 */ }
}

function play(name) {
  if (muted) return;
  switch (name) {
    case 'pop': // 泡泡破裂
      tone('sine', 520, 140, 0.09, 0.25);
      break;
    case 'crunch': // 咔嚓碎裂
      tone('square', 140, 70, 0.08, 0.18);
      tone('square', 110, 60, 0.09, 0.15, 0.06);
      break;
    case 'splash': // 水花
      tone('sine', 760, 180, 0.28, 0.2);
      tone('triangle', 320, 90, 0.34, 0.12);
      break;
    case 'chime': // 清脆提示音（进入游戏）
      tone('sine', 784, 784, 0.28, 0.16);
      tone('sine', 1175, 1175, 0.36, 0.13, 0.09);
      break;
    case 'whoosh': // 嗖的一声
      tone('sawtooth', 160, 820, 0.2, 0.1);
      tone('sine', 760, 130, 0.16, 0.1, 0.16);
      break;
    default:
      break;
  }
}

function toggleMute() {
  muted = !muted;
  storage.set('muted', muted);
  return muted;
}

function isMuted() {
  return muted;
}

module.exports = {
  play: play,
  toggleMute: toggleMute,
  isMuted: isMuted
};

};
__modules["js/engine.js"]=function(module,exports,require){
'use strict';
// 共享引擎：游戏注册表 + 模块加载 + 帧循环 / 屏幕 / 触摸路由。
// 坐标约定：触摸进入引擎时是画布物理像素，路由给屏幕前除以 dpr 转成 CSS 像素；
// 所有屏幕（Hub 与游戏）的 update/draw/触摸回调都工作在 CSS 像素坐标系。

// 40 个游戏槽位：1-10 可玩（chunks 2-3 提供 js/gameXX.js），11-40 占位。
var GAMES = [
  { num: 1, id: 'g01', name: '捏泡泡纸', playable: true, file: 'game01.js' },
  { num: 2, id: 'g02', name: '切肥皂', playable: true, file: 'game02.js' },
  { num: 3, id: 'g03', name: '动感沙', playable: true, file: 'game03.js' },
  { num: 4, id: 'g04', name: '减压球', playable: true, file: 'game04.js' },
  { num: 5, id: 'g05', name: '倒珠子', playable: true, file: 'game05.js' },
  { num: 6, id: 'g06', name: '揭膜', playable: true, file: 'game06.js' },
  { num: 7, id: 'g07', name: '雨滴涟漪', playable: true, file: 'game07.js' },
  { num: 8, id: 'g08', name: '涂色', playable: true, file: 'game08.js' },
  { num: 9, id: 'g09', name: '推金币', playable: true, file: 'game09.js' },
  { num: 10, id: 'g10', name: '弹力球', playable: true, file: 'game10.js' },
  { num: 11, id: 'g11', name: '敲木鱼', playable: false },
  { num: 12, id: 'g12', name: '吹泡泡', playable: false },
  { num: 13, id: 'g13', name: '捏泥巴', playable: false },
  { num: 14, id: 'g14', name: '指尖陀螺', playable: false },
  { num: 15, id: 'g15', name: '解压魔方', playable: false },
  { num: 16, id: 'g16', name: '削铅笔', playable: false },
  { num: 17, id: 'g17', name: '挤牙膏', playable: false },
  { num: 18, id: 'g18', name: '叠杯子', playable: false },
  { num: 19, id: 'g19', name: '磁力沙', playable: false },
  { num: 20, id: 'g20', name: '割草', playable: false },
  { num: 21, id: 'g21', name: '洗车', playable: false },
  { num: 22, id: 'g22', name: '擦玻璃', playable: false },
  { num: 23, id: 'g23', name: '捏方便面', playable: false },
  { num: 24, id: 'g24', name: '串珠子', playable: false },
  { num: 25, id: 'g25', name: '折纸飞机', playable: false },
  { num: 26, id: 'g26', name: '弹弓', playable: false },
  { num: 27, id: 'g27', name: '保龄球', playable: false },
  { num: 28, id: 'g28', name: '套圈', playable: false },
  { num: 29, id: 'g29', name: '打地鼠', playable: false },
  { num: 30, id: 'g30', name: '钓鱼', playable: false },
  { num: 31, id: 'g31', name: '养小鱼', playable: false },
  { num: 32, id: 'g32', name: '种花', playable: false },
  { num: 33, id: 'g33', name: '拼积木', playable: false },
  { num: 34, id: 'g34', name: '滚雪球', playable: false },
  { num: 35, id: 'g35', name: '放烟花', playable: false },
  { num: 36, id: 'g36', name: '拼图', playable: false },
  { num: 37, id: 'g37', name: '敲钉子', playable: false },
  { num: 38, id: 'g38', name: '叠纸', playable: false },
  { num: 39, id: 'g39', name: '涂鸦墙', playable: false },
  { num: 40, id: 'g40', name: '捏气泡膜·进阶版', playable: false }
];

// 尝试加载游戏模块；文件不存在（后续 chunk 才会加）时返回 null，绝不抛异常。
function loadGameModule(entry) {
  if (!entry || !entry.file) return null;
  try {
    return require('./' + entry.file);
  } catch (e) {
    return null;
  }
}

// 创建应用：帧循环 + 屏幕管理 + 触摸路由。
// screen 对象约定：update(dt), draw(ctx), onTouchStart/Move/End(x, y)，可选 onEnter/onExit。
function createApp(canvas, ctx, W, H, dpr) {
  var current = null;
  if (!dpr || dpr <= 0) dpr = 1;

  function route(name) {
    return function (x, y) {
      if (!current || typeof current[name] !== 'function') return;
      current[name](x / dpr, y / dpr);
    };
  }

  var app = {
    canvas: canvas,
    ctx: ctx,
    W: W,
    H: H,
    dpr: dpr,
    currentScreen: null,
    setScreen: function (screen) {
      var prev = current;
      current = screen || null;
      this.currentScreen = current;
      if (prev && typeof prev.onExit === 'function') prev.onExit();
      if (current && typeof current.onEnter === 'function') current.onEnter();
    },
    frame: function (dt) {
      if (!(dt > 0)) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;
      if (!current) return;
      if (typeof current.update === 'function') current.update(dt);
      if (typeof current.draw === 'function') current.draw(ctx);
    },
    touchStart: route('onTouchStart'),
    touchMove: route('onTouchMove'),
    touchEnd: route('onTouchEnd')
  };

  return app;
}

module.exports = {
  GAMES: GAMES,
  loadGameModule: loadGameModule,
  createApp: createApp
};

};
__modules["js/game01.js"]=function(module,exports,require){
'use strict';
// 游戏 1：捏泡泡纸。点按泡泡捏爆（pop 音效 + 爆裂粒子），换一张重置，累计计数。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function circle(c, cx, cy, r) {
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
}

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var t = 0;

  var pitch = 34;
  var top = 64;
  var btn = { x: W / 2 - 70, y: H - 58, w: 140, h: 40, label: '换一张' };
  var fieldBottom = btn.y - 14;

  var cols = Math.max(4, Math.floor((W - 24) / pitch));
  var gridW = cols * pitch;
  var ox = (W - gridW) / 2;
  var availH = fieldBottom - top;
  var rows = Math.max(5, Math.floor(availH / pitch));
  var oy = top + (availH - rows * pitch) / 2;

  var popped = new Array(cols * rows);
  for (var i = 0; i < popped.length; i++) popped[i] = false;
  var total = 0;

  function bubbleCenter(idx) {
    var col = idx % cols;
    var row = (idx / cols) | 0;
    return { x: ox + col * pitch + pitch / 2, y: oy + row * pitch + pitch / 2 };
  }

  function hitBubble(x, y) {
    var col = Math.floor((x - ox) / pitch);
    var row = Math.floor((y - oy) / pitch);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
    var idx = row * cols + col;
    var p = bubbleCenter(idx);
    var dx = x - p.x;
    var dy = y - p.y;
    var rHit = pitch / 2 + 6;
    if (dx * dx + dy * dy > rHit * rHit) return -1;
    return idx;
  }

  function inBtn(x, y) {
    return x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h;
  }

  function pop(idx) {
    if (popped[idx]) return;
    popped[idx] = true;
    total++;
    var p = bubbleCenter(idx);
    audio.play('pop');
    fx.spawn(p.x, p.y, {
      color: ['#a9c8e8', '#cfe3f7', '#ffffff'],
      count: 10, speed: 170, life: 0.4, gravity: 260, size: 3, shape: 'circle'
    });
  }

  var game = {
    grid: { ox: ox, oy: oy, pitch: pitch, cols: cols, rows: rows },
    popped: popped,
    btn: btn,
    poppedTotal: 0,
    update: function (dt) {
      t += dt;
      fx.update(dt);
      this.poppedTotal = total;
    },
    draw: function (c) {
      c.fillStyle = '#eaf1f8';
      c.fillRect(0, 0, W, H);
      for (var i = 0; i < popped.length; i++) {
        var p = bubbleCenter(i);
        var r = pitch / 2 - 2.5;
        if (popped[i]) {
          c.fillStyle = '#d7e1ec';
          circle(c, p.x, p.y, r * 0.55);
          c.strokeStyle = 'rgba(150,165,185,0.5)';
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
          c.stroke();
        } else {
          c.fillStyle = '#c4dcf4';
          circle(c, p.x, p.y, r);
          c.fillStyle = 'rgba(255,255,255,0.75)';
          circle(c, p.x - r * 0.3, p.y - r * 0.35, r * 0.32);
        }
      }
      fx.draw(c);

      // 换一张按钮
      c.fillStyle = 'rgba(255,255,255,0.9)';
      rr(c, btn.x, btn.y, btn.w, btn.h, 20);
      c.fill();
      c.fillStyle = '#5a6b8c';
      c.font = '15px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);

      // 计数（按钮右侧）
      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'right';
      c.fillText('已捏 ' + total + ' 个', W - 12, btn.y + btn.h / 2);
    },
    onTouchStart: function (x, y) {
      if (inBtn(x, y)) {
        for (var i = 0; i < popped.length; i++) popped[i] = false;
        audio.play('whoosh');
        fx.spawn(btn.x + btn.w / 2, btn.y + btn.h / 2, {
          color: ['#ffffff', '#a9c8e8'],
          count: 8, speed: 110, life: 0.4, gravity: -60, size: 3, shape: 'circle'
        });
        return;
      }
      var idx = hitBubble(x, y);
      if (idx >= 0) pop(idx);
    },
    onTouchMove: function () { /* 单击交互 */ },
    onTouchEnd: function () { /* 单击交互 */ }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  var r = size * 0.21;
  c.fillStyle = '#a9c8e8';
  circle(c, x + size * 0.3, y + size * 0.34, r);
  c.fillStyle = '#bcd4ee';
  circle(c, x + size * 0.68, y + size * 0.4, r);
  c.fillStyle = '#cfe3f7';
  circle(c, x + size * 0.48, y + size * 0.74, r * 0.95);
  c.fillStyle = 'rgba(255,255,255,0.8)';
  circle(c, x + size * 0.24, y + size * 0.27, r * 0.32);
  // 一颗已捏瘪的
  c.fillStyle = '#d7e1ec';
  circle(c, x + size * 0.72, y + size * 0.76, r * 0.5);
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game02.js"]=function(module,exports,require){
'use strict';
// 游戏 2：切肥皂。肥皂滑入，手指划过即沿划线切开，切下的块受重力坠落
// （crunch 音效 + 碎屑粒子）；剩余部分可继续切，切到太小就换新肥皂。计分=刀数。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

var SOAP_COLORS = ['#f6b8c8', '#bfe3d8', '#f9d9a8', '#cdd6f6'];

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;

  var barW = Math.min(W * 0.62, 240);
  var barH = 96;
  var cy = H * 0.42;

  var bar = null;          // { poly(local), x, cy, w, h, color, slide, ready, origArea }
  var pieces = [];         // { poly(local), x, y, vx, vy, rot, vr, color }
  var slices = 0;
  var colorIdx = 0;
  var respawn = 0;
  var cooldown = 0;
  var drag = null;         // { x0,y0 (bar-local), cx,cy (local), sx,sy }

  function rectPoly(w, h) {
    return [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 }
    ];
  }

  // Sutherland–Hodgman 单平面裁剪：保留 n·p <= d 一侧
  function clipPoly(poly, nx, ny, d) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i];
      var b = poly[(i + 1) % poly.length];
      var da = a.x * nx + a.y * ny - d;
      var db = b.x * nx + b.y * ny - d;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        var k = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      }
    }
    return out;
  }

  function polyArea(poly) {
    if (!poly || poly.length < 3) return 0;
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i];
      var b = poly[(i + 1) % poly.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }

  function centroid(poly) {
    var x = 0, y = 0;
    for (var i = 0; i < poly.length; i++) {
      x += poly[i].x;
      y += poly[i].y;
    }
    return { x: x / poly.length, y: y / poly.length };
  }

  function polyBounds(poly) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < poly.length; i++) {
      if (poly[i].x < x0) x0 = poly[i].x;
      if (poly[i].x > x1) x1 = poly[i].x;
      if (poly[i].y < y0) y0 = poly[i].y;
      if (poly[i].y > y1) y1 = poly[i].y;
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  function spawnBar() {
    bar = {
      poly: rectPoly(barW, barH),
      x: W + barW / 2,
      cy: cy,
      w: barW,
      h: barH,
      color: SOAP_COLORS[colorIdx++ % SOAP_COLORS.length],
      slide: 0,
      ready: false,
      origArea: barW * barH
    };
  }

  function easeOut(k) {
    k = Math.max(0, Math.min(1, k));
    return 1 - (1 - k) * (1 - k) * (1 - k);
  }

  function cut(lx0, ly0, lx1, ly1) {
    var a = Math.atan2(ly1 - ly0, lx1 - lx0);
    var nx = -Math.sin(a);
    var ny = Math.cos(a);
    var d = nx * lx0 + ny * ly0;
    var sideA = clipPoly(bar.poly, nx, ny, d);      // n·p <= d
    var sideB = clipPoly(bar.poly, -nx, -ny, -d);   // 另一侧
    var areaA = polyArea(sideA);
    var areaB = polyArea(sideB);
    if (areaA < 8 && areaB < 8) return false;
    var keep, fall;
    if (areaA >= areaB) { keep = sideA; fall = sideB; }
    else { keep = sideB; fall = sideA; }
    if (polyArea(fall) >= 8) {
      var fc = centroid(fall);
      var local = [];
      for (var i = 0; i < fall.length; i++) {
        local.push({ x: fall[i].x - fc.x, y: fall[i].y - fc.y });
      }
      var away = (areaA >= areaB) ? 1 : -1;
      pieces.push({
        poly: local,
        x: bar.x + fc.x,
        y: bar.cy + fc.y,
        vx: nx * away * 60 + (Math.random() - 0.5) * 40,
        vy: -90,
        rot: 0,
        vr: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2),
        color: bar.color
      });
    }
    bar.poly = keep;
    var b = polyBounds(keep);
    bar.w = b.w;
    bar.h = b.h;
    slices++;
    cooldown = 0.35;
    audio.play('crunch');
    var mx = bar.x + (lx0 + lx1) / 2;
    var my = bar.cy + (ly0 + ly1) / 2;
    fx.spawn(mx, my, {
      color: ['#ffffff', bar.color, '#f3e6d0'],
      count: 12, speed: 150, life: 0.55, gravity: 520, size: 3.5, shape: 'crumb'
    });
    if (polyArea(keep) < bar.origArea * 0.24) {
      var kc = centroid(keep);
      var klocal = [];
      for (var j = 0; j < keep.length; j++) {
        klocal.push({ x: keep[j].x - kc.x, y: keep[j].y - kc.y });
      }
      pieces.push({
        poly: klocal,
        x: bar.x + kc.x,
        y: bar.cy + kc.y,
        vx: (Math.random() - 0.5) * 60,
        vy: -60,
        rot: 0,
        vr: (Math.random() - 0.5) * 3,
        color: bar.color
      });
      bar = null;
      respawn = 0.7;
    }
    return true;
  }

  var game = {
    bar: null,   // 测试镜像：指向当前 bar
    slices: 0,
    update: function (dt) {
      this.bar = bar;
      this.slices = slices;
      cooldown -= dt;
      if (!bar) {
        respawn -= dt;
        if (respawn <= 0) spawnBar();
      } else if (!bar.ready) {
        bar.slide += dt * 2.4;
        if (bar.slide >= 1) {
          bar.slide = 1;
          bar.ready = true;
          bar.x = W / 2;
        } else {
          bar.x = (W + bar.w / 2) + (W / 2 - (W + bar.w / 2)) * easeOut(bar.slide);
        }
      }
      for (var i = pieces.length - 1; i >= 0; i--) {
        var p = pieces[i];
        p.vy += 1300 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 180) pieces.splice(i, 1);
      }
      fx.update(dt);
    },
    draw: function (c) {
      c.fillStyle = '#e8f3ee';
      c.fillRect(0, 0, W, H);

      // 落下的切块
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.beginPath();
        c.moveTo(p.poly[0].x, p.poly[0].y);
        for (var k = 1; k < p.poly.length; k++) c.lineTo(p.poly[k].x, p.poly[k].y);
        c.closePath();
        c.fill();
        c.restore();
      }

      // 当前肥皂
      if (bar) {
        c.fillStyle = 'rgba(90,110,100,0.15)';
        c.beginPath();
        c.ellipse(bar.x, bar.cy + bar.h * 0.62, bar.w * 0.42, 10, 0, 0, Math.PI * 2);
        c.fill();
        c.save();
        c.translate(bar.x, bar.cy);
        c.fillStyle = bar.color;
        c.beginPath();
        c.moveTo(bar.poly[0].x, bar.poly[0].y);
        for (var m = 1; m < bar.poly.length; m++) c.lineTo(bar.poly[m].x, bar.poly[m].y);
        c.closePath();
        c.fill();
        // 内嵌装饰圆
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.beginPath();
        c.arc(0, 0, 12, 0, Math.PI * 2);
        c.fill();
        // 拖动预览线
        if (drag) {
          c.strokeStyle = 'rgba(255,255,255,0.85)';
          c.lineWidth = 2.5;
          c.beginPath();
          c.moveTo(drag.x0, drag.y0);
          c.lineTo(drag.cx, drag.cy);
          c.stroke();
        }
        c.restore();
      }

      fx.draw(c);

      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('已切 ' + slices + ' 刀', 12, top + 10);
    },
    onTouchStart: function (x, y) {
      if (bar && bar.ready &&
        Math.abs(x - bar.x) < bar.w / 2 + 18 &&
        Math.abs(y - bar.cy) < bar.h / 2 + 18) {
        drag = { x0: x - bar.x, y0: y - bar.cy, cx: x - bar.x, cy: y - bar.cy, sx: x, sy: y };
      }
    },
    onTouchMove: function (x, y) {
      if (!drag || !bar || !bar.ready) return;
      var lx = x - bar.x;
      var ly = y - bar.cy;
      drag.cx = lx;
      drag.cy = ly;
      if (cooldown > 0) return;
      var dx = x - drag.sx;
      var dy = y - drag.sy;
      if (Math.sqrt(dx * dx + dy * dy) > bar.w * 0.4 &&
        Math.abs(lx) < bar.w * 0.75 && Math.abs(ly) < bar.h * 0.75) {
        var x0 = drag.x0, y0 = drag.y0;
        drag = null;
        cut(x0, y0, lx, ly);
      }
    },
    onTouchEnd: function () {
      drag = null;
    }
  };

  spawnBar();
  return game;
}

function drawIcon(c, x, y, size) {
  c.fillStyle = '#f6b8c8';
  var rx = x + size * 0.12;
  var ry = y + size * 0.3;
  var rw = size * 0.76;
  var rh = size * 0.42;
  var r = size * 0.12;
  c.beginPath();
  c.moveTo(rx + r, ry);
  c.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
  c.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
  c.arcTo(rx, ry + rh, rx, ry, r);
  c.arcTo(rx, ry, rx + rw, ry, r);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x + size * 0.2, y + size * 0.38);
  c.lineTo(x + size * 0.8, y + size * 0.64);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath();
  c.arc(x + size * 0.86, y + size * 0.24, size * 0.05, 0, Math.PI * 2);
  c.fill();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game03.js"]=function(module,exports,require){
'use strict';
// 游戏 3：动感沙。拖动在沙地上刻出沟痕并扬起沙粒；抚平按钮清空，印星星按钮盖星印。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

var SAND_DARK = 'rgba(170,128,70,0.42)';
var SAND_MOTES = ['#e0c184', '#c9a05a', '#f2ddb0'];

function starPath(c, cx, cy, s, rot) {
  c.beginPath();
  for (var i = 0; i < 10; i++) {
    var r = (i % 2 === 0) ? s : s * 0.45;
    var a = (Math.PI / 5) * i - Math.PI / 2 + (rot || 0);
    var px = cx + Math.cos(a) * r;
    var py = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;
  var buttons = {
    smooth: { x: W / 2 - 158, y: H - 60, w: 150, h: 44, label: '抚平' },
    stamp: { x: W / 2 + 8, y: H - 60, w: 150, h: 44, label: '印星星' }
  };
  var fieldBottom = buttons.smooth.y - 12;

  var strokes = [];   // { pts: [{x,y}] }
  var stamps = [];    // { x, y, size, rot }
  var current = null;
  var lastPt = null;
  var count = 0;

  function inField(x, y) {
    return y >= top && y <= fieldBottom;
  }

  function inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  var game = {
    strokes: strokes,
    stamps: stamps,
    buttons: buttons,
    update: function (dt) {
      fx.update(dt);
    },
    draw: function (c) {
      // 沙地底色
      c.fillStyle = '#f2e3bd';
      c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(0, 0, W, top);
      c.fillRect(0, fieldBottom, W, H - fieldBottom);

      // 沟痕
      c.strokeStyle = SAND_DARK;
      c.lineWidth = 13;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (var i = 0; i < strokes.length; i++) {
        var pts = strokes[i].pts;
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        if (pts.length === 1) c.lineTo(pts[0].x + 0.5, pts[0].y + 0.5);
        for (var k = 1; k < pts.length; k++) c.lineTo(pts[k].x, pts[k].y);
        c.stroke();
      }

      // 星印（先白后深，做浮雕感）
      for (var s = 0; s < stamps.length; s++) {
        var st = stamps[s];
        c.fillStyle = 'rgba(255,255,255,0.55)';
        starPath(c, st.x + 2, st.y + 3, st.size, st.rot);
        c.fill();
        c.fillStyle = 'rgba(150,108,52,0.55)';
        starPath(c, st.x, st.y, st.size, st.rot);
        c.fill();
      }

      fx.draw(c);

      // 按钮
      var keys = ['smooth', 'stamp'];
      for (var b = 0; b < keys.length; b++) {
        var btn = buttons[keys[b]];
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.beginPath();
        var r2 = btn.h / 2;
        c.moveTo(btn.x + r2, btn.y);
        c.arcTo(btn.x + btn.w, btn.y, btn.x + btn.w, btn.y + btn.h, r2);
        c.arcTo(btn.x + btn.w, btn.y + btn.h, btn.x, btn.y + btn.h, r2);
        c.arcTo(btn.x, btn.y + btn.h, btn.x, btn.y, r2);
        c.arcTo(btn.x, btn.y, btn.x + btn.w, btn.y, r2);
        c.closePath();
        c.fill();
        c.fillStyle = '#8a6a3a';
        c.font = '15px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
      }
    },
    onTouchStart: function (x, y) {
      if (inRect(x, y, buttons.smooth)) {
        strokes.length = 0;
        stamps.length = 0;
        current = null;
        audio.play('whoosh');
        return;
      }
      if (inRect(x, y, buttons.stamp)) {
        var px = (lastPt && inField(lastPt.x, lastPt.y)) ? lastPt.x : W / 2;
        var py = (lastPt && inField(lastPt.x, lastPt.y)) ? lastPt.y : (top + fieldBottom) / 2;
        stamps.push({ x: px, y: py, size: 40, rot: (Math.random() - 0.5) * 0.4 });
        if (stamps.length > 30) stamps.shift();
        audio.play('pop');
        fx.spawn(px, py, {
          color: ['#e8c268', '#f2ddb0', '#ffffff'],
          count: 8, speed: 130, life: 0.5, gravity: 260, size: 4, shape: 'star'
        });
        return;
      }
      if (!inField(x, y)) return;
      current = { pts: [{ x: x, y: y }] };
      strokes.push(current);
      if (strokes.length > 220) strokes.shift();
      lastPt = { x: x, y: y };
      count = 0;
    },
    onTouchMove: function (x, y) {
      if (!current || !inField(x, y)) return;
      var pts = current.pts;
      var tail = pts[pts.length - 1];
      var dx = x - tail.x;
      var dy = y - tail.y;
      if (dx * dx + dy * dy < 36) return;
      if (pts.length < 150) pts.push({ x: x, y: y });
      else {
        current = { pts: [{ x: x, y: y }] };
        strokes.push(current);
        if (strokes.length > 220) strokes.shift();
      }
      lastPt = { x: x, y: y };
      if ((count++ & 1) === 0) {
        fx.spawn(x, y, {
          color: SAND_MOTES,
          count: 2, speed: 90, life: 0.45, gravity: 380, size: 2.5, shape: 'circle'
        });
      }
    },
    onTouchEnd: function () {
      current = null;
    }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  // 沙堆
  c.fillStyle = '#e8cd93';
  c.beginPath();
  c.moveTo(x + size * 0.1, y + size * 0.85);
  c.quadraticCurveTo(x + size * 0.5, y + size * 0.3, x + size * 0.9, y + size * 0.85);
  c.closePath();
  c.fill();
  // 沟痕弧线
  c.strokeStyle = 'rgba(150,108,52,0.7)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x + size * 0.2, y + size * 0.72);
  c.quadraticCurveTo(x + size * 0.5, y + size * 0.48, x + size * 0.8, y + size * 0.7);
  c.stroke();
  // 小星星
  c.fillStyle = '#c98d3f';
  c.beginPath();
  for (var i = 0; i < 10; i++) {
    var r = (i % 2 === 0) ? size * 0.14 : size * 0.06;
    var a = (Math.PI / 5) * i - Math.PI / 2;
    var px = x + size * 0.5 + Math.cos(a) * r;
    var py = y + size * 0.4 + Math.sin(a) * r;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
  c.fill();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game04.js"]=function(module,exports,require){
'use strict';
// 游戏 4：减压球。按住中间的大软球把它压瘪（随按压时间加深、朝手指方向变形），
// 松手后弹簧回弹抖动（soft pop 音效），计数已捏次数。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;

  var center = {
    x: W / 2,
    y: top + (H - 64 - top) / 2 + 6,
    r: Math.min(W, H) * 0.22
  };

  var pressing = false;
  var pressX = 0, pressY = 0;
  var pressT = 0;      // 按压深度 0..1
  var uAngle = Math.PI / 2; // 变形朝向
  var q = 0;           // 当前挤压量（弹簧模拟）
  var qv = 0;
  var squishes = 0;
  var t = 0;

  function dist(x, y) {
    var dx = x - center.x;
    var dy = y - center.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  var game = {
    center: center,
    squishes: 0,
    update: function (dt) {
      t += dt;
      if (pressing) {
        pressT = Math.min(1, pressT + dt * 3);
        q = pressT;
        qv = 0;
      } else {
        pressT = 0;
        // 阻尼弹簧回弹（自然过冲抖动）
        qv += (-140 * q - 7 * qv) * dt;
        q += qv * dt;
        if (q < -0.5) q = -0.5;
        if (Math.abs(q) < 0.001 && Math.abs(qv) < 0.001) { q = 0; qv = 0; }
      }
      fx.update(dt);
      this.squishes = squishes;
    },
    draw: function (c) {
      c.fillStyle = '#f7eef2';
      c.fillRect(0, 0, W, H);

      var breathe = 1 + 0.012 * Math.sin(t * 2.2);
      var ru = center.r * (1 - 0.33 * q) * breathe;
      var rp = center.r * (1 + 0.22 * q) * breathe;
      var shift = 0.22 * center.r * q * Math.min(1, Math.max(0, (pressing ? dist(pressX, pressY) : 0) / center.r));
      var ccx = center.x + Math.cos(uAngle) * shift;
      var ccy = center.y + Math.sin(uAngle) * shift;

      // 地面阴影
      c.fillStyle = 'rgba(150,110,130,0.16)';
      c.beginPath();
      c.ellipse(center.x, center.y + center.r * 0.95, ru * 0.85, center.r * 0.16, 0, 0, Math.PI * 2);
      c.fill();

      // 球体（沿按压方向旋转的椭圆）
      c.save();
      c.translate(ccx, ccy);
      c.rotate(uAngle);
      c.fillStyle = '#f6a8c0';
      c.beginPath();
      c.ellipse(0, 0, ru, rp, 0, 0, Math.PI * 2);
      c.fill();
      // 高光
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.beginPath();
      c.ellipse(-ru * 0.35, -rp * 0.4, ru * 0.22, rp * 0.15, -0.5, 0, Math.PI * 2);
      c.fill();
      c.restore();

      fx.draw(c);

      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('已捏 ' + squishes + ' 次', 12, top + 10);
      c.textAlign = 'center';
      c.fillStyle = '#b39aab';
      c.font = '13px sans-serif';
      c.fillText(pressing ? '按住它…' : '按住小球捏一捏', center.x, center.y + center.r + 42);
    },
    onTouchStart: function (x, y) {
      if (dist(x, y) < center.r * 1.15) {
        pressing = true;
        pressX = x;
        pressY = y;
        pressT = 0;
        var dx = x - center.x;
        var dy = y - center.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        uAngle = len < 2 ? Math.PI / 2 : Math.atan2(dy, dx);
      }
    },
    onTouchMove: function (x, y) {
      if (!pressing) return;
      pressX = x;
      pressY = y;
      var dx = x - center.x;
      var dy = y - center.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      uAngle = len < 2 ? Math.PI / 2 : Math.atan2(dy, dx);
    },
    onTouchEnd: function () {
      if (!pressing) return;
      pressing = false;
      // 松手：软 pop + 弹簧从当前挤压量回弹
      audio.play('pop');
      if (pressT > 0.15) {
        squishes++;
        fx.spawn(center.x, center.y, {
          color: ['#f6a8c0', '#ffffff', '#f2b6d4'],
          count: 8, speed: 130, life: 0.4, gravity: 200, size: 3, shape: 'circle'
        });
      }
    }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  c.fillStyle = '#f6a8c0';
  c.beginPath();
  c.ellipse(x + size * 0.5, y + size * 0.52, size * 0.34, size * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  // 两根按压手指示意
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath();
  c.ellipse(x + size * 0.38, y + size * 0.4, size * 0.1, size * 0.07, -0.6, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f9c6d4';
  c.beginPath();
  c.ellipse(x + size * 0.72, y + size * 0.78, size * 0.16, size * 0.13, 0, 0, Math.PI * 2);
  c.fill();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game05.js"]=function(module,exports,require){
'use strict';
// 游戏 5：倒珠子。按住顶部的瓶子往下面的罐子里倒彩色珠子，珠子受重力下落、
// 按列堆积在罐底；摇一摇按钮把珠子抛起重新堆；松手停止倒。计数已倒颗数。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

var BEAD_COLORS = ['#f28b94', '#f6c26b', '#8fd0a0', '#7fb8e8', '#c39be8', '#f2a2c0'];

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;
  var t = 0;

  // 瓶子（倒置，瓶口朝下），局部坐标原点在瓶身中心
  var bottle = { x: W / 2, y: 100, hitR: 58, mouthY: 152 };

  // 罐子
  var wall = 6;
  var r = 7;
  var colW = r * 2;
  var x0 = W / 2 - 92;
  var x1 = W / 2 + 92;
  var floorY = H - 90;
  var jarTop = floorY - 150;
  var innerLeft = x0 + wall + r;
  var innerRight = x1 - wall - r;
  var nCols = Math.max(4, Math.floor((innerRight - innerLeft) / colW));
  var gridW = nCols * colW;
  var gridLeft = innerLeft + (innerRight - innerLeft - gridW) / 2;
  var colH = new Array(nCols);
  for (var ci = 0; ci < nCols; ci++) colH[ci] = 0;
  var capacity = nCols * 9;

  var beads = [];      // { x, y, vx, vy, color, state: 'fall'|'set', col }
  var poured = 0;
  var pouring = false;
  var pourT = 0;
  var settled = 0;
  var shakeT = 0;
  var colorIdx = 0;

  var shakeBtn = { x: W / 2 - 60, y: H - 50, w: 120, h: 38, label: '摇一摇' };

  function colX(col) {
    return gridLeft + col * colW + colW / 2;
  }

  function spawnBead() {
    if (beads.length > 200) {
      for (var i = 0; i < beads.length; i++) {
        if (beads[i].state === 'set') {
          colH[beads[i].col]--;
          settled--;
          beads.splice(i, 1);
          break;
        }
      }
    }
    beads.push({
      x: W / 2 + (Math.random() - 0.5) * 16,
      y: bottle.mouthY + 6,
      vx: (Math.random() - 0.5) * 60,
      vy: 60,
      color: BEAD_COLORS[colorIdx++ % BEAD_COLORS.length],
      state: 'fall',
      col: -1
    });
    poured++;
  }

  function shake() {
    audio.play('whoosh');
    shakeT = 0.35;
    for (var c = 0; c < nCols; c++) colH[c] = 0;
    settled = 0;
    for (var i = 0; i < beads.length; i++) {
      var b = beads[i];
      b.state = 'fall';
      b.col = -1;
      b.vy = -(160 + Math.random() * 200);
      b.vx = (Math.random() - 0.5) * 280;
    }
    fx.spawn(W / 2, floorY - 60, {
      color: BEAD_COLORS,
      count: 8, speed: 160, life: 0.5, gravity: 400, size: 3, shape: 'circle'
    });
  }

  function inRect(x, y, rc) {
    return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
  }

  var game = {
    beads: beads,
    bottleHit: { x: bottle.x, y: bottle.y, r: bottle.hitR },
    shakeBtn: shakeBtn,
    poured: 0,
    update: function (dt) {
      t += dt;
      this.poured = poured;
      if (shakeT > 0) shakeT -= dt;

      if (pouring && settled < capacity) {
        pourT -= dt;
        if (pourT <= 0) {
          pourT = 0.08;
          spawnBead();
        }
      }

      for (var i = beads.length - 1; i >= 0; i--) {
        var b = beads[i];
        if (b.state !== 'fall') continue;
        b.vy += 1100 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < innerLeft) { b.x = innerLeft; b.vx = Math.abs(b.vx) * 0.6; }
        if (b.x > innerRight) { b.x = innerRight; b.vx = -Math.abs(b.vx) * 0.6; }
        var col = Math.floor((b.x - gridLeft) / colW);
        if (col < 0) col = 0;
        if (col >= nCols) col = nCols - 1;
        var landY = floorY - colH[col] * 12.5 - r;
        if (b.y >= landY) {
          b.y = landY;
          b.x = colX(col);
          b.state = 'set';
          b.col = col;
          colH[col]++;
          settled++;
        }
      }
      fx.update(dt);
    },
    draw: function (c) {
      c.fillStyle = '#eef0f7';
      c.fillRect(0, 0, W, H);

      // 瓶子（轻微摆动）
      var sway = pouring ? Math.sin(t * 9) * 0.05 : 0;
      c.save();
      c.translate(bottle.x, bottle.y);
      c.rotate(sway);
      c.fillStyle = 'rgba(207,224,242,0.95)';
      c.strokeStyle = '#9fb8d8';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-12, 26);
      c.lineTo(12, 26);
      c.lineTo(7, 46);
      c.lineTo(-7, 46);
      c.closePath();
      c.fill();
      c.stroke();
      c.beginPath();
      var bw = 33, bh = 30, brr = 10;
      c.moveTo(-bw + brr, -30);
      c.lineTo(bw - brr, -30);
      c.arcTo(bw, -30, bw, 26, brr);
      c.lineTo(bw, 26 - brr);
      c.arcTo(bw, 26, -bw, 26, brr);
      c.lineTo(-bw, -30 + brr);
      c.arcTo(-bw, -30, bw, -30, brr);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#9fb8d8';
      c.fillRect(-20, -36, 40, 8); // 瓶盖
      if (pouring) {
        c.fillStyle = '#c39be8';
        c.beginPath();
        c.ellipse(0, 46, 5, 8, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();

      // 珠子 + 罐子（摇动时整体平移）
      var offx = shakeT > 0 ? Math.sin(shakeT * 50) * 5 * (shakeT / 0.35) : 0;
      c.save();
      c.translate(offx, 0);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(x0, jarTop, x1 - x0, floorY - jarTop);
      for (var i = 0; i < beads.length; i++) {
        var b = beads[i];
        c.fillStyle = b.color;
        c.beginPath();
        c.arc(b.x, b.y, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.beginPath();
        c.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.3, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = '#9fb8d8';
      c.lineWidth = wall;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(x0, jarTop);
      c.lineTo(x0, floorY);
      c.lineTo(x1, floorY);
      c.lineTo(x1, jarTop);
      c.stroke();
      c.restore();

      fx.draw(c);

      // 摇一摇按钮
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      var r2 = shakeBtn.h / 2;
      c.moveTo(shakeBtn.x + r2, shakeBtn.y);
      c.arcTo(shakeBtn.x + shakeBtn.w, shakeBtn.y, shakeBtn.x + shakeBtn.w, shakeBtn.y + shakeBtn.h, r2);
      c.arcTo(shakeBtn.x + shakeBtn.w, shakeBtn.y + shakeBtn.h, shakeBtn.x, shakeBtn.y + shakeBtn.h, r2);
      c.arcTo(shakeBtn.x, shakeBtn.y + shakeBtn.h, shakeBtn.x, shakeBtn.y, r2);
      c.arcTo(shakeBtn.x, shakeBtn.y, shakeBtn.x + shakeBtn.w, shakeBtn.y, r2);
      c.closePath();
      c.fill();
      c.fillStyle = '#5a6b8c';
      c.font = '15px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(shakeBtn.label, shakeBtn.x + shakeBtn.w / 2, shakeBtn.y + shakeBtn.h / 2);

      // 计数
      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'left';
      c.fillText('已倒 ' + poured + ' 颗', 12, top + 10);
      c.textAlign = 'center';
      c.font = '13px sans-serif';
      c.fillStyle = '#8a97ad';
      c.fillText(pouring ? '正在倒…' : '按住瓶子倒珠子', bottle.x, 176);
    },
    onTouchStart: function (x, y) {
      var dx = x - bottle.x;
      var dy = y - bottle.y;
      if (dx * dx + dy * dy <= bottle.hitR * bottle.hitR) {
        pouring = true;
        pourT = 0;
        return;
      }
      if (inRect(x, y, shakeBtn)) {
        shake();
      }
    },
    onTouchMove: function () { /* 按住即倒 */ },
    onTouchEnd: function () {
      pouring = false;
    }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  // 倒置的小瓶
  c.fillStyle = '#cfe0f2';
  c.strokeStyle = '#9fb8d8';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x + size * 0.36, y + size * 0.62);
  c.lineTo(x + size * 0.64, y + size * 0.62);
  c.lineTo(x + size * 0.58, y + size * 0.78);
  c.lineTo(x + size * 0.42, y + size * 0.78);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillRect(x + size * 0.26, y + size * 0.16, size * 0.48, size * 0.46);
  c.strokeRect(x + size * 0.26, y + size * 0.16, size * 0.48, size * 0.46);
  // 珠子
  var cols = ['#f28b94', '#f6c26b', '#8fd0a0'];
  for (var i = 0; i < 3; i++) {
    c.fillStyle = cols[i];
    c.beginPath();
    c.arc(x + size * (0.38 + i * 0.12), y + size * 0.9, size * 0.06, 0, Math.PI * 2);
    c.fill();
  }
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game06.js"]=function(module,exports,require){
'use strict';
// 游戏 6：揭膜。闪光表面上盖着一层透明薄膜，从左上角小标签往右下拖动揭膜
// （揭膜过程 whoosh 音效），揭到 100% 表面星光庆祝 + chime，稍停后自动铺上新膜。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

function clipPoly(poly, nx, ny, d) {
  // 保留 n·p <= d 一侧（Sutherland–Hodgman 单平面）
  var out = [];
  for (var i = 0; i < poly.length; i++) {
    var a = poly[i];
    var b = poly[(i + 1) % poly.length];
    var da = a.x * nx + a.y * ny - d;
    var db = b.x * nx + b.y * ny - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      var k = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  }
  return out;
}

function fillPoly(c, poly) {
  c.beginPath();
  c.moveTo(poly[0].x, poly[0].y);
  for (var i = 1; i < poly.length; i++) c.lineTo(poly[i].x, poly[i].y);
  c.closePath();
}

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var ps = particlesLib.createParticles();
  var t = 0;
  var top = 64;

  var filmX0 = 12;
  var filmY0 = top + 6;
  var filmW = W - 24;
  var filmH = H - 70 - filmY0;
  var maxDist = filmW + filmH;

  var film = { p: 0 }; // null = 已揭完，等新膜
  var pauseT = 0;
  var films = 0;
  var drag = null;
  var whooshT = 0;

  var sparkles = [];
  for (var si = 0; si < 10; si++) {
    sparkles.push({
      x: filmX0 + 20 + Math.random() * (filmW - 40),
      y: filmY0 + 20 + Math.random() * (filmH - 40),
      ph: Math.random() * 6.28
    });
  }

  function proj(x, y) {
    return (x - filmX0) + (y - filmY0);
  }

  var game = {
    films: 0,
    tab: { x: filmX0 + 10, y: filmY0 + 10 },
    update: function (dt) {
      t += dt;
      ps.update(dt);
      this.films = films;
      whooshT -= dt;
      if (!film) {
        pauseT -= dt;
        if (pauseT <= 0) film = { p: 0 };
      } else if (film.p >= 1) {
        films++;
        audio.play('chime');
        for (var i = 0; i < 6; i++) {
          ps.spawn(filmX0 + Math.random() * filmW, filmY0 + Math.random() * filmH, {
            color: ['#f2d24a', '#ffffff', '#7fd8e8'],
            count: 2, speed: 120, life: 0.7, gravity: 60, size: 4, shape: 'star'
          });
        }
        film = null;
        pauseT = 1.1;
      }
    },
    draw: function (c) {
      // 背景 + 闪光表面
      c.fillStyle = '#eef2f8';
      c.fillRect(0, 0, W, H);
      var g = c.createLinearGradient(0, filmY0, 0, filmY0 + filmH);
      g.addColorStop(0, '#dfe9f5');
      g.addColorStop(1, '#f2dce6');
      c.fillStyle = g;
      c.fillRect(filmX0, filmY0, filmW, filmH);
      // 斜向光带
      c.fillStyle = 'rgba(255,255,255,0.12)';
      for (var b = 0; b < 3; b++) {
        var bx = filmX0 + filmW * (0.12 + 0.3 * b);
        c.beginPath();
        c.moveTo(bx, filmY0);
        c.lineTo(bx + 56, filmY0);
        c.lineTo(bx + 56 - filmH * 0.4, filmY0 + filmH);
        c.lineTo(bx - filmH * 0.4, filmY0 + filmH);
        c.closePath();
        c.fill();
      }
      // 星光闪烁
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 1.5;
      for (var s = 0; s < sparkles.length; s++) {
        var sp = sparkles[s];
        var a = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.7 + sp.ph));
        c.globalAlpha = a * 0.85;
        var r = 5 + 3 * a;
        c.beginPath();
        c.moveTo(sp.x - r, sp.y);
        c.lineTo(sp.x + r, sp.y);
        c.moveTo(sp.x, sp.y - r);
        c.lineTo(sp.x, sp.y + r);
        c.stroke();
      }
      c.globalAlpha = 1;

      // 薄膜
      if (film) {
        var sEdge = filmX0 + filmY0 + film.p * maxDist; // 揭膜前沿：x + y = sEdge
        var poly = clipPoly(
          [{ x: filmX0, y: filmY0 }, { x: filmX0 + filmW, y: filmY0 },
           { x: filmX0 + filmW, y: filmY0 + filmH }, { x: filmX0, y: filmY0 + filmH }],
          -1, -1, -sEdge);
        if (poly.length >= 3) {
          c.fillStyle = 'rgba(235,242,250,0.4)';
          fillPoly(c, poly);
          c.fill();
          // 膜面高光斜纹（裁剪在膜内）
          c.save();
          fillPoly(c, poly);
          c.clip();
          c.strokeStyle = 'rgba(255,255,255,0.3)';
          c.lineWidth = 14;
          for (var l = 0; l < 2; l++) {
            var lx = filmX0 + filmW * (0.3 + 0.35 * l);
            c.beginPath();
            c.moveTo(lx, filmY0);
            c.lineTo(lx - filmH * 0.55, filmY0 + filmH);
            c.stroke();
          }
          c.restore();
          c.strokeStyle = 'rgba(255,255,255,0.55)';
          c.lineWidth = 1.5;
          fillPoly(c, poly);
          c.stroke();
          // 卷起的膜边
          if (film.p > 0.02 && film.p < 0.999) {
            var pts = [];
            var ex1 = sEdge - filmY0;
            if (ex1 >= filmX0 && ex1 <= filmX0 + filmW) pts.push({ x: ex1, y: filmY0 });
            var ex2 = sEdge - filmY0 - filmH;
            if (ex2 >= filmX0 && ex2 <= filmX0 + filmW) pts.push({ x: ex2, y: filmY0 + filmH });
            var ey1 = sEdge - filmX0;
            if (ey1 >= filmY0 && ey1 <= filmY0 + filmH) pts.push({ x: filmX0, y: ey1 });
            var ey2 = sEdge - filmX0 - filmW;
            if (ey2 >= filmY0 && ey2 <= filmY0 + filmH) pts.push({ x: filmX0 + filmW, y: ey2 });
            if (pts.length >= 2) {
              c.strokeStyle = 'rgba(210,226,242,0.95)';
              c.lineWidth = 16;
              c.lineCap = 'round';
              c.beginPath();
              c.moveTo(pts[0].x, pts[0].y);
              c.lineTo(pts[1].x, pts[1].y);
              c.stroke();
              c.strokeStyle = 'rgba(255,255,255,0.85)';
              c.lineWidth = 5;
              c.beginPath();
              c.moveTo(pts[0].x - 2, pts[0].y - 2);
              c.lineTo(pts[1].x - 2, pts[1].y - 2);
              c.stroke();
            }
          }
        }
        // 左上角小标签
        if (film.p < 0.05) {
          c.fillStyle = 'rgba(255,255,255,0.92)';
          c.strokeStyle = 'rgba(150,170,195,0.8)';
          c.lineWidth = 1.5;
          c.beginPath();
          var tx = filmX0 + 2, ty = filmY0 + 2, tw = 36, th = 20, tr = 5;
          c.moveTo(tx + tr, ty);
          c.arcTo(tx + tw, ty, tx + tw, ty + th, tr);
          c.arcTo(tx + tw, ty + th, tx, ty + th, tr);
          c.arcTo(tx, ty + th, tx, ty, tr);
          c.arcTo(tx, ty, tx + tw, ty, tr);
          c.closePath();
          c.fill();
          c.stroke();
          c.strokeStyle = 'rgba(150,170,195,0.6)';
          for (var gi = 0; gi < 3; gi++) {
            c.beginPath();
            c.moveTo(tx + 9 + gi * 7, ty + 6);
            c.lineTo(tx + 9 + gi * 7, ty + 14);
            c.stroke();
          }
        }
      }

      ps.draw(c);

      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillText('已揭 ' + films + ' 张', W - 12, top + 10);
    },
    onTouchStart: function (x, y) {
      if (!film || film.p >= 1) return;
      if (x < filmX0 - 30 || x > filmX0 + filmW + 30 ||
        y < filmY0 - 30 || y > filmY0 + filmH + 30) return;
      drag = { p0: film.p, sProj: proj(x, y) };
    },
    onTouchMove: function (x, y) {
      if (!drag || !film) return;
      var gain = proj(x, y) - drag.sProj;
      if (gain <= 0) return;
      var np = drag.p0 + gain / maxDist;
      if (np > film.p) {
        film.p = Math.min(1, np);
        if (whooshT <= 0) {
          audio.play('whoosh');
          whooshT = 0.18;
        }
        ps.spawn(x, y, {
          color: ['#ffffff', '#cfe0f2'],
          count: 2, speed: 60, life: 0.4, gravity: 240, size: 2.5, shape: 'circle'
        });
      }
    },
    onTouchEnd: function () {
      drag = null;
    }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  // 闪光表面
  c.fillStyle = '#dfe9f5';
  c.fillRect(x + size * 0.15, y + size * 0.2, size * 0.7, size * 0.65);
  // 被揭起的膜角
  c.fillStyle = 'rgba(235,242,250,0.85)';
  c.beginPath();
  c.moveTo(x + size * 0.85, y + size * 0.2);
  c.lineTo(x + size * 0.85, y + size * 0.7);
  c.lineTo(x + size * 0.45, y + size * 0.2);
  c.closePath();
  c.fill();
  // 小标签
  c.fillStyle = '#9fb8d8';
  c.fillRect(x + size * 0.1, y + size * 0.14, size * 0.24, size * 0.14);
  // 星光
  c.strokeStyle = '#f2d24a';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x + size * 0.3, y + size * 0.6);
  c.lineTo(x + size * 0.42, y + size * 0.6);
  c.moveTo(x + size * 0.36, y + size * 0.54);
  c.lineTo(x + size * 0.36, y + size * 0.66);
  c.stroke();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game07.js"]=function(module,exports,require){
'use strict';
// 游戏 7：雨滴涟漪。点任意处落下一滴雨，落到下方水面溅起水花（splash 音效 +
// 水珠粒子）并泛开层层涟漪。计数已落滴数。纯点击，保持平静。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;
  var WY = H * 0.68; // 水面高度

  var drops = [];    // { x, y, vy }
  var ripples = [];  // { x, age, life }
  var count = 0;

  function splash(x) {
    count++;
    audio.play('splash');
    for (var i = 0; i < 3; i++) {
      ripples.push({ x: x, age: -0.14 * i, life: 0.95 });
      if (ripples.length > 40) ripples.shift();
    }
    fx.spawn(x, WY, {
      color: ['#7fb8e8', '#ffffff', '#a9c8e8'],
      count: 10, speed: 230, life: 0.5, gravity: 520, size: 3, shape: 'drop'
    });
  }

  var game = {
    dropCount: 0,
    update: function (dt) {
      this.dropCount = count;
      for (var i = drops.length - 1; i >= 0; i--) {
        var d = drops[i];
        d.vy += 900 * dt;
        d.y += d.vy * dt;
        if (d.y >= WY) {
          splash(d.x);
          drops.splice(i, 1);
        }
      }
      for (var k = ripples.length - 1; k >= 0; k--) {
        ripples[k].age += dt;
        if (ripples[k].age > ripples[k].life) ripples.splice(k, 1);
      }
      fx.update(dt);
    },
    draw: function (c) {
      // 天空
      var sky = c.createLinearGradient(0, 0, 0, WY);
      sky.addColorStop(0, '#dcebf6');
      sky.addColorStop(1, '#c8ddef');
      c.fillStyle = sky;
      c.fillRect(0, 0, W, WY);
      // 水
      var water = c.createLinearGradient(0, WY, 0, H);
      water.addColorStop(0, '#bfe0f2');
      water.addColorStop(1, '#8fbfe0');
      c.fillStyle = water;
      c.fillRect(0, WY, W, H - WY);
      c.strokeStyle = 'rgba(255,255,255,0.65)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, WY + 2);
      c.quadraticCurveTo(W * 0.25, WY - 3, W * 0.5, WY + 1);
      c.quadraticCurveTo(W * 0.75, WY + 5, W, WY);
      c.stroke();

      // 涟漪（错开的多圈椭圆）
      for (var i = 0; i < ripples.length; i++) {
        var r = ripples[i];
        if (r.age < 0) continue;
        var k = 1 - r.age / r.life;
        var rad = 6 + r.age * 95;
        c.globalAlpha = k * 0.6;
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(r.x, WY, rad, rad * 0.32, 0, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.ellipse(r.x, WY, rad * 0.6, rad * 0.19, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;

      // 雨滴（水滴形 + 尾迹）
      c.fillStyle = '#7fb8e8';
      for (var d2 = 0; d2 < drops.length; d2++) {
        var dp = drops[d2];
        c.strokeStyle = 'rgba(127,184,232,0.55)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(dp.x, dp.y - 14);
        c.lineTo(dp.x, dp.y - 4);
        c.stroke();
        c.beginPath();
        c.arc(dp.x, dp.y, 4, 0, Math.PI * 2);
        c.fill();
      }

      fx.draw(c);

      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillText('已落 ' + count + ' 滴', W - 12, top + 10);
      c.textAlign = 'center';
      c.fillStyle = '#8a97ad';
      c.font = '13px sans-serif';
      c.fillText('点任意处落一滴雨', W / 2, top + 34);
    },
    onTouchStart: function (x, y) {
      if (drops.length >= 20) return;
      var sy = Math.min(Math.max(y, top), WY - 60);
      drops.push({ x: x, y: sy, vy: 60 });
    },
    onTouchMove: function () { /* 纯点击 */ },
    onTouchEnd: function () { /* 纯点击 */ }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  // 水面
  c.fillStyle = '#bfe0f2';
  c.fillRect(x + size * 0.12, y + size * 0.55, size * 0.76, size * 0.35);
  // 雨滴
  c.fillStyle = '#7fb8e8';
  c.beginPath();
  c.arc(x + size * 0.5, y + size * 0.36, size * 0.1, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(x + size * 0.5, y + size * 0.16);
  c.quadraticCurveTo(x + size * 0.6, y + size * 0.3, x + size * 0.5, y + size * 0.36);
  c.quadraticCurveTo(x + size * 0.4, y + size * 0.3, x + size * 0.5, y + size * 0.16);
  c.fill();
  // 涟漪
  c.strokeStyle = '#ffffff';
  c.lineWidth = 1.5;
  c.beginPath();
  c.ellipse(x + size * 0.5, y + size * 0.62, size * 0.22, size * 0.07, 0, 0, Math.PI * 2);
  c.stroke();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game08.js"]=function(module,exports,require){
'use strict';
// 游戏 8：涂色。曼陀罗线稿：同心环 × 楔形区块（点击按半径+角度命中），
// 底部 8 色调色盘，点色块选色、点区块上色（pop 音效），重涂按钮一键清空。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

var PALETTE = ['#e8606c', '#f2984a', '#f2d24a', '#7ec86e', '#5ab8d8', '#7288e0', '#b47ae0', '#e87ab8'];

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;
  var paletteY = H - 50;

  var palette = [];
  for (var pi = 0; pi < PALETTE.length; pi++) {
    palette.push({ x: 24 + pi * (W - 48) / (PALETTE.length - 1), y: paletteY, r: 15, color: PALETTE[pi] });
  }

  var resetBtn = { x: 12, y: 62, w: 76, h: 32, label: '重涂' };
  var center = { x: W / 2, y: top + (paletteY - 24 - top) / 2 };
  var R = Math.min(W * 0.42, (paletteY - 24 - top) * 0.42);
  var INNER = 0.18;
  var BAND = (1 - INNER) / 4;
  var WEDGES = 12;

  var filled = {}; // key: 'c'（中心） 或 ring*12+wedge
  var filledCount = 0;
  var selected = 0;

  function inRect(x, y, rc) {
    return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
  }

  function keyAt(x, y) {
    var dx = x - center.x;
    var dy = y - center.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > R + 4) return null;
    if (d < R * INNER) return 'c';
    var ring = Math.floor((d / R - INNER) / BAND);
    if (ring < 0) ring = 0;
    if (ring > 3) ring = 3;
    var a = Math.atan2(dy, dx); // -π..π
    var u = (a + Math.PI) / (Math.PI * 2);
    var wedge = Math.floor(u * WEDGES);
    if (wedge >= WEDGES) wedge = WEDGES - 1;
    return ring * WEDGES + wedge;
  }

  var game = {
    center: center,
    radius: R,
    palette: palette,
    resetBtn: resetBtn,
    filledCount: 0,
    selected: 0,
    update: function (dt) {
      fx.update(dt);
      this.filledCount = filledCount;
      this.selected = selected;
    },
    draw: function (c) {
      c.fillStyle = '#faf7f2';
      c.fillRect(0, 0, W, H);

      var step = Math.PI * 2 / WEDGES;

      // 填色区块
      for (var ring = 0; ring < 4; ring++) {
        var r0 = R * (INNER + ring * BAND);
        var r1 = R * (INNER + (ring + 1) * BAND);
        for (var k = 0; k < WEDGES; k++) {
          var a0 = -Math.PI + k * step;
          var a1 = a0 + step;
          c.beginPath();
          c.arc(center.x, center.y, r1, a0, a1);
          c.arc(center.x, center.y, r0, a1, a0, true);
          c.closePath();
          c.fillStyle = filled[ring * WEDGES + k] || '#ffffff';
          c.fill();
        }
      }
      c.beginPath();
      c.arc(center.x, center.y, R * INNER, 0, Math.PI * 2);
      c.fillStyle = filled['c'] || '#ffffff';
      c.fill();

      // 线稿
      c.strokeStyle = '#8a7a9a';
      c.lineWidth = 1.5;
      for (var b = 0; b <= 4; b++) {
        c.beginPath();
        c.arc(center.x, center.y, R * (INNER + b * BAND), 0, Math.PI * 2);
        c.stroke();
      }
      for (var sp = 0; sp < WEDGES; sp++) {
        var ang = -Math.PI + sp * step;
        c.beginPath();
        c.moveTo(center.x + Math.cos(ang) * R * INNER, center.y + Math.sin(ang) * R * INNER);
        c.lineTo(center.x + Math.cos(ang) * R, center.y + Math.sin(ang) * R);
        c.stroke();
      }
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(center.x, center.y, R, 0, Math.PI * 2);
      c.stroke();

      fx.draw(c);

      // 调色盘
      for (var s = 0; s < palette.length; s++) {
        var p = palette[s];
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fill();
        if (s === selected) {
          c.strokeStyle = '#5a6b8c';
          c.lineWidth = 2.5;
          c.beginPath();
          c.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
          c.stroke();
        }
      }

      // 重涂按钮
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.strokeStyle = '#8a7a9a';
      c.lineWidth = 1.5;
      c.beginPath();
      var r2 = resetBtn.h / 2;
      c.moveTo(resetBtn.x + r2, resetBtn.y);
      c.arcTo(resetBtn.x + resetBtn.w, resetBtn.y, resetBtn.x + resetBtn.w, resetBtn.y + resetBtn.h, r2);
      c.arcTo(resetBtn.x + resetBtn.w, resetBtn.y + resetBtn.h, resetBtn.x, resetBtn.y + resetBtn.h, r2);
      c.arcTo(resetBtn.x, resetBtn.y + resetBtn.h, resetBtn.x, resetBtn.y, r2);
      c.arcTo(resetBtn.x, resetBtn.y, resetBtn.x + resetBtn.w, resetBtn.y, r2);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#5a6b8c';
      c.font = '13px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(resetBtn.label, resetBtn.x + resetBtn.w / 2, resetBtn.y + resetBtn.h / 2);
    },
    onTouchStart: function (x, y) {
      if (inRect(x, y, resetBtn)) {
        filled = {};
        filledCount = 0;
        audio.play('whoosh');
        return;
      }
      for (var s = 0; s < palette.length; s++) {
        var p = palette[s];
        var pdx = x - p.x;
        var pdy = y - p.y;
        if (pdx * pdx + pdy * pdy < 400) {
          selected = s;
          audio.play('pop');
          return;
        }
      }
      var key = keyAt(x, y);
      if (key === null || filled[key]) return;
      filled[key] = PALETTE[selected];
      filledCount++;
      audio.play('pop');
      fx.spawn(x, y, {
        color: [PALETTE[selected], '#ffffff'],
        count: 5, speed: 90, life: 0.35, gravity: 120, size: 2.5, shape: 'circle'
      });
    },
    onTouchMove: function () { /* 点按交互 */ },
    onTouchEnd: function () { /* 点按交互 */ }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  // 简化曼陀罗：三个环 + 分瓣，几瓣已上色
  var cx = x + size * 0.5;
  var cy = y + size * 0.5;
  var cols = ['#e8606c', '#f2d24a', '#5ab8d8', '#7ec86e'];
  for (var i = 0; i < 8; i++) {
    var a = (Math.PI * 2 / 8) * i;
    c.fillStyle = cols[i % 4];
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, size * 0.36, a, a + Math.PI / 4);
    c.closePath();
    c.fill();
  }
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#8a7a9a';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(cx, cy, size * 0.36, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
  c.stroke();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game09.js"]=function(module,exports,require){
'use strict';
// 游戏 9：推金币。投币按钮从推板下方掉落金币到台面；推板周期性向前推进，
// 把整堆金币往前推，越过前沿的金币掉入托盘（chime + 星光粒子）并计数收集。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

function easeInOut(k) {
  k = Math.max(0, Math.min(1, k));
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;
  var t = 0;

  var x0 = 24;
  var x1 = W - 24;
  var edgeY = H - 150;   // 台面前沿
  var barBaseY = 300;    // 推板（顶部）基准
  var barH = 26;
  var pushDepth = 62;
  var cycle = 2.4;
  var r = 13;

  var coins = [];        // { x, y, vy, state: 'fall'|'rest'|'gone' }
  var collected = 0;
  var prevPush = 0;

  var dropBtn = { x: W / 2 - 70, y: H - 52, w: 140, h: 40, label: '投币' };

  function pushAt(tt) {
    var ph = tt % cycle;
    if (ph < cycle / 2) return easeInOut(ph / (cycle / 2)) * pushDepth;
    return pushDepth * (1 - easeInOut((ph - cycle / 2) / (cycle / 2)));
  }

  function topSurface(x) {
    var best = edgeY - r; // 平台面
    for (var i = 0; i < coins.length; i++) {
      var c = coins[i];
      if (c.state !== 'rest') continue;
      if (Math.abs(c.x - x) < 22) {
        var top2 = c.y - (2 * r - 1);
        if (top2 < best) best = top2;
      }
    }
    return best;
  }

  function drop() {
    if (coins.length >= 130) return;
    coins.push({
      x: W / 2 + (Math.random() - 0.5) * 110,
      y: barBaseY + pushAt(t) + barH + 34,
      vy: 40,
      state: 'fall'
    });
  }

  function inRect(x, y, rc) {
    return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
  }

  var game = {
    coins: coins,
    collected: 0,
    dropBtn: dropBtn,
    update: function (dt) {
      t += dt;
      fx.update(dt);
      this.collected = collected;

      var push = pushAt(t);
      var d = push - prevPush;
      prevPush = push;
      if (d > 0) {
        // 推板前进：整堆金币一起向前（向下）挪动
        for (var i = 0; i < coins.length; i++) {
          var rc = coins[i];
          if (rc.state !== 'rest') continue;
          rc.y += d;
          if (rc.y > edgeY + 4) {
            rc.state = 'gone';
            rc.vy = 40;
            collected++;
            audio.play('chime');
            fx.spawn(rc.x, edgeY, {
              color: ['#f2d24a', '#ffffff', '#f6c26b'],
              count: 10, speed: 180, life: 0.6, gravity: 300, size: 3.5, shape: 'star'
            });
          }
        }
      }

      for (var k = coins.length - 1; k >= 0; k--) {
        var c = coins[k];
        if (c.state === 'fall') {
          c.vy += 1100 * dt;
          c.y += c.vy * dt;
          if (c.x < x0 + r) { c.x = x0 + r; c.vy *= 0.9; }
          if (c.x > x1 - r) { c.x = x1 - r; c.vy *= 0.9; }
          var surf = topSurface(c.x);
          if (c.y >= surf) {
            c.y = surf;
            c.state = 'rest';
          }
        } else if (c.state === 'gone') {
          c.vy += 1100 * dt;
          c.y += c.vy * dt;
          if (c.y > H + 60) coins.splice(k, 1);
        }
      }
    },
    draw: function (c) {
      // 背景与托盘
      c.fillStyle = '#f6eedd';
      c.fillRect(0, 0, W, H);
      var tray = c.createLinearGradient(0, edgeY, 0, H);
      tray.addColorStop(0, '#e8d9b8');
      tray.addColorStop(1, '#d9c49a');
      c.fillStyle = tray;
      c.fillRect(0, edgeY, W, H - edgeY);
      // 侧壁
      c.fillStyle = '#dcc9a4';
      c.fillRect(x0 - 10, top + 10, 10, edgeY - top - 10);
      c.fillRect(x1, top + 10, 10, edgeY - top - 10);
      // 前沿
      c.strokeStyle = '#b8946a';
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(x0 - 10, edgeY);
      c.lineTo(x1 + 10, edgeY);
      c.stroke();

      // 推板
      var barY = barBaseY + pushAt(t);
      c.fillStyle = '#e0b25a';
      c.strokeStyle = '#b8863a';
      c.lineWidth = 2.5;
      c.beginPath();
      var bw = (x1 - x0) - 28, bh = barH, brr = 8;
      c.moveTo(x0 + 14 + brr, barY);
      c.arcTo(x0 + 14 + bw, barY, x0 + 14 + bw, barY + bh, brr);
      c.arcTo(x0 + 14 + bw, barY + bh, x0 + 14, barY + bh, brr);
      c.arcTo(x0 + 14, barY + bh, x0 + 14, barY, brr);
      c.arcTo(x0 + 14, barY, x0 + 14 + bw, barY, brr);
      c.closePath();
      c.fill();
      c.stroke();
      c.strokeStyle = 'rgba(120,84,30,0.35)';
      c.lineWidth = 2;
      for (var rb = 0; rb < 5; rb++) {
        var rx = x0 + 34 + rb * ((bw - 40) / 4);
        c.beginPath();
        c.moveTo(rx, barY + 6);
        c.lineTo(rx, barY + barH - 6);
        c.stroke();
      }

      // 金币
      for (var i = 0; i < coins.length; i++) {
        var cn = coins[i];
        c.fillStyle = '#f2c14e';
        c.beginPath();
        c.arc(cn.x, cn.y, r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#d99a2b';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cn.x, cn.y, r - 1, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.8)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cn.x - r * 0.25, cn.y - r * 0.25, r * 0.4, Math.PI * 0.9, Math.PI * 1.6);
        c.stroke();
      }

      fx.draw(c);

      // 计数与提示
      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('已收 ' + collected + ' 枚', 12, top + 10);
      c.textAlign = 'center';
      c.fillStyle = '#a08a5a';
      c.font = '12px sans-serif';
      c.fillText('推板会把金币推下前沿', W / 2, barBaseY - 16);

      // 投币按钮
      c.fillStyle = '#f2c14e';
      c.strokeStyle = '#b8863a';
      c.lineWidth = 2;
      c.beginPath();
      var r2 = dropBtn.h / 2;
      c.moveTo(dropBtn.x + r2, dropBtn.y);
      c.arcTo(dropBtn.x + dropBtn.w, dropBtn.y, dropBtn.x + dropBtn.w, dropBtn.y + dropBtn.h, r2);
      c.arcTo(dropBtn.x + dropBtn.w, dropBtn.y + dropBtn.h, dropBtn.x, dropBtn.y + dropBtn.h, r2);
      c.arcTo(dropBtn.x, dropBtn.y + dropBtn.h, dropBtn.x, dropBtn.y, r2);
      c.arcTo(dropBtn.x, dropBtn.y, dropBtn.x + dropBtn.w, dropBtn.y, r2);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#5a4a20';
      c.font = '15px sans-serif';
      c.fillText(dropBtn.label, dropBtn.x + dropBtn.w / 2, dropBtn.y + dropBtn.h / 2);
    },
    onTouchStart: function (x, y) {
      if (inRect(x, y, dropBtn)) {
        drop();
        audio.play('whoosh');
      }
    },
    onTouchMove: function () { /* 按钮交互 */ },
    onTouchEnd: function () { /* 按钮交互 */ }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  // 金币堆 + 推板
  c.fillStyle = '#f2c14e';
  c.beginPath();
  c.arc(x + size * 0.38, y + size * 0.62, size * 0.16, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x + size * 0.62, y + size * 0.62, size * 0.16, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x + size * 0.5, y + size * 0.44, size * 0.16, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e0b25a';
  c.fillRect(x + size * 0.15, y + size * 0.16, size * 0.7, size * 0.12);
  c.strokeStyle = '#b8863a';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x + size * 0.12, y + size * 0.85);
  c.lineTo(x + size * 0.88, y + size * 0.85);
  c.stroke();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/game10.js"]=function(module,exports,require){
'use strict';
// 游戏 10：弹力球。点空白处生成一颗弹力球（上限 24 颗），球受重力下落、
// 碰墙壁和地板反弹衰减；点球把它戳破（pop 音效 + 爆裂粒子）。计数已戳个数。
var particlesLib = require('./particles.js');
var audio = require('./audio.js');

var COLORS = ['#f28b94', '#f6c26b', '#8fd0a0', '#7fb8e8', '#c39be8', '#f2a2c0', '#7fd8c8', '#f2d24a'];

function create() {
  var info = null;
  try { info = wx.getSystemInfoSync(); } catch (e) { info = null; }
  info = info || {};
  var W = info.windowWidth || 375;
  var H = info.windowHeight || 667;

  var fx = particlesLib.createParticles();
  var top = 64;
  var t = 0;

  var ceilY = top + 4;
  var floorY = H - 12;

  var balls = []; // { x, y, vx, vy, r, color }
  var popped = 0;
  var colorIdx = 0;

  function spawn(x, y) {
    if (balls.length >= 24) return;
    balls.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 90,
      vy: 0,
      r: 12 + Math.random() * 8,
      color: COLORS[colorIdx++ % COLORS.length]
    });
  }

  var game = {
    balls: balls,
    popped: 0,
    update: function (dt) {
      t += dt;
      fx.update(dt);
      this.popped = popped;
      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        b.vy += 950 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.8; }
        if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.8; }
        if (b.y - b.r < ceilY) { b.y = ceilY + b.r; b.vy = Math.abs(b.vy) * 0.8; }
        if (b.y + b.r > floorY) {
          b.y = floorY - b.r;
          b.vy = -Math.abs(b.vy) * 0.75;
          b.vx *= 0.985;
        }
      }
    },
    draw: function (c) {
      c.fillStyle = '#eff5ec';
      c.fillRect(0, 0, W, H);
      // 地板
      c.fillStyle = '#dcead8';
      c.fillRect(0, floorY, W, H - floorY);
      c.strokeStyle = '#b8d0b2';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, floorY);
      c.lineTo(W, floorY);
      c.stroke();

      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        c.fillStyle = b.color;
        c.beginPath();
        c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.beginPath();
        c.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2);
        c.fill();
      }

      fx.draw(c);

      c.fillStyle = '#5a6b8c';
      c.font = '14px sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('已戳 ' + popped + ' 个', 12, top + 10);
      c.textAlign = 'center';
      c.fillStyle = '#8a97ad';
      c.font = '12px sans-serif';
      c.fillText('点空白弹球 · 点球戳破', W / 2, top + 10);
    },
    onTouchStart: function (x, y) {
      // 先命中球（戳破），否则空白处生成
      for (var i = balls.length - 1; i >= 0; i--) {
        var b = balls[i];
        var dx = x - b.x;
        var dy = y - b.y;
        var hit = b.r + 8;
        if (dx * dx + dy * dy <= hit * hit) {
          balls.splice(i, 1);
          popped++;
          audio.play('pop');
          fx.spawn(b.x, b.y, {
            color: [b.color, '#ffffff'],
            count: 12, speed: 200, life: 0.45, gravity: 300, size: 3.5, shape: 'circle'
          });
          return;
        }
      }
      spawn(x, y);
    },
    onTouchMove: function () { /* 点按交互 */ },
    onTouchEnd: function () { /* 点按交互 */ }
  };

  return game;
}

function drawIcon(c, x, y, size) {
  c.fillStyle = '#7fb8e8';
  c.beginPath();
  c.arc(x + size * 0.38, y + size * 0.46, size * 0.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath();
  c.arc(x + size * 0.31, y + size * 0.39, size * 0.06, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f28b94';
  c.beginPath();
  c.arc(x + size * 0.66, y + size * 0.62, size * 0.14, 0, Math.PI * 2);
  c.fill();
  // 弹跳轨迹线
  c.strokeStyle = 'rgba(90,107,140,0.5)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x + size * 0.14, y + size * 0.86);
  c.quadraticCurveTo(x + size * 0.4, y + size * 0.6, x + size * 0.62, y + size * 0.86);
  c.stroke();
}

module.exports = { create: create, drawIcon: drawIcon };

};
__modules["js/particles.js"]=function(module,exports,require){
'use strict';
// 极简共享粒子池：所有游戏共用的火花 / 星星 / 水珠 / 碎屑效果。
// 纯逻辑 + canvas 绘制，不调用任何 wx API。坐标系与游戏一致（CSS 像素）。

var MAX_LIVE = 300;

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function createParticles() {
  var live = [];

  // opts: color(字符串或数组), count, speed(px/s), life(s), gravity(px/s^2), size(px), shape
  function spawn(x, y, opts) {
    opts = opts || {};
    var count = opts.count || 8;
    var speed = opts.speed || 120;
    var life = opts.life || 0.6;
    var gravity = opts.gravity == null ? 200 : opts.gravity;
    var size = opts.size || 4;
    var shape = opts.shape || 'circle';
    var colors = Array.isArray(opts.color) ? opts.color : [opts.color || '#ffffff'];
    for (var i = 0; i < count; i++) {
      if (live.length >= MAX_LIVE) live.shift();
      var a = rand(0, Math.PI * 2);
      var sp = speed * rand(0.4, 1.15);
      live.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        life: life * rand(0.6, 1.2),
        size: size * rand(0.6, 1.3),
        gravity: gravity,
        shape: shape,
        color: colors[(Math.random() * colors.length) | 0],
        rot: rand(0, Math.PI * 2),
        vr: rand(-6, 6)
      });
    }
  }

  function update(dt) {
    for (var i = live.length - 1; i >= 0; i--) {
      var p = live[i];
      p.age += dt;
      if (p.age >= p.life) {
        live.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  function starPath(c, s) {
    c.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = (i % 2 === 0) ? s : s * 0.45;
      var a = (Math.PI / 5) * i - Math.PI / 2;
      if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
  }

  function draw(ctx) {
    for (var i = 0; i < live.length; i++) {
      var p = live[i];
      var k = 1 - p.age / p.life;
      ctx.globalAlpha = k < 0 ? 0 : k;
      ctx.fillStyle = p.color;
      var s = p.size;
      if (p.shape === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        starPath(ctx, s);
        ctx.fill();
        ctx.restore();
      } else if (p.shape === 'crumb') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-s / 2, -s / 2, s, s * 0.8);
        ctx.restore();
      } else if (p.shape === 'drop') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.4, s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else { // circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * (0.5 + 0.5 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    spawn: spawn,
    update: update,
    draw: draw,
    clear: function () { live.length = 0; },
    count: function () { return live.length; }
  };
}

module.exports = { createParticles: createParticles };

};
__modules["js/storage.js"]=function(module,exports,require){
'use strict';
// 本地存储封装：wx.getStorageSync / wx.setStorageSync，任何异常都静默回退。
const PREFIX = 'relax_';

function get(key, def) {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return def;
    const v = wx.getStorageSync(PREFIX + key);
    return (v === '' || v === undefined || v === null) ? def : v;
  } catch (e) {
    return def;
  }
}

function set(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(PREFIX + key, value);
  } catch (e) { /* ignore */ }
}

module.exports = { get, set };

};
__require("__entry__")("./game.js");
})();
