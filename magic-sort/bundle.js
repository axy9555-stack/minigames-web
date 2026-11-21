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
// Magic Sort — a magic-themed ball-sort puzzle for the WeChat mini-game runtime.
// Everything is drawn on the wx.createCanvas() 2D context; no DOM/BOM, no external assets.

var Logic = require('./js/logic.js');
var createAudio = require('./js/audio.js').createAudio;

// ---------------------------------------------------------------- system / canvas
function getInfo() {
  try { if (wx.getWindowInfo) return wx.getWindowInfo(); } catch (e) { /* fall through */ }
  return wx.getSystemInfoSync();
}
var sys = getInfo();
var W = sys.windowWidth || sys.screenWidth || 375;
var H = sys.windowHeight || sys.screenHeight || 667;
var DPR = sys.pixelRatio || 2;
var safeTop = (sys.safeArea && sys.safeArea.top) || sys.statusBarHeight || 20;
var safeBottom = sys.safeArea ? Math.max(0, H - sys.safeArea.bottom) : 0;
var capsule = null;
try {
  if (wx.getMenuButtonBoundingClientRect) {
    var cr = wx.getMenuButtonBoundingClientRect();
    if (cr && cr.width > 0 && cr.top >= 0) capsule = cr;
  }
} catch (e) { capsule = null; }

var canvas = wx.createCanvas(); // first call = on-screen canvas
canvas.width = Math.round(W * DPR);
canvas.height = Math.round(H * DPR);
var ctx = canvas.getContext('2d');

var raf = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };

function makeLayer(w, h) {
  var c = wx.createCanvas(); // later calls = offscreen canvases
  c.width = Math.max(1, Math.ceil(w * DPR));
  c.height = Math.max(1, Math.ceil(h * DPR));
  var g = c.getContext('2d');
  g.scale(DPR, DPR);
  return { canvas: c, ctx: g, w: w, h: h };
}

