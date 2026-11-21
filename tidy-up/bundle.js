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
// 收纳达人 (Tidy Up) - WeChat mini-game entry. All rendering on wx canvas, no DOM/BOM.
var logic = require('./js/logic.js');
var art = require('./js/art.js');
var createAudio = require('./js/audio.js');

var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');
var info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
var dpr = info.pixelRatio || 2;
var W = info.windowWidth, H = info.windowHeight;
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

var audio = createAudio();
try { audio.muted = !!wx.getStorageSync('tidyup_muted'); } catch (e) { /* ignore */ }

var S = Math.min(W / 375, H / 667); // ui scale
function fsz(n) { return Math.max(10, Math.round(n * S)); }

// ---------- storage ----------
function loadBest() {
  try {
    var b = wx.getStorageSync('tidyup_best');
    return (b && typeof b === 'object') ? b : {};
  } catch (e) { return {}; }
}
function saveBest(b) { try { wx.setStorageSync('tidyup_best', b); } catch (e) { /* ignore */ } }
function loadLevel() {
  try { var n = parseInt(wx.getStorageSync('tidyup_level'), 10); return n >= 1 ? n : 1; } catch (e) { return 1; }
}
function saveLevel(n) { try { wx.setStorageSync('tidyup_level', n); } catch (e) { /* ignore */ } }

// ---------- layout ----------
var layout = {};
function computeLayout() {
  var hudH = fsz(84);
  var zw = Math.min(W * 0.36, 200), zh = zw * 0.86;
  var m = 6;
  var topY = hudH + 4;
  var sideY = Math.round(topY + zh + (H - zh * 3 - topY) / 2);
  var botY = H - zh - 6;
  var zones = {
    toys:    { x: m, y: topY, w: zw, h: zh, cx: m + zw / 2, cy: topY + zh / 2 },
    books:   { x: W - zw - m, y: topY, w: zw, h: zh, cx: W - zw / 2 - m, cy: topY + zh / 2 },
    clothes: { x: m, y: sideY, w: zw, h: zh, cx: m + zw / 2, cy: sideY + zh / 2 },
    kitchen: { x: W - zw - m, y: sideY, w: zw, h: zh, cx: W - zw / 2 - m, cy: sideY + zh / 2 },
    shoes:   { x: W / 2 - zw / 2, y: botY, w: zw, h: zh, cx: W / 2, cy: botY + zh / 2 }
  };
  var fx0 = zw + m + 6, fx1 = W - zw - m - 6;
  var fy0 = topY + zh + 6, fy1 = botY - 6;
  var floor = { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 };
  var win = { w: Math.min(W * 0.4, 190), h: Math.min(H * 0.13, 130) };
  win.x = (W - win.w) / 2; win.y = hudH * 0.06;
  layout = {
    hudH: hudH, zones: zones, floor: floor, zw: zw, zh: zh,
    room: {
      floorLine: topY + zh * 0.35,
      win: win,
      rug: { cx: W / 2, cy: (floor.y + floor.y + floor.h) / 2, rx: floor.w * 0.44, ry: floor.h * 0.4 }
    }
  };
  // shrink rug if floor too small
  if (layout.room.rug.ry > floor.h * 0.46) layout.room.rug.ry = floor.h * 0.46;
}
computeLayout();

// HUD button rects (fixed)
var hudBtns = {};
function computeHudBtns() {
  var r = fsz(34), g = 8, x = W - 10 - r;
  hudBtns.mute = { x: x, y: fsz(46), w: r, h: r, id: 'mute' };
  hudBtns.pause = { x: x - (r + g), y: fsz(46), w: r, h: r, id: 'pause' };
  hudBtns.restart = { x: x - (r + g) * 2, y: fsz(46), w: r, h: r, id: 'restart' };
}
computeHudBtns();

// ---------- game state ----------
var best = loadBest();
var screen = 'menu'; // menu | game
var menuLevel = loadLevel();
var state = null;     // level state from logic.createLevel
var paused = false;
var drag = null;      // {id, dx, dy, moved, sx, sy}
var selected = -1;    // tap-selected item id
var hoverZone = null;
var anims = [];       // fly / shake / pop animations per item
var particles = [];   // sparkles + confetti
var floats = [];      // floating score texts
var winStars = 0;
var tGlobal = 0;

function startLevel(n, reshuffle) {
  menuLevel = n; saveLevel(n);
  state = logic.createLevel(n, layout.floor);
  state.items.forEach(function (it) { it.ox = it.x; it.oy = it.y; });
  drag = null; selected = -1; hoverZone = null;
  anims = []; particles = []; floats = [];
  paused = false; winStars = 0;
  screen = 'game';
}
function animOf(id) {
  for (var i = 0; i < anims.length; i++) if (anims[i].id === id) return anims[i];
  return null;
}

// ---------- particles ----------
function sparkle(x, y, n) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
    particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      life: 0.55 + Math.random() * 0.35, t: 0, size: 4 + Math.random() * 5,
      col: ['#ffd84d', '#fff3b0', '#ff9a3c', '#7cc6ff'][i % 4], type: 'star' });
  }
}
function confetti() {
  var cols = ['#ff6b6b', '#ffd84d', '#6aa6e8', '#8fd6b4', '#b49cff', '#ff9a3c'];
  for (var i = 0; i < 90; i++) {
    particles.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
      vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160,
      life: 2.4 + Math.random(), t: 0, size: 5 + Math.random() * 6,
      col: cols[i % cols.length], type: 'confetti', rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8 });
  }
}
function floatText(x, y, txt, col) { floats.push({ x: x, y: y, txt: txt, col: col || '#fff', t: 0, life: 0.9 }); }

// ---------- input ----------
var btns = []; // overlay buttons of current frame
function hit(b, x, y) { return x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6; }
function findButton(x, y) {
  var all = [];
  for (var k in hudBtns) all.push(hudBtns[k]);
  all = all.concat(btns);
  for (var i = 0; i < all.length; i++) if (hit(all[i], x, y)) return all[i];
  return null;
}
function zoneAt(x, y) {
  var zs = layout.zones;
  for (var id in zs) {
    var z = zs[id], p = fsz(14);
    if (x >= z.x - p && x <= z.x + z.w + p && y >= z.y - p && y <= z.y + z.h + p) return id;
  }
  return null;
}
function itemAt(x, y) {
  if (!state) return -1;
  var bestD = 1e9, id = -1;
  for (var i = 0; i < state.items.length; i++) {
    var it = state.items[i];
    if (it.placed || animOf(i)) continue;
    var d = (it.x - x) * (it.x - x) + (it.y - y) * (it.y - y);
    var rad = (it.r + 14) * (it.r + 14);
    if (d < rad && d < bestD) { bestD = d; id = i; }
  }
  return id;
}

function doPlace(itemId, zoneId, fromX, fromY) {
  var it = state.items[itemId];
  var r = logic.placeItem(state, itemId, zoneId);
  if (r.ok) {
    var z = layout.zones[zoneId];
    anims.push({ id: itemId, type: 'fly', t: 0, dur: 0.28, fx: it.x, fy: it.y, tx: z.cx, ty: z.cy });
    sparkle(z.cx, z.cy, 14);
    audio.chime(r.combo);
    if (r.won) {
      winStars = logic.starsFor(state.timeLeft, state.timeTotal);
      audio.fanfare();
      confetti();
    }
    floatText(z.cx, z.cy - 40, '+' + r.points, '#ffd84d');
  } else {
    // bounce back + shake
    state.combo = r.ignored ? state.combo : 0;
    if (!r.ignored) logic.missItem(state);
    anims.push({ id: itemId, type: 'back', t: 0, dur: 0.32, fx: it.x, fy: it.y, tx: it.ox, ty: it.oy });
    it.x = it.ox; it.y = it.oy; // logical position restored; visual animates from fx/fy
    if (!r.ignored) { audio.boing(); floatText(it.ox, it.oy - it.r - 16, '放错啦', '#ff8a8a'); }
  }
}

wx.onTouchStart(function (e) {
  audio.resume();
  if (!e.touches || !e.touches.length) return;
  var x = e.touches[0].clientX, y = e.touches[0].clientY;
  var b = findButton(x, y);
  if (b) { onButton(b.id); return; }
  if (screen !== 'game' || paused || !state || state.over) return;
  var zid = zoneAt(x, y);
  if (selected >= 0) {
    // tap-select mode: tap zone to place, tap item to switch, elsewhere to put back
    var it = state.items[selected];
    if (zid) { doPlace(selected, zid, it.x, it.y); selected = -1; return; }
    var iid = itemAt(x, y);
    if (iid >= 0) { audio.pop(); selected = iid; return; }
    audio.pop(); selected = -1; return;
  }
  var iid2 = itemAt(x, y);
  if (iid2 >= 0) {
    var it2 = state.items[iid2];
    drag = { id: iid2, dx: it2.x - x, dy: it2.y - y, moved: false, sx: x, sy: y };
  }
});
wx.onTouchMove(function (e) {
  if (!e.touches || !e.touches.length || !drag) return;
  var x = e.touches[0].clientX, y = e.touches[0].clientY;
  if (!drag.moved && (Math.abs(x - drag.sx) > 8 || Math.abs(y - drag.sy) > 8)) drag.moved = true;
  if (drag.moved) {
    var it = state.items[drag.id];
    it.x = Math.max(10, Math.min(W - 10, x + drag.dx));
    it.y = Math.max(10, Math.min(H - 10, y + drag.dy));
    hoverZone = zoneAt(x, y);
  }
});
wx.onTouchEnd(function (e) {
  if (!drag) return;
  var d = drag; drag = null; hoverZone = null;
  var x = e.changedTouches[0].clientX, y = e.changedTouches[0].clientY;
  var it = state.items[d.id];
  if (!d.moved) {
    // tap: pick up (select)
    selected = d.id; audio.pop();
    return;
  }
  var zid = zoneAt(x, y);
  if (zid) doPlace(d.id, zid, it.x, it.y);
  else {
    // dropped on floor: bounce back to original spot
    state.combo = 0; logic.missItem(state);
    anims.push({ id: d.id, type: 'back', t: 0, dur: 0.3, fx: it.x, fy: it.y, tx: it.ox, ty: it.oy });
    it.x = it.ox; it.y = it.oy;
    audio.pop();
  }
});

