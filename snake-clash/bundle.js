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
// Snake Clash 蛇蛇竞技场 — entry: canvas, loop, input, rounds, rendering.
// No DOM/BOM. Everything renders on the wx canvas.
var L = require('./js/logic.js');
var aiMod = require('./js/ai.js');
var storage = require('./js/storage.js');

// ---- audio hook (js/audio.js arrives in chunk 3; never crash if absent) ----
var audio = null;
try { audio = require('./js/audio.js'); } catch (e) { audio = null; }
function sfx(name, x) {
  if (audio && typeof audio.play === 'function') {
    try { audio.play(name, x); } catch (e2) { /* audio must not break the game */ }
  }
}

// ---- canvas & layout ----
var sys = wx.getSystemInfoSync();
var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');
var dpr = Math.min(sys.pixelRatio || 1, 2);
canvas.width = Math.floor(sys.screenWidth * dpr);
canvas.height = Math.floor(sys.screenHeight * dpr);

var VIEW_W = 750;                          // design width
var designPerPt = VIEW_W / sys.screenWidth; // design px per screen point
var VIEW_H = sys.screenHeight * designPerPt;
var S = canvas.width / VIEW_W;             // canvas px per design px (uniform)

// Arena placement: HUD on top, boost row at the bottom.
var arenaView = { x: 0, y: 0, k: 1 };
(function layoutArena() {
  var top = 112, bottom = 168, side = 16;
  var availW = VIEW_W - side * 2;
  var availH = VIEW_H - top - bottom;
  arenaView.k = Math.min(availW / L.ARENA.w, availH / L.ARENA.h);
  arenaView.x = (VIEW_W - L.ARENA.w * arenaView.k) / 2;
  arenaView.y = top + (availH - L.ARENA.h * arenaView.k) / 2;
})();
function w2x(x) { return arenaView.x + x * arenaView.k; }
function w2y(y) { return arenaView.y + y * arenaView.k; }
function d2wx(px) { return (px - arenaView.x) / arenaView.k; }
function d2wy(py) { return (py - arenaView.y) / arenaView.k; }

// ---- constants ----
var STEP = 1 / 60;
var BOOST_CD = 3;
var COLORS = { p: '#3EDC81', red: '#FF5A5F', blue: '#4DA3FF', purple: '#A96BFF' };
var NAMES = { red: '红蛇', blue: '蓝蛇', purple: '紫蛇' };

// ---- game state ----
var game = {
  state: 'menu',            // menu | playing | paused | over
  round: 1,
  speedMul: 1,
  snakes: [],
  pellets: [],
  particles: [],
  popups: [],
  feed: null,
  feedT: 0,
  time: 0,
  touchId: null, touchDX: 0, touchDY: 0,
  boostHeld: false, boostCd: 0, boostTouchId: null,
  over: { win: false, placement: 1, score: 0, best: 0 },
  acc: 0, last: 0,
  rng: L.makeRng((Date.now() & 0xffffffff) >>> 0)
};

// ---- round setup ----
function startRound() {
  aiMod.reset();
  game.speedMul = 1 + Math.min(0.30, (game.round - 1) * 0.05);
  var m = L.BASE_SPEED * game.speedMul;
  var b = L.BODY_RADIUS + 8;
  var W = L.ARENA.w, H = L.ARENA.h;
  var defs = [
    ['p', b, H - b, -Math.PI / 4, COLORS.p, true, null],
    ['red', b, b, Math.PI / 4, COLORS.red, false, 'aggressive'],
    ['blue', W - b, b, 3 * Math.PI / 4, COLORS.blue, false, 'cautious'],
    ['purple', W - b, H - b, -3 * Math.PI / 4, COLORS.purple, false, 'greedy']
  ];
  game.snakes = [];
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    var s = L.createSnake(d[0], d[1], d[2], d[3], d[4], d[5]);
    s.personality = d[6];
    s.speed = m;
    game.snakes.push(s);
  }
  game.pellets = [];
  while (game.pellets.length < L.PELLET_TARGET) {
    game.pellets.push(L.spawnPellet(L.ARENA, game.snakes, game.rng));
  }
  game.particles = [];
  game.popups = [];
  game.feed = null;
  game.feedT = 0;
  game.touchId = null;
  game.boostHeld = false;
  game.boostCd = 0;
  game.boostTouchId = null;
  game.acc = 0;
  game.state = 'playing';
}

function byId(id) {
  for (var i = 0; i < game.snakes.length; i++) {
    if (game.snakes[i].id === id) return game.snakes[i];
  }
  return null;
}
function findPelletIndex(pid) {
  for (var i = 0; i < game.pellets.length; i++) {
    if (game.pellets[i].id === pid) return i;
  }
  return -1;
}

// ---- fx ----
function burst(x, y, color, n, speed) {
  for (var i = 0; i < n; i++) {
    var a = game.rng() * Math.PI * 2;
    var v = speed * (0.4 + game.rng() * 0.6);
    game.particles.push({
      x: x, y: y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.5 + game.rng() * 0.3, max: 0.8,
      color: color, r: 2 + game.rng() * 3
    });
  }
}
function addPopup(x, y, text, color) {
  game.popups.push({ x: x, y: y, text: text, color: color, age: 0 });
}
function updateFx(dt) {
  game.time += dt;
  var ps = game.particles;
  for (var i = ps.length - 1; i >= 0; i--) {
    var p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
  }
  for (i = game.popups.length - 1; i >= 0; i--) {
    var u = game.popups[i];
    u.age += dt;
    if (u.age > 0.9) game.popups.splice(i, 1);
  }
  if (game.feedT > 0) game.feedT = Math.max(0, game.feedT - dt);
}

// ---- round end ----
function endRound(win, placement) {
  var player = game.snakes[0];
  game.over = {
    win: win,
    placement: placement,
    score: player.score,
    best: storage.setBest(player.score)
  };
  game.state = 'over';
  sfx(win ? 'win' : 'lose');
}

