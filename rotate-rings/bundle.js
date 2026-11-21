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
/**
 * 旋转圆环 (Rotate Rings) — 微信小游戏
 * 全部逻辑与绘制均在本文件内，纯 Canvas 渲染，无 DOM/BOM、无外部资源。
 *
 * 玩法：若干同心圆环，每环 8 个扇形色块。旋转各环，
 * 使从内到外的 8 条辐射「辐条」各自为同一颜色即获胜。
 */

'use strict';

/* ---------------------------------------------------------------- *
 * 环境与画布
 * ---------------------------------------------------------------- */

var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');

var sysInfo = {};
try {
  if (typeof wx.getSystemInfoSync === 'function') {
    sysInfo = wx.getSystemInfoSync() || {};
  }
} catch (e) {
  sysInfo = {};
}
if (!sysInfo.windowWidth) { sysInfo.windowWidth = 375; }
if (!sysInfo.windowHeight) { sysInfo.windowHeight = 667; }
if (!sysInfo.pixelRatio) { sysInfo.pixelRatio = 2; }

var W = sysInfo.windowWidth;
var H = sysInfo.windowHeight;
var DPR = sysInfo.pixelRatio;

canvas.width = Math.floor(W * DPR);
canvas.height = Math.floor(H * DPR);

/* 每帧重置为逻辑像素坐标系（触点坐标也是逻辑像素） */
function resetTransform() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ---------------------------------------------------------------- *
 * 常量
 * ---------------------------------------------------------------- */

var SEG = 8;                       // 每环扇形数
var SEG_ANGLE = (Math.PI * 2) / SEG;
var SWIPE_STEP = 46;               // 每滑动多少像素旋转一格
var TAP_RADIUS = 12;               // 判定“点击”的最大位移
var PALETTE = [
  '#e74c3c', // 红
  '#3498db', // 蓝
  '#2ecc71', // 绿
  '#f1c40f', // 黄
  '#9b59b6', // 紫
  '#e67e22'  // 橙
];
var BG_TOP = '#1b2338';
var BG_BOT = '#0d1220';

/* ---------------------------------------------------------------- *
 * 音效（wx.createWebAudioContext，可能不存在则静默）
 * ---------------------------------------------------------------- */

var audioCtx = null;
var audioTried = false;
var muted = false;

function ensureAudio() {
  if (audioTried) { return; }
  audioTried = true;
  try {
    if (typeof wx.createWebAudioContext === 'function') {
      audioCtx = wx.createWebAudioContext();
    }
  } catch (e) {
    audioCtx = null;
  }
}

function blip(freq, dur, type) {
  if (muted || !audioCtx) { return; }
  try {
    var osc = audioCtx.createOscillator
      ? audioCtx.createOscillator() : null;
    var gain = audioCtx.createGain ? audioCtx.createGain() : null;
    if (!osc || !gain) { return; }
    osc.type = type || 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.06;
    if (gain.gain.exponentialRampToValueAtTime) {
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001,
        audioCtx.currentTime + dur);
    }
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) {
    /* 静默失败 */
  }
}

var sfx = {
  rotate: function () { blip(330, 0.07); },
  select: function () { blip(520, 0.06, 'triangle'); },
  win: function () {
    blip(523, 0.12, 'triangle');
    setTimeoutSafe(function () { blip(659, 0.12, 'triangle'); }, 120);
    setTimeoutSafe(function () { blip(784, 0.2, 'triangle'); }, 240);
  }
};

function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') { setTimeout(fn, ms); }
  else { fn(); }
}

/* ---------------------------------------------------------------- *
 * 关卡与棋盘
 * ---------------------------------------------------------------- */

function levelConfig(level) {
  if (level <= 1) { return { rings: 3, colors: 4 }; }
  if (level === 2) { return { rings: 4, colors: 5 }; }
  return { rings: 5, colors: 6 };
}

var game = {
  level: 1,
  ringCount: 3,
  colorCount: 4,
  rings: [],          // [{ base:[8], rot:int, angle:float }]
  selected: 0,
  moves: 0,
  won: false,
  startTime: 0,
  elapsed: 0,         // 胜利后冻结的用时（秒）
  best: null
};

function makeRing(colorCount) {
  var base = [];
  for (var s = 0; s < SEG; s++) {
    base.push(s % colorCount);
  }
  return { base: base, rot: 0, angle: 0 };
}

function colorAt(ringIndex, spoke) {
  var ring = game.rings[ringIndex];
  return ring.base[((spoke - ring.rot) % SEG + SEG) % SEG];
}

function isSolved() {
  for (var s = 0; s < SEG; s++) {
    var c = colorAt(0, s);
    for (var r = 1; r < game.ringCount; r++) {
      if (colorAt(r, s) !== c) { return false; }
    }
  }
  return true;
}