function onButton(id) {
  audio.click();
  if (id === 'mute') {
    audio.muted = !audio.muted;
    try { wx.setStorageSync('tidyup_muted', audio.muted); } catch (e) { /* ignore */ }
    return;
  }
  if (id === 'restart') { startLevel(state ? state.level : menuLevel, true); return; }
  if (id === 'pause') { paused = true; return; }
  if (id === 'resume') { paused = false; return; }
  if (id === 'menu') { screen = 'menu'; menuLevel = state ? state.level : menuLevel; return; }
  if (id === 'tryAgain') { startLevel(state.level, true); return; }
  if (id === 'next') { startLevel(state.level + 1); return; }
  if (id === 'replay') { startLevel(state.level, true); return; }
  if (id === 'start') { startLevel(menuLevel); return; }
}

// ---------- drawing helpers ----------
function drawZone(id, z, hl) {
  art.drawFurniture(ctx, id, z);
  if (hl) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,215,90,0.95)';
    ctx.shadowBlur = 18;
    art.rr(ctx, z.x - 4, z.y - 4, z.w + 8, z.h + 8, 14);
    ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
  }
  var cat = logic.CATEGORIES.filter(function (c) { return c.id === id; })[0];
  var iconKind = logic.ITEMS_BY_CAT[id][0];
  art.drawLabel(ctx, z.cx, z.y + z.h - 10, fsz(22), cat.zh, iconKind, z.w - 8);
}
function drawShadow(x, y, rx, ry, a) {
  ctx.save(); ctx.globalAlpha = a === undefined ? 0.25 : a;
  art.ell(ctx, x, y, rx, ry); ctx.fillStyle = 'rgba(60,30,10,1)'; ctx.fill();
  ctx.restore();
}
function roundBtn(b, label, opts) {
  opts = opts || {};
  var pressed = false;
  ctx.save();
  art.rr(ctx, b.x, b.y + 3, b.w, b.h, b.h / 2);
  ctx.fillStyle = 'rgba(110,60,25,0.35)'; ctx.fill();
  art.rr(ctx, b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fillStyle = opts.col || '#ff9a5c'; ctx.fill();
  ctx.strokeStyle = 'rgba(120,60,20,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = opts.txt || '#fff';
  ctx.font = 'bold ' + fsz(b.h * 0.42) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  ctx.restore();
  return b;
}
function wideBtn(id, cy, label, col) {
  var w = Math.min(W * 0.6, 240), h = fsz(46);
  var b = { x: W / 2 - w / 2, y: cy, w: w, h: h, id: id };
  roundBtn(b, label, { col: col });
  btns.push(b);
  return b;
}

// ---------- HUD ----------
function drawHUD() {
  var h = layout.hudH;
  ctx.save();
  art.rr(ctx, 0, 0, W, h, 0); ctx.fillStyle = 'rgba(255,243,225,0.96)'; ctx.fill();
  ctx.fillStyle = 'rgba(190,140,90,0.5)'; ctx.fillRect(0, h - 2, W, 2);

  art.broom(ctx, fsz(22), fsz(26), fsz(15));
  ctx.fillStyle = '#6b3f22';
  ctx.font = 'bold ' + fsz(18) + 'px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('收纳达人', fsz(44), fsz(26));

  // level chip
  ctx.font = 'bold ' + fsz(15) + 'px sans-serif';
  var lt = '第 ' + state.level + ' 关';
  var lw = ctx.measureText(lt).width + 18;
  art.rr(ctx, fsz(120), fsz(13), lw, fsz(26), fsz(13));
  ctx.fillStyle = '#ffe1b8'; ctx.fill();
  ctx.strokeStyle = '#d9a46f'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#8a5a2b'; ctx.fillText(lt, fsz(120) + lw / 2, fsz(27));

  // score
  ctx.textAlign = 'right';
  ctx.font = 'bold ' + fsz(20) + 'px sans-serif';
  ctx.fillStyle = '#e07b3a';
  ctx.fillText(String(state.score), W - 12, fsz(20));
  ctx.font = fsz(11) + 'px sans-serif';
  ctx.fillStyle = '#a97b4f';
  ctx.fillText('得分', W - 12, fsz(36));

  // combo flame
  if (state.combo >= 3) {
    art.flame(ctx, W / 2 + fsz(8), fsz(30), fsz(13));
    ctx.textAlign = 'left';
    ctx.font = 'bold ' + fsz(16) + 'px sans-serif';
    ctx.fillStyle = '#ff7a3c';
    ctx.fillText('x' + state.combo, W / 2 + fsz(24), fsz(32));
  }

  // timer bar
  var bw = W - fsz(150), bx = fsz(10), by = fsz(56), bh = fsz(12);
  var frac = Math.max(0, state.timeLeft / state.timeTotal);
  art.rr(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(190,140,90,0.3)'; ctx.fill();
  var red = state.timeLeft < 10;
  art.rr(ctx, bx, by, Math.max(bh, bw * frac), bh, bh / 2);
  ctx.fillStyle = red ? '#ff5a4f' : '#7cc6b0'; ctx.fill();
  if (red) {
    ctx.save(); ctx.globalAlpha = 0.4 + 0.3 * Math.sin(tGlobal * 8);
    art.rr(ctx, bx, by, Math.max(bh, bw * frac), bh, bh / 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.font = 'bold ' + fsz(11) + 'px sans-serif';
  ctx.fillStyle = red ? '#d43a2f' : '#8a5a2b';
  ctx.fillText(Math.ceil(state.timeLeft) + 's', bx + bw + 6, by + bh / 2);

  // buttons
  var r = hudBtns.restart;
  art.circle(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.strokeStyle = '#d9a46f'; ctx.lineWidth = 1.5; ctx.stroke();
  art.iconRestart(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.28, '#e07b3a');
  var p = hudBtns.pause;
  art.circle(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.stroke();
  art.iconPause(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.24, '#e07b3a');
  var m = hudBtns.mute;
  art.circle(ctx, m.x + m.w / 2, m.y + m.h / 2, m.w / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.stroke();
  art.iconSound(ctx, m.x + m.w / 2, m.y + m.h / 2, m.w * 0.26, '#e07b3a', audio.muted);
  ctx.restore();
}

// ---------- items ----------
function itemScreenPos(it, i) {
  var a = animOf(i);
  if (!a) return { x: it.x, y: it.y, s: 1, rot: 0 };
  var k = a.t / a.dur;
  if (a.type === 'fly') {
    var e = 1 - (1 - k) * (1 - k);
    return { x: a.fx + (a.tx - a.fx) * e, y: a.fy + (a.ty - a.fy) * e, s: 1 - 0.35 * e, rot: 0 };
  }
  if (a.type === 'back') {
    var e2 = 1 - (1 - k) * (1 - k);
    var sh = Math.sin(k * Math.PI * 3) * 5 * (1 - k);
    return { x: a.fx + (a.tx - a.fx) * e2 + sh, y: a.fy + (a.ty - a.fy) * e2, s: 1, rot: 0 };
  }
  return { x: it.x, y: it.y, s: 1, rot: 0 };
}
function drawItems() {
  for (var i = 0; i < state.items.length; i++) {
    var it = state.items[i];
    if (it.placed && !animOf(i)) continue;
    var p = itemScreenPos(it, i);
    var dragging = drag && drag.id === i && drag.moved;
    var sel = selected === i;
    var s = p.s * (dragging ? 1.15 : 1);
    if (sel) s *= 1.08;
    var a = animOf(i);
    if (a && a.type === 'back') {
      var k = a.t / a.dur;
      if (k < 0.5) drawShadow(p.x + 4, p.y + it.r * 0.9, it.r * 0.8, it.r * 0.3, 0.25 * (1 - k));
    }
    if (dragging) drawShadow(it.x + 6, it.y + it.r * 1.05, it.r * 0.9, it.r * 0.34, 0.3);
    else if (!a) drawShadow(it.x + 3, it.y + it.r * 0.95, it.r * 0.75, it.r * 0.26, 0.22);
    ctx.save();
    if (sel) {
      ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -tGlobal * 30;
      art.circle(ctx, p.x, p.y, it.r + 10); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot + (dragging ? Math.sin(tGlobal * 6) * 0.04 : 0));
    ctx.scale(s, s);
    art.drawItem(ctx, it.kind, 0, 0, it.r);
    ctx.restore();
  }
}

// ---------- particles & floats ----------
function drawParticles(dt) {
  for (var i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { particles.splice(i, 1); continue; }
    var k = p.t / p.life;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.type === 'confetti') { p.vy += 60 * dt; p.rot += p.vr * dt; }
    else { p.vx *= 0.96; p.vy = p.vy * 0.96 + 40 * dt; }
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.translate(p.x, p.y);
    if (p.type === 'confetti') { ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); }
    else { art.starPath(ctx, 0, 0, p.size * (1 - k * 0.5), p.size * 0.45 * (1 - k * 0.5), 4); ctx.fillStyle = p.col; ctx.fill(); }
    ctx.restore();
  }
}
function drawFloats(dt) {
  for (var i = floats.length - 1; i >= 0; i--) {
    var f = floats[i];
    f.t += dt;
    if (f.t >= f.life) { floats.splice(i, 1); continue; }
    var k = f.t / f.life;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.font = 'bold ' + fsz(18) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(90,40,10,0.6)';
    ctx.strokeText(f.txt, f.x, f.y - k * 34);
    ctx.fillStyle = f.col;
    ctx.fillText(f.txt, f.x, f.y - k * 34);
    ctx.restore();
  }
}

// ---------- overlays ----------
function dim(a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#3a2414'; ctx.fillRect(0, 0, W, H); ctx.restore();
}
function drawPause() {
  dim(0.55);
  ctx.save();
  ctx.fillStyle = '#fff8ec';
  art.rr(ctx, W / 2 - fsz(130), H * 0.3, fsz(260), fsz(250), fsz(24)); ctx.fill();
  ctx.strokeStyle = '#e8c49a'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#6b3f22'; ctx.textAlign = 'center';
  ctx.font = 'bold ' + fsz(26) + 'px sans-serif';
  ctx.fillText('休息一下', W / 2, H * 0.3 + fsz(44));
  ctx.restore();
  wideBtn('resume', H * 0.3 + fsz(72), '继续游戏', '#7cc6b0');
  wideBtn('pauseRestart', H * 0.3 + fsz(130), '重新开始', '#ff9a5c');
  wideBtn('menu', H * 0.3 + fsz(188), '回到菜单', '#b49cff');
}
function drawTimeup() {
  dim(0.6);
  ctx.save();
  ctx.fillStyle = '#fff8ec';
  art.rr(ctx, W / 2 - fsz(140), H * 0.24, fsz(280), fsz(260), fsz(24)); ctx.fill();
  ctx.strokeStyle = '#e8c49a'; ctx.lineWidth = 3; ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = 'bold ' + fsz(30) + 'px sans-serif';
  ctx.fillStyle = '#e0524f';
  ctx.fillText("时间到！", W / 2, H * 0.24 + fsz(50));
  ctx.font = fsz(17) + 'px sans-serif';
  ctx.fillStyle = '#6b3f22';
  ctx.fillText('得分 ' + state.score, W / 2, H * 0.24 + fsz(92));
  ctx.fillText('还剩 ' + (state.items.length - state.placedCount) + ' 件物品', W / 2, H * 0.24 + fsz(120));
  ctx.restore();
  wideBtn('tryAgain', H * 0.24 + fsz(150), '再试一次', '#ff9a5c');
  wideBtn('menu2', H * 0.24 + fsz(208), '回到菜单', '#b49cff');
}
function drawWin() {
  dim(0.35);
  ctx.save();
  ctx.fillStyle = '#fff8ec';
  var pw = fsz(300), ph = fsz(300);
  art.rr(ctx, W / 2 - pw / 2, H * 0.2, pw, ph, fsz(26)); ctx.fill();
  ctx.strokeStyle = '#e8c49a'; ctx.lineWidth = 3; ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = 'bold ' + fsz(28) + 'px sans-serif';
  ctx.fillStyle = '#e07b3a';
  ctx.fillText('太棒了！房间真干净', W / 2, H * 0.2 + fsz(44));
  // stars
  var cy = H * 0.2 + fsz(100), R = fsz(26);
  for (var i = 0; i < 3; i++) {
    var sx = W / 2 + (i - 1) * fsz(66);
    var on = i < winStars;
    var pop = Math.min(1, Math.max(0, tGlobal - 0.3 - i * 0.25) * 3);
    var sc = on ? (0.6 + 0.4 * (1 - Math.pow(1 - pop, 2))) : 1;
    ctx.save(); ctx.translate(sx, cy); ctx.scale(sc, sc);
    if (!on) ctx.globalAlpha = 0.25;
    art.starPath(ctx, 0, 0, R, R * 0.45);
    ctx.fillStyle = on ? '#ffd84d' : '#d8cbb8'; ctx.fill();
    ctx.strokeStyle = on ? '#c98a12' : '#b3a892'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }
  var bestScore = best[state.level] || 0;
  var isNew = state.score > bestScore;
  if (isNew) { best[state.level] = state.score; saveBest(best); }
  ctx.font = fsz(18) + 'px sans-serif';
  ctx.fillStyle = '#6b3f22';
  ctx.fillText('得分 ' + state.score + (isNew ? '  新纪录！' : '  最佳 ' + best[state.level]), W / 2, H * 0.2 + fsz(160));
  ctx.font = fsz(14) + 'px sans-serif';
  ctx.fillStyle = '#a97b4f';
  ctx.fillText('最高连击 x' + state.maxCombo, W / 2, H * 0.2 + fsz(186));
  ctx.restore();
  wideBtn('next', H * 0.2 + fsz(210), '下一关', '#7cc6b0');
  wideBtn('replay', H * 0.2 + fsz(268), '再玩一次', '#ff9a5c');
}

// ---------- menu ----------
function drawMenu(dt) {
  ctx.fillStyle = '#ffe9cf'; ctx.fillRect(0, 0, W, H);
  var L = { floorLine: H * 0.62, win: layout.room.win, rug: { cx: W / 2, cy: H * 0.78, rx: W * 0.32, ry: H * 0.09 } };
  art.drawRoom(ctx, W, H, L);
  // sample furniture row
  var zw = Math.min(W * 0.28, 150), zh = zw * 0.8;
  var ids = ['toys', 'books', 'clothes'];
  for (var i = 0; i < 3; i++) {
    var id = ids[i];
    var a = { x: (i + 0.5) * (W / 3) - zw / 2, y: H * 0.42, w: zw, h: zh };
    art.drawFurniture(ctx, id, a);
  }
  // floating preview items on rug
  var t = tGlobal;
  var kinds = ['bear', 'storybook', 'sneakers', 'apple', 'duck'];
  for (var k = 0; k < kinds.length; k++) {
    var ang = t * 0.6 + k * 1.256;
    art.drawItem(ctx, kinds[k], W / 2 + Math.cos(ang) * W * 0.24, H * 0.78 + Math.sin(ang) * H * 0.035, fsz(24) + 6);
  }
  art.broom(ctx, W / 2 - fsz(110), H * 0.14, fsz(20));
  ctx.textAlign = 'center';
  ctx.font = 'bold ' + fsz(44) + 'px sans-serif';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(120,70,30,0.25)';
  ctx.strokeText('收纳达人', W / 2, H * 0.155);
  ctx.fillStyle = '#e07b3a';
  ctx.fillText('收纳达人', W / 2, H * 0.155);
  ctx.font = fsz(16) + 'px sans-serif';
  ctx.fillStyle = '#8a5a2b';
  ctx.fillText('把物品拖回正确的家', W / 2, H * 0.21);
  var b = wideBtn('start', H * 0.63, '开始整理  ·  第 ' + menuLevel + ' 关', '#ff9a5c');
  ctx.font = fsz(13) + 'px sans-serif';
  ctx.fillStyle = '#a97b4f';
  var bs = best[menuLevel] || 0;
  ctx.fillText(bs ? ('本关最佳 ' + bs + ' 分') : '还没有本关记录', W / 2, b.y + b.h + fsz(24));
  // mute
  var m = hudBtns.mute;
  art.circle(ctx, m.x + m.w / 2, m.y + m.h / 2, m.w / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  ctx.strokeStyle = '#d9a46f'; ctx.lineWidth = 1.5; ctx.stroke();
  art.iconSound(ctx, m.x + m.w / 2, m.y + m.h / 2, m.w * 0.26, '#e07b3a', audio.muted);
}

// ---------- main loop ----------
var last = 0;
function frame(ts) {
  var dt = Math.max(0, Math.min(0.05, (ts - last) / 1000 || 0.016));
  last = ts;
  tGlobal += dt;
  btns = [];
  ctx.clearRect(0, 0, W, H);

  if (screen === 'menu') { drawMenu(dt); drawParticles(dt); }
  else {
    if (!paused && !state.over) logic.tick(state, dt);
    if (state.over && state.status === 'timeup' && !state.playedTimeup) { state.playedTimeup = true; audio.timeup(); }
    art.drawRoom(ctx, W, H, layout.room);
    zoneUnderSelected = (selected >= 0 && state.items[selected]) ? zoneAt(state.items[selected].x, state.items[selected].y) : null;
    for (var id in layout.zones) drawZone(id, layout.zones[id], hoverZone === id || (selected >= 0 && zoneUnderSelected === id));
    drawItems();
    drawParticles(dt);
    drawFloats(dt);
    drawHUD();
    if (state.status === 'won') drawWin();
    else if (state.status === 'timeup') drawTimeup();
    else if (paused) drawPause();
  }

  // advance animations
  for (var i = anims.length - 1; i >= 0; i--) {
    var a = anims[i];
    a.t += dt;
    if (a.t >= a.dur) anims.splice(i, 1);
  }
  requestAnimationFrame(frame);
}

// selected-zone pre-highlight (drag alternative): remember zone under selected item pos
var zoneUnderSelected = null;

requestAnimationFrame(frame);

};
__modules["js/art.js"]=function(module,exports,require){
'use strict';
// All visuals drawn with canvas paths. Items are designed in a -50..50 unit box.

var PI2 = Math.PI * 2;

// ---------- path helpers ----------
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
function ellPath(c, cx, cy, rx, ry) {
  var k = 0.5522848;
  c.moveTo(cx + rx, cy);
  c.bezierCurveTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
  c.bezierCurveTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
  c.bezierCurveTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
  c.bezierCurveTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
  c.closePath();
}
function ell(c, cx, cy, rx, ry) { c.beginPath(); ellPath(c, cx, cy, rx, ry); }
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, PI2); c.closePath(); }
function starPath(c, x, y, R, r, n) {
  n = n || 5;
  c.beginPath();
  for (var i = 0; i < n * 2; i++) {
    var a = -Math.PI / 2 + i * Math.PI / n;
    var rad = i % 2 === 0 ? R : r;
    if (i === 0) c.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    else c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  c.closePath();
}
function heartPath(c, x, y, s) {
  c.beginPath();
  c.moveTo(x, y + s);
  c.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.8, y - s * 1.4, x, y - s * 0.5);
  c.bezierCurveTo(x + s * 0.8, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s);
  c.closePath();
}
function fs(c, fill, stroke, lw) {
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 3; c.stroke(); }
}
function hash(k) { var s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
function eyes(c, x1, x2, y, r, col) {
  circle(c, x1, y, r); fs(c, col);
  circle(c, x2, y, r); fs(c, col);
  circle(c, x1 + r * 0.35, y - r * 0.4, r * 0.38); fs(c, '#ffffff');
  circle(c, x2 + r * 0.35, y - r * 0.4, r * 0.38); fs(c, '#ffffff');
}
var BLUSH = 'rgba(255,120,130,0.45)';

// ---------- items ----------
var ITEMS = {
  bear: function (c) {
    var fur = '#c68c53', dk = '#6e4325', lt = '#f1d3a8';
    circle(c, -26, -34, 14); fs(c, fur, dk);
    circle(c, 26, -34, 14); fs(c, fur, dk);
    circle(c, -26, -34, 7); fs(c, lt);
    circle(c, 26, -34, 7); fs(c, lt);
    ell(c, 0, 24, 29, 22); fs(c, fur, dk);
    ell(c, 0, 28, 15, 12); fs(c, lt);
    circle(c, -16, 42, 9); fs(c, fur, dk);
    circle(c, 16, 42, 9); fs(c, fur, dk);
    circle(c, -28, 18, 10); fs(c, fur, dk);
    circle(c, 28, 18, 10); fs(c, fur, dk);
    circle(c, 0, -13, 28); fs(c, fur, dk);
    ell(c, 0, -3, 13, 10); fs(c, lt);
    ell(c, 0, -7, 5, 3.6); fs(c, dk);
    c.beginPath(); c.moveTo(-5, 0); c.quadraticCurveTo(0, 5, 5, 0); fs(c, null, dk, 2.5);
    eyes(c, -11, 11, -18, 3.8, '#3a2414');
    circle(c, -19, -6, 4.5); fs(c, BLUSH);
    circle(c, 19, -6, 4.5); fs(c, BLUSH);
    c.beginPath(); c.moveTo(0, 13); c.lineTo(-11, 7); c.lineTo(-11, 19); c.closePath(); fs(c, '#ff6b8a', '#b33a5a', 2);
    c.beginPath(); c.moveTo(0, 13); c.lineTo(11, 7); c.lineTo(11, 19); c.closePath(); fs(c, '#ff6b8a', '#b33a5a', 2);
    circle(c, 0, 13, 3.5); fs(c, '#ff8fa6', '#b33a5a', 2);
  },
  ball: function (c) {
    var cols = ['#ff6b6b', '#ffffff', '#ffd166', '#ffffff', '#4fa3e0', '#ffffff'];
    c.save();
    circle(c, 0, 0, 40); c.clip();
    for (var i = 0; i < 6; i++) {
      c.beginPath(); c.moveTo(0, 0);
      c.arc(0, 0, 42, i * Math.PI / 3 - Math.PI / 2, (i + 1) * Math.PI / 3 - Math.PI / 2);
      c.closePath(); fs(c, cols[i]);
    }
    c.restore();
    circle(c, 0, 0, 40); fs(c, null, '#5a6b8c', 3);
    circle(c, 0, 0, 7); fs(c, '#ffffff', '#5a6b8c', 2.5);
    c.beginPath(); c.arc(0, 0, 30, -2.7, -1.9); c.lineCap = 'round';
    fs(c, null, 'rgba(255,255,255,0.85)', 6);
  },
  car: function (c) {
    var body = '#ff7a6b', dk = '#9c3b33';
    c.beginPath(); c.moveTo(-28, -2); c.lineTo(-17, -27); c.quadraticCurveTo(-15, -30, -10, -30);
    c.lineTo(14, -30); c.quadraticCurveTo(19, -30, 21, -27); c.lineTo(32, -2); c.closePath(); fs(c, body, dk);
    c.beginPath(); c.moveTo(-20, -5); c.lineTo(-12, -24); c.lineTo(-2, -24); c.lineTo(-2, -5); c.closePath(); fs(c, '#c9ecff', dk, 2);
    c.beginPath(); c.moveTo(3, -5); c.lineTo(3, -24); c.lineTo(15, -24); c.lineTo(24, -5); c.closePath(); fs(c, '#c9ecff', dk, 2);
    rr(c, -46, -5, 92, 30, 12); fs(c, body, dk);
    rr(c, -40, 5, 80, 5, 2.5); fs(c, 'rgba(255,255,255,0.65)');
    circle(c, 40, 3, 4.5); fs(c, '#ffe680', dk, 2);
    circle(c, -24, 26, 12); fs(c, '#3b3b4f');
    circle(c, 24, 26, 12); fs(c, '#3b3b4f');
    circle(c, -24, 26, 5); fs(c, '#d8d8e0');
    circle(c, 24, 26, 5); fs(c, '#d8d8e0');
    circle(c, 0, -34, 4); fs(c, '#ffd84d', dk, 2);
  },
  duck: function (c) {
    var y = '#ffd84d', dk = '#c98a12';
    c.beginPath(); c.moveTo(-26, 4); c.quadraticCurveTo(-36, 40, 6, 40); c.quadraticCurveTo(40, 40, 42, 12);
    c.lineTo(48, -6); c.quadraticCurveTo(30, 2, 18, 0); c.quadraticCurveTo(-6, -4, -26, 4); c.closePath(); fs(c, y, dk);
    circle(c, -14, -16, 21); fs(c, y, dk);
    c.beginPath(); c.moveTo(-32, -15); c.quadraticCurveTo(-50, -19, -50, -9); c.quadraticCurveTo(-46, -2, -32, -6); c.closePath();
    fs(c, '#ff9a3c', '#c25a10', 2.5);
    c.beginPath(); c.moveTo(0, 14); c.quadraticCurveTo(14, 2, 30, 12); c.quadraticCurveTo(22, 30, 0, 22); c.closePath();
    fs(c, '#f5c021', dk, 2.5);
    circle(c, -17, -21, 4); fs(c, '#3a2a10');
    circle(c, -15.6, -22.6, 1.5); fs(c, '#ffffff');
    circle(c, -5, -10, 4.5); fs(c, BLUSH);
  },
  storybook: function (c) {
    rr(c, -24, -38, 62, 77, 5); fs(c, '#fffaf0', '#c7b89a', 2.5);
    c.strokeStyle = '#e2d6bd'; c.lineWidth = 1.5;
    for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-20, -30 + i * 4); c.lineTo(36, -30 + i * 4); }
    rr(c, -36, -41, 64, 80, 6); fs(c, '#6aa6e8', '#2f5f99');
    rr(c, -36, -41, 13, 80, 6); fs(c, '#3f7bc4', '#2f5f99', 2);
    starPath(c, 3, -10, 15, 6.5); fs(c, '#ffd84d', '#c98a12', 2.5);
    rr(c, -12, 14, 30, 6, 3); fs(c, 'rgba(255,255,255,0.85)');
    rr(c, -7, 25, 20, 5, 2.5); fs(c, 'rgba(255,255,255,0.6)');
  },
  notebook: function (c) {
    rr(c, -28, -41, 62, 82, 6); fs(c, '#8fd6b4', '#3f8f6b');
    rr(c, -12, -22, 36, 24, 4); fs(c, '#fffdf5', '#3f8f6b', 2);
    c.strokeStyle = '#9ab8a8'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-6, -14); c.lineTo(18, -14); c.moveTo(-6, -6); c.lineTo(12, -6); c.stroke();
    rr(c, -18, 20, 44, 7, 3.5); fs(c, 'rgba(255,255,255,0.5)');
    for (var y = -32; y <= 32; y += 10) {
      circle(c, -21, y, 2.2); fs(c, '#2f6f53');
      ell(c, -28, y, 7, 3.2); fs(c, null, '#6b6b78', 2.5);
    }
  },
  pencil: function (c) {
    c.save(); c.rotate(-Math.PI / 4);
    rr(c, -54, -10, 16, 20, 5); fs(c, '#ff9eb5', '#c55c78');
    c.beginPath(); c.rect(-30, -10, 56, 20); fs(c, '#ffcf3f', '#b38410');
    c.fillStyle = '#ffe07a'; c.fillRect(-28.5, -8.5, 53, 5.5);
    c.fillStyle = '#f2b705'; c.fillRect(-28.5, 3.5, 53, 5);
    c.beginPath(); c.rect(-41, -10, 11, 20); fs(c, '#c9ccd6', '#7d8090');
    c.beginPath(); c.moveTo(26, -10); c.lineTo(48, 0); c.lineTo(26, 10); c.closePath(); fs(c, '#f4d3a6', '#b38410');
    c.beginPath(); c.moveTo(40, -3.6); c.lineTo(48, 0); c.lineTo(40, 3.6); c.closePath(); fs(c, '#444');
    c.restore();
  },
  tshirt: function (c) {
    function p() {
      c.beginPath(); c.moveTo(-14, -38); c.quadraticCurveTo(0, -26, 14, -38); c.lineTo(38, -28); c.lineTo(49, -6);
      c.lineTo(32, 0); c.lineTo(30, 40); c.lineTo(-30, 40); c.lineTo(-32, 0); c.lineTo(-49, -6); c.lineTo(-38, -28); c.closePath();
    }
    p(); fs(c, '#5bc0eb');
    c.save(); p(); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(-50, 12, 100, 8); c.fillRect(-50, 26, 100, 5);
    c.restore();
    p(); fs(c, null, '#2a7fa6');
    c.beginPath(); c.moveTo(-14, -38); c.quadraticCurveTo(0, -26, 14, -38); fs(c, null, '#2a7fa6', 5);
    starPath(c, 0, -10, 10, 4.5); fs(c, '#ffd84d', '#c98a12', 2);
  },
  socks: function (c) {
    function sock(col, dk) {
      c.beginPath(); c.moveTo(-12, -36); c.lineTo(8, -36); c.lineTo(8, 8); c.lineTo(22, 10);
      c.quadraticCurveTo(36, 12, 36, 24); c.quadraticCurveTo(36, 34, 22, 34); c.lineTo(-2, 34);
      c.quadraticCurveTo(-12, 34, -12, 22); c.closePath(); fs(c, col, dk);
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(-10.5, -20, 17, 5); c.fillRect(-10.5, -9, 17, 5);
      circle(c, 27, 24, 5); fs(c, 'rgba(255,255,255,0.55)');
      rr(c, -15, -42, 26, 11, 4); fs(c, '#ffffff', dk, 2.5);
    }
    c.save(); c.translate(-16, -3); sock('#ff8fab', '#c24d6f'); c.restore();
    c.save(); c.translate(6, 5); sock('#b49cff', '#6c52c4'); c.restore();
  },
  cap: function (c) {
    c.beginPath(); c.moveTo(14, 4); c.quadraticCurveTo(52, 0, 52, 13); c.quadraticCurveTo(50, 22, 8, 18); c.closePath();
    fs(c, '#e04848', '#a83232');
    c.beginPath(); c.moveTo(-36, 12); c.quadraticCurveTo(-38, -34, 0, -34); c.quadraticCurveTo(36, -34, 34, 12); c.closePath();
    fs(c, '#ff6b6b', '#a83232');
    c.beginPath(); c.moveTo(0, -34); c.lineTo(0, 12);
    c.moveTo(-15, -30); c.quadraticCurveTo(-21, -10, -19, 12);
    c.moveTo(15, -30); c.quadraticCurveTo(21, -10, 19, 12);
    fs(c, null, '#d14d4d', 2);
    rr(c, -36, 6, 70, 8, 4); fs(c, '#ffd84d', '#a83232', 2);
    circle(c, 0, -35, 5); fs(c, '#ffd84d', '#a83232', 2);
    circle(c, -10, -12, 8); fs(c, '#ffffff');
    starPath(c, -10, -12, 6, 2.6); fs(c, '#ff6b6b');
  },
  cup: function (c) {
    c.beginPath(); c.arc(24, 6, 14, -Math.PI / 2, Math.PI / 2); c.lineCap = 'round';
    fs(c, null, '#b8603a', 12);
    c.beginPath(); c.arc(24, 6, 14, -Math.PI / 2, Math.PI / 2); fs(c, null, '#ffb38a', 6);
    rr(c, -32, -22, 54, 58, 10); fs(c, '#ffb38a', '#b8603a');
    ell(c, -5, -22, 27, 5.5); fs(c, '#ffe0cc', '#b8603a', 2.5);
    ell(c, -5, -21, 21, 3); fs(c, '#a0623a');
    heartPath(c, -5, 8, 10); fs(c, '#ff6b8a', '#c23a5a', 2);
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(-14, -31); c.bezierCurveTo(-20, -38, -8, -42, -14, -50);
    c.moveTo(4, -31); c.bezierCurveTo(-2, -38, 10, -42, 4, -50);
    fs(c, null, 'rgba(190,190,205,0.9)', 3);
  },
  plate: function (c) {
    ell(c, 0, 13, 47, 30); fs(c, '#c9d6e2');
    ell(c, 0, 8, 47, 30); fs(c, '#ffffff', '#8aa4bd');
    ell(c, 0, 7, 32, 19); fs(c, '#eef5fb', '#c4d4e3', 2);
    for (var i = 0; i < 12; i++) {
      var a = i * PI2 / 12;
      circle(c, Math.cos(a) * 39.5, 8 + Math.sin(a) * 24.5, 2.8); fs(c, '#7fb3e0');
    }
    ell(c, -12, 0, 9, 4); fs(c, 'rgba(255,255,255,0.9)');
  },
  apple: function (c) {
    c.beginPath(); c.moveTo(0, -24);
    c.bezierCurveTo(-20, -40, -48, -26, -42, 4);
    c.bezierCurveTo(-37, 30, -16, 44, 0, 36);
    c.bezierCurveTo(16, 44, 37, 30, 42, 4);
    c.bezierCurveTo(48, -26, 20, -40, 0, -24);
    c.closePath(); fs(c, '#ff5a5f', '#b52a33');
    c.beginPath(); c.moveTo(0, -24); c.quadraticCurveTo(2, -36, 6, -44); c.lineCap = 'round'; fs(c, null, '#7a4a24', 5);
    c.save(); c.translate(17, -38); c.rotate(-0.5); ell(c, 0, 0, 13, 6.5); fs(c, '#6cc24a', '#3d8a2a', 2.5); c.restore();
    ell(c, -22, -6, 6, 11); fs(c, 'rgba(255,255,255,0.6)');
    eyes(c, -10, 10, 6, 3.4, '#5a1a1e');
    c.beginPath(); c.moveTo(-4, 14); c.quadraticCurveTo(0, 18, 4, 14); fs(c, null, '#5a1a1e', 2.2);
    circle(c, -19, 14, 4.5); fs(c, 'rgba(255,200,200,0.55)');
    circle(c, 19, 14, 4.5); fs(c, 'rgba(255,200,200,0.55)');
  },
  sneakers: function (c) {
    c.beginPath(); c.moveTo(-42, 16); c.lineTo(-40, -14); c.quadraticCurveTo(-38, -24, -26, -24); c.lineTo(-8, -24);
    c.quadraticCurveTo(-2, -12, 10, -8); c.quadraticCurveTo(38, -2, 46, 10); c.quadraticCurveTo(48, 16, 44, 16); c.closePath();
    fs(c, '#7c8cff', '#3b48b0');
    c.beginPath(); c.moveTo(22, -3); c.quadraticCurveTo(40, 0, 46, 10); c.quadraticCurveTo(48, 16, 44, 16); c.lineTo(20, 16); c.closePath();
    fs(c, 'rgba(255,255,255,0.85)');
    c.lineCap = 'round';
    c.beginPath();
    for (var i = 0; i < 3; i++) { c.moveTo(-8 + i * 7, -17 + i * 3); c.lineTo(0 + i * 7, -13 + i * 3); }
    fs(c, null, '#ffffff', 3);
    starPath(c, -25, -2, 8, 3.5); fs(c, '#ffd84d', '#c98a12', 1.5);
    rr(c, -47, 13, 97, 13, 6); fs(c, '#ffffff', '#8a8fb0', 2.5);
    c.beginPath(); c.moveTo(-40, 20); c.lineTo(42, 20); fs(c, null, '#d0d3e6', 2);
  },
  boots: function (c) {
    c.beginPath(); c.moveTo(-28, -36); c.lineTo(4, -36); c.lineTo(6, 4); c.quadraticCurveTo(8, 10, 24, 12);
    c.quadraticCurveTo(46, 16, 44, 28); c.lineTo(-30, 28); c.closePath(); fs(c, '#b07040', '#6a3f1f');
    rr(c, -27, -6, 32, 7, 3.5); fs(c, '#8a5530');
    rr(c, -10, -9, 9, 13, 2); fs(c, '#ffd84d', '#6a3f1f', 2);
    rr(c, -34, -46, 44, 15, 7); fs(c, '#f6e7d2', '#b39a7a', 2.5);
    rr(c, -32, 25, 80, 11, 4); fs(c, '#5a3a22');
    ell(c, 24, 18, 6, 3); fs(c, 'rgba(255,255,255,0.3)');
  },
  slippers: function (c) {
    ell(c, 2, 26, 47, 11); fs(c, '#e9789f', '#b3486e');
    c.save(); c.translate(15, -12); c.rotate(-0.35);
    ell(c, 0, -10, 6.5, 15); fs(c, '#ffb8d2', '#c2557d', 2.5); ell(c, 0, -10, 3, 10); fs(c, '#ff8fb5');
    c.restore();
    c.save(); c.translate(31, -11); c.rotate(0.35);
    ell(c, 0, -10, 6.5, 15); fs(c, '#ffb8d2', '#c2557d', 2.5); ell(c, 0, -10, 3, 10); fs(c, '#ff8fb5');
    c.restore();
    c.beginPath(); c.moveTo(-8, 24); c.quadraticCurveTo(-4, -10, 23, -10); c.quadraticCurveTo(48, -8, 48, 24); c.closePath();
    fs(c, '#ffc9dc', '#c2557d');
    c.beginPath(); c.moveTo(-44, 24); c.quadraticCurveTo(-40, 14, -26, 16); c.lineTo(-8, 20); fs(c, null, '#c2557d', 3);
    eyes(c, 15, 31, 6, 3, '#4a1f30');
    circle(c, 23, 12, 2.6); fs(c, '#ff6b8a');
    circle(c, 9, 14, 3.5); fs(c, BLUSH);
    circle(c, 38, 14, 3.5); fs(c, BLUSH);
  }
};

function drawItem(c, kind, x, y, r, alpha) {
  var fn = ITEMS[kind];
  if (!fn) return;
  c.save();
  c.translate(x, y);
  var s = r / 48;
  c.scale(s, s);
  if (alpha !== undefined) c.globalAlpha = alpha;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  fn(c);
  c.restore();
}

// ---------- furniture (screen px) ----------
function bookshelf(c, x, y, w, h) {
  var dk = '#8a5a36';
  rr(c, x, y, w, h, 10); fs(c, '#c98f5e', dk, 2);
  var p = Math.max(5, w * 0.07);
  rr(c, x + p, y + p, w - 2 * p, h - 2 * p, 5); fs(c, '#6f4428');
  var pal = ['#ff7b7b', '#6aa6e8', '#ffd166', '#8fd6b4', '#b49cff', '#ffa86b', '#f7f0e0'];
  var shelves = 3, ih = (h - 2 * p) / shelves, k = 3;
  for (var s = 0; s < shelves; s++) {
    var sy = y + p + ih * (s + 1);
    var bx = x + p + 3, end = x + w - p - 3;
    while (bx < end - 4) {
      var bw = Math.max(5, w * 0.075 * (0.8 + 0.6 * hash(k)));
      if (bx + bw > end) break;
      var bh = (ih - 8) * (0.62 + 0.33 * hash(k + 7));
      if (s === 0 && hash(k + 2) > 0.8 && bx + ih * 0.5 < end) {
        // little plant pot
        var pw = ih * 0.45;
        rr(c, bx, sy - 3 - pw * 0.6, pw, pw * 0.6, 3); fs(c, '#e9845d');
        ell(c, bx + pw / 2, sy - 3 - pw * 0.75, pw * 0.42, pw * 0.3); fs(c, '#6cc24a');
        bx += pw + 3; k++; continue;
      }
      rr(c, bx, sy - 3 - bh, bw, bh, 2); fs(c, pal[k % pal.length]);
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(bx + 1, sy - 3 - bh * 0.8, bw - 2, 2);
      bx += bw + 1.5; k++;
    }
    c.fillStyle = '#c98f5e'; c.fillRect(x + p - 1, sy - 3, w - 2 * p + 2, 5);
  }
}

function wardrobe(c, x, y, w, h) {
  var dk = '#9a6438';
  c.beginPath(); c.moveTo(x + w * 0.06, y + h * 0.1); c.quadraticCurveTo(x + w / 2, y - h * 0.03, x + w * 0.94, y + h * 0.1); c.closePath();
  fs(c, '#d9965c', dk, 2);
  rr(c, x + w * 0.16, y + h * 0.92, w * 0.12, h * 0.08, 3); fs(c, dk);
  rr(c, x + w * 0.72, y + h * 0.92, w * 0.12, h * 0.08, 3); fs(c, dk);
  rr(c, x + w * 0.04, y + h * 0.08, w * 0.92, h * 0.86, 12); fs(c, '#e8b07a', dk, 2);
  var dw = w * 0.4, dy = y + h * 0.14, dh = h * 0.74;
  rr(c, x + w * 0.09, dy, dw, dh, 8); fs(c, '#f3c99a', '#b57a45', 2);
  rr(c, x + w * 0.51, dy, dw, dh, 8); fs(c, '#f3c99a', '#b57a45', 2);
  rr(c, x + w * 0.14, dy + dh * 0.08, dw - w * 0.1, dh * 0.4, 6); fs(c, null, '#dba56f', 1.5);
  rr(c, x + w * 0.56, dy + dh * 0.08, dw - w * 0.1, dh * 0.4, 6); fs(c, null, '#dba56f', 1.5);
  var hs = Math.min(w, h) * 0.07;
  heartPath(c, x + w * 0.29, dy + dh * 0.72, hs); fs(c, '#ec9a7a');
  heartPath(c, x + w * 0.71, dy + dh * 0.72, hs); fs(c, '#ec9a7a');
  circle(c, x + w * 0.45, dy + dh * 0.5, Math.max(2.5, w * 0.03)); fs(c, '#ffd84d', dk, 1.5);
  circle(c, x + w * 0.55, dy + dh * 0.5, Math.max(2.5, w * 0.03)); fs(c, '#ffd84d', dk, 1.5);
}

function toybox(c, x, y, w, h) {
  var dk = '#3f8f72';
  var by = y + h * 0.4, bh = h * 0.6;
  c.save(); c.translate(x + w * 0.08, by); c.rotate(-0.2);
  rr(c, -2, -h * 0.16, w * 0.84, h * 0.16, 6); fs(c, '#5fb892', dk, 2);
  c.restore();
  var s = Math.min(w, h) * 0.2;
  drawItem(c, 'ball', x + w * 0.36, by - s * 0.2, s);
  drawItem(c, 'bear', x + w * 0.66, by - s * 0.3, s * 1.1);
  rr(c, x + w * 0.05, by, w * 0.9, bh, 10); fs(c, '#7fcfb0', dk, 2);
  rr(c, x + w * 0.05, by, w * 0.9, bh * 0.18, 6); fs(c, '#6cc3a2');
  var st = Math.min(w, h) * 0.07;
  starPath(c, x + w * 0.2, by + bh * 0.55, st, st * 0.45); fs(c, '#ffd84d');
  starPath(c, x + w * 0.8, by + bh * 0.55, st, st * 0.45); fs(c, '#ff8fab');
  eyes(c, x + w * 0.42, x + w * 0.58, by + bh * 0.46, Math.max(2, st * 0.4), '#2f5f4c');
  c.beginPath(); c.arc(x + w * 0.5, by + bh * 0.58, st * 0.8, 0.2, Math.PI - 0.2); fs(c, null, '#2f5f4c', 2);
}

function kitchenShelf(c, x, y, w, h) {
  var dk = '#b07a45';
  rr(c, x + w * 0.05, y, w * 0.9, h * 0.52, 8); fs(c, '#fdebd0', dk, 2);
  // tiles
  c.strokeStyle = 'rgba(176,122,69,0.18)'; c.lineWidth = 1;
  c.beginPath();
  for (var tx = x + w * 0.05 + 10; tx < x + w * 0.95; tx += 10) { c.moveTo(tx, y + 3); c.lineTo(tx, y + h * 0.48); }
  c.stroke();
  var s = Math.min(w * 0.2, h * 0.2);
  drawItem(c, 'plate', x + w * 0.3, y + h * 0.27, s * 1.1);
  drawItem(c, 'cup', x + w * 0.68, y + h * 0.3, s * 0.9);
  rr(c, x, y + h * 0.48, w, h * 0.08, 4); fs(c, '#e0a35f', dk, 2);
  rr(c, x + w * 0.04, y + h * 0.56, w * 0.92, h * 0.44, 8); fs(c, '#ffcf99', dk, 2);
  rr(c, x + w * 0.09, y + h * 0.61, w * 0.39, h * 0.34, 6); fs(c, '#ffdcb3', '#d29b62', 1.5);
  rr(c, x + w * 0.52, y + h * 0.61, w * 0.39, h * 0.34, 6); fs(c, '#ffdcb3', '#d29b62', 1.5);
  circle(c, x + w * 0.44, y + h * 0.78, Math.max(2.2, w * 0.025)); fs(c, '#ffd84d', dk, 1.5);
  circle(c, x + w * 0.56, y + h * 0.78, Math.max(2.2, w * 0.025)); fs(c, '#ffd84d', dk, 1.5);
}

function shoeRack(c, x, y, w, h) {
  var wood = '#c48b5c', dk = '#7d5230';
  rr(c, x + w * 0.06, y + h * 0.04, w * 0.06, h * 0.96, 3); fs(c, wood, dk, 1.5);
  rr(c, x + w * 0.88, y + h * 0.04, w * 0.06, h * 0.96, 3); fs(c, wood, dk, 1.5);
  var t1 = y + h * 0.46, t2 = y + h * 0.9;
  var s = Math.min(w * 0.2, h * 0.21);
  drawItem(c, 'sneakers', x + w * 0.33, t1 - s * 0.55, s);
  drawItem(c, 'slippers', x + w * 0.68, t1 - s * 0.6, s);
  drawItem(c, 'boots', x + w * 0.33, t2 - s * 0.75, s);
  drawItem(c, 'sneakers', x + w * 0.68, t2 - s * 0.55, s);
  rr(c, x + w * 0.03, y, w * 0.94, h * 0.07, 3); fs(c, wood, dk, 1.5);
  rr(c, x + w * 0.03, t1, w * 0.94, h * 0.07, 3); fs(c, wood, dk, 1.5);
  rr(c, x + w * 0.03, t2, w * 0.94, h * 0.08, 3); fs(c, wood, dk, 1.5);
}

var FURNITURE = { toys: toybox, books: bookshelf, clothes: wardrobe, kitchen: kitchenShelf, shoes: shoeRack };

function drawFurniture(c, catId, a) {
  var fn = FURNITURE[catId];
  if (!fn) return;
  c.save(); c.lineJoin = 'round';
  fn(c, a.x, a.y, a.w, a.h);
  c.restore();
}

function drawLabel(c, cx, cy, h, text, iconKind, maxW) {
  var fsz = Math.round(h * 0.6);
  c.font = 'bold ' + fsz + 'px sans-serif';
  var tw = c.measureText(text).width;
  var w = Math.min(maxW, tw + h * 1.5 + 12);
  c.save();
  rr(c, cx - w / 2, cy - h / 2 + 1.5, w, h, h / 2); fs(c, 'rgba(120,70,40,0.25)');
  rr(c, cx - w / 2, cy - h / 2, w, h, h / 2); fs(c, 'rgba(255,251,242,0.96)', '#d9b48a', 1.5);
  drawItem(c, iconKind, cx - w / 2 + h * 0.62 + 2, cy, h * 0.36);
  c.fillStyle = '#6b3f22'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(text, cx - w / 2 + h * 1.25 + 4, cy + 0.5);
  c.restore();
}

// ---------- room background ----------
function drawRoom(c, W, H, L) {
  var fl = L.floorLine;
  var g = c.createLinearGradient(0, 0, 0, fl);
  g.addColorStop(0, '#ffe9cf'); g.addColorStop(1, '#f7d1a8');
  c.fillStyle = g; c.fillRect(0, 0, W, fl);
  c.fillStyle = 'rgba(255,255,255,0.22)';
  for (var sx = 0; sx < W; sx += 26) c.fillRect(sx, 0, 11, fl);
  c.fillStyle = 'rgba(232,150,110,0.18)';
  for (var dy = 14; dy < fl; dy += 28) for (var dx = 19; dx < W; dx += 52) { circle(c, dx + (Math.floor(dy / 28) % 2) * 26, dy, 2.2); c.fill(); }

  // floor planks
  c.fillStyle = '#d9a46f'; c.fillRect(0, fl, W, H - fl);
  var ph = 24, row = 0;
  for (var py = fl; py < H; py += ph, row++) {
    c.fillStyle = row % 2 ? '#d49c66' : '#ddaa75';
    c.fillRect(0, py, W, ph);
    c.fillStyle = 'rgba(110,62,28,0.22)'; c.fillRect(0, py + ph - 1.5, W, 1.5);
    var off = (row * 47) % 110;
    for (var px = -off; px < W; px += 110) c.fillRect(px, py, 1.5, ph);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, py + 3, W, 2);
  }
  var fg = c.createLinearGradient(0, fl, 0, H);
  fg.addColorStop(0, 'rgba(90,45,15,0.18)'); fg.addColorStop(0.3, 'rgba(90,45,15,0)'); fg.addColorStop(1, 'rgba(90,45,15,0.12)');
  c.fillStyle = fg; c.fillRect(0, fl, W, H - fl);
  // baseboard
  c.fillStyle = '#f3dcc0'; c.fillRect(0, fl - 7, W, 8);
  c.fillStyle = 'rgba(140,90,50,0.35)'; c.fillRect(0, fl + 1, W, 2);

  // window
  var w = L.win;
  if (w && w.w > 20) {
    rr(c, w.x - 4, w.y - 4, w.w + 8, w.h + 8, 10); fs(c, '#fffaf2', '#d9b48a', 2);
    var sky = c.createLinearGradient(0, w.y, 0, w.y + w.h);
    sky.addColorStop(0, '#a9dcff'); sky.addColorStop(1, '#fff2cc');
    rr(c, w.x, w.y, w.w, w.h, 7); c.fillStyle = sky; c.fill();
    c.save(); rr(c, w.x, w.y, w.w, w.h, 7); c.clip();
    var sr = Math.min(w.w, w.h) * 0.16;
    circle(c, w.x + w.w * 0.7, w.y + w.h * 0.3, sr * 1.8); fs(c, 'rgba(255,236,150,0.45)');
    circle(c, w.x + w.w * 0.7, w.y + w.h * 0.3, sr); fs(c, '#ffe27a');
    var cx = w.x + w.w * 0.28, cy = w.y + w.h * 0.62, cr = Math.min(w.w, w.h) * 0.09;
    circle(c, cx, cy, cr); fs(c, '#ffffff'); circle(c, cx + cr, cy - cr * 0.5, cr * 1.2); fs(c, '#ffffff');
    circle(c, cx + cr * 2.1, cy, cr); fs(c, '#ffffff');
    c.restore();
    c.fillStyle = '#fffaf2';
    c.fillRect(w.x + w.w / 2 - 2, w.y, 4, w.h); c.fillRect(w.x, w.y + w.h / 2 - 2, w.w, 4);
    // curtains
    var cw = Math.max(8, w.w * 0.18);
    [[w.x - 6, 1], [w.x + w.w + 6, -1]].forEach(function (s) {
      var x0 = s[0], d = s[1];
      c.beginPath(); c.moveTo(x0, w.y - 8); c.lineTo(x0 + d * cw, w.y - 8);
      c.quadraticCurveTo(x0 + d * cw * 0.3, w.y + w.h * 0.5, x0 + d * cw * 0.7, w.y + w.h + 8);
      c.lineTo(x0 - d * 4, w.y + w.h + 8); c.closePath(); fs(c, '#f7a6a0', '#d9776f', 1.5);
    });
    rr(c, w.x - cw - 10, w.y - 12, w.w + cw * 2 + 20, 6, 3); fs(c, '#b5835a');
    rr(c, w.x - 10, w.y + w.h + 4, w.w + 20, 7, 3); fs(c, '#f3dcc0', '#d9b48a', 1.5);
    // sunbeam onto the floor
    var bg = c.createLinearGradient(0, w.y + w.h, 0, H);
    bg.addColorStop(0, 'rgba(255,240,180,0.32)'); bg.addColorStop(1, 'rgba(255,240,180,0)');
    c.beginPath(); c.moveTo(w.x + w.w * 0.1, w.y + w.h); c.lineTo(w.x + w.w * 0.9, w.y + w.h);
    c.lineTo(w.x + w.w * 2.2, H * 0.92); c.lineTo(w.x - w.w * 0.6, H * 0.92); c.closePath();
    c.fillStyle = bg; c.fill();
  }

  // rug
  var r = L.rug;
  if (r) {
    ell(c, r.cx, r.cy + 4, r.rx, r.ry); fs(c, 'rgba(90,40,10,0.15)');
    ell(c, r.cx, r.cy, r.rx, r.ry); fs(c, '#e98b6d', '#c4664c', 2);
    ell(c, r.cx, r.cy, r.rx * 0.86, r.ry * 0.82); fs(c, '#f6c28b');
    ell(c, r.cx, r.cy, r.rx * 0.74, r.ry * 0.66); fs(c, '#e98b6d');
    ell(c, r.cx, r.cy, r.rx * 0.5, r.ry * 0.42); fs(c, '#f9dcae');
    ell(c, r.cx, r.cy, r.rx * 0.22, r.ry * 0.18); fs(c, '#7cc6b0');
    for (var i = 0; i < 16; i++) {
      var a = i * PI2 / 16;
      circle(c, r.cx + Math.cos(a) * r.rx * 0.8, r.cy + Math.sin(a) * r.ry * 0.74, Math.max(2, r.ry * 0.03)); fs(c, '#fff3dc');
    }
  }
}