// ---- fixed-step update ----
function step(dt) {
  var i;
  var snakes = game.snakes;
  var pellets = game.pellets;
  var player = snakes[0];

  // boost
  game.boostCd = Math.max(0, game.boostCd - dt);
  var boosting = game.boostHeld && game.boostCd <= 0 && player.alive;
  player.speed = (boosting ? L.BOOST_SPEED : L.BASE_SPEED) * game.speedMul;
  if (boosting) {
    var tail = player.segments[player.segments.length - 1];
    game.particles.push({
      x: tail.x, y: tail.y,
      vx: (game.rng() - 0.5) * 60, vy: (game.rng() - 0.5) * 60,
      life: 0.4, max: 0.4, color: COLORS.p, r: 3 + game.rng() * 2
    });
  }

  // player steering (virtual joystick toward the finger)
  if (game.touchId !== null && player.alive) {
    var hx = player.segments[0].x, hy = player.segments[0].y;
    var dx = d2wx(game.touchDX) - hx, dy = d2wy(game.touchDY) - hy;
    if (dx * dx + dy * dy > 484) { // ignore jitters right on the head
      L.steerToward(player, Math.atan2(dy, dx), dt, L.MAX_TURN_RATE);
    }
  }

  aiMod.updateAI(snakes, pellets, L.ARENA, dt, game.rng);
  for (i = 0; i < snakes.length; i++) {
    if (snakes[i].alive) L.stepSnake(snakes[i], dt);
  }

  var ev = L.checkCollisions(snakes, pellets, L.ARENA);

  // eating
  for (i = 0; i < ev.eaten.length; i++) {
    var e = ev.eaten[i];
    var idx = findPelletIndex(e.pelletId);
    if (idx < 0) continue;
    var pel = pellets[idx];
    var sn = byId(e.snakeId);
    if (sn) L.eatPellet(sn, pel);
    burst(pel.x, pel.y, pel.color, 6, 90);
    addPopup(pel.x, pel.y, pel.golden ? '+5' : '+1', pel.golden ? L.GOLDEN_COLOR : '#FFFFFF');
    sfx('eat', sn ? sn.targetLength : 0);
    pellets.splice(idx, 1);
  }
  while (pellets.length < L.PELLET_TARGET) {
    pellets.push(L.spawnPellet(L.ARENA, snakes, game.rng));
  }

  // deaths
  if (ev.deathInfo.length) {
    for (i = 0; i < ev.deathInfo.length; i++) {
      var d = ev.deathInfo[i];
      var dead = byId(d.snakeId);
      if (!dead) continue;
      dead.alive = false;
      var drops = L.pelletsFromDeath(d.points, L.ARENA, game.rng);
      for (var j = 0; j < drops.length && j < 20; j++) pellets.push(drops[j]);
      for (var q = 0; q < d.points.length; q += 2) {
        burst(d.points[q].x, d.points[q].y, dead.color, 2, 140);
      }
      sfx('die');
      announceDeath(d, dead);
    }
    var aliveAI = 0;
    for (i = 1; i < snakes.length; i++) if (snakes[i].alive) aliveAI++;
    var playerAlive = snakes[0].alive;
    if (playerAlive && aliveAI === 0) endRound(true, 1);
    else if (!playerAlive) endRound(false, aliveAI + 1);
    else if (aliveAI === 0) endRound(true, 1);
  }
}

function announceDeath(d, dead) {
  var killer = d.killerId ? byId(d.killerId) : null;
  var msg;
  if (dead.id === 'p') {
    msg = '你被' + (killer && NAMES[killer.id] ? NAMES[killer.id] : '对手') + '淘汰了！';
  } else if (d.cause === 'wall') {
    msg = NAMES[dead.id] + '撞上了边界！';
  } else if (d.killerId === 'p') {
    msg = '你淘汰了' + NAMES[dead.id] + '！';
    sfx('kill');
  } else if (d.cause === 'head') {
    msg = (killer && NAMES[killer.id] ? NAMES[killer.id] : '对手') + '和' + NAMES[dead.id] + '同归于尽！';
  } else {
    msg = (killer && NAMES[killer.id] ? NAMES[killer.id] : '对手') + '淘汰了' + NAMES[dead.id] + '！';
  }
  game.feed = msg;
  game.feedT = 2;
}

// ---- buttons ----
var boostBtn = { x: VIEW_W - 150, y: VIEW_H - 152, r: 60 };
function inRect(x, y, b) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }
function inCircle(x, y, c) {
  var dx = x - (c.x + c.r), dy = y - (c.y + c.r);
  return dx * dx + dy * dy <= c.r * c.r;
}

function buttons() {
  var list = [];
  var bw = 96, bh = 56;
  if (game.state === 'menu') {
    list.push({ id: 'start', x: 195, y: VIEW_H * 0.42, w: 360, h: 110, label: '开始游戏', big: true });
    list.push({ id: 'mute', x: VIEW_W - bw - 12, y: 18, w: bw, h: bh, label: mutedLabel() });
  } else if (game.state === 'playing' || game.state === 'paused') {
    list.push({ id: 'pause', x: VIEW_W - bw - 12, y: 18, w: bw, h: bh, label: game.state === 'paused' ? '继续' : '暂停' });
    list.push({ id: 'mute', x: VIEW_W - bw * 2 - 24, y: 18, w: bw, h: bh, label: mutedLabel() });
  }
  if (game.state === 'paused') {
    list.push({ id: 'restart', x: 235, y: VIEW_H * 0.46, w: 280, h: 92, label: '重新开始' });
    list.push({ id: 'menu', x: 235, y: VIEW_H * 0.46 + 116, w: 280, h: 92, label: '回到菜单' });
  }
  if (game.state === 'over') {
    list.push({ id: 'again', x: 215, y: VIEW_H * 0.52, w: 320, h: 100, label: '再来一局', big: true });
    list.push({ id: 'menu', x: 215, y: VIEW_H * 0.52 + 124, w: 320, h: 88, label: '返回菜单' });
  }
  return list;
}
function mutedLabel() { return storage.getMuted() ? '音效:关' : '音效:开'; }