/** 从已解盘面出发随机旋转各环打乱；保证可解且不是已解状态 */
function shuffleBoard() {
  var guard = 0;
  do {
    for (var r = 0; r < game.ringCount; r++) {
      game.rings[r].rot = Math.floor(Math.random() * SEG);
      game.rings[r].angle = game.rings[r].rot;
    }
    guard++;
  } while (isSolved() && guard < 200);

  /* 兜底：极端情况下强行破坏对齐 */
  if (isSolved()) {
    game.rings[0].rot = (game.rings[0].rot + 3) % SEG;
    game.rings[0].angle = game.rings[0].rot;
  }
}

function bestKey(level) {
  return 'rr_best_L' + level;
}

function loadBest(level) {
  try {
    var v = wx.getStorageSync(bestKey(level));
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  } catch (e) {
    return null;
  }
}

function saveBest(level, moves) {
  try {
    wx.setStorageSync(bestKey(level), String(moves));
  } catch (e) { /* 忽略 */ }
}

function setupLevel(level) {
  var cfg = levelConfig(level);
  game.level = level;
  game.ringCount = cfg.rings;
  game.colorCount = cfg.colors;
  game.rings = [];
  for (var i = 0; i < cfg.rings; i++) {
    game.rings.push(makeRing(cfg.colors));
  }
  shuffleBoard();
  game.selected = cfg.rings - 1;
  game.moves = 0;
  game.won = false;
  game.startTime = nowSeconds();
  game.elapsed = 0;
  game.best = loadBest(level);
}

function nowSeconds() {
  return Date.now() / 1000;
}

function rotateSelected(dir) {
  if (game.won) { return; }
  var ring = game.rings[game.selected];
  ring.rot = ((ring.rot + dir) % SEG + SEG) % SEG;
  game.moves++;
  sfx.rotate();
  if (isSolved()) {
    game.won = true;
    game.elapsed = nowSeconds() - game.startTime;
    if (game.best === null || game.moves < game.best) {
      game.best = game.moves;
      saveBest(game.level, game.moves);
    }
    sfx.win();
  }
}

/* ---------------------------------------------------------------- *
 * 布局（逻辑像素）
 * ---------------------------------------------------------------- */

var layout = {};

function computeLayout() {
  var cx = W / 2;
  var cy = H * 0.44;
  var outerR = Math.min(W * 0.44, H * 0.30);
  var ringW = outerR / (game.ringCount + 0.55);
  var innerR = outerR - ringW * game.ringCount;

  layout.cx = cx;
  layout.cy = cy;
  layout.outerR = outerR;
  layout.innerR = innerR;
  layout.ringW = ringW;

  var bw = Math.min(110, W * 0.3);
  var bh = 58;
  var by = H - 108;
  var gap = 24;
  layout.btnLeft = { x: cx - bw - gap / 2, y: by, w: bw, h: bh };
  layout.btnRight = { x: cx + gap / 2, y: by, w: bw, h: bh };

  var small = 46;
  layout.btnRestart = { x: W - small - 14, y: 14, w: small, h: small };
  layout.btnMute = { x: W - small * 2 - 24, y: 14, w: small, h: small };

  layout.btnNext = { x: cx - bw - gap / 2, y: cy + outerR + 70, w: bw, h: bh };
  layout.btnReplay = { x: cx + gap / 2, y: cy + outerR + 70, w: bw, h: bh };
}

function inRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w &&
         p.y >= r.y && p.y <= r.y + r.h;
}

/* ---------------------------------------------------------------- *
 * 触摸输入
 * ---------------------------------------------------------------- */

var touch = {
  active: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  moved: false,
  acc: 0
};

function getPoint(e) {
  var t = (e && e.touches && e.touches[0]) ||
          (e && e.changedTouches && e.changedTouches[0]);
  if (!t) { return null; }
  return { x: t.clientX, y: t.clientY };
}

wx.onTouchStart(function (e) {
  ensureAudio();
  var p = getPoint(e);
  if (!p) { return; }
  touch.active = true;
  touch.startX = p.x;
  touch.startY = p.y;
  touch.lastX = p.x;
  touch.moved = false;
  touch.acc = 0;
});

wx.onTouchMove(function (e) {
  if (!touch.active || game.won) { return; }
  var p = getPoint(e);
  if (!p) { return; }
  var dx = p.x - touch.lastX;
  touch.acc += dx;
  touch.lastX = p.x;
  if (Math.abs(p.x - touch.startX) > TAP_RADIUS ||
      Math.abs(p.y - touch.startY) > TAP_RADIUS) {
    touch.moved = true;
  }
  var guard = 0;
  while (Math.abs(touch.acc) >= SWIPE_STEP && guard < 8) {
    var dir = touch.acc > 0 ? 1 : -1;
    rotateSelected(dir);
    touch.acc -= dir * SWIPE_STEP;
    guard++;
  }
});