// ---------- small icons ----------
function broom(c, x, y, s) {
  c.save(); c.translate(x, y); c.rotate(0.5); c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, -s); c.lineTo(0, s * 0.2); fs(c, null, '#a0663c', s * 0.22);
  c.beginPath(); c.moveTo(-s * 0.18, s * 0.15); c.lineTo(s * 0.18, s * 0.15); c.lineTo(s * 0.5, s); c.lineTo(-s * 0.5, s); c.closePath();
  fs(c, '#ffcf5a', '#c98a12', s * 0.1);
  c.restore();
  starPath(c, x + s * 0.9, y - s * 0.7, s * 0.45, s * 0.2); fs(c, '#ffd84d', '#c98a12', 1);
}
function flame(c, x, y, s) {
  c.beginPath(); c.moveTo(x, y - s);
  c.bezierCurveTo(x + s * 0.9, y - s * 0.2, x + s * 0.8, y + s, x, y + s);
  c.bezierCurveTo(x - s * 0.8, y + s, x - s * 0.9, y - s * 0.1, x - s * 0.2, y - s * 0.4);
  c.quadraticCurveTo(x - s * 0.1, y - s * 0.7, x, y - s); c.closePath(); fs(c, '#ff7a3c', '#d9481a', 1.5);
  c.beginPath(); c.moveTo(x, y - s * 0.2);
  c.bezierCurveTo(x + s * 0.5, y + s * 0.3, x + s * 0.4, y + s * 0.85, x, y + s * 0.85);
  c.bezierCurveTo(x - s * 0.4, y + s * 0.85, x - s * 0.45, y + s * 0.4, x, y - s * 0.2); c.closePath(); fs(c, '#ffd84d');
}
function iconRestart(c, x, y, s, col) {
  c.beginPath(); c.arc(x, y, s, -Math.PI * 0.35, Math.PI * 1.45); c.lineCap = 'round'; fs(c, null, col, s * 0.32);
  var a = -Math.PI * 0.35, ax = x + Math.cos(a) * s, ay = y + Math.sin(a) * s;
  c.beginPath(); c.moveTo(ax + s * 0.55, ay - s * 0.1); c.lineTo(ax - s * 0.1, ay - s * 0.55); c.lineTo(ax - s * 0.05, ay + s * 0.4); c.closePath();
  fs(c, col);
}
function iconPause(c, x, y, s, col) {
  rr(c, x - s * 0.7, y - s, s * 0.5, s * 2, s * 0.2); fs(c, col);
  rr(c, x + s * 0.2, y - s, s * 0.5, s * 2, s * 0.2); fs(c, col);
}
function iconSound(c, x, y, s, col, muted) {
  c.beginPath(); c.moveTo(x - s, y - s * 0.4); c.lineTo(x - s * 0.45, y - s * 0.4); c.lineTo(x + s * 0.15, y - s);
  c.lineTo(x + s * 0.15, y + s); c.lineTo(x - s * 0.45, y + s * 0.4); c.lineTo(x - s, y + s * 0.4); c.closePath(); fs(c, col);
  c.lineCap = 'round';
  if (muted) {
    c.beginPath(); c.moveTo(x + s * 0.45, y - s * 0.4); c.lineTo(x + s, y + s * 0.4);
    c.moveTo(x + s, y - s * 0.4); c.lineTo(x + s * 0.45, y + s * 0.4); fs(c, null, '#e0524f', s * 0.25);
  } else {
    c.beginPath(); c.arc(x + s * 0.2, y, s * 0.5, -0.9, 0.9); fs(c, null, col, s * 0.22);
    c.beginPath(); c.arc(x + s * 0.2, y, s * 0.9, -0.9, 0.9); fs(c, null, col, s * 0.22);
  }
}