function doAction(id) {
  sfx('click');
  if (id === 'start' || id === 'restart') startRound();
  else if (id === 'mute') {
    storage.setMuted(!storage.getMuted());
    if (!storage.getMuted()) sfx('eat');
  } else if (id === 'pause') game.state = 'paused';
  else if (id === 'resume') game.state = 'playing';
  else if (id === 'menu') game.state = 'menu';
  else if (id === 'again') {
    if (game.over.win) game.round++;
    startRound();
  }
}

// ---- touch input ----
function toDesign(t) {
  return { x: t.clientX * designPerPt, y: t.clientY * designPerPt };
}
wx.onTouchStart(function (e) {
  var ts = e.changedTouches || e.touches || [];
  for (var i = 0; i < ts.length; i++) handleStart(ts[i]);
});
wx.onTouchMove(function (e) {
  var ts = e.changedTouches || e.touches || [];
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i], p = toDesign(t);
    if (game.touchId !== null && t.identifier === game.touchId) {
      game.touchDX = p.x; game.touchDY = p.y;
    }
  }
});
function handleEnd(e) {
  var ts = e.changedTouches || e.touches || [];
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i];
    if (t.identifier === game.touchId) game.touchId = null;
    if (t.identifier === game.boostTouchId) {
      game.boostTouchId = null;
      if (game.boostHeld) { game.boostHeld = false; game.boostCd = BOOST_CD; sfx('boost_stop'); }
    }
  }
}
wx.onTouchEnd(handleEnd);
wx.onTouchCancel(handleEnd);

function handleStart(t) {
  var p = toDesign(t);
  if (game.state === 'playing') {
    if (inCircle(p.x, p.y, boostBtn)) {
      game.boostTouchId = t.identifier;
      game.boostHeld = true;
      sfx('boost_start');
      return;
    }
  }
  var bs = buttons();
  for (var i = 0; i < bs.length; i++) {
    if (inRect(p.x, p.y, bs[i])) { doAction(bs[i].id); return; }
  }
  if (game.state === 'playing' && game.touchId === null) {
    game.touchId = t.identifier;
    game.touchDX = p.x;
    game.touchDY = p.y;
  }
}

// ---- frame loop ----
function nextFrame(f) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(f);
  else setTimeout(f, 16);
}
function frame() {
  var now = Date.now();
  var dt = game.last ? Math.min(0.1, (now - game.last) / 1000) : 0;
  game.last = now;
  if (game.state === 'playing') {
    game.acc += dt;
    while (game.acc >= STEP) {
      step(STEP);
      game.acc -= STEP;
      if (game.state !== 'playing') { game.acc = 0; break; }
    }
  } else {
    updateFx(dt);
  }
  render();
  nextFrame(frame);
}

// ---- drawing helpers ----
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function hexA(hex, a) {
  var n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function text(str, x, y, size, color, align, bold) {
  ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

// ---- render ----
function render() {
  ctx.setTransform(S, 0, 0, S, 0, 0);
  var g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, '#141F38');
  g.addColorStop(1, '#20305A');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (game.state === 'menu') { renderMenu(); return; }

  renderArena();
  renderPellets();
  renderSnakes();
  renderFx();
  renderHUD();
  renderButtons(buttons());
  renderBoostButton();
  if (game.state === 'paused') renderPause();
  else if (game.state === 'over') renderOver();
}

function renderArena() {
  var a = arenaView;
  var w = L.ARENA.w * a.k, h = L.ARENA.h * a.k;
  ctx.fillStyle = 'rgba(6,12,26,0.55)';
  rr(a.x, a.y, w, h, 18);
  ctx.fill();

  // subtle grid
  ctx.save();
  rr(a.x, a.y, w, h, 18);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var gx = 55; gx < L.ARENA.w; gx += 55) {
    ctx.moveTo(w2x(gx), a.y);
    ctx.lineTo(w2x(gx), a.y + h);
  }
  for (var gy = 55; gy < L.ARENA.h; gy += 55) {
    ctx.moveTo(a.x, w2y(gy));
    ctx.lineTo(a.x + w, w2y(gy));
  }
  ctx.stroke();
  ctx.restore();

  // glowing wall
  ctx.save();
  ctx.shadowColor = '#39D0FF';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(80,200,255,0.9)';
  ctx.lineWidth = 4;
  rr(a.x, a.y, w, h, 18);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  rr(a.x, a.y, w, h, 18);
  ctx.stroke();
}

function renderPellets() {
  var k = arenaView.k;
  for (var i = 0; i < game.pellets.length; i++) {
    var p = game.pellets[i];
    var x = w2x(p.x), y = w2y(p.y);
    var r = (p.golden ? 8 : 5) * k;
    ctx.fillStyle = p.golden ? hexA(L.GOLDEN_COLOR, 0.22) : hexA(p.color, 0.18);
    circle(x, y, r * 2.6);
    ctx.fill();
    ctx.fillStyle = p.golden ? L.GOLDEN_COLOR : p.color;
    circle(x, y, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    circle(x - r * 0.3, y - r * 0.3, r * 0.35);
    ctx.fill();
    if (p.golden) {
      // sparkle cross
      var a = game.time * 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 2.2, y + Math.sin(a) * r * 2.2);
      ctx.lineTo(x - Math.cos(a) * r * 2.2, y - Math.sin(a) * r * 2.2);
      ctx.stroke();
    }
  }
}

function renderSnakes() {
  var k = arenaView.k;
  var R = L.BODY_RADIUS * k;
  for (var i = 0; i < game.snakes.length; i++) {
    var s = game.snakes[i];
    if (!s.alive) continue;
    var segs = s.segments;
    for (var j = segs.length - 1; j >= 0; j--) {
      var x = w2x(segs[j].x), y = w2y(segs[j].y);
      var r = j === 0 ? R * 1.12 : R;
      ctx.fillStyle = s.color;
      circle(x, y, r);
      ctx.fill();
      if (j > 0 && j % 3 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        circle(x, y, r * 0.45);
        ctx.fill();
      }
    }
    // head: outline, highlight, eyes
    var hx = w2x(segs[0].x), hy = w2y(segs[0].y);
    var dir = s.heading;
    var hr = R * 1.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    circle(hx, hy, hr);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    circle(hx - hr * 0.35, hy - hr * 0.35, hr * 0.3);
    ctx.fill();
    var ex = Math.cos(dir), ey = Math.sin(dir);
    for (var e = -1; e <= 1; e += 2) {
      var px = hx + ex * hr * 0.45 + ey * e * hr * 0.5;
      var py = hy + ey * hr * 0.45 - ex * e * hr * 0.5;
      ctx.fillStyle = '#FFFFFF';
      circle(px, py, hr * 0.3);
      ctx.fill();
      ctx.fillStyle = '#222';
      circle(px + ex * hr * 0.12, py + ey * hr * 0.12, hr * 0.15);
      ctx.fill();
    }
  }
}