wx.onTouchEnd(function (e) {
  if (!touch.active) { return; }
  touch.active = false;
  if (touch.moved) { return; }
  var p = getPoint(e);
  if (!p) { return; }
  handleTap(p);
});

function handleTap(p) {
  if (game.won) {
    if (inRect(p, layout.btnNext)) {
      sfx.select();
      setupLevel(game.level + 1);
    } else if (inRect(p, layout.btnReplay)) {
      sfx.select();
      setupLevel(game.level);
    }
    return;
  }

  if (inRect(p, layout.btnRestart)) {
    sfx.select();
    setupLevel(game.level);
    return;
  }
  if (inRect(p, layout.btnMute)) {
    muted = !muted;
    if (!muted) { sfx.select(); }
    return;
  }
  if (inRect(p, layout.btnLeft)) {
    rotateSelected(-1);
    return;
  }
  if (inRect(p, layout.btnRight)) {
    rotateSelected(1);
    return;
  }

  /* 点击圆盘选择圆环 */
  var dx = p.x - layout.cx;
  var dy = p.y - layout.cy;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= layout.innerR - layout.ringW * 0.4 &&
      dist <= layout.outerR + layout.ringW * 0.4) {
    var band = Math.floor((dist - layout.innerR) / layout.ringW);
    if (band < 0) { band = 0; }
    if (band > game.ringCount - 1) { band = game.ringCount - 1; }
    /* 内环 index 0 在最里面 */
    var idx = (game.ringCount - 1) - band;
    if (idx !== game.selected) {
      game.selected = idx;
      sfx.select();
    }
  }
}

/* ---------------------------------------------------------------- *
 * 绘制
 * ---------------------------------------------------------------- */

function fmtTime(sec) {
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function drawBackground(t) {
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, BG_TOP);
  g.addColorStop(1, BG_BOT);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  /* 缓慢旋转的装饰刻度环 */
  ctx.save();
  ctx.translate(layout.cx, layout.cy);
  ctx.rotate(t * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (var i = 0; i < 24; i++) {
    var a = i * (Math.PI * 2 / 24);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (layout.outerR + 14),
               Math.sin(a) * (layout.outerR + 14));
    ctx.lineTo(Math.cos(a) * (layout.outerR + 26),
               Math.sin(a) * (layout.outerR + 26));
    ctx.stroke();
  }
  ctx.restore();
}

function drawHUD() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('旋转圆环', W / 2, 30);

  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#9fb3d1';
  ctx.fillText('第 ' + game.level + ' 关 · ' +
    game.ringCount + ' 环 ' + game.colorCount + ' 色', W / 2, 58);

  ctx.fillStyle = '#cfe0f5';
  ctx.font = '15px sans-serif';
  var sec = game.won ? game.elapsed : (nowSeconds() - game.startTime);
  ctx.fillText('步数 ' + game.moves + '    时间 ' + fmtTime(sec),
    W / 2, 84);

  if (game.best !== null) {
    ctx.fillStyle = '#7f93b5';
    ctx.font = '12px sans-serif';
    ctx.fillText('本关最佳 ' + game.best + ' 步', W / 2, 106);
  }

  drawRestartIcon(layout.btnRestart);
  drawMuteIcon(layout.btnMute);
}