module.exports = {
  rr: rr, ell: ell, circle: circle, starPath: starPath, heartPath: heartPath, fs: fs,
  drawItem: drawItem, drawFurniture: drawFurniture, drawLabel: drawLabel, drawRoom: drawRoom,
  broom: broom, flame: flame, iconRestart: iconRestart, iconPause: iconPause, iconSound: iconSound,
  ITEM_DRAWERS: ITEMS
};

};
__modules["js/audio.js"]=function(module,exports,require){
'use strict';
// Tiny synthesized sound effects via wx.createWebAudioContext(). Silently no-ops if unavailable.

function createAudio() {
  var ac = null;
  try {
    if (typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
      ac = wx.createWebAudioContext();
    }
  } catch (e) { ac = null; }

  var api = { muted: false, available: !!ac };

  function tone(o) {
    if (!ac || api.muted) return;
    try {
      var t0 = (ac.currentTime || 0) + (o.delay || 0);
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(o.vol || 0.15, t0 + (o.attack || 0.012));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.05);
    } catch (e) { /* ignore audio errors */ }
  }

  api.resume = function () {
    try { if (ac && ac.state === 'suspended' && ac.resume) ac.resume(); } catch (e) { /* ignore */ }
  };

  // Soft two-note bell; pitch climbs a little with the combo.
  api.chime = function (combo) {
    var k = Math.min(Math.max(combo || 1, 1), 8) - 1;
    var base = 659.25 * Math.pow(2, k * 2 / 12);
    tone({ f: base, dur: 0.55, vol: 0.14 });
    tone({ f: base * 1.5, dur: 0.6, vol: 0.09, delay: 0.07 });
    tone({ f: base * 3, dur: 0.35, vol: 0.025, delay: 0.07, type: 'triangle' });
  };

  api.boing = function () {
    tone({ f: 330, f2: 110, dur: 0.34, vol: 0.2 });
    tone({ f: 495, f2: 170, dur: 0.22, vol: 0.05, delay: 0.02, type: 'triangle' });
  };

  api.pop = function () { tone({ f: 520, f2: 900, dur: 0.09, vol: 0.07 }); };
  api.click = function () { tone({ f: 700, dur: 0.06, vol: 0.05, type: 'triangle' }); };

  api.fanfare = function () {
    var notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach(function (f, i) {
      var last = i === notes.length - 1;
      tone({ f: f, dur: last ? 0.9 : 0.22, vol: 0.12, delay: i * 0.13, type: 'triangle' });
      tone({ f: f * 2, dur: last ? 0.7 : 0.18, vol: 0.03, delay: i * 0.13 });
    });
    tone({ f: 783.99, dur: 0.8, vol: 0.06, delay: 0.39, type: 'sine' });
  };

  api.timeup = function () {
    [392, 330, 262].forEach(function (f, i) {
      tone({ f: f, dur: 0.3, vol: 0.1, delay: i * 0.18, type: 'triangle' });
    });
  };

  return api;
}