function renderFx() {
  var k = arenaView.k;
  for (var i = 0; i < game.particles.length; i++) {
    var p = game.particles[i];
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    circle(w2x(p.x), w2y(p.y), p.r * k);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (i = 0; i < game.popups.length; i++) {
    var u = game.popups[i];
    ctx.globalAlpha = Math.max(0, 1 - u.age / 0.9);
    text(u.text, w2x(u.x), w2y(u.y) - u.age * 55, 30, u.color, 'center', true);
  }
  ctx.globalAlpha = 1;
}

function renderHUD() {
  var player = game.snakes[0];
  // score
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 4;
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(String(player.score), VIEW_W / 2, 52);
  text(String(player.score), VIEW_W / 2, 52, 52, '#FFD23F', 'center', true);

  var alive = 0;
  for (var i = 0; i < game.snakes.length; i++) if (game.snakes[i].alive) alive++;
  text('长度 ' + player.targetLength + ' · 剩余 ' + alive + ' 条蛇', VIEW_W / 2, 92, 24, 'rgba(255,255,255,0.85)');
  text('第 ' + game.round + ' 轮', 20, 44, 26, 'rgba(255,255,255,0.7)', 'left', true);

  // kill feed
  if (game.feed && game.feedT > 0) {
    ctx.globalAlpha = Math.min(1, game.feedT / 0.5);
    text(game.feed, VIEW_W / 2, arenaView.y - 20, 28, '#FFFFFF');
    ctx.globalAlpha = 1;
  }

  // steering arrow while touching
  if (game.touchId !== null && player.alive) {
    var hx = w2x(player.segments[0].x), hy = w2y(player.segments[0].y);
    var ang = Math.atan2(game.touchDY - hy, game.touchDX - hx);
    var len = 90;
    var tx = hx + Math.cos(ang) * len, ty = hy + Math.sin(ang) * len;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang) * 40, hy + Math.sin(ang) * 40);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(ang) * 16, ty + Math.sin(ang) * 16);
    ctx.lineTo(tx + Math.cos(ang + 2.5) * 12, ty + Math.sin(ang + 2.5) * 12);
    ctx.lineTo(tx + Math.cos(ang - 2.5) * 12, ty + Math.sin(ang - 2.5) * 12);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function renderButtons(list) {
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (b.big) {
      ctx.fillStyle = 'rgba(62,220,129,0.92)';
      rr(b.x, b.y, b.w, b.h, b.h / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text(b.label, b.x + b.w / 2, b.y + b.h / 2, b.h * 0.42, '#0B2A18', 'center', true);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      rr(b.x, b.y, b.w, b.h, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      text(b.label, b.x + b.w / 2, b.y + b.h / 2, 28, '#FFFFFF');
    }
  }
}

function renderBoostButton() {
  var c = boostBtn;
  var cx = c.x + c.r, cy = c.y + c.r;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  circle(cx, cy, c.r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (game.boostCd > 0) {
    var frac = game.boostCd / BOOST_CD;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, c.r - 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    text(Math.ceil(game.boostCd), cx, cy, 30, 'rgba(255,255,255,0.9)', 'center', true);
  } else {
    text('加速', cx, cy, 32, '#FFFFFF', 'center', true);
  }
}

function dim(a) {
  ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function renderPause() {
  dim(0.55);
  text('已暂停', VIEW_W / 2, VIEW_H * 0.32, 56, '#FFFFFF', 'center', true);
  renderButtons(buttons());
}

function renderOver() {
  dim(0.6);
  var o = game.over;
  if (o.win) {
    text('你赢了！', VIEW_W / 2, VIEW_H * 0.26, 72, '#FFD23F', 'center', true);
    text('冠军 · 第 ' + game.round + ' 轮', VIEW_W / 2, VIEW_H * 0.26 + 64, 32, '#FFFFFF');
  } else {
    text('被淘汰了', VIEW_W / 2, VIEW_H * 0.26, 72, '#FF6B6B', 'center', true);
    text('第 ' + o.placement + ' 名', VIEW_W / 2, VIEW_H * 0.26 + 64, 32, '#FFFFFF');
  }
  text('得分 ' + o.score, VIEW_W / 2, VIEW_H * 0.26 + 118, 40, '#FFD23F', 'center', true);
  text('最佳纪录 ' + o.best, VIEW_W / 2, VIEW_H * 0.26 + 166, 26, 'rgba(255,255,255,0.8)');
  renderButtons(buttons());
}

function renderMenu() {
  text('蛇蛇竞技场', VIEW_W / 2, VIEW_H * 0.20, 84, '#FFD23F', 'center', true);
  text('4 蛇同场竞技', VIEW_W / 2, VIEW_H * 0.20 + 66, 30, 'rgba(255,255,255,0.75)');
  text('最佳纪录：' + storage.getBest(), VIEW_W / 2, VIEW_H * 0.32, 34, 'rgba(255,255,255,0.9)');
  // decorative snake
  var ty = VIEW_H * 0.58;
  for (var i = 0; i < 8; i++) {
    ctx.fillStyle = i === 0 ? '#5BEE9A' : COLORS.p;
    circle(VIEW_W / 2 - i * 34, ty + Math.sin(game.time * 2 + i * 0.6) * 12, 20 - i);
    ctx.fill();
  }
  renderButtons(buttons());
  text('拖动屏幕控制方向 · 按住「加速」冲刺', VIEW_W / 2, VIEW_H - 60, 26, 'rgba(255,255,255,0.6)');
}

// ---- go ----
game.last = Date.now();
nextFrame(frame);

// Exposed for tests (selftest.js drives the game with stubbed wx).
module.exports = { game: game, startRound: startRound, layout: arenaView };

};
__modules["js/ai.js"]=function(module,exports,require){
// AI driver: thin wrapper over logic.decideAI with a retarget timer and a
// little personality per snake. No rendering, no wx calls.
var L = require('./logic.js');

var RETARGET = 0.25;          // seconds between normal target refreshes
var CAUTIOUS_FACTOR = 1.6;    // cautious snakes look this much further ahead
var SNACK_RANGE = 90;         // aggressive snakes still grab pellets this close
var ORDER = ['aggressive', 'cautious', 'greedy'];

var states = {};              // snake.id -> { snake, timer, target, personality }

function getState(snake, index) {
  var st = states[snake.id];
  if (!st || st.snake !== snake) {
    st = states[snake.id] = {
      snake: snake,
      timer: (index % 3) * 0.08,   // stagger so they do not all think on one frame
      target: snake.heading,
      personality: snake.personality || ORDER[index % ORDER.length]
    };
  }
  return st;
}

function lookahead(snake, personality) {
  var look = L.LOOKAHEAD * Math.max(1, snake.speed / L.BASE_SPEED);
  return personality === 'cautious' ? look * CAUTIOUS_FACTOR : look;
}

function threatened(snake, personality, snakes, arena) {
  var look = lookahead(snake, personality);
  return L.clearDistance(snake, snake.heading, snakes, arena, look) < look;
}

function findPlayer(snakes) {
  for (var i = 0; i < snakes.length; i++) {
    if (snakes[i].isPlayer && snakes[i].alive) return snakes[i];
  }
  return null;
}

// A point just behind the player's tail, kept inside the arena.
function tailArea(player, arena) {
  var segs = player.segments;
  var tail = segs[segs.length - 1];
  var prev = segs[Math.max(0, segs.length - 2)];
  var dx = tail.x - prev.x, dy = tail.y - prev.y;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  var m = L.BODY_RADIUS * 3;
  return {
    x: Math.min(arena.w - m, Math.max(m, tail.x + dx / d * m)),
    y: Math.min(arena.h - m, Math.max(m, tail.y + dy / d * m)),
    value: 1
  };
}

function chooseHeading(snake, personality, pellets, snakes, arena, rng) {
  if (personality === 'cautious') {
    // decideAI scales its avoid distance with speed, so hand it a stand-in
    // that claims to be faster; swap it into the list so its own neck is skipped.
    var proxy = {
      id: snake.id, alive: true, isPlayer: false, heading: snake.heading,
      speed: Math.max(snake.speed, L.BASE_SPEED) * CAUTIOUS_FACTOR, segments: snake.segments
    };
    var list = [];
    for (var i = 0; i < snakes.length; i++) list.push(snakes[i] === snake ? proxy : snakes[i]);
    return L.decideAI(proxy, pellets, list, arena, rng);
  }
  if (personality === 'aggressive') {
    var player = findPlayer(snakes);
    if (player) {
      var head = snake.segments[0];
      var near = [];
      for (var k = 0; k < pellets.length; k++) {
        var dx = pellets[k].x - head.x, dy = pellets[k].y - head.y;
        if (dx * dx + dy * dy < SNACK_RANGE * SNACK_RANGE) near.push(pellets[k]);
      }
      if (!near.length) near.push(tailArea(player, arena));
      return L.decideAI(snake, near, snakes, arena, rng);
    }
  }
  return L.decideAI(snake, pellets, snakes, arena, rng); // greedy: nearest pellet
}

// Steers every alive AI snake in place. Call once per logic step, before stepSnake.
function updateAI(snakes, pellets, arena, dt, rng) {
  arena = arena || L.ARENA;
  pellets = pellets || [];
  var index = 0;
  for (var i = 0; i < snakes.length; i++) {
    var s = snakes[i];
    if (s.isPlayer) continue;
    var st = getState(s, index++);
    if (!s.alive) continue;
    st.timer -= dt;
    if (st.timer <= 0 || threatened(s, st.personality, snakes, arena)) {
      st.target = chooseHeading(s, st.personality, pellets, snakes, arena, rng);
      if (st.timer <= 0) st.timer = RETARGET;
    }
    L.steerToward(s, st.target, dt, L.MAX_TURN_RATE);
  }
}

function reset() {
  states = {};
}

module.exports = {
  RETARGET: RETARGET,
  updateAI: updateAI,
  reset: reset
};

};
__modules["js/audio.js"]=function(module,exports,require){
// Snake Clash 音频：WebAudio 合成音效。wx.createWebAudioContext 不可用时静默运行。
// 静音开关持久化在 js/storage.js；play() 每次实时读取，静音立即生效。
var storage = require('./storage.js');

var actx = null;
var ok = false;
try {
  if (typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
    actx = wx.createWebAudioContext();
    ok = !!(actx && actx.createBuffer && actx.createBufferSource && actx.destination);
  }
} catch (e) {
  actx = null;
  ok = false;
}

var boostSrc = null;

// ---- synth helpers (volume/envelope baked into the samples) ----

function sampleRate() {
  return actx.sampleRate || 44100;
}

// fn(t) -> waveform sample; envelope: short attack + exponential decay.
function toneBuf(dur, fn, vol) {
  var sr = sampleRate();
  var n = Math.max(1, Math.floor(dur * sr));
  var buf = actx.createBuffer(1, n, sr);
  var ch = buf.getChannelData(0);
  for (var i = 0; i < n; i++) {
    var t = i / sr;
    var env = Math.min(1, t * 80) * Math.exp(-t * 7);
    ch[i] = fn(t) * env * vol;
  }
  return buf;
}

function toneAt(freq, dur, vol) {
  return toneBuf(dur, function (t) {
    return Math.sin(2 * Math.PI * freq * t);
  }, vol);
}

function sweepBuf(f0, f1, dur, vol) {
  return toneBuf(dur, function (t) {
    var phase = 2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * dur));
    return Math.sin(phase);
  }, vol);
}

function noiseBuf(dur, vol) {
  return toneBuf(dur, function () {
    return Math.random() * 2 - 1;
  }, vol);
}

function playAt(buf, when) {
  var src = actx.createBufferSource();
  src.buffer = buf;
  src.connect(actx.destination);
  src.start(actx.currentTime + (when || 0));
  return src;
}

function melody(freqs, step, dur, vol) {
  for (var i = 0; i < freqs.length; i++) {
    playAt(toneAt(freqs[i], dur, vol), i * step);
  }
}

// ---- boost whoosh: looped noise while boosting ----

function startBoost() {
  if (!ok || storage.getMuted()) return;
  try {
    stopBoost();
    var sr = sampleRate();
    var n = Math.floor(0.4 * sr);
    var buf = actx.createBuffer(1, n, sr);
    var ch = buf.getChannelData(0);
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      ch[i] = (Math.random() * 2 - 1) * 0.16 * (0.7 + 0.3 * Math.sin(t * 40));
    }
    var src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(actx.destination);
    src.start();
    boostSrc = src;
  } catch (e) {
    boostSrc = null;
  }
}

