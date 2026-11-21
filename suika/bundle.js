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
// game.js — 合成大西瓜 main entry: game loop, rendering, touch controls,
// merge flow and game over. Pure canvas rendering, no DOM, no assets.
//
// Coordinate system: design units, 375 wide (the "750 design px" resolution
// expressed in half-points; js/fruits.js radii are already in these units).
// The design height follows the real screen aspect ratio. Everything is
// scaled to device pixels (including devicePixelRatio) via one transform.
//
// js/audio.js ships in chunk 3 and is optional: every sound call goes
// through sfx(), which silently does nothing when the module is missing.

var storage = require('./js/storage.js');
var fruitsMod = require('./js/fruits.js');
var physics = require('./js/physics.js');

var audio = null;
try { audio = require('./js/audio.js'); } catch (e) { audio = null; }

var FRUITS = fruitsMod.FRUITS;
var getFruit = fruitsMod.getFruit;
var randomSpawnTier = fruitsMod.randomSpawnTier;
var mergeResult = fruitsMod.mergeResult;

// ------------------------------------------------------------------ setup

var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');

var info = wx.getSystemInfoSync();
var SW = info.screenWidth || 375;
var SH = info.screenHeight || 667;
var DPR = info.pixelRatio || 2;

var W = 375;                       // design width (units)
var H = W * SH / SW;               // design height (units)
var SCALE = 1;                     // canvas px per design unit

var L = {
  cupLeft: 14,                     // cup outer bounds (design units)
  cupRight: 361,
  cupTop: 170,
  wallT: 10,                       // wood frame thickness
  innerLeft: 24,
  innerRight: 351,
  innerBottom: 0,
  dangerY: 180,                    // cupTop + 10: lose line
  dropperY: 128,                   // hanging fruit center
  muteBtn: { x: 26, y: 30, r: 16 },
  restartBtn: { x: 349, y: 30, r: 16 },
  overlayBtn: { x: 0, y: 0, w: 160, h: 46 }   // filled in drawOverlay
};

function initCanvas() {
  canvas.width = Math.round(SW * DPR);
  canvas.height = Math.round(SH * DPR);
  SCALE = canvas.width / W;
}
initCanvas();

// Physics world bounds = cup interior (open top).
function makeWorld() {
  return physics.createWorld({
    left: L.innerLeft,
    right: L.innerRight,
    bottom: L.innerBottom
  });
}

// ------------------------------------------------------------------ state

var world = null;
var state = 'play';                // 'play' | 'over'
var score = 0;
var best = storage.getBest();
var muted = storage.getMuted();
var newRecord = false;

var currentTier = 1;               // fruit on the dropper
var nextTier = 2;                  // fruit shown in the preview
var phase = 'aim';                 // 'aim' | 'cooldown'
var cooldownT = 0;
var droppedBody = null;
var MIN_COOLDOWN = 0.55;           // s before the dropper may re-arm
var MAX_WAIT = 2.4;                // s after which it re-arms regardless
var DROP_SPEED = 260;              // initial downward velocity (units/s)
var POP_SPEED = 170;               // upward pop of merged fruit

var aiming = false;
var aimX = W / 2;
var time = 0;

var aboveT = 0;                    // seconds a settled fruit topped the line
var OVER_LIMIT = 1.5;
var warn = false;                  // some settled fruit is above the line

var popups = [];                   // { x, y, text, life }
var rings = [];                    // { x, y, r0, r1, life, maxLife, color }
var parts = [];                    // particles / confetti

function resetGame() {
  world = makeWorld();
  score = 0;
  newRecord = false;
  aboveT = 0;
  warn = false;
  state = 'play';
  phase = 'aim';
  cooldownT = 0;
  droppedBody = null;
  aiming = false;
  aimX = W / 2;
  popups = [];
  rings = [];
  parts = [];
  currentTier = randomSpawnTier();
  nextTier = randomSpawnTier();
}
L.innerBottom = H - 14 - L.wallT;
resetGame();

// ------------------------------------------------------------------ audio

// Plays a named sound if the (optional) audio module exposes either
// play(name, arg) or a function named after the sound.
function sfx(name, arg) {
  if (!audio) return;
  try {
    if (typeof audio.play === 'function') audio.play(name, arg);
    else if (typeof audio[name] === 'function') audio[name](arg);
  } catch (e) { /* never let sound break the game */ }
}

function pushMuted() {
  if (audio && typeof audio.setMuted === 'function') {
    try { audio.setMuted(muted); } catch (e) {}
  }
}
pushMuted();

// ------------------------------------------------------------------ helpers

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// Mixes a #rrggbb color toward white (f > 0) or black (f < 0).
function shade(hex, f) {
  var n = parseInt(hex.slice(1), 16);
  var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) {
    r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f;
  } else {
    r *= 1 + f; g *= 1 + f; b *= 1 + f;
  }
  return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}

function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setDash(v) {
  if (typeof ctx.setLineDash === 'function') {
    try { ctx.setLineDash(v); } catch (e) {}
  }
}

// ------------------------------------------------------------------ drawing

function drawBackground() {
  var grad = null;
  try {
    grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffedcf');
    grad.addColorStop(0.55, '#ffe3b8');
    grad.addColorStop(1, '#ffd49b');
  } catch (e) {}
  ctx.fillStyle = grad || '#ffe3b8';
  ctx.fillRect(0, 0, W, H);
}