module.exports = createAudio;

};
__modules["js/logic.js"]=function(module,exports,require){
'use strict';
// Pure game rules for 收纳达人 (Tidy Up). No wx / canvas access here, so it can be tested in node.

var CATEGORIES = [
  { id: 'toys', zh: '玩具箱', en: 'Toy Box', icon: 'ball' },
  { id: 'books', zh: '书架', en: 'Bookshelf', icon: 'storybook' },
  { id: 'clothes', zh: '衣柜', en: 'Wardrobe', icon: 'tshirt' },
  { id: 'kitchen', zh: '餐具架', en: 'Kitchen Shelf', icon: 'cup' },
  { id: 'shoes', zh: '鞋架', en: 'Shoe Rack', icon: 'sneakers' }
];

var ITEM_KINDS = {
  bear: { cat: 'toys', zh: '泰迪熊' },
  ball: { cat: 'toys', zh: '皮球' },
  car: { cat: 'toys', zh: '玩具车' },
  duck: { cat: 'toys', zh: '小黄鸭' },
  storybook: { cat: 'books', zh: '故事书' },
  notebook: { cat: 'books', zh: '笔记本' },
  pencil: { cat: 'books', zh: '铅笔' },
  tshirt: { cat: 'clothes', zh: 'T恤' },
  socks: { cat: 'clothes', zh: '袜子' },
  cap: { cat: 'clothes', zh: '帽子' },
  cup: { cat: 'kitchen', zh: '杯子' },
  plate: { cat: 'kitchen', zh: '盘子' },
  apple: { cat: 'kitchen', zh: '苹果' },
  sneakers: { cat: 'shoes', zh: '运动鞋' },
  boots: { cat: 'shoes', zh: '靴子' },
  slippers: { cat: 'shoes', zh: '拖鞋' }
};

var ITEMS_BY_CAT = {};
CATEGORIES.forEach(function (c) { ITEMS_BY_CAT[c.id] = []; });
Object.keys(ITEM_KINDS).forEach(function (k) { ITEMS_BY_CAT[ITEM_KINDS[k].cat].push(k); });

function levelTime(n) { return Math.max(75 - 5 * (n - 1), 45); }
function levelItemCount(n) { return Math.min(8 + 2 * (n - 1), 20); }

function shuffle(arr, rand) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// All zones that accept this kind. By design always exactly one.
function validZonesFor(kind) {
  var def = ITEM_KINDS[kind];
  if (!def) return [];
  return CATEGORIES.filter(function (c) { return c.id === def.cat; }).map(function (c) { return c.id; });
}

function isCorrect(kind, zoneId) {
  var z = validZonesFor(kind);
  return z.length === 1 && z[0] === zoneId;
}

// Cycle through the 5 categories (in a shuffled order) so counts differ by at most 1,
// and cycle through a shuffled pool of identities inside each category.
function buildItemList(n, rand) {
  rand = rand || Math.random;
  var count = levelItemCount(n);
  var order = shuffle(CATEGORIES.map(function (c) { return c.id; }), rand);
  var pools = {}, ptr = {};
  order.forEach(function (cat) { pools[cat] = shuffle(ITEMS_BY_CAT[cat].slice(), rand); ptr[cat] = 0; });
  var list = [];
  for (var i = 0; i < count; i++) {
    var cat = order[i % order.length];
    var pool = pools[cat];
    var kind = pool[ptr[cat] % pool.length];
    ptr[cat]++;
    list.push({ kind: kind, cat: cat });
  }
  shuffle(list, rand);
  list.forEach(function (it, idx) { it.id = idx; });
  return list;
}

// Random non-overlapping positions inside floor rect {x,y,w,h} (rejection sampling).
// Every item gets the same radius r and lies fully inside the floor.
function scatterItems(items, floor, rand) {
  rand = rand || Math.random;
  var n = items.length;
  if (!n) return 0;
  var r = Math.sqrt(0.36 * floor.w * floor.h / (n * Math.PI));
  r = Math.min(r, 34, floor.w / 4, floor.h / 4);
  for (var attempt = 0; attempt < 14; attempt++) {
    var gap = Math.max(4, r * 0.2);
    var minD2 = (2 * r + gap) * (2 * r + gap);
    var pts = [];
    var ok = true;
    for (var i = 0; i < n && ok; i++) {
      var placed = false;
      for (var k = 0; k < 500; k++) {
        var x = floor.x + r + rand() * (floor.w - 2 * r);
        var y = floor.y + r + rand() * (floor.h - 2 * r);
        var clash = false;
        for (var p = 0; p < pts.length; p++) {
          var dx = pts[p].x - x, dy = pts[p].y - y;
          if (dx * dx + dy * dy < minD2) { clash = true; break; }
        }
        if (!clash) { pts.push({ x: x, y: y }); placed = true; break; }
      }
      if (!placed) ok = false;
    }
    if (ok) {
      for (var a = 0; a < n; a++) { items[a].x = pts[a].x; items[a].y = pts[a].y; items[a].r = r; }
      return r;
    }
    r *= 0.92;
  }
  // Fallback: jittered grid, always succeeds.
  var cols = Math.max(1, Math.ceil(Math.sqrt(n * floor.w / floor.h)));
  var rows = Math.ceil(n / cols);
  var cw = floor.w / cols, ch = floor.h / rows;
  r = Math.min(cw, ch) / 2 * 0.85;
  var cells = [];
  for (var c = 0; c < cols * rows; c++) cells.push(c);
  shuffle(cells, rand);
  for (var b = 0; b < n; b++) {
    var cell = cells[b];
    var jx = (cw / 2 - r) * (rand() * 2 - 1) * 0.8;
    var jy = (ch / 2 - r) * (rand() * 2 - 1) * 0.8;
    items[b].x = floor.x + (cell % cols + 0.5) * cw + jx;
    items[b].y = floor.y + (Math.floor(cell / cols) + 0.5) * ch + jy;
    items[b].r = r;
  }
  return r;
}

function createLevel(n, floor, rand) {
  rand = rand || Math.random;
  n = Math.max(1, n | 0);
  var items = buildItemList(n, rand);
  items.forEach(function (it) { it.placed = false; });
  scatterItems(items, floor, rand);
  var t = levelTime(n);
  return {
    level: n, items: items, timeTotal: t, timeLeft: t,
    score: 0, combo: 0, maxCombo: 0, placedCount: 0,
    over: false, status: 'playing'
  };
}

// Try to put item into a zone. Correct: +10 + combo*2 (combo counted after increment).
function placeItem(state, itemId, zoneId) {
  var it = state.items[itemId];
  if (!it || it.placed || state.over) return { ok: false, ignored: true };
  if (isCorrect(it.kind, zoneId)) {
    it.placed = true;
    state.combo += 1;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    var points = 10 + state.combo * 2;
    state.score += points;
    state.placedCount += 1;
    var won = state.placedCount === state.items.length;
    if (won) { state.over = true; state.status = 'won'; }
    return { ok: true, points: points, combo: state.combo, won: won };
  }
  state.combo = 0;
  return { ok: false, points: 0, combo: 0, won: false };
}

// Dropped on empty floor: counts as a mistake.
function missItem(state) { if (!state.over) state.combo = 0; }

function tick(state, dt) {
  if (state.over) return state.status;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) { state.timeLeft = 0; state.over = true; state.status = 'timeup'; }
  return state.status;
}

function isWon(state) { return state.status === 'won'; }

function starsFor(timeLeft, total) {
  var f = total > 0 ? timeLeft / total : 0;
  if (f > 0.4) return 3;
  if (f > 0.15) return 2;
  return 1;
}

module.exports = {
  CATEGORIES: CATEGORIES, ITEM_KINDS: ITEM_KINDS, ITEMS_BY_CAT: ITEMS_BY_CAT,
  levelTime: levelTime, levelItemCount: levelItemCount, shuffle: shuffle,
  validZonesFor: validZonesFor, isCorrect: isCorrect, buildItemList: buildItemList,
  scatterItems: scatterItems, createLevel: createLevel, placeItem: placeItem,
  missItem: missItem, tick: tick, isWon: isWon, starsFor: starsFor
};

};
__require("__entry__")("./game.js");
})();