function drawRestartIcon(r) {
  var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  var rad = r.w * 0.28;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, -Math.PI * 0.15, Math.PI * 1.25);
  ctx.stroke();
  /* 箭头 */
  var ax = cx + Math.cos(-Math.PI * 0.15) * rad;
  var ay = cy + Math.sin(-Math.PI * 0.15) * rad;
  ctx.beginPath();
  ctx.moveTo(ax + 7, ay - 2);
  ctx.lineTo(ax - 4, ay - 8);
  ctx.lineTo(ax - 1, ay + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMuteIcon(r) {
  var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  /* 喇叭主体 */
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 4);
  ctx.lineTo(cx - 3, cy - 4);
  ctx.lineTo(cx + 3, cy - 10);
  ctx.lineTo(cx + 3, cy + 10);
  ctx.lineTo(cx - 3, cy + 4);
  ctx.lineTo(cx - 9, cy + 4);
  ctx.closePath();
  ctx.fill();
  if (muted) {
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy - 7);
    ctx.lineTo(cx + 14, cy + 7);
    ctx.moveTo(cx + 14, cy - 7);
    ctx.lineTo(cx + 6, cy + 7);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + 4, cy, 8, -0.9, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 4, cy, 12, -0.8, 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRings() {
  var cx = layout.cx, cy = layout.cy;
  var i, s, a0, a1;

  for (i = 0; i < game.ringCount; i++) {
    var ring = game.rings[i];
    var rOut = layout.outerR - i * layout.ringW;
    var rIn = rOut - layout.ringW;
    var offset = ring.angle * SEG_ANGLE;
    var isSel = (i === game.selected) && !game.won;

    for (s = 0; s < SEG; s++) {
      a0 = s * SEG_ANGLE + offset - Math.PI / 2;
      a1 = a0 + SEG_ANGLE;
      var gapA = 0.02;
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, a0 + gapA, a1 - gapA);
      ctx.arc(cx, cy, rIn, a1 - gapA, a0 + gapA, true);
      ctx.closePath();
      ctx.fillStyle = PALETTE[colorAt(i, s)];
      ctx.fill();

      if (isSel) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
      }
    }

    /* 分隔线 */
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (s = 0; s < SEG; s++) {
      a0 = s * SEG_ANGLE + offset - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rIn, cy + Math.sin(a0) * rIn);
      ctx.lineTo(cx + Math.cos(a0) * rOut, cy + Math.sin(a0) * rOut);
      ctx.stroke();
    }

    /* 选中环描边 */
    if (isSel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rIn, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* 中心圆点 */
  ctx.beginPath();
  ctx.arc(cx, cy, layout.innerR * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = '#0d1220';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* 辐条对齐提示：已统一的辐条画一条淡光 */
  if (!game.won) {
    for (s = 0; s < SEG; s++) {
      var c0 = colorAt(0, s);
      var ok = true;
      for (i = 1; i < game.ringCount; i++) {
        if (colorAt(i, s) !== c0) { ok = false; break; }
      }
      if (!ok) { continue; }
      var ang = s * SEG_ANGLE - Math.PI / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (layout.innerR + 2),
                 cy + Math.sin(ang) * (layout.innerR + 2));
      ctx.lineTo(cx + Math.cos(ang) * (layout.outerR - 2),
                 cy + Math.sin(ang) * (layout.outerR - 2));
      ctx.stroke();
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawButton(rect, drawIcon) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(rect.x, rect.y, rect.w, rect.h, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawIcon(rect);
}

function drawArrowButton(rect, dir) {
  var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  var s = dir * 13;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + s, cy - 12);
  ctx.lineTo(cx - s, cy);
  ctx.lineTo(cx + s, cy + 12);
  ctx.closePath();
  ctx.fill();
}

function drawControls() {
  if (game.won) { return; }
  drawButton(layout.btnLeft, function (r) { drawArrowButton(r, -1); });
  drawButton(layout.btnRight, function (r) { drawArrowButton(r, 1); });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9fb3d1';
  ctx.font = '12px sans-serif';
  ctx.fillText('点击圆环选中 · 左右滑动或按按钮旋转',
    W / 2, layout.btnLeft.y - 16);
}

function drawWinOverlay() {
  ctx.fillStyle = 'rgba(8,12,24,0.78)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('通关！', W / 2, layout.cy - 60);

  ctx.font = '17px sans-serif';
  ctx.fillStyle = '#cfe0f5';
  ctx.fillText('第 ' + game.level + ' 关 · 步数 ' + game.moves +
    ' · 用时 ' + fmtTime(game.elapsed), W / 2, layout.cy - 16);

  ctx.font = '15px sans-serif';
  ctx.fillStyle = game.best === game.moves ? '#f1c40f' : '#9fb3d1';
  ctx.fillText(game.best === game.moves
    ? '★ 新纪录！最佳 ' + game.best + ' 步'
    : '本关最佳 ' + game.best + ' 步',
    W / 2, layout.cy + 14);

  drawButton(layout.btnNext, function (r) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('下一关', r.x + r.w / 2, r.y + r.h / 2);
  });
  drawButton(layout.btnReplay, function (r) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('重玩本关', r.x + r.w / 2, r.y + r.h / 2);
  });
}

/* ---------------------------------------------------------------- *
 * 主循环
 * ---------------------------------------------------------------- */

var lastFrame = Date.now();

function tick() {
  var now = Date.now();
  var dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  /* 角度补间动画 */
  for (var i = 0; i < game.rings.length; i++) {
    var ring = game.rings[i];
    var diff = ring.rot - ring.angle;
    if (Math.abs(diff) < 0.002) {
      ring.angle = ring.rot;
    } else {
      ring.angle += diff * Math.min(1, dt * 14);
    }
  }

  resetTransform();
  drawBackground(now / 1000);
  drawHUD();
  drawRings();
  drawControls();
  if (game.won) { drawWinOverlay(); }

  scheduleFrame(tick);
}

function scheduleFrame(fn) {
  if (typeof canvas.requestAnimationFrame === 'function') {
    canvas.requestAnimationFrame(fn);
  } else if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 16);
  }
}

/* ---------------------------------------------------------------- *
 * 启动
 * ---------------------------------------------------------------- */

ensureAudio();
setupLevel(1);
computeLayout();
tick();

};
__require("__entry__")("./game.js");
})();