function stopBoost() {
  if (!boostSrc) return;
  try { boostSrc.stop(); } catch (e) { /* already stopped */ }
  boostSrc = null;
}

// ---- public ----

// play(name[, arg]) — arg: for 'eat', the snake's targetLength (pitch rises).
function play(name, arg) {
  if (!ok || storage.getMuted()) return;
  try {
    switch (name) {
      case 'eat': {
        var f = 480 + Math.min(arg || 0, 80) * 4; // 蛇越长音调越高
        playAt(sweepBuf(f, f * 1.7, 0.09, 0.5), 0);
        break;
      }
      case 'golden':
        playAt(toneAt(880, 0.12, 0.4), 0);
        playAt(toneAt(1318, 0.18, 0.4), 0.08);
        break;
      case 'kill':
        playAt(sweepBuf(300, 700, 0.12, 0.45), 0);
        break;
      case 'die':
        playAt(noiseBuf(0.28, 0.5), 0);
        playAt(sweepBuf(220, 55, 0.3, 0.5), 0.02);
        break;
      case 'win':
        melody([523, 659, 784, 1047], 0.14, 0.22, 0.45);
        break;
      case 'lose':
        melody([392, 311, 262], 0.18, 0.28, 0.45);
        break;
      case 'click':
        playAt(sweepBuf(900, 600, 0.05, 0.3), 0);
        break;
      case 'boost_start':
        startBoost();
        break;
      case 'boost_stop':
        stopBoost();
        break;
    }
  } catch (e) {
    // 音频出错绝不能影响游戏
  }
}