// ---------------------------------------------------------------- storage
var KEY_LEVEL = 'magicsort_level';
var KEY_BEST = 'magicsort_best';
var KEY_MUTED = 'magicsort_muted';
function load(key, def) {
  try {
    var v = wx.getStorageSync(key);
    return (v === '' || v === undefined || v === null) ? def : v;
  } catch (e) { return def; }
}
function save(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- palette
var COLORS = [
  { name: 'ruby', base: '#ff3b5c', light: '#ffc0cc', dark: '#7a0020' },
  { name: 'sapphire', base: '#3d7bff', light: '#c2d6ff', dark: '#0a2580' },
  { name: 'emerald', base: '#2ee59d', light: '#c4ffe6', dark: '#04683f' },
  { name: 'gold', base: '#ffd23f', light: '#fff6c4', dark: '#8f6200' },
  { name: 'moonstone', base: '#dfe6ff', light: '#ffffff', dark: '#5f6898' },
  { name: 'aqua', base: '#2fe3ff', light: '#cffaff', dark: '#006a84' },
  { name: 'amber', base: '#ff8a2b', light: '#ffd6b0', dark: '#842f00' },
  { name: 'rose', base: '#ff6fd8', light: '#ffd6f4', dark: '#83106a' }
];
function rgba(hex, a) {
  var n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

// ---------------------------------------------------------------- helpers
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutBack(t) { var c = 1.6; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function fmtTime(ms) {
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  s %= 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
function starPath(g, x, y, outer, inner, points, rot) {
  g.beginPath();
  for (var i = 0; i < points * 2; i++) {
    var r = i % 2 === 0 ? outer : inner;
    var a = (rot || -Math.PI / 2) + i * Math.PI / points;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}
function sparkle(g, x, y, s, color) { // 4-point twinkle
  if (s <= 0.2) return;
  g.fillStyle = color;
  starPath(g, x, y, s, s * 0.22, 4, 0);
  g.fill();
}
function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

// ---------------------------------------------------------------- HUD layout
var hud = {};
var buttons = [];
function computeHud() {
  var top = safeTop + 6;
  var titleH = 34;
  if (capsule) { top = capsule.top; titleH = capsule.height; }
  hud.titleY = top + titleH / 2;
  hud.titleRight = capsule ? capsule.left - 8 : W - 12;
  var pad = 14, gap = 8;
  var y = top + titleH + 10;
  var pw = (W - pad * 2 - gap * 2) / 3;
  hud.pills = [0, 1, 2].map(function (i) { return { x: pad + i * (pw + gap), y: y, w: pw, h: 36 }; });
  y += 36 + 10;
  buttons = ['undo', 'restart', 'mute'].map(function (id, i) {
    return { id: id, x: pad + i * (pw + gap), y: y, w: pw, h: 40 };
  });
  hud.bottom = y + 40 + 8;
}

// ---------------------------------------------------------------- board layout
// Flask geometry relative to (cx, by) where by is the bottom of the flask body, in units of d (orb diameter).
var CELL_H = 7.7;  // 1.9 lift space + 5.42 flask + 0.38 gap
var CELL_W = 1.75;
var layout = null;

function geometry(d) {
  return {
    d: d, r: d / 2,
    fw: 1.34 * d, nw: 0.72 * d, botR: 0.5 * d,
    bodyTop: -4.4 * d, shoulderTop: -4.82 * d, mouth: -5.42 * d,
    slot: function (i) { return -0.62 * d - i * 1.04 * d; }
  };
}

function computeLayout(n) {
  var areaX = 10, areaW = W - 20;
  var areaTop = hud.bottom + 4;
  var areaH = H - safeBottom - 10 - areaTop;
  var maxD = Math.min(52, W * 0.135);
  var best = null;
  for (var cols = 1; cols <= n; cols++) {
    var rows = Math.ceil(n / cols);
    var d = Math.min(areaW / cols / CELL_W, areaH / rows / CELL_H, maxD);
    if (!best || d > best.d + 0.5) best = { cols: cols, rows: rows, d: d };
  }
  var d0 = best.d, cols0 = best.cols, rows0 = best.rows;
  // balance rows (e.g. 7 flasks in 2 rows -> 4 + 3)
  var perRow = Math.ceil(n / rows0);
  var cellW = Math.min(areaW / cols0, d0 * 2.5);
  var cellH = d0 * CELL_H;
  var extra = areaH - rows0 * cellH;
  var startY = areaTop + extra * 0.4;
  var flasks = [];
  var idx = 0;
  for (var r = 0; r < rows0; r++) {
    var inRow = Math.min(perRow, n - idx);
    var rowW = inRow * cellW;
    var x0 = areaX + (areaW - rowW) / 2;
    var rowTop = startY + r * cellH;
    for (var c = 0; c < inRow; c++) {
      var cx = x0 + cellW * (c + 0.5);
      flasks.push({
        cx: cx,
        by: rowTop + cellH - 0.38 * d0,
        rect: { x: cx - cellW / 2, y: rowTop, w: cellW, h: cellH }
      });
      idx++;
    }
  }
  layout = { d: d0, g: geometry(d0), cols: cols0, rows: rows0, flasks: flasks, sprites: buildSprites(d0) };
}

// ---------------------------------------------------------------- sprites (pre-rendered per layout)
function flaskPath(g, cx, by, G) {
  var hw = G.fw / 2, nw2 = G.nw / 2, r = G.botR;
  g.beginPath();
  g.moveTo(cx - nw2, by + G.mouth);
  g.lineTo(cx - nw2, by + G.shoulderTop);
  g.quadraticCurveTo(cx - hw, by + G.shoulderTop, cx - hw, by + G.bodyTop);
  g.lineTo(cx - hw, by - r);
  g.quadraticCurveTo(cx - hw, by, cx - hw + r, by);
  g.lineTo(cx + hw - r, by);
  g.quadraticCurveTo(cx + hw, by, cx + hw, by - r);
  g.lineTo(cx + hw, by + G.bodyTop);
  g.quadraticCurveTo(cx + hw, by + G.shoulderTop, cx + nw2, by + G.shoulderTop);
  g.lineTo(cx + nw2, by + G.mouth);
}

function buildSprites(d) {
  var G = geometry(d);
  var sw = G.fw + 0.8 * d, sh = -G.mouth + 0.5 * d;
  var ox = sw / 2, oy = sh - 0.3 * d; // where (cx, by) lands inside the sprite
  var lw = Math.max(1.5, d * 0.055);

  // glass back
  var back = makeLayer(sw, sh);
  var g = back.ctx;
  flaskPath(g, ox, oy, G);
  g.closePath();
  var grad = g.createLinearGradient(ox - G.fw / 2, 0, ox + G.fw / 2, 0);
  grad.addColorStop(0, 'rgba(190,170,255,0.24)');
  grad.addColorStop(0.5, 'rgba(120,90,220,0.07)');
  grad.addColorStop(1, 'rgba(190,170,255,0.2)');
  g.fillStyle = grad;
  g.fill();
  var glow = g.createRadialGradient(ox, oy - 0.4 * d, 0, ox, oy - 0.4 * d, G.fw * 0.8);
  glow.addColorStop(0, 'rgba(200,160,255,0.18)');
  glow.addColorStop(1, 'rgba(200,160,255,0)');
  g.fillStyle = glow;
  g.fill();

  // glass front: shine, outline, rim
  var front = makeLayer(sw, sh);
  g = front.ctx;
  g.save();
  flaskPath(g, ox, oy, G);
  g.closePath();
  g.clip();
  var sx = ox - G.fw / 2 + 0.13 * d;
  var shine = g.createLinearGradient(0, oy + G.bodyTop, 0, oy);
  shine.addColorStop(0, 'rgba(255,255,255,0.5)');
  shine.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  roundRect(g, sx, oy + G.bodyTop + 0.1 * d, 0.13 * d, -G.bodyTop - 0.6 * d, 0.06 * d);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(g, ox + G.fw / 2 - 0.22 * d, oy + G.bodyTop + 0.3 * d, 0.07 * d, 1.2 * d, 0.03 * d);
  g.fill();
  g.restore();
  flaskPath(g, ox, oy, G);
  g.strokeStyle = 'rgba(225,210,255,0.8)';
  g.lineWidth = lw;
  g.lineJoin = 'round';
  g.stroke();
  // rim / lip
  g.fillStyle = 'rgba(225,210,255,0.85)';
  roundRect(g, ox - G.nw / 2 - 0.09 * d, oy + G.mouth - 0.06 * d, G.nw + 0.18 * d, 0.14 * d, 0.07 * d);
  g.fill();

  // corks
  function cork(sealed) {
    var size = 1.3 * d;
    var L = makeLayer(size, size);
    var c = L.ctx;
    var cw = G.nw * 0.84, ch = 0.5 * d;
    c.translate(size / 2, size / 2);
    if (!sealed) c.rotate(-0.16);
    var cg = c.createLinearGradient(-cw / 2, 0, cw / 2, 0);
    cg.addColorStop(0, '#7a4a22');
    cg.addColorStop(0.35, '#c98e55');
    cg.addColorStop(1, '#6b3d1a');
    c.fillStyle = cg;
    roundRect(c, -cw / 2, -ch / 2, cw, ch, 0.08 * d);
    c.fill();
    c.fillStyle = 'rgba(60,30,10,0.5)';
    var dots = [[-0.18, -0.08], [0.1, 0.06], [0.2, -0.12], [-0.05, 0.14], [-0.2, 0.12]];
    for (var i = 0; i < dots.length; i++) {
      c.beginPath();
      c.arc(dots[i][0] * cw * 1.4, dots[i][1] * ch * 1.6, 0.025 * d + 0.4, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(255,230,190,0.35)';
    roundRect(c, -cw / 2 + 0.05 * d, -ch / 2 + 0.04 * d, cw - 0.1 * d, 0.07 * d, 0.03 * d);
    c.fill();
    if (sealed) {
      c.fillStyle = '#ffcf4a';
      c.fillRect(-cw / 2, ch * 0.12, cw, 0.09 * d);
    }
    return L;
  }

  // orbs
  var orbs = COLORS.map(function (col) {
    var s = 1.9 * d;
    var L = makeLayer(s, s);
    var c = L.ctx;
    var o = s / 2, r = d * 0.47;
    var gl = c.createRadialGradient(o, o, r * 0.5, o, o, s / 2);
    gl.addColorStop(0, rgba(col.base, 0.6));
    gl.addColorStop(0.5, rgba(col.base, 0.18));
    gl.addColorStop(1, rgba(col.base, 0));
    c.fillStyle = gl;
    c.beginPath(); c.arc(o, o, s / 2, 0, Math.PI * 2); c.fill();
    var sg = c.createRadialGradient(o - r * 0.35, o - r * 0.4, r * 0.05, o, o, r);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.2, col.light);
    sg.addColorStop(0.62, col.base);
    sg.addColorStop(1, col.dark);
    c.fillStyle = sg;
    c.beginPath(); c.arc(o, o, r, 0, Math.PI * 2); c.fill();
    // inner swirl of magic
    c.strokeStyle = rgba(col.light, 0.45);
    c.lineWidth = Math.max(1, d * 0.04);
    c.beginPath(); c.arc(o + r * 0.05, o + r * 0.1, r * 0.55, 0.4, 2.3); c.stroke();
    // bottom rim light
    c.strokeStyle = rgba(col.light, 0.5);
    c.beginPath(); c.arc(o, o, r * 0.86, 0.9, 2.2); c.stroke();
    // specular
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.beginPath(); c.ellipse
      ? c.ellipse(o - r * 0.32, o - r * 0.45, r * 0.26, r * 0.14, -0.5, 0, Math.PI * 2)
      : c.arc(o - r * 0.32, o - r * 0.45, r * 0.18, 0, Math.PI * 2);
    c.fill();
    return L;
  });

  return { back: back, front: front, ox: ox, oy: oy, sw: sw, sh: sh,
    corkOpen: cork(false), corkSealed: cork(true), orbs: orbs, orbSize: 1.9 * d };
}

// ---------------------------------------------------------------- background
var bgLayer = null;
var stars = [];
function buildBackground() {
  bgLayer = makeLayer(W, H);
  var g = bgLayer.ctx;
  var grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#12062e');
  grad.addColorStop(0.45, '#2a0e56');
  grad.addColorStop(0.8, '#3a1366');
  grad.addColorStop(1, '#14072c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  var blobs = [[0.2, 0.35, 0.5, 'rgba(255,90,200,0.10)'], [0.85, 0.6, 0.55, 'rgba(80,120,255,0.10)'],
    [0.4, 0.8, 0.45, 'rgba(160,80,255,0.12)']];
  blobs.forEach(function (b) {
    var rg = g.createRadialGradient(W * b[0], H * b[1], 0, W * b[0], H * b[1], W * b[2]);
    rg.addColorStop(0, b[3]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  });
  // crescent moon
  var mx = W * 0.82, my = hud.bottom + 34, mr = Math.min(28, W * 0.07);
  var halo = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3.2);
  halo.addColorStop(0, 'rgba(255,240,190,0.28)');
  halo.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = halo;
  g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  var moon = makeLayer(mr * 2 + 4, mr * 2 + 4);
  var m = moon.ctx;
  var mg = m.createRadialGradient(mr - mr * 0.3, mr - mr * 0.3, 1, mr + 2, mr + 2, mr);
  mg.addColorStop(0, '#fffbe8');
  mg.addColorStop(1, '#f3d98a');
  m.fillStyle = mg;
  m.beginPath(); m.arc(mr + 2, mr + 2, mr, 0, Math.PI * 2); m.fill();
  m.globalCompositeOperation = 'destination-out';
  m.beginPath(); m.arc(mr + 2 + mr * 0.5, mr + 2 - mr * 0.25, mr * 0.88, 0, Math.PI * 2); m.fill();
  g.drawImage(moon.canvas, mx - mr - 2, my - mr - 2, mr * 2 + 4, mr * 2 + 4);
  // distant hills + wizard tower silhouette
  var hy = H - safeBottom;
  g.fillStyle = 'rgba(12,4,32,0.85)';
  g.beginPath();
  g.moveTo(0, hy);
  g.lineTo(0, hy - H * 0.06);
  g.quadraticCurveTo(W * 0.2, hy - H * 0.11, W * 0.42, hy - H * 0.06);
  g.quadraticCurveTo(W * 0.65, hy - H * 0.01, W * 0.82, hy - H * 0.08);
  g.quadraticCurveTo(W * 0.92, hy - H * 0.11, W, hy - H * 0.07);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();
  var tx = W * 0.14, tw = W * 0.05, tb = hy - H * 0.08, th = H * 0.09;
  g.fillRect(tx - tw / 2, tb - th, tw, th + 4);
  g.beginPath();
  g.moveTo(tx - tw * 0.8, tb - th);
  g.lineTo(tx, tb - th - tw * 2.2);
  g.lineTo(tx + tw * 0.8, tb - th);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,210,120,0.8)';
  g.fillRect(tx - tw * 0.15, tb - th * 0.7, tw * 0.3, tw * 0.45);
  if (H > 0) {
    g.fillStyle = 'rgba(8,2,24,1)';
    g.fillRect(0, H - safeBottom, W, safeBottom);
  }

  stars = [];
  for (var i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * W, y: Math.random() * H * 0.92,
      s: 0.4 + Math.random() * 1.4, p: Math.random() * Math.PI * 2, v: 0.8 + Math.random() * 2.2,
      big: Math.random() < 0.12
    });
  }
}

function drawBackground(now) {
  ctx.drawImage(bgLayer.canvas, 0, 0, W, H);
  var t = now / 1000;
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    var a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.v + s.p));
    if (s.big) {
      sparkle(ctx, s.x, s.y, s.s * 3.2 * (0.5 + a * 0.6), 'rgba(255,245,220,' + a.toFixed(3) + ')');
    } else {
      ctx.fillStyle = 'rgba(255,250,240,' + a.toFixed(3) + ')';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
  }
}

// ---------------------------------------------------------------- game state
var audio = createAudio();
audio.setMuted(!!load(KEY_MUTED, false));

var state = {
  level: 1,
  board: [],
  initial: [],
  colors: 3,
  moves: 0,
  undo: [],
  sel: null,         // { i, count, color, t0 }
  flights: [],       // orbs in the air
  hidden: [],        // per flask: top orbs currently represented by flights
  complete: [],      // per flask: completion flag (for detecting newly completed flasks)
  shakes: [],        // per flask: shake start time
  particles: [],
  rings: [],
  timerBase: 0,
  timerStart: 0,
  timerRunning: false,
  won: false,
  winAt: 0,
  winInfo: null,
  pressed: null
};
var overlayButtons = [];

function elapsed(now) {
  return state.timerBase + (state.timerRunning ? now - state.timerStart : 0);
}

function resetPlayState(board) {
  state.board = Logic.cloneBoard(board);
  state.moves = 0;
  state.undo = [];
  state.sel = null;
  state.flights = [];
  state.particles = [];
  state.rings = [];
  state.hidden = board.map(function () { return 0; });
  state.shakes = board.map(function () { return -1e9; });
  state.complete = state.board.map(Logic.isFlaskComplete);
  state.timerBase = 0;
  state.timerStart = Date.now();
  state.timerRunning = true;
  state.won = false;
  state.winInfo = null;
}

function startLevel(level) {
  state.level = Math.max(1, Math.floor(level) || 1);
  var lv = Logic.generateLevel(state.level);
  state.colors = lv.colors;
  state.initial = Logic.cloneBoard(lv.board);
  save(KEY_LEVEL, state.level);
  computeLayout(lv.board.length);
  resetPlayState(state.initial);
}

function replayLevel() {
  save(KEY_LEVEL, state.level);
  resetPlayState(state.initial);
}

// ---------------------------------------------------------------- positions
function slotPos(f, slot) {
  var F = layout.flasks[f];
  return { x: F.cx, y: F.by + layout.g.slot(slot) };
}

function shakeOffset(f, now) {
  var dt = now - state.shakes[f];
  if (dt < 0 || dt > 320) return 0;
  return Math.sin(dt / 320 * Math.PI * 6) * layout.d * 0.13 * (1 - dt / 320);
}

// Current lifted orb positions (bottom of run first).
function liftedPositions(now) {
  var sel = state.sel;
  if (!sel) return [];
  var G = layout.g, F = layout.flasks[sel.i];
  var len = state.board[sel.i].length;
  var topY = F.by + G.slot(len - 1);
  var liftTop = F.by + G.mouth - 1.2 * layout.d;
  var p = clamp((now - sel.t0) / 200, 0, 1);
  var off = (topY - liftTop) * easeOutBack(p);
  var bob = p >= 1 ? Math.sin((now - sel.t0) / 260) * layout.d * 0.05 : 0;
  var sx = shakeOffset(sel.i, now);
  var out = [];
  for (var k = 0; k < sel.count; k++) {
    var slot = len - sel.count + k;
    out.push({ x: F.cx + sx, y: F.by + G.slot(slot) - off + bob });
  }
  return out;
}

// ---------------------------------------------------------------- actions
function addFlight(color, from, to, toFlask, delay, now) {
  var dx = Math.abs(to.x - from.x);
  state.flights.push({
    color: color, x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    arc: dx < 1 ? 0 : layout.d * 1.1 + dx * 0.15,
    t0: now + delay, dur: dx < 1 ? 170 : 230, flask: toFlask
  });
  state.hidden[toFlask]++;
}

function landFlight(fl, quiet) {
  state.hidden[fl.flask] = Math.max(0, state.hidden[fl.flask] - 1);
  if (!quiet) audio.pop();
  if (state.hidden[fl.flask] === 0) checkFlaskComplete(fl.flask);
}

function finishFlights() {
  if (!state.flights.length) return;
  var list = state.flights;
  state.flights = [];
  for (var i = 0; i < list.length; i++) landFlight(list[i], i > 0);
  checkWin(Date.now());
}

function checkFlaskComplete(f) {
  var done = Logic.isFlaskComplete(state.board[f]);
  if (done && !state.complete[f]) burst(f);
  state.complete[f] = done;
}

function burst(f) {
  var F = layout.flasks[f], G = layout.g, d = layout.d;
  var col = COLORS[state.board[f][0]];
  var cy = F.by + G.bodyTop * 0.6;
  for (var i = 0; i < 40; i++) {
    var a = Math.random() * Math.PI * 2;
    var sp = (0.6 + Math.random() * 1.8) * d * 0.09;
    state.particles.push({
      x: F.cx + (Math.random() - 0.5) * G.fw, y: cy + (Math.random() - 0.5) * -G.bodyTop * 0.8,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - d * 0.06,
      life: 0, max: 700 + Math.random() * 700,
      size: d * (0.08 + Math.random() * 0.14),
      color: Math.random() < 0.3 ? '#fff3b0' : col.light, g: d * 0.0025
    });
  }
  state.rings.push({ x: F.cx, y: cy, t0: Date.now(), color: col.base });
  audio.chime();
}

function checkWin(now) {
  if (state.won || state.flights.length || state.sel) return;
  if (!Logic.isSolved(state.board)) return;
  state.won = true;
  state.winAt = now;
  state.timerBase = elapsed(now);
  state.timerRunning = false;
  var best = load(KEY_BEST, {});
  if (typeof best !== 'object' || !best) best = {};
  var prev = best[state.level];
  var record = !prev || state.moves < prev;
  if (record) { best[state.level] = state.moves; save(KEY_BEST, best); }
  state.winInfo = { moves: state.moves, time: state.timerBase, best: best[state.level], record: record && !!prev, first: !prev };
  save(KEY_LEVEL, state.level + 1); // resume at the next level if the game is closed now
  setTimeout(function () { audio.win(); }, 350);
}

function putBack(now) {
  var sel = state.sel;
  var pos = liftedPositions(now);
  var len = state.board[sel.i].length;
  state.sel = null;
  for (var k = 0; k < sel.count; k++) {
    addFlight(sel.color, pos[k], slotPos(sel.i, len - sel.count + k), sel.i, 0, now);
  }
}

function tapFlask(i, now) {
  finishFlights();
  if (state.won) return;
  var sel = state.sel;
  if (!sel) {
    var run = Logic.topRun(state.board[i]);
    if (!run) { state.shakes[i] = now; audio.bump(); return; }
    state.sel = { i: i, count: run.count, color: run.color, t0: now };
    audio.lift();
    return;
  }
  if (sel.i === i) { putBack(now); return; }
  var n = Logic.movableCount(state.board, sel.i, i);
  if (n === 0) { state.shakes[i] = now; audio.bump(); return; }

  var pos = liftedPositions(now); // bottom of run first
  state.undo.push({ board: Logic.cloneBoard(state.board), moves: state.moves });
  var targetLen = state.board[i].length;
  var srcLen = state.board[sel.i].length;
  Logic.applyMove(state.board, sel.i, i);
  state.moves++;
  state.sel = null;
  // the topmost lifted orb leaves first and lands lowest in the target
  for (var k = 0; k < n; k++) {
    var p = pos[pos.length - 1 - k];
    addFlight(sel.color, p, slotPos(i, targetLen + k), i, k * 50, now);
  }
  // leftovers that did not fit drop back into the source flask
  var rest = sel.count - n;
  for (var j = 0; j < rest; j++) {
    addFlight(sel.color, pos[j], slotPos(sel.i, srcLen - sel.count + j), sel.i, 60, now);
  }
  state.complete[sel.i] = Logic.isFlaskComplete(state.board[sel.i]);
}

function doUndo() {
  if (state.won) return;
  state.flights = [];
  state.sel = null;
  var snap = state.undo.pop();
  if (!snap) return;
  state.board = snap.board;
  state.moves = snap.moves;
  state.hidden = state.board.map(function () { return 0; });
  state.complete = state.board.map(Logic.isFlaskComplete);
  audio.lift();
}

function doRestart() {
  replayLevel();
  audio.lift();
}

function toggleMute() {
  audio.setMuted(!audio.isMuted());
  save(KEY_MUTED, audio.isMuted());
  audio.lift();
}

// ---------------------------------------------------------------- input
function touchPoint(e) {
  var t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
  if (!t) return null;
  var x = t.clientX !== undefined ? t.clientX : (t.pageX !== undefined ? t.pageX : t.x);
  var y = t.clientY !== undefined ? t.clientY : (t.pageY !== undefined ? t.pageY : t.y);
  return { x: x, y: y };
}

function overlayVisible(now) { return state.won && now - state.winAt > 500; }

function buttonAt(x, y, now) {
  var list = state.won ? (overlayVisible(now) ? overlayButtons : []) : buttons;
  for (var i = 0; i < list.length; i++) if (inRect(x, y, list[i])) return list[i];
  return null;
}

wx.onTouchStart(function (e) {
  audio.resume();
  var p = touchPoint(e);
  if (!p) return;
  var now = Date.now();
  var b = buttonAt(p.x, p.y, now);
  if (b) { state.pressed = b.id; return; }
  if (state.won) return;
  for (var i = 0; i < layout.flasks.length; i++) {
    if (inRect(p.x, p.y, layout.flasks[i].rect)) { tapFlask(i, now); return; }
  }
  if (state.sel) { finishFlights(); putBack(now); } // tap on empty space cancels the lift
});

wx.onTouchMove(function (e) {
  if (!state.pressed) return;
  var p = touchPoint(e);
  var b = p && buttonAt(p.x, p.y, Date.now());
  if (!b || b.id !== state.pressed) state.pressed = null;
});

wx.onTouchEnd(function (e) {
  var id = state.pressed;
  state.pressed = null;
  if (!id) return;
  var p = touchPoint(e);
  var b = p && buttonAt(p.x, p.y, Date.now());
  if (!b || b.id !== id) return;
  if (id === 'undo') doUndo();
  else if (id === 'restart') doRestart();
  else if (id === 'mute') toggleMute();
  else if (id === 'next') startLevel(state.level + 1);
  else if (id === 'replay') replayLevel();
});

if (wx.onTouchCancel) wx.onTouchCancel(function () { state.pressed = null; });

if (wx.onHide) wx.onHide(function () {
  if (state.timerRunning) { state.timerBase = elapsed(Date.now()); state.timerRunning = false; state.paused = true; }
});
if (wx.onShow) wx.onShow(function () {
  if (state.paused && !state.won) { state.timerStart = Date.now(); state.timerRunning = true; }
  state.paused = false;
});

// ---------------------------------------------------------------- update
function update(now, dt) {
  // flights
  if (state.flights.length) {
    var keep = [];
    var landed = false;
    for (var i = 0; i < state.flights.length; i++) {
      var fl = state.flights[i];
      if (now - fl.t0 >= fl.dur) { landFlight(fl, false); landed = true; } else keep.push(fl);
    }
    state.flights = keep;
    if (landed && !keep.length) checkWin(now);
  }
  // particles
  var ps = state.particles;
  for (var j = ps.length - 1; j >= 0; j--) {
    var q = ps[j];
    q.life += dt;
    if (q.life >= q.max) { ps.splice(j, 1); continue; }
    var k = dt / 16.67;
    q.vy += q.g * k;
    q.vx *= Math.pow(0.985, k);
    q.x += q.vx * k;
    q.y += q.vy * k;
  }
  state.rings = state.rings.filter(function (r) { return now - r.t0 < 600; });
  if (overlayVisible(now) && ps.length < 140) {
    for (var m = 0; m < 2; m++) {
      var c = COLORS[Math.floor(Math.random() * COLORS.length)];
      ps.push({
        x: Math.random() * W, y: H * 0.1 + Math.random() * H * 0.3,
        vx: (Math.random() - 0.5) * 1.2, vy: -0.5 - Math.random(),
        life: 0, max: 1200 + Math.random() * 900, size: 3 + Math.random() * 6,
        color: Math.random() < 0.4 ? '#fff3b0' : c.light, g: 0.03
      });
    }
  }
}

// ---------------------------------------------------------------- render
function drawOrb(color, x, y, now, seed, scale) {
  var S = layout.sprites;
  var s = S.orbSize * (scale || 1);
  ctx.drawImage(S.orbs[color].canvas, x - s / 2, y - s / 2, s, s);
  var r = layout.d * 0.47;
  var tw = 0.5 + 0.5 * Math.sin(now / 340 + seed * 1.7);
  sparkle(ctx, x - r * 0.42, y - r * 0.5, r * (0.12 + 0.22 * tw), 'rgba(255,255,255,' + (0.5 + 0.5 * tw).toFixed(3) + ')');
}

function drawFlasks(now) {
  var S = layout.sprites, G = layout.g, d = layout.d;
  for (var i = 0; i < layout.flasks.length; i++) {
    var F = layout.flasks[i];
    var flask = state.board[i];
    var sx = shakeOffset(i, now);
    var cx = F.cx + sx;
    var lifted = state.sel && state.sel.i === i ? state.sel.count : 0;
    var complete = state.complete[i] && state.hidden[i] === 0 && !lifted;
    if (complete) {
      var col = COLORS[flask[0]];
      var pulse = 0.75 + 0.25 * Math.sin(now / 400 + i);
      var gy = F.by + G.bodyTop / 2;
      var hg = ctx.createRadialGradient(cx, gy, 0, cx, gy, d * 2.4);
      hg.addColorStop(0, rgba(col.base, 0.32 * pulse));
      hg.addColorStop(1, rgba(col.base, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(cx - d * 2.4, gy - d * 2.4, d * 4.8, d * 4.8);
    }
    ctx.drawImage(S.back.canvas, cx - S.ox, F.by - S.oy, S.sw, S.sh);
    var visible = flask.length - state.hidden[i] - lifted;
    for (var k = 0; k < visible; k++) drawOrb(flask[k], cx, F.by + G.slot(k), now, i * 4 + k);
    ctx.drawImage(S.front.canvas, cx - S.ox, F.by - S.oy, S.sw, S.sh);
    var cs = 1.3 * d;
    if (complete) {
      ctx.fillStyle = '#ffcf4a';
      roundRect(ctx, cx - G.nw / 2 - 0.09 * d, F.by + G.mouth - 0.06 * d, G.nw + 0.18 * d, 0.14 * d, 0.07 * d);
      ctx.fill();
      ctx.drawImage(S.corkSealed.canvas, cx - cs / 2, F.by + G.mouth - 0.13 * d - cs / 2, cs, cs);
    } else {
      ctx.drawImage(S.corkOpen.canvas, cx + 0.05 * d - cs / 2, F.by + G.mouth - 0.36 * d - cs / 2, cs, cs);
    }
    if (lifted) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,215,110,0.95)';
      ctx.shadowBlur = d * 0.4;
      ctx.strokeStyle = 'rgba(255,225,140,' + (0.65 + 0.3 * Math.sin(now / 150)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2, d * 0.07);
      ctx.lineJoin = 'round';
      flaskPath(ctx, cx, F.by, G);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawLifted(now) {
  if (!state.sel) return;
  var pos = liftedPositions(now);
  var d = layout.d;
  for (var k = 0; k < pos.length; k++) {
    var p = pos[k];
    var a = 0.35 + 0.25 * Math.sin(now / 160 + k);
    var hg = ctx.createRadialGradient(p.x, p.y, d * 0.4, p.x, p.y, d * 0.85);
    hg.addColorStop(0, 'rgba(255,240,200,' + a.toFixed(3) + ')');
    hg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(p.x, p.y, d * 0.85, 0, Math.PI * 2); ctx.fill();
    drawOrb(state.sel.color, p.x, p.y, now, 99 + k, 1.05);
  }
}

function drawFlights(now) {
  for (var i = 0; i < state.flights.length; i++) {
    var fl = state.flights[i];
    var t = clamp((now - fl.t0) / fl.dur, 0, 1);
    var e = easeInOut(t);
    var x = lerp(fl.x0, fl.x1, e);
    var cy = Math.min(fl.y0, fl.y1) - fl.arc;
    var u = 1 - e;
    var y = fl.arc ? u * u * fl.y0 + 2 * u * e * cy + e * e * fl.y1 : lerp(fl.y0, fl.y1, e);
    drawOrb(fl.color, x, y, now, 50 + i);
  }
}

function drawParticles(now) {
  if (!state.particles.length && !state.rings.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (var r = 0; r < state.rings.length; r++) {
    var ring = state.rings[r];
    var t = (now - ring.t0) / 600;
    ctx.strokeStyle = rgba(ring.color, (1 - t) * 0.8);
    ctx.lineWidth = 3 * (1 - t) + 0.5;
    ctx.beginPath(); ctx.arc(ring.x, ring.y, layout.d * (0.5 + t * 2.4), 0, Math.PI * 2); ctx.stroke();
  }
  for (var i = 0; i < state.particles.length; i++) {
    var q = state.particles[i];
    var k = 1 - q.life / q.max;
    ctx.globalAlpha = clamp(k * 1.4, 0, 1);
    sparkle(ctx, q.x, q.y, q.size * (0.4 + 0.6 * k), q.color);
  }
  ctx.restore();
}

function drawWandIcon(x, y, s) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3b2160';
  ctx.lineWidth = s * 0.2;
  ctx.beginPath(); ctx.moveTo(x - s * 0.45, y + s * 0.45); ctx.lineTo(x + s * 0.2, y - s * 0.2); ctx.stroke();
  ctx.strokeStyle = '#f2e6ff';
  ctx.lineWidth = s * 0.2;
  ctx.beginPath(); ctx.moveTo(x + s * 0.08, y - s * 0.08); ctx.lineTo(x + s * 0.2, y - s * 0.2); ctx.stroke();
  ctx.shadowColor = 'rgba(255,220,100,0.9)';
  ctx.shadowBlur = s * 0.5;
  ctx.fillStyle = '#ffd84a';
  starPath(ctx, x + s * 0.32, y - s * 0.32, s * 0.32, s * 0.13, 5);
  ctx.fill();
  ctx.restore();
}

function drawIcon(id, x, y, s) {
  ctx.save();
  ctx.strokeStyle = '#f4ecff';
  ctx.fillStyle = '#f4ecff';
  ctx.lineWidth = Math.max(1.6, s * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (id === 'undo') {
    ctx.beginPath(); ctx.arc(x + s * 0.05, y + s * 0.08, s * 0.38, Math.PI * 1.05, Math.PI * 2.35); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y - s * 0.12); ctx.lineTo(x - s * 0.33, y + s * 0.22); ctx.lineTo(x - s * 0.08, y - s * 0.02);
    ctx.stroke();
  } else if (id === 'restart') {
    ctx.beginPath(); ctx.arc(x, y, s * 0.38, -Math.PI * 0.35, Math.PI * 1.45); ctx.stroke();
    var ax = x + Math.cos(-Math.PI * 0.35) * s * 0.38, ay = y + Math.sin(-Math.PI * 0.35) * s * 0.38;
    ctx.beginPath();
    ctx.moveTo(ax - s * 0.3, ay - s * 0.08); ctx.lineTo(ax + s * 0.02, ay + s * 0.02); ctx.lineTo(ax + s * 0.02, ay - s * 0.3);
    ctx.stroke();
  } else if (id === 'mute') {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y - s * 0.15); ctx.lineTo(x - s * 0.28, y - s * 0.15); ctx.lineTo(x, y - s * 0.4);
    ctx.lineTo(x, y + s * 0.4); ctx.lineTo(x - s * 0.28, y + s * 0.15); ctx.lineTo(x - s * 0.5, y + s * 0.15);
    ctx.closePath(); ctx.fill();
    if (audio.isMuted()) {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.15, y - s * 0.2); ctx.lineTo(x + s * 0.5, y + s * 0.2);
      ctx.moveTo(x + s * 0.5, y - s * 0.2); ctx.lineTo(x + s * 0.15, y + s * 0.2);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x + s * 0.02, y, s * 0.25, -0.8, 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + s * 0.02, y, s * 0.48, -0.8, 0.8); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawButton(b, label, primary) {
  var pressed = state.pressed === b.id;
  ctx.save();
  if (pressed) { ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(0.95, 0.95); ctx.translate(-b.x - b.w / 2, -b.y - b.h / 2); }
  var g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  if (primary) { g.addColorStop(0, '#ffe07a'); g.addColorStop(1, '#e79a1f'); }
  else { g.addColorStop(0, 'rgba(150,100,255,0.45)'); g.addColorStop(1, 'rgba(80,40,170,0.45)'); }
  ctx.fillStyle = g;
  roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fill();
  ctx.strokeStyle = primary ? 'rgba(255,245,200,0.9)' : 'rgba(210,190,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
  return pressed;
}

function drawHud(now) {
  // title
  var ts = 22;
  drawWandIcon(24, hud.titleY, ts);
  ctx.save();
  ctx.font = 'italic bold ' + ts + 'px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(255,170,255,0.8)';
  ctx.shadowBlur = 10;
  var tg = ctx.createLinearGradient(0, hud.titleY - ts / 2, 0, hud.titleY + ts / 2);
  tg.addColorStop(0, '#fff6d6');
  tg.addColorStop(1, '#ffb8f0');
  ctx.fillStyle = tg;
  ctx.fillText('Magic Sort', 44, hud.titleY + 1);
  ctx.restore();

  // stat pills
  var stats = [['LEVEL', String(state.level)], ['MOVES', String(state.moves)], ['TIME', fmtTime(elapsed(now))]];
  for (var i = 0; i < 3; i++) {
    var p = hud.pills[i];
    ctx.fillStyle = 'rgba(20,6,50,0.55)';
    roundRect(ctx, p.x, p.y, p.w, p.h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,170,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(220,200,255,0.75)';
    ctx.fillText(stats[i][0], p.x + 10, p.y + p.h / 2);
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#fff4d2';
    ctx.fillText(stats[i][1], p.x + p.w - 10, p.y + p.h / 2 + 1);
  }

  // buttons
  var labels = { undo: 'Undo', restart: 'Restart', mute: audio.isMuted() ? 'Muted' : 'Sound' };
  for (var j = 0; j < buttons.length; j++) {
    var b = buttons[j];
    var disabled = b.id === 'undo' && !state.undo.length;
    ctx.save();
    if (disabled) ctx.globalAlpha = 0.45;
    drawButton(b, labels[b.id], false);
    ctx.font = 'bold 14px sans-serif';
    var tw = ctx.measureText(labels[b.id]).width;
    var total = 18 + 6 + tw;
    var x0 = b.x + (b.w - total) / 2;
    drawIcon(b.id, x0 + 9, b.y + b.h / 2, 18);
    ctx.fillStyle = '#f4ecff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[b.id], x0 + 24, b.y + b.h / 2 + 1);
    ctx.restore();
  }
}

function drawOverlay(now) {
  if (!overlayVisible(now)) return;
  var t = (now - state.winAt - 500) / 1000;
  var fade = clamp(t / 0.3, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = 'rgba(8,0,24,0.72)';
  ctx.fillRect(0, 0, W, H);

  var pw = Math.min(W - 40, 340), ph = 330;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  var sc = easeOutBack(clamp(t / 0.35, 0, 1));
  ctx.translate(W / 2, H / 2);
  ctx.scale(sc, sc);
  ctx.translate(-W / 2, -H / 2);

  var pg = ctx.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, '#4a1d8c');
  pg.addColorStop(1, '#22094d');
  ctx.shadowColor = 'rgba(255,170,255,0.6)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = pg;
  roundRect(ctx, px, py, pw, ph, 22);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,220,140,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic bold 26px serif';
  ctx.fillStyle = '#fff3c4';
  ctx.fillText('Spell Complete!', W / 2, py + 38);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = 'rgba(230,210,255,0.85)';
  ctx.fillText('Level ' + state.level + ' sorted', W / 2, py + 66);

  // stars
  for (var i = 0; i < 3; i++) {
    var st = clamp((t - 0.25 - i * 0.18) / 0.3, 0, 1);
    if (st <= 0) continue;
    var s = easeOutBack(st) * (i === 1 ? 28 : 22);
    var sx = W / 2 + (i - 1) * 62, sy = py + 112 - (i === 1 ? 8 : 0);
    ctx.save();
    ctx.shadowColor = 'rgba(255,215,80,0.95)';
    ctx.shadowBlur = 16;
    var sg = ctx.createRadialGradient(sx, sy - s * 0.3, 1, sx, sy, s);
    sg.addColorStop(0, '#fffbe0');
    sg.addColorStop(1, '#ffb915');
    ctx.fillStyle = sg;
    starPath(ctx, sx, sy, s, s * 0.45, 5);
    ctx.fill();
    ctx.restore();
  }

  var info = state.winInfo;
  var rows = [['Moves', String(info.moves)], ['Time', fmtTime(info.time)], ['Best', info.best + ' moves']];
  ctx.font = '16px sans-serif';
  for (var r = 0; r < rows.length; r++) {
    var ry = py + 160 + r * 28;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(220,200,255,0.85)';
    ctx.fillText(rows[r][0], px + 40, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff4d2';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(rows[r][1], px + pw - 40, ry);
    ctx.font = '16px sans-serif';
  }
  if (info.record) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#7dffc4';
    ctx.fillText('New best!', W / 2, py + 236);
  }

  var bw = (pw - 60) / 2, bh = 46, by = py + ph - bh - 24;
  overlayButtons = [
    { id: 'replay', x: px + 20, y: by, w: bw, h: bh },
    { id: 'next', x: px + 40 + bw, y: by, w: bw, h: bh }
  ];
  drawButton(overlayButtons[0], 'Replay', false);
  drawButton(overlayButtons[1], 'Next Level', true);
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#f4ecff';
  ctx.fillText('Replay', overlayButtons[0].x + bw / 2, by + bh / 2 + 1);
  ctx.fillStyle = '#4a1d00';
  ctx.fillText('Next Level', overlayButtons[1].x + bw / 2, by + bh / 2 + 1);
  ctx.restore();
}

function render(now) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  drawBackground(now);
  drawFlasks(now);
  drawLifted(now);
  drawFlights(now);
  drawHud(now);
  if (!state.won) drawParticles(now);
  drawOverlay(now);
  if (state.won) drawParticles(now);
}

// ---------------------------------------------------------------- boot
computeHud();
buildBackground();
startLevel(load(KEY_LEVEL, 1));

var last = Date.now();
function frame() {
  var now = Date.now();
  var dt = Math.min(50, now - last);
  last = now;
  try {
    update(now, dt);
    render(now);
  } catch (e) {
    console.error('[MagicSort] frame error', e);
  }
  raf(frame);
}
raf(frame);

};
__modules["js/audio.js"]=function(module,exports,require){
'use strict';
// Tiny synthesized sound effects via wx.createWebAudioContext(). Silently no-ops when unavailable.

function createAudio() {
  var ac = null;
  try {
    if (typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
      ac = wx.createWebAudioContext();
    }
  } catch (e) { ac = null; }

  var muted = false;

  function ramp(param, value, time) {
    try {
      if (param.exponentialRampToValueAtTime) param.exponentialRampToValueAtTime(value, time);
      else if (param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, time);
      else param.value = value;
    } catch (e) {
      try { param.value = value; } catch (e2) { /* ignore */ }
    }
  }

  function tone(freq, delay, dur, vol, type, freqEnd) {
    if (!ac || muted) return;
    try {
      var t = ac.currentTime + (delay || 0);
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (freqEnd) ramp(osc.frequency, freqEnd, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      ramp(gain.gain, vol, t + 0.012);
      ramp(gain.gain, 0.0001, t + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch (e) { /* never crash the game because of audio */ }
  }

  return {
    available: function () { return !!ac; },
    isMuted: function () { return muted; },
    setMuted: function (m) { muted = !!m; },
    resume: function () {
      try { if (ac && ac.state === 'suspended' && ac.resume) ac.resume(); } catch (e) { /* ignore */ }
    },
    lift: function () { tone(660, 0, 0.08, 0.06, 'sine', 880); },
    pop: function () {
      tone(560, 0, 0.09, 0.16, 'sine', 190);
      tone(1200, 0, 0.04, 0.04, 'triangle', 700);
    },
    bump: function () { tone(160, 0, 0.1, 0.1, 'triangle', 110); },
    chime: function () {
      var notes = [1046.5, 1318.5, 1568.0, 2093.0];
      for (var i = 0; i < notes.length; i++) {
        tone(notes[i], i * 0.07, 0.9, 0.09, 'sine');
        tone(notes[i] * 2, i * 0.07, 0.4, 0.02, 'triangle');
      }
    },
    win: function () {
      var notes = [784, 988, 1175, 1568, 1976, 2349];
      for (var i = 0; i < notes.length; i++) tone(notes[i], i * 0.09, 1.1, 0.08, 'sine');
    }
  };
}

module.exports = { createAudio: createAudio };

};
__modules["js/logic.js"]=function(module,exports,require){
'use strict';
// Pure game logic for Magic Sort (no wx / canvas dependencies, so it can be tested in node).
// A board is an array of flasks; each flask is an array of color indices, bottom -> top.

var CAPACITY = 4;

function colorsForLevel(level) {
  var n = Math.max(1, Math.floor(level) || 1);
  return Math.min(3 + Math.floor((n - 1) / 2), 8);
}

function flasksForLevel(level) {
  return colorsForLevel(level) + 2;
}

function createSolved(colors) {
  var board = [];
  for (var c = 0; c < colors; c++) board.push([c, c, c, c]);
  board.push([]);
  board.push([]);
  return board;
}

function cloneBoard(board) {
  return board.map(function (f) { return f.slice(); });
}

function isFlaskComplete(flask) {
  if (flask.length !== CAPACITY) return false;
  for (var i = 1; i < flask.length; i++) if (flask[i] !== flask[0]) return false;
  return true;
}

function isSolved(board) {
  for (var i = 0; i < board.length; i++) {
    if (board[i].length !== 0 && !isFlaskComplete(board[i])) return false;
  }
  return true;
}

// Top contiguous run of same-colored orbs: { color, count } or null for an empty flask.
function topRun(flask) {
  if (!flask.length) return null;
  var color = flask[flask.length - 1];
  var count = 0;
  for (var i = flask.length - 1; i >= 0 && flask[i] === color; i--) count++;
  return { color: color, count: count };
}

// How many orbs would move from `from` to `to` under the game rules (0 = illegal).
function movableCount(board, from, to) {
  if (from === to) return 0;
  var run = topRun(board[from]);
  if (!run) return 0;
  var target = board[to];
  var room = CAPACITY - target.length;
  if (room <= 0) return 0;
  if (target.length && target[target.length - 1] !== run.color) return 0;
  return Math.min(room, run.count);
}

// Applies a legal move in place; returns the number of orbs moved.
function applyMove(board, from, to) {
  var n = movableCount(board, from, to);
  for (var i = 0; i < n; i++) board[to].push(board[from].pop());
  return n;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Random reverse moves ignoring color rules. Mutates board, returns [[from, to], ...].
function scrambleBoard(board, k, rng) {
  var moves = [];
  for (var s = 0; s < k; s++) {
    var sources = [];
    for (var i = 0; i < board.length; i++) if (board[i].length > 0) sources.push(i);
    var from = pick(sources, rng);
    var targets = [];
    for (var j = 0; j < board.length; j++) {
      if (j !== from && board[j].length < CAPACITY) targets.push(j);
    }
    var to = pick(targets, rng); // always non-empty: there are >= 8 free slots in total
    board[to].push(board[from].pop());
    moves.push([from, to]);
  }
  return moves;
}

function generateLevel(level, rng) {
  rng = rng || Math.random;
  var colors = colorsForLevel(level);
  var board = createSolved(colors);
  var k = 40 + 10 * colors;
  var moves = scrambleBoard(board, k, rng);
  while (isSolved(board)) moves = moves.concat(scrambleBoard(board, k, rng));
  return { level: level, colors: colors, board: board, scramble: moves };
}

// Undo a recorded scramble (each step moves the top orb of `to` back onto `from`).
function unscramble(board, moves) {
  var b = cloneBoard(board);
  for (var i = moves.length - 1; i >= 0; i--) {
    var from = moves[i][0], to = moves[i][1];
    b[from].push(b[to].pop());
  }
  return b;
}

module.exports = {
  CAPACITY: CAPACITY,
  colorsForLevel: colorsForLevel,
  flasksForLevel: flasksForLevel,
  createSolved: createSolved,
  cloneBoard: cloneBoard,
  isFlaskComplete: isFlaskComplete,
  isSolved: isSolved,
  topRun: topRun,
  movableCount: movableCount,
  applyMove: applyMove,
  scrambleBoard: scrambleBoard,
  generateLevel: generateLevel,
  unscramble: unscramble
};

};
__require("__entry__")("./game.js");
})();