// Wood-ish cup: outer rounded slab, interior punched on top of it so the
// mouth stays open and the left/right/bottom walls remain visible.
function drawContainer() {
  var x = L.cupLeft, y = L.cupTop;
  var w = L.cupRight - L.cupLeft;
  var h = (H - 14) - y;

  var grad = null;
  try {
    grad = ctx.createLinearGradient(x, 0, L.cupRight, 0);
    grad.addColorStop(0, '#9c6437');
    grad.addColorStop(0.5, '#b07a45');
    grad.addColorStop(1, '#8a5a33');
  } catch (e) {}
  ctx.fillStyle = grad || '#a9743f';
  rr(x, y, w, h, 18);
  ctx.fill();

  // interior
  ctx.fillStyle = 'rgba(255, 250, 238, 0.55)';
  rr(L.innerLeft - 1, y + 1, (L.innerRight - L.innerLeft) + 2,
     h - L.wallT - 1, 10);
  ctx.fill();

  // rim highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  rr(x + 2, y + 2, w - 4, h - 4, 15);
  ctx.stroke();
}

function drawDangerLine() {
  var y = L.dangerY;
  var x0 = L.innerLeft + 4, x1 = L.innerRight - 4;
  var alpha = warn ? 0.55 + 0.45 * Math.abs(Math.sin(time * 9)) : 0.45;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = warn ? '#ff3b30' : '#e88a7a';
  ctx.lineWidth = warn ? 3 : 2;
  setDash([9, 7]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  setDash([]);
  ctx.restore();
}

// Evolution chart: the 11 tiers, smallest to largest, left to right.
function drawChart() {
  var gap = 5, y = 78;
  var radii = [], total = 0, t;
  for (t = 1; t <= FRUITS.length; t++) {
    var r = 3.5 + t * 0.45;
    radii.push(r);
    total += r * 2;
  }
  total += gap * (FRUITS.length - 1);
  var x = W / 2 - total / 2;
  ctx.save();
  for (t = 1; t <= FRUITS.length; t++) {
    var r = radii[t - 1];
    var cx = x + r;
    var f = getFruit(t);
    try {
      var g = ctx.createRadialGradient(cx - r * 0.35, y - r * 0.4, r * 0.15, cx, y, r);
      g.addColorStop(0, shade(f.color, 0.45));
      g.addColorStop(1, f.color);
      ctx.fillStyle = g;
    } catch (e) { ctx.fillStyle = f.color; }
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    x += r * 2 + gap;
  }
  ctx.restore();
}

// One fruit: radial-lit ball + stem/leaf + cute face.
function drawFruit(x, y, r, tier) {
  var f = getFruit(tier);
  if (!f) return;

  // body
  var grad = null;
  try {
    grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
    grad.addColorStop(0, shade(f.color, 0.5));
    grad.addColorStop(0.65, f.color);
    grad.addColorStop(1, shade(f.color, -0.2));
  } catch (e) {}
  ctx.fillStyle = grad || f.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - r * 0.38, y - r * 0.42, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  if (r >= 10) {
    // stem
    ctx.fillStyle = '#7a4a21';
    rr(x - r * 0.06, y - r - r * 0.14, r * 0.12, r * 0.26, r * 0.05);
    ctx.fill();
    // leaf (squashed circle, rotated)
    ctx.save();
    ctx.translate(x + r * 0.22, y - r - r * 0.08);
    ctx.rotate(-0.6);
    ctx.scale(1, 0.55);
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (r >= 12) {
    // eyes
    ctx.fillStyle = '#3a2a20';
    ctx.beginPath();
    ctx.arc(x - r * 0.26, y - r * 0.05, r * 0.09, 0, Math.PI * 2);
    ctx.arc(x + r * 0.26, y - r * 0.05, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
    // eye glints
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x - r * 0.23, y - r * 0.09, r * 0.03, 0, Math.PI * 2);
    ctx.arc(x + r * 0.29, y - r * 0.09, r * 0.03, 0, Math.PI * 2);
    ctx.fill();
    // smile
    ctx.strokeStyle = '#3a2a20';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y + r * 0.12, r * 0.22, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    // blush
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(x - r * 0.45, y + r * 0.18, r * 0.1, 0, Math.PI * 2);
    ctx.arc(x + r * 0.45, y + r * 0.18, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFruits() {
  var bs = world.bodies;
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    if (b.removed) continue;
    drawFruit(b.x, b.y, b.r, b.tier);
  }
}

function drawDropper() {
  if (phase !== 'aim') return;
  var f = getFruit(currentTier);
  var r = f.radius;
  var bob = Math.sin(time * 2.2) * 2.5;
  var y = L.dropperY + bob;

  // hanger claw
  ctx.fillStyle = '#8a5a33';
  rr(aimX - 10, y - r - 13, 20, 6, 3);
  ctx.fill();

  // aim guide
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 2;
  setDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(aimX, y + r + 3);
  ctx.lineTo(aimX, L.innerBottom - 2);
  ctx.stroke();
  setDash([]);
  ctx.restore();

  drawFruit(aimX, y, r, currentTier);
}

function drawNextPreview() {
  var f = getFruit(nextTier);
  var x = 26, y = 78;
  drawFruit(x, y, f.radius * 0.55, nextTier);
  ctx.fillStyle = '#8a5a33';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('下一个', x, y + f.radius * 0.55 + 12);
}

function drawButton(b, drawIcon) {
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a9743f';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawIcon();
}

function drawMuteIcon() {
  var x = L.muteBtn.x, y = L.muteBtn.y;
  ctx.fillStyle = '#8a5a33';
  ctx.beginPath();                       // speaker body
  ctx.moveTo(x - 7, y - 3);
  ctx.lineTo(x - 3, y - 3);
  ctx.lineTo(x + 1, y - 7);
  ctx.lineTo(x + 1, y + 7);
  ctx.lineTo(x - 3, y + 3);
  ctx.lineTo(x - 7, y + 3);
  ctx.closePath();
  ctx.fill();
  if (muted) {
    ctx.strokeStyle = '#d81e3c';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 5);
    ctx.lineTo(x + 9, y + 5);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#8a5a33';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x + 2, y, 5, -0.9, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 2, y, 8.5, -0.9, 0.9);
    ctx.stroke();
  }
}

function drawRestartIcon() {
  var x = L.restartBtn.x, y = L.restartBtn.y, r = 7;
  ctx.strokeStyle = '#8a5a33';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI * 0.35, Math.PI * 1.15);
  ctx.stroke();
  // arrowhead at the arc end (angle -0.35π, upper right)
  var ax = x + r * Math.cos(-Math.PI * 0.35);
  var ay = y + r * Math.sin(-Math.PI * 0.35);
  ctx.fillStyle = '#8a5a33';
  ctx.beginPath();
  ctx.moveTo(ax + 4, ay - 3);
  ctx.lineTo(ax - 3, ay - 4);
  ctx.lineTo(ax - 1, ay + 4);
  ctx.closePath();
  ctx.fill();
}

function drawHUD() {
  // score
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 30px sans-serif';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeText(String(score), W / 2, 40);
  ctx.fillStyle = '#7a4a21';
  ctx.fillText(String(score), W / 2, 40);

  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#a9743f';
  ctx.fillText('最高 ' + Math.max(best, score), W / 2, 57);

  drawChart();
  drawNextPreview();
  drawButton(L.muteBtn, drawMuteIcon);
  drawButton(L.restartBtn, drawRestartIcon);
}

// ------------------------------------------------------------------ effects

function spawnPopup(x, y, text) {
  popups.push({ x: x, y: y, text: text, life: 1.0 });
}

function burst(x, y, color, big) {
  rings.push({
    x: x, y: y,
    r0: 10, r1: big ? 90 : 52,
    life: 0.4, maxLife: 0.4, color: color
  });
  var n = big ? 22 : 11;
  for (var i = 0; i < n; i++) {
    var a = Math.random() * Math.PI * 2;
    var sp = 60 + Math.random() * (big ? 200 : 110);
    parts.push({
      confetti: false,
      x: x, y: y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: 0.5 + Math.random() * 0.35, maxLife: 0.85,
      color: Math.random() < 0.5 ? color : shade(color, 0.35),
      size: 2 + Math.random() * 2.5,
      ang: 0, spin: 0, w: 0, h: 0
    });
  }
}

function confettiBurst(x, y) {
  var palette = ['#f2474f', '#ff9f1a', '#f5c518', '#4caf50', '#8e44ad', '#3a9d3a', '#ffa8a0'];
  for (var i = 0; i < 40; i++) {
    var a = Math.random() * Math.PI * 2;
    var sp = 120 + Math.random() * 260;
    parts.push({
      confetti: true,
      x: x, y: y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
      life: 0.9 + Math.random() * 0.5, maxLife: 1.4,
      color: palette[i % palette.length],
      size: 0,
      ang: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 14,
      w: 4 + Math.random() * 3, h: 7 + Math.random() * 4
    });
  }
}

function updateEffects(dt) {
  var i;
  for (i = popups.length - 1; i >= 0; i--) {
    var p = popups[i];
    p.life -= dt;
    p.y -= 42 * dt;
    if (p.life <= 0) popups.splice(i, 1);
  }
  for (i = rings.length - 1; i >= 0; i--) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
  for (i = parts.length - 1; i >= 0; i--) {
    var q = parts[i];
    q.life -= dt;
    q.vy += (q.confetti ? 380 : 480) * dt;
    if (q.confetti) { q.vx *= 0.985; q.ang += q.spin * dt; }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.life <= 0) parts.splice(i, 1);
  }
}

function drawEffects() {
  var i;
  for (i = 0; i < rings.length; i++) {
    var rg = rings[i];
    var k = 1 - rg.life / rg.maxLife;
    ctx.save();
    ctx.globalAlpha = rg.life / rg.maxLife * 0.8;
    ctx.strokeStyle = rg.color;
    ctx.lineWidth = 3 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, rg.r0 + (rg.r1 - rg.r0) * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (i = 0; i < parts.length; i++) {
    var q = parts[i];
    ctx.save();
    ctx.globalAlpha = Math.min(1, q.life / (q.maxLife * 0.5));
    ctx.fillStyle = q.color;
    if (q.confetti) {
      ctx.translate(q.x, q.y);
      ctx.rotate(q.ang);
      ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
    } else {
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPopups() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px sans-serif';
  for (var i = 0; i < popups.length; i++) {
    var p = popups[i];
    ctx.globalAlpha = clamp(p.life / 0.6, 0, 1);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = '#d84315';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ gameplay

function handleMerges(merges) {
  for (var i = 0; i < merges.length; i++) {
    var a = merges[i].a, b = merges[i].b;
    if (a.removed || b.removed) continue;
    var tier = a.tier;
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    physics.removeBody(world, a);
    physics.removeBody(world, b);

    var res = mergeResult(tier);
    score += res.score;
    var fx = res.tier > 0 ? getFruit(res.tier).color : getFruit(FRUITS.length).color;
    spawnPopup(clamp(mx, 40, W - 40), clamp(my, 60, L.innerBottom - 10), '+' + res.score);

    if (res.tier > 0) {
      var f = getFruit(res.tier);
      var nb = physics.addBody(world, {
        x: clamp(mx, L.innerLeft + f.radius, L.innerRight - f.radius),
        y: Math.min(my, L.innerBottom - f.radius),
        r: f.radius,
        tier: res.tier,
        vy: -POP_SPEED
      });
      nb.stillTime = 0;
      burst(nb.x, nb.y, f.color, res.celebrate);
      sfx('merge', res.tier);        // pitch rises with tier
      if (res.celebrate) sfx('fanfare');   // a watermelon was born
    } else {
      // watermelon + watermelon: both vanish
      burst(mx, my, fx, true);
      confettiBurst(mx, my);
      sfx('fanfare');
    }
  }
}

function dropCurrent() {
  var f = getFruit(currentTier);
  var x = clamp(aimX, L.innerLeft + f.radius, L.innerRight - f.radius);
  var body = physics.addBody(world, {
    x: x, y: L.dropperY, r: f.radius, tier: currentTier, vy: DROP_SPEED
  });
  body.stillTime = 0;
  droppedBody = body;
  phase = 'cooldown';
  cooldownT = 0;
  sfx('drop');
}

// The dropper re-arms once the dropped fruit settled (or its merge chain
// resolved), or after a short timeout so a rolling fruit can't stall play.
function updateDropper(dt) {
  if (phase !== 'cooldown') return;
  cooldownT += dt;
  var settled = !droppedBody || droppedBody.removed || droppedBody.sleeping;
  if (cooldownT >= MIN_COOLDOWN && (settled || cooldownT >= MAX_WAIT)) {
    currentTier = nextTier;
    nextTier = randomSpawnTier();
    droppedBody = null;
    phase = 'aim';
  }
}

// A settled (sleeping or slow) fruit poking above the danger line starts
// the 1.5 s countdown; the line flashes red while the countdown runs.
function updateDanger(dt) {
  var danger = false;
  var bs = world.bodies;
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    if (b.removed) continue;
    var sp2 = b.vx * b.vx + b.vy * b.vy;
    if ((b.sleeping || sp2 < 80 * 80) && b.y - b.r < L.dangerY) {
      danger = true;
      break;
    }
  }
  warn = danger;
  aboveT = danger ? aboveT + dt : 0;
  if (aboveT >= OVER_LIMIT) gameOver();
}

function gameOver() {
  if (state !== 'play') return;
  state = 'over';
  newRecord = storage.submitScore(score);
  best = storage.getBest();
  sfx('gameover');
}

// ------------------------------------------------------------------ render

function drawOverlay() {
  ctx.fillStyle = 'rgba(40, 20, 5, 0.5)';
  ctx.fillRect(0, 0, W, H);

  var pw = 280, ph = 240;
  var px = (W - pw) / 2, py = Math.max(120, H / 2 - ph / 2 - 40);
  ctx.fillStyle = '#fff6e8';
  rr(px, py, pw, ph, 16);
  ctx.fill();
  ctx.strokeStyle = '#d9a86a';
  ctx.lineWidth = 2;
  rr(px, py, pw, ph, 16);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7a4a21';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('游戏结束', W / 2, py + 44);

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#a9743f';
  ctx.fillText('本局得分', W / 2, py + 80);
  ctx.font = 'bold 38px sans-serif';
  ctx.fillStyle = '#d84315';
  ctx.fillText(String(score), W / 2, py + 122);

  ctx.font = '13px sans-serif';
  if (newRecord) {
    ctx.fillStyle = '#f26b1d';
    ctx.fillText('新纪录！最高 ' + best, W / 2, py + 150);
  } else {
    ctx.fillStyle = '#a9743f';
    ctx.fillText('最高分 ' + best, W / 2, py + 150);
  }

  var bw = L.overlayBtn.w, bh = L.overlayBtn.h;
  var bx = (W - bw) / 2, by = py + ph - bh - 22;
  L.overlayBtn.x = bx;
  L.overlayBtn.y = by;
  ctx.fillStyle = '#f26b1d';
  rr(bx, by, bw, bh, 23);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('再来一局', W / 2, by + 30);
}

function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawBackground();
  drawContainer();
  drawDangerLine();
  drawDropper();
  drawFruits();
  drawEffects();
  drawHUD();
  drawPopups();
  if (state === 'over') drawOverlay();
}

// ------------------------------------------------------------------ loop

function update(dt) {
  time += dt;
  if (state === 'play') {
    var merges = physics.step(world, dt);
    handleMerges(merges);
    updateDropper(dt);
    if (state === 'play') updateDanger(dt);
  }
  updateEffects(dt);
}

var last = Date.now();
function frame() {
  var now = Date.now();
  var dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(dt);
  render();
  scheduleFrame();
}

function scheduleFrame() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(frame);
  } else if (typeof canvas.requestAnimationFrame === 'function') {
    canvas.requestAnimationFrame(frame);
  } else {
    setTimeout(frame, 16);
  }
}

// ------------------------------------------------------------------ input

// Touches arrive in screen px; convert to design units.
function toDesign(t) {
  return { x: t.clientX * W / SW, y: t.clientY * W / SW };
}

function inCircle(b, p) {
  var dx = p.x - b.x, dy = p.y - b.y;
  return dx * dx + dy * dy <= b.r * b.r;
}

function inRect(r, p) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function clampAim(x) {
  var r = getFruit(currentTier).radius;
  return clamp(x, L.innerLeft + r, L.innerRight - r);
}

function firstTouch(e) {
  if (e.touches && e.touches.length > 0) return e.touches[0];
  if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
  return null;
}

function onTouchStart(e) {
  var t = firstTouch(e);
  if (!t) return;
  var p = toDesign(t);

  if (state === 'over') {
    if (inRect(L.overlayBtn, p)) {
      sfx('button');
      resetGame();
    }
    return;
  }
  if (inCircle(L.muteBtn, p)) {
    muted = storage.setMuted(!muted);
    pushMuted();
    sfx('button');
    return;
  }
  if (inCircle(L.restartBtn, p)) {
    sfx('button');
    resetGame();
    return;
  }
  if (phase === 'aim') {
    aiming = true;
    aimX = clampAim(p.x);
  }
}

function onTouchMove(e) {
  if (!aiming) return;
  var t = firstTouch(e);
  if (!t) return;
  aimX = clampAim(toDesign(t).x);
}

function onTouchEnd(e) {
  if (!aiming) return;
  aiming = false;
  if (state === 'play' && phase === 'aim') dropCurrent();
}

function onTouchCancel() {
  aiming = false;
}

if (typeof wx.onTouchStart === 'function') wx.onTouchStart(onTouchStart);
if (typeof wx.onTouchMove === 'function') wx.onTouchMove(onTouchMove);
if (typeof wx.onTouchEnd === 'function') wx.onTouchEnd(onTouchEnd);
if (typeof wx.onTouchCancel === 'function') wx.onTouchCancel(onTouchCancel);

scheduleFrame();

};
__modules["js/audio.js"]=function(module,exports,require){
// js/audio.js — 合成大西瓜 sound effects, fully synthesized (no assets).
//
// Uses wx.createWebAudioContext() when the runtime provides it. If it is
// missing or misbehaves, the module degrades to silence without ever
// throwing. Interface consumed by game.js:
//   audio.play(name, arg)  — 'drop' | 'merge' (arg = new tier 2..11)
//                            | 'fanfare' | 'gameover' | 'button'
//   audio.setMuted(muted)  — one switch silences everything; game.js keeps
//                            it in sync with js/storage.js persistence.

var storage = require('./storage.js');

var actx = null;
var unusable = false;
var muted = !!storage.getMuted();

function ensureCtx() {
  if (actx || unusable) return actx;
  try {
    if (typeof wx !== 'undefined' && wx &&
        typeof wx.createWebAudioContext === 'function') {
      actx = wx.createWebAudioContext();
    }
  } catch (e) { actx = null; }
  if (!actx || typeof actx.createOscillator !== 'function' ||
      typeof actx.createGain !== 'function') {
    actx = null;
    unusable = true;
  }
  return actx;
}

// One enveloped oscillator note. delay schedules it relative to "now" so
// multi-note jingles (fanfare / gameover) stay in sequence.
function tone(freq, dur, opts) {
  opts = opts || {};
  var c = ensureCtx();
  if (!c) return;
  try {
    var t = c.currentTime + (opts.delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    if (typeof osc.frequency.setValueAtTime === 'function') {
      osc.frequency.setValueAtTime(freq, t);
      if (opts.slideTo) {
        osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
      }
    } else {
      osc.frequency.value = freq;
    }
    osc.type = opts.type || 'sine';
    var vol = opts.vol || 0.25;
    if (typeof gain.gain.setValueAtTime === 'function') {
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    } else {
      gain.gain.value = vol;
    }
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  } catch (e) { /* never let sound break the game */ }
}

var HANDLERS = {
  // soft low thud when a fruit is released
  drop: function () {
    tone(120, 0.12, { type: 'sine', slideTo: 55, vol: 0.5 });
  },
  // pop whose pitch rises with the new tier (arg = tier 2..11)
  merge: function (tier) {
    var t = Number(tier) || 5;
    var base = 260 * Math.pow(1.10, t);
    tone(base * 0.7, 0.10, { type: 'triangle', slideTo: base, vol: 0.30 });
    tone(base * 1.5, 0.12, { type: 'sine', delay: 0.06, vol: 0.22 });
  },
  // watermelon celebration: rising arpeggio
  fanfare: function () {
    var seq = [523.25, 659.25, 783.99, 1046.50];
    for (var i = 0; i < seq.length; i++) {
      tone(seq[i], i === seq.length - 1 ? 0.35 : 0.16,
           { type: 'triangle', delay: i * 0.11, vol: 0.30 });
    }
  },
  // game over: falling four-note jingle
  gameover: function () {
    var seq = [659.25, 554.37, 440.00, 329.63];
    for (var i = 0; i < seq.length; i++) {
      tone(seq[i], i === seq.length - 1 ? 0.50 : 0.22,
           { type: 'sine', delay: i * 0.20, vol: 0.30 });
    }
  },
  // UI click
  button: function () {
    tone(720, 0.05, { type: 'square', vol: 0.12 });
  }
};

function play(name, arg) {
  if (muted) return;
  var fn = HANDLERS[name];
  if (!fn) return;
  try { fn(arg); } catch (e) { /* stay silent */ }
}

function setMuted(m) { muted = !!m; }
function getMuted() { return muted; }

module.exports = {
  play: play,
  setMuted: setMuted,
  getMuted: getMuted
};

};
__modules["js/fruits.js"]=function(module,exports,require){
// Fruit tier table. Radii are in design px for a 375-wide design canvas
// whose container is ~345px wide: the watermelon (r=76, 152px across) fits
// with plenty of room, the cherry (r=14) stays easy to see and tap.

var FRUITS = [
  { id: 1,  name: '樱桃',   radius: 14, color: '#d81e3c', score: 1 },
  { id: 2,  name: '草莓',   radius: 19, color: '#f2474f', score: 3 },
  { id: 3,  name: '葡萄',   radius: 25, color: '#8e44ad', score: 6 },
  { id: 4,  name: '橙子',   radius: 31, color: '#ff9f1a', score: 10 },
  { id: 5,  name: '柿子',   radius: 37, color: '#f26b1d', score: 15 },
  { id: 6,  name: '苹果',   radius: 44, color: '#e3342f', score: 21 },
  { id: 7,  name: '梨',     radius: 51, color: '#d6cf48', score: 28 },
  { id: 8,  name: '桃',     radius: 57, color: '#ffa8a0', score: 36 },
  { id: 9,  name: '菠萝',   radius: 63, color: '#f5c518', score: 45 },
  { id: 10, name: '哈密瓜', radius: 69, color: '#bcd86a', score: 55 },
  { id: 11, name: '西瓜',   radius: 76, color: '#3a9d3a', score: 66 }
];

var MAX_TIER = FRUITS.length;      // 11 = watermelon, no tier 12
var WATERMELON_BONUS = 1000;       // two watermelons merging -> both vanish

// Dropper only spawns tiers 1-5; small fruits are most common.
var SPAWN_WEIGHTS = [
  { id: 1, weight: 34 },
  { id: 2, weight: 30 },
  { id: 3, weight: 18 },
  { id: 4, weight: 11 },
  { id: 5, weight: 7 }
];
var SPAWN_TOTAL = SPAWN_WEIGHTS.reduce(function (s, w) { return s + w.weight; }, 0);

function getFruit(id) {
  return FRUITS[id - 1] || null;
}

// rand: optional () => [0,1) for deterministic tests.
function randomSpawnTier(rand) {
  var r = (rand || Math.random)() * SPAWN_TOTAL;
  for (var i = 0; i < SPAWN_WEIGHTS.length; i++) {
    r -= SPAWN_WEIGHTS[i].weight;
    if (r < 0) return SPAWN_WEIGHTS[i].id;
  }
  return SPAWN_WEIGHTS[0].id;
}

// Result of merging two fruits of tier `id`.
// { tier: next tier id or 0 when watermelons vanish, score, celebrate }
function mergeResult(id) {
  if (id >= MAX_TIER) {
    return { tier: 0, score: WATERMELON_BONUS, celebrate: true };
  }
  var next = getFruit(id + 1);
  return { tier: next.id, score: next.score, celebrate: next.id === MAX_TIER };
}

module.exports = {
  FRUITS: FRUITS,
  MAX_TIER: MAX_TIER,
  WATERMELON_BONUS: WATERMELON_BONUS,
  SPAWN_WEIGHTS: SPAWN_WEIGHTS,
  getFruit: getFruit,
  randomSpawnTier: randomSpawnTier,
  mergeResult: mergeResult
};

};
__modules["js/physics.js"]=function(module,exports,require){
// Minimal 2D circle physics for the merge game. Pure logic: no rendering,
// no wx calls. Units are design px and seconds. The container is open at
// the top; left/right/bottom are walls. Merges are REPORTED, not performed.

var DEFAULTS = {
  gravity: 1800,        // px/s^2
  substeps: 3,          // fixed substeps per step() call
  iterations: 8,        // contact solver passes per substep
  restitution: 0.2,
  bounceSpeed: 60,      // approach speed below which contacts don't bounce
  friction: 0.3,        // coulomb coefficient for circle-circle contacts
  wallFriction: 0.25,
  damping: 0.995,       // per-substep linear damping (air drag)
  maxSpeed: 2000,       // clamp so nothing tunnels at 60fps/3 substeps
  slop: 0.3,            // allowed penetration before correction (px)
  correction: 0.8,      // fraction of penetration fixed per pass
  mergeOverlap: -0.5,   // same-tier pair merges when overlap > this (px); slightly
                        // negative so gentle, just-touching contacts still merge
  sleepSpeed: 15,       // avg speed over a frame (px/s) below which it may sleep
  sleepTime: 0.4,       // seconds below sleepSpeed before sleeping
  wakeSpeed: 40,        // relative contact speed that wakes a sleeper
  wakeOverlap: 1.5,     // penetration (px) that wakes a sleeper (wedged bodies)
  massPower: 1.5,       // mass = r^1.5: softer ratios than area, stacks stably
  maxDt: 1 / 30         // clamp long frames
};

function createWorld(opts) {
  opts = opts || {};
  var w = { bodies: [], nextId: 1 };
  for (var k in DEFAULTS) w[k] = opts[k] !== undefined ? opts[k] : DEFAULTS[k];
  w.left = opts.left !== undefined ? opts.left : 0;
  w.right = opts.right !== undefined ? opts.right : 345;
  w.bottom = opts.bottom !== undefined ? opts.bottom : 600;
  return w;
}

// Adds a circle. opts: { x, y, r, tier, vx?, vy?, data? }
function addBody(world, opts) {
  var b = {
    id: world.nextId++,
    x: opts.x, y: opts.y,
    vx: opts.vx || 0, vy: opts.vy || 0,
    r: opts.r,
    tier: opts.tier,
    invMass: 1 / Math.pow(opts.r, world.massPower),
    sleeping: false,
    stillTime: 0,
    px: opts.x, py: opts.y, // position at start of frame (sleep test)
    removed: false,
    data: opts.data || null
  };
  world.bodies.push(b);
  return b;
}

// Removes a body and wakes everything, since its neighbours may have lost
// support. Merges are rare, so waking all is cheap enough.
function removeBody(world, body) {
  var i = world.bodies.indexOf(body);
  if (i >= 0) world.bodies.splice(i, 1);
  body.removed = true;
  wakeAll(world);
}

function wake(b) { b.sleeping = false; b.stillTime = 0; }

function wakeAll(world) {
  for (var i = 0; i < world.bodies.length; i++) wake(world.bodies[i]);
}

function integrate(world, h) {
  var bs = world.bodies, max2 = world.maxSpeed * world.maxSpeed;
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    if (b.sleeping) continue;
    b.vy += world.gravity * h;
    b.vx *= world.damping; b.vy *= world.damping;
    var s2 = b.vx * b.vx + b.vy * b.vy;
    if (s2 > max2) { var k = world.maxSpeed / Math.sqrt(s2); b.vx *= k; b.vy *= k; }
    b.x += b.vx * h; b.y += b.vy * h;
  }
}

// Solves one circle-circle contact. Sleepers act as immovable unless hit
// hard enough to wake. Returns pre-correction overlap (<=0 if apart).
function solvePair(world, a, b) {
  var dx = b.x - a.x, dy = b.y - a.y;
  var rs = a.r + b.r;
  var d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return 0;
  var d = Math.sqrt(d2), nx, ny;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; } else { nx = 0; ny = 1; d = 0; }
  var overlap = rs - d;

  var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
  var vn = rvx * nx + rvy * ny;
  var hit = -vn > world.wakeSpeed || overlap > world.wakeOverlap;
  if (hit && a.sleeping) wake(a);
  if (hit && b.sleeping) wake(b);
  var ia = a.sleeping ? 0 : a.invMass, ib = b.sleeping ? 0 : b.invMass;
  var isum = ia + ib;
  if (isum === 0) return overlap;

  // Positional correction.
  var corr = Math.max(overlap - world.slop, 0) * world.correction / isum;
  a.x -= nx * corr * ia; a.y -= ny * corr * ia;
  b.x += nx * corr * ib; b.y += ny * corr * ib;

  // Velocity impulse (only when approaching).
  if (vn < 0) {
    var e = -vn > world.bounceSpeed ? world.restitution : 0;
    var j = -(1 + e) * vn / isum;
    a.vx -= j * nx * ia; a.vy -= j * ny * ia;
    b.vx += j * nx * ib; b.vy += j * ny * ib;
    // Coulomb friction along the tangent.
    var tx = -ny, ty = nx;
    var vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    var jt = -vt / isum, lim = world.friction * j;
    if (jt > lim) jt = lim; else if (jt < -lim) jt = -lim;
    a.vx -= jt * tx * ia; a.vy -= jt * ty * ia;
    b.vx += jt * tx * ib; b.vy += jt * ty * ib;
  }
  return overlap;
}

// Reduces tangential speed v by Coulomb friction mu * normal impulse jn.
function wallFriction(v, jn, mu) {
  var lim = mu * jn;
  return v > lim ? v - lim : (v < -lim ? v + lim : 0);
}

function solveWalls(world, b) {
  if (b.sleeping) return;
  var r = world.restitution, t = world.bounceSpeed;
  var mu = world.wallFriction;
  if (b.x - b.r < world.left) {
    b.x = world.left + b.r;
    if (b.vx < 0) { b.vy = wallFriction(b.vy, -b.vx * (1 + r), mu); b.vx = b.vx < -t ? -b.vx * r : 0; }
  } else if (b.x + b.r > world.right) {
    b.x = world.right - b.r;
    if (b.vx > 0) { b.vy = wallFriction(b.vy, b.vx * (1 + r), mu); b.vx = b.vx > t ? -b.vx * r : 0; }
  }
  if (b.y + b.r > world.bottom) {
    b.y = world.bottom - b.r;
    if (b.vy > 0) { b.vx = wallFriction(b.vx, b.vy * (1 + r), mu); b.vy = b.vy > t ? -b.vy * r : 0; }
  }
}

// Sleep test uses average velocity over the frame (displacement / dt), which
// ignores the per-substep gravity kick that resting bodies keep receiving.
// A body only sleeps once every touching neighbour is also still, so loaded
// groups fall asleep together instead of waking each other in a loop.
function updateSleep(world, dt) {
  var bs = world.bodies, lim = world.sleepSpeed * dt, i;
  for (i = 0; i < bs.length; i++) {
    var b = bs[i];
    var dx = b.x - b.px, dy = b.y - b.py;
    b.px = b.x; b.py = b.y;
    if (b.sleeping) continue;
    if (dt > 0 && dx * dx + dy * dy < lim * lim) b.stillTime += dt;
    else b.stillTime = 0;
  }
  var ready = [];
  for (i = 0; i < bs.length; i++) {
    if (!bs[i].sleeping && bs[i].stillTime >= world.sleepTime && neighboursStill(world, bs[i])) {
      ready.push(bs[i]);
    }
  }
  for (i = 0; i < ready.length; i++) {
    ready[i].sleeping = true; ready[i].vx = 0; ready[i].vy = 0;
  }
}

function neighboursStill(world, b) {
  var bs = world.bodies;
  for (var i = 0; i < bs.length; i++) {
    var o = bs[i];
    if (o === b || o.sleeping || o.stillTime >= world.sleepTime) continue;
    var dx = o.x - b.x, dy = o.y - b.y, rs = o.r + b.r + 1;
    if (dx * dx + dy * dy < rs * rs) return false;
  }
  return true;
}

// Advances the world by dt seconds using fixed substeps.
// Returns merge pairs [{ a, b }] of same-tier bodies overlapping more than
// world.mergeOverlap. Each body appears in at most one pair.
function step(world, dt) {
  dt = Math.min(Math.max(dt, 0), world.maxDt);
  var bs = world.bodies, n = bs.length;
  var h = dt / world.substeps;
  var merges = [], used = {};

  for (var s = 0; s < world.substeps; s++) {
    integrate(world, h);
    for (var it = 0; it < world.iterations; it++) {
      for (var i = 0; i < n; i++) {
        var a = bs[i];
        for (var k = i + 1; k < n; k++) {
          var b = bs[k];
          if (a.sleeping && b.sleeping) continue;
          var ov = solvePair(world, a, b);
          if (ov > 0 && ov > world.mergeOverlap && a.tier === b.tier &&
              !used[a.id] && !used[b.id]) {
            used[a.id] = used[b.id] = true;
            merges.push({ a: a, b: b });
          }
        }
        solveWalls(world, a);
      }
    }
  }
  // Catch pairs that ended the step touching (gentle or sleeping contacts).
  for (var p = 0; p < n; p++) {
    for (var q = p + 1; q < n; q++) {
      var c = bs[p], o = bs[q];
      if (c.tier !== o.tier || used[c.id] || used[o.id]) continue;
      var dx = o.x - c.x, dy = o.y - c.y, rs = c.r + o.r - world.mergeOverlap;
      if (rs > 0 && dx * dx + dy * dy < rs * rs) {
        used[c.id] = used[o.id] = true;
        merges.push({ a: c, b: o });
      }
    }
  }
  updateSleep(world, dt);
  return merges;
}

function allAsleep(world) {
  for (var i = 0; i < world.bodies.length; i++) {
    if (!world.bodies[i].sleeping) return false;
  }
  return true;
}

module.exports = {
  DEFAULTS: DEFAULTS,
  createWorld: createWorld,
  addBody: addBody,
  removeBody: removeBody,
  wake: wake,
  wakeAll: wakeAll,
  step: step,
  allAsleep: allAsleep
};

};
__modules["js/storage.js"]=function(module,exports,require){
// Tiny persistent storage wrapper. Falls back to in-memory values when
// wx storage is unavailable (plain node, or a storage error).

var KEY_BEST = 'suika_best';
var KEY_MUTED = 'suika_muted';

var memory = {};
memory[KEY_BEST] = 0;
memory[KEY_MUTED] = false;

function hasWx() {
  return typeof wx !== 'undefined' && wx &&
    typeof wx.getStorageSync === 'function' &&
    typeof wx.setStorageSync === 'function';
}

function read(key) {
  if (hasWx()) {
    try {
      var v = wx.getStorageSync(key);
      // getStorageSync returns '' for missing keys.
      if (v !== '' && v !== undefined && v !== null) {
        memory[key] = v;
        return v;
      }
    } catch (e) { /* fall through to memory */ }
  }
  return memory[key];
}

function write(key, value) {
  memory[key] = value;
  if (hasWx()) {
    try { wx.setStorageSync(key, value); } catch (e) { /* memory only */ }
  }
}

function getBest() {
  var n = Number(read(KEY_BEST));
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function setBest(score) {
  var n = Math.max(0, Math.floor(Number(score) || 0));
  write(KEY_BEST, n);
  return n;
}

// Saves score only if it beats the stored best. Returns true on a new record.
function submitScore(score) {
  if (score > getBest()) { setBest(score); return true; }
  return false;
}

function getMuted() {
  var v = read(KEY_MUTED);
  return v === true || v === 'true' || v === 1;
}

function setMuted(muted) {
  write(KEY_MUTED, !!muted);
  return !!muted;
}

module.exports = {
  KEY_BEST: KEY_BEST,
  KEY_MUTED: KEY_MUTED,
  getBest: getBest,
  setBest: setBest,
  submitScore: submitScore,
  getMuted: getMuted,
  setMuted: setMuted
};

};
__require("__entry__")("./game.js");
})();