function setMuted(muted) {
  storage.setMuted(!!muted);
  if (muted) stopBoost();
}

module.exports = {
  play: play,
  setMuted: setMuted
};

};
__modules["js/logic.js"]=function(module,exports,require){
// Snake Clash - pure game logic. No rendering, no wx calls; runs in plain node.

var ARENA = { w: 750, h: 1100 };
var BODY_RADIUS = 14;
var BASE_SPEED = 150;
var BOOST_SPEED = 240;
var MAX_TURN_RATE = 4.5;
var EAT_RADIUS = 26;
var START_LENGTH = 5;
var PELLET_TARGET = 40;
var HIT_DIST = BODY_RADIUS * 1.5;   // head centre to body-point centre that kills
var NECK_SEGMENTS = 2;              // own segments behind the head that never kill
var LOOKAHEAD = 110;                // AI danger distance at base speed
var GOLDEN_CHANCE = 0.1;
var GOLDEN_COLOR = '#FFD23F';
var PELLET_COLORS = ['#FF6B6B', '#4ECDC4', '#A78BFA', '#7BD389', '#FF9F68', '#5BC0EB'];

var TWO_PI = Math.PI * 2;
var pelletSeq = 0;

// ---------- helpers ----------

function normalizeAngle(a) {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  return a;
}

function angleDiff(from, to) {
  return normalizeAngle(to - from);
}

function dist2(ax, ay, bx, by) {
  var dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

// Small deterministic rng (mulberry32) for callers that want seeded randomness.
function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- snake ----------

function createSnake(id, x, y, heading, color, isPlayer) {
  var segments = [];
  var path = [];
  var cx = Math.cos(heading), cy = Math.sin(heading);
  for (var i = 0; i < START_LENGTH; i++) {
    var px = x - cx * BODY_RADIUS * i, py = y - cy * BODY_RADIUS * i;
    segments.push({ x: px, y: py });
    path.push({ x: px, y: py });
  }
  return {
    id: id,
    color: color,
    isPlayer: !!isPlayer,
    alive: true,
    heading: normalizeAngle(heading),
    speed: BASE_SPEED,
    segments: segments,       // head -> tail, spaced ~BODY_RADIUS along the path
    path: path,               // recorded head positions, newest first
    targetLength: START_LENGTH,
    score: 0,
    boostCooldown: 0
  };
}

// Rebuild segments by walking the recorded head path and emitting a point every
// BODY_RADIUS of arc length. The path is trimmed at the last segment.
function resample(snake) {
  var path = snake.path;
  var target = snake.targetLength;
  var segs = [{ x: path[0].x, y: path[0].y }];
  var carry = 0; // arc length travelled since the last emitted point
  for (var i = 1; i < path.length && segs.length < target; i++) {
    var a = path[i - 1], b = path[i];
    var d = Math.sqrt(dist2(a.x, a.y, b.x, b.y));
    if (d === 0) continue;
    var t = BODY_RADIUS - carry;
    while (t <= d + 1e-9 && segs.length < target) {
      var k = t / d;
      segs.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      t += BODY_RADIUS;
    }
    carry = d - (t - BODY_RADIUS);
    if (segs.length >= target) {
      var last = segs[segs.length - 1];
      path.length = i + 1;
      path[i] = { x: last.x, y: last.y };
    }
  }
  snake.segments = segs;
}

function stepSnake(snake, dt) {
  if (!snake.alive || !(dt > 0)) return snake;
  snake.boostCooldown = Math.max(0, snake.boostCooldown - dt);
  var head = snake.path[0];
  var step = snake.speed * dt;
  if (step > 0) {
    snake.path.unshift({
      x: head.x + Math.cos(snake.heading) * step,
      y: head.y + Math.sin(snake.heading) * step
    });
  }
  resample(snake);
  return snake;
}

function steerToward(snake, targetAngle, dt, maxTurnRate) {
  var rate = maxTurnRate === undefined ? MAX_TURN_RATE : maxTurnRate;
  var maxStep = Math.max(0, rate * dt);
  var diff = angleDiff(snake.heading, targetAngle);
  if (diff > maxStep) diff = maxStep;
  else if (diff < -maxStep) diff = -maxStep;
  snake.heading = normalizeAngle(snake.heading + diff);
  return snake;
}

// Apply a pellet to a snake: grow and score by the pellet value.
function eatPellet(snake, pellet) {
  var v = pellet && pellet.value ? pellet.value : 1;
  snake.targetLength += v;
  snake.score += v;
  return snake;
}

// ---------- collisions ----------

function hitsWall(p, arena) {
  return p.x < BODY_RADIUS || p.x > arena.w - BODY_RADIUS ||
         p.y < BODY_RADIUS || p.y > arena.h - BODY_RADIUS;
}

// Does not mutate anything. Returns:
//   deaths: [snakeId]
//   eaten:  [{snakeId, pelletId}]   (pelletId = pellet.id, or its index if it has none)
//   deathInfo: [{snakeId, cause: 'wall'|'body'|'head', killerId, points: [{x,y}]}]
//     points = the dead snake's body positions, for the caller to drop pellets on.
function checkCollisions(snakes, pellets, arena) {
  arena = arena || ARENA;
  var live = [];
  var i, j, k;
  for (i = 0; i < snakes.length; i++) {
    if (snakes[i].alive && snakes[i].segments.length) live.push(snakes[i]);
  }
  var hit2 = HIT_DIST * HIT_DIST;
  var dead = {};      // id -> {cause, killerId}
  var headPair = {};  // "i|j" pairs whose heads collided this frame

  function kill(s, cause, killerId) {
    if (!dead[s.id]) dead[s.id] = { cause: cause, killerId: killerId };
  }

  // head-to-head: shorter dies, equal length both die
  for (i = 0; i < live.length; i++) {
    for (j = i + 1; j < live.length; j++) {
      var ha = live[i].segments[0], hb = live[j].segments[0];
      if (dist2(ha.x, ha.y, hb.x, hb.y) < hit2) {
        headPair[i + '|' + j] = true;
        var la = live[i].targetLength, lb = live[j].targetLength;
        if (la <= lb) kill(live[i], 'head', live[j].id);
        if (lb <= la) kill(live[j], 'head', live[i].id);
      }
    }
  }

  for (i = 0; i < live.length; i++) {
    var s = live[i];
    var h = s.segments[0];
    if (hitsWall(h, arena)) { kill(s, 'wall', null); continue; }
    for (j = 0; j < live.length && !dead[s.id]; j++) {
      var o = live[j];
      var start;
      if (i === j) {
        start = NECK_SEGMENTS + 1;
      } else {
        // a head-to-head pair is settled by the length rule alone
        if (headPair[Math.min(i, j) + '|' + Math.max(i, j)]) continue;
        start = 1;
      }
      for (k = start; k < o.segments.length; k++) {
        var p = o.segments[k];
        if (dist2(h.x, h.y, p.x, p.y) < hit2) {
          kill(s, 'body', o.id);
          break;
        }
      }
    }
  }

  var deaths = [], deathInfo = [];
  for (i = 0; i < live.length; i++) {
    var d = dead[live[i].id];
    if (!d) continue;
    deaths.push(live[i].id);
    var pts = [];
    for (k = 0; k < live[i].segments.length; k++) {
      pts.push({ x: live[i].segments[k].x, y: live[i].segments[k].y });
    }
    deathInfo.push({ snakeId: live[i].id, cause: d.cause, killerId: d.killerId, points: pts });
  }

  // pellets: each goes to the nearest surviving head within eatRadius
  var eaten = [];
  var eat2 = EAT_RADIUS * EAT_RADIUS;
  pellets = pellets || [];
  for (k = 0; k < pellets.length; k++) {
    var pe = pellets[k];
    var best = null, bestD = eat2;
    for (i = 0; i < live.length; i++) {
      if (dead[live[i].id]) continue;
      var hh = live[i].segments[0];
      var dd = dist2(hh.x, hh.y, pe.x, pe.y);
      if (dd <= bestD) { bestD = dd; best = live[i]; }
    }
    if (best) eaten.push({ snakeId: best.id, pelletId: pe.id !== undefined ? pe.id : k });
  }

  return { deaths: deaths, eaten: eaten, deathInfo: deathInfo };
}

// ---------- pellets ----------

function makePellet(x, y, golden, rng) {
  return {
    id: ++pelletSeq,
    x: x,
    y: y,
    value: golden ? 5 : 1,
    color: golden ? GOLDEN_COLOR : PELLET_COLORS[Math.floor(rng() * PELLET_COLORS.length) % PELLET_COLORS.length],
    golden: !!golden
  };
}

function spawnPellet(arena, snakes, rng) {
  arena = arena || ARENA;
  rng = rng || Math.random;
  snakes = snakes || [];
  var margin = BODY_RADIUS * 2;
  var minD2 = margin * margin;
  var bestX = arena.w / 2, bestY = arena.h / 2, bestClear = -1;
  for (var attempt = 0; attempt < 60; attempt++) {
    var x = margin + rng() * (arena.w - margin * 2);
    var y = margin + rng() * (arena.h - margin * 2);
    var clear = Infinity;
    for (var i = 0; i < snakes.length; i++) {
      if (!snakes[i].alive) continue;
      var segs = snakes[i].segments;
      for (var k = 0; k < segs.length; k++) {
        var d = dist2(x, y, segs[k].x, segs[k].y);
        if (d < clear) clear = d;
      }
    }
    if (clear > bestClear) { bestClear = clear; bestX = x; bestY = y; }
    if (clear >= minD2) break;
  }
  return makePellet(bestX, bestY, rng() < GOLDEN_CHANCE, rng);
}

// Pellets dropped by a dead snake: one normal pellet on every other body point.
function pelletsFromDeath(points, arena, rng) {
  arena = arena || ARENA;
  rng = rng || Math.random;
  var out = [];
  var m = BODY_RADIUS * 2;
  for (var i = 0; i < points.length; i += 2) {
    var x = Math.min(arena.w - m, Math.max(m, points[i].x + (rng() - 0.5) * BODY_RADIUS));
    var y = Math.min(arena.h - m, Math.max(m, points[i].y + (rng() - 0.5) * BODY_RADIUS));
    out.push(makePellet(x, y, false, rng));
  }
  return out;
}

// ---------- AI ----------

// Distance from the snake's head along `angle` before reaching a wall or a snake
// body, capped at maxDist.
function clearDistance(snake, angle, snakes, arena, maxDist) {
  var head = snake.segments[0];
  var cx = Math.cos(angle), cy = Math.sin(angle);
  var stepLen = BODY_RADIUS / 2;
  var block2 = (BODY_RADIUS * 2) * (BODY_RADIUS * 2);
  for (var d = stepLen; d <= maxDist; d += stepLen) {
    var px = head.x + cx * d, py = head.y + cy * d;
    if (px < BODY_RADIUS || px > arena.w - BODY_RADIUS ||
        py < BODY_RADIUS || py > arena.h - BODY_RADIUS) return d - stepLen;
    for (var i = 0; i < snakes.length; i++) {
      var o = snakes[i];
      if (!o.alive) continue;
      var segs = o.segments;
      for (var k = (o === snake ? NECK_SEGMENTS + 2 : 0); k < segs.length; k++) {
        if (dist2(px, py, segs[k].x, segs[k].y) < block2) return d - stepLen;
      }
    }
  }
  return maxDist;
}

var AI_OFFSETS = [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2];

// Returns the heading (radians) an AI snake should steer toward.
function decideAI(snake, pellets, snakes, arena, rng) {
  arena = arena || ARENA;
  snakes = snakes || [];
  var head = snake.segments[0];
  var i;

  // nearest pellet (arena centre if none)
  var tx = arena.w / 2, ty = arena.h / 2, best = Infinity;
  for (i = 0; pellets && i < pellets.length; i++) {
    var d = dist2(head.x, head.y, pellets[i].x, pellets[i].y);
    if (d < best) { best = d; tx = pellets[i].x; ty = pellets[i].y; }
  }
  var targetDist = Math.sqrt(dist2(head.x, head.y, tx, ty));
  var seek = targetDist > 1e-6 ? Math.atan2(ty - head.y, tx - head.x) : snake.heading;

  var look = LOOKAHEAD * Math.max(1, snake.speed / BASE_SPEED);
  var seekLook = Math.min(look, targetDist);
  var danger = clearDistance(snake, snake.heading, snakes, arena, look) < look ||
               clearDistance(snake, seek, snakes, arena, seekLook) < seekLook - BODY_RADIUS / 2;
  if (!danger) return seek;

  // sample 5 headings, take the longest clear run; ties go toward the pellet
  var range = look * 2.5;
  var bestAngle = snake.heading, bestClear = -1, bestOff = Infinity;
  for (i = 0; i < AI_OFFSETS.length; i++) {
    var ang = normalizeAngle(snake.heading + AI_OFFSETS[i]);
    var clear = clearDistance(snake, ang, snakes, arena, range);
    var off = Math.abs(angleDiff(ang, seek));
    var better = clear > bestClear + 1e-6;
    if (!better && Math.abs(clear - bestClear) <= 1e-6) {
      if (off < bestOff - 1e-6) better = true;
      else if (Math.abs(off - bestOff) <= 1e-6 && rng && rng() < 0.5) better = true;
    }
    if (better) { bestAngle = ang; bestClear = clear; bestOff = off; }
  }
  return bestAngle;
}

module.exports = {
  ARENA: ARENA,
  BODY_RADIUS: BODY_RADIUS,
  BASE_SPEED: BASE_SPEED,
  BOOST_SPEED: BOOST_SPEED,
  MAX_TURN_RATE: MAX_TURN_RATE,
  EAT_RADIUS: EAT_RADIUS,
  START_LENGTH: START_LENGTH,
  PELLET_TARGET: PELLET_TARGET,
  HIT_DIST: HIT_DIST,
  LOOKAHEAD: LOOKAHEAD,
  GOLDEN_COLOR: GOLDEN_COLOR,
  normalizeAngle: normalizeAngle,
  angleDiff: angleDiff,
  makeRng: makeRng,
  createSnake: createSnake,
  stepSnake: stepSnake,
  steerToward: steerToward,
  eatPellet: eatPellet,
  checkCollisions: checkCollisions,
  spawnPellet: spawnPellet,
  pelletsFromDeath: pelletsFromDeath,
  clearDistance: clearDistance,
  decideAI: decideAI
};

};
__modules["js/storage.js"]=function(module,exports,require){
// Persistent storage wrapper. Falls back to in-memory values when wx storage
// is unavailable or throws.
var KEY_BEST = 'snakeclash_best';
var KEY_MUTED = 'snakeclash_muted';

var memory = {};
memory[KEY_BEST] = 0;
memory[KEY_MUTED] = false;

function read(key) {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      var v = wx.getStorageSync(key);
      if (v !== '' && v !== undefined && v !== null) {
        memory[key] = v;
      }
    }
  } catch (e) {
    // keep in-memory value
  }
  return memory[key];
}

function write(key, value) {
  memory[key] = value;
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      wx.setStorageSync(key, value);
    }
  } catch (e) {
    // in-memory value already updated
  }
}

function getBest() {
  var n = Number(read(KEY_BEST));
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Stores score only if it beats the current best. Returns the best score.
function setBest(score) {
  var best = getBest();
  var n = Math.floor(Number(score));
  if (isFinite(n) && n > best) {
    write(KEY_BEST, n);
    return n;
  }
  return best;
}

function getMuted() {
  var v = read(KEY_MUTED);
  return v === true || v === 'true';
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
  getMuted: getMuted,
  setMuted: setMuted
};

};
__require("__entry__")("./game.js");
})();
