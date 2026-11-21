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
 * 喵独数 Meowdoku — 猫咪主题数独微信小游戏
 * 纯 Canvas 绘制，无 DOM/BOM，无外部资源。
 */

/* ==================== 运行环境与画布 ==================== */

var sysInfo = null;
try {
  sysInfo = wx.getSystemInfoSync();
} catch (e) {
  sysInfo = { windowWidth: 375, windowHeight: 667, pixelRatio: 2 };
}

var W = sysInfo.windowWidth || 375;
var H = sysInfo.windowHeight || 667;
var DPR = sysInfo.pixelRatio || 2;

var canvas = wx.createCanvas();
canvas.width = W * DPR;
canvas.height = H * DPR;
var ctx = canvas.getContext('2d');
ctx.scale(DPR, DPR);

/* ==================== 调色板（奶油粉薄荷暖橙） ==================== */

var COLORS = {
  bg: '#FDF6EC',
  board: '#FFFFFF',
  grid: '#E8D5C4',
  gridBold: '#C9A896',
  text: '#5B4A43',
  textSoft: '#A08B7E',
  pink: '#F8B8C8',
  pinkDeep: '#E8749A',
  mint: '#BFE8D8',
  mintDeep: '#4FA98A',
  orange: '#F8C89B',
  orangeDeep: '#E8935A',
  highlight: 'rgba(248,200,155,0.35)',
  sameDigit: 'rgba(191,232,216,0.55)',
  selected: 'rgba(248,184,200,0.85)',
  correct: '#4FA98A',
  wrong: '#E85B5B',
  paw: '#E8749A',
  pawLost: '#D9CDC3'
};

/* ==================== 数独核心 ==================== */

function idx(r, c) { return r * 9 + c; }

function candidatesUsed(grid, r, c) {
  var used = [false, false, false, false, false, false, false, false, false, false];
  var br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (var k = 0; k < 9; k++) {
    var rv = grid[idx(r, k)]; if (rv) used[rv] = true;
    var cv = grid[idx(k, c)]; if (cv) used[cv] = true;
    var bv = grid[idx(br + Math.floor(k / 3), bc + (k % 3))]; if (bv) used[bv] = true;
  }
  return used;
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// 回溯填充完整棋盘
function fillComplete(grid, pos) {
  if (pos === 81) return true;
  var r = Math.floor(pos / 9), c = pos % 9;
  var used = candidatesUsed(grid, r, c);
  var digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (var d = 0; d < 9; d++) {
    var v = digits[d];
    if (!used[v]) {
      grid[idx(r, c)] = v;
      if (fillComplete(grid, pos + 1)) return true;
      grid[idx(r, c)] = 0;
    }
  }
  return false;
}

// 计数解（找到 limit 个即停）
function countSolutions(grid, limit, pos) {
  if (pos === undefined) pos = 0;
  while (pos < 81 && grid[pos] !== 0) pos++;
  if (pos === 81) return 1;
  var r = Math.floor(pos / 9), c = pos % 9;
  var used = candidatesUsed(grid, r, c);
  var count = 0;
  for (var v = 1; v <= 9; v++) {
    if (used[v]) continue;
    grid[pos] = v;
    count += countSolutions(grid, limit - count, pos + 1);
    grid[pos] = 0;
    if (count >= limit) return count;
  }
  return count;
}

// 回溯求一个解并原地把 grid 填成解
function solveOne(grid) {
  var pos = 0;
  while (pos < 81 && grid[pos] !== 0) pos++;
  if (pos === 81) return grid;
  var r = Math.floor(pos / 9), c = pos % 9;
  var used = candidatesUsed(grid, r, c);
  for (var v = 1; v <= 9; v++) {
    if (!used[v]) {
      grid[pos] = v;
      if (solveOne(grid)) return grid;
      grid[pos] = 0;
    }
  }
  return null;
}

// 生成一道唯一解谜题，givens 为目标提示数
function generatePuzzle(givens) {
  var full = makeEmptyGrid();
  fillComplete(full, 0);
  var order = shuffle([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,
                       20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,
                       37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,
                       54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,
                       71,72,73,74,75,76,77,78,79,80]);
  var puzzle = full.slice();
  var remaining = 81;
  for (var i = 0; i < order.length && remaining > givens; i++) {
    var p = order[i];
    var saved = puzzle[p];
    if (saved === 0) continue;
    puzzle[p] = 0;
    var probe = puzzle.slice();
    if (countSolutions(probe, 2) !== 1) {
      puzzle[p] = saved; // 解不唯一，保留该格
    } else {
      remaining--;
    }
  }
  return puzzle;
}

function makeEmptyGrid() {
  var g = [];
  for (var i = 0; i < 81; i++) g.push(0);
  return g;
}

/* ==================== 游戏状态 ==================== */

var DIFFICULTIES = [
  { id: 'easy',   name: '简单', givens: 40, color: COLORS.mintDeep },
  { id: 'medium', name: '中等', givens: 32, color: COLORS.orangeDeep },
  { id: 'hard',   name: '困难', givens: 26, color: COLORS.pinkDeep }
];

var state = {
  scene: 'menu',        // menu | playing | paused | gameover | win
  difficulty: DIFFICULTIES[0],
  solution: null,
  givens: null,
  cells: null,          // {value, notes:[9], given}
  selected: -1,
  notesMode: false,
  mistakes: 0,
  hintsLeft: 3,
  time: 0,
  undoStack: [],
  catMood: 'normal',    // normal | happy | sad | celebrate
  moodUntil: 0,
  shakeCell: -1,
  shakeStart: 0,
  flashCell: -1,
  flashUntil: 0,
  newRecord: false,
  now: 0
};

function newGame(diff) {
  state.difficulty = diff;
  var puzzle = generatePuzzle(diff.givens);
  state.solution = solveOne(puzzle.slice());
  state.givens = [];
  state.cells = [];
  for (var i = 0; i < 81; i++) {
    var isGiven = puzzle[i] !== 0;
    state.givens.push(isGiven);
    state.cells.push({
      value: puzzle[i],
      notes: [false, false, false, false, false, false, false, false, false],
      given: isGiven
    });
  }
  state.selected = -1;
  state.notesMode = false;
  state.mistakes = 0;
  state.hintsLeft = 3;
  state.time = 0;
  state.undoStack = [];
  state.catMood = 'normal';
  state.moodUntil = 0;
  state.shakeCell = -1;
  state.flashCell = -1;
  state.newRecord = false;
  state.scene = 'playing';
}

/* ==================== 音效（合成喵叫） ==================== */

var audioCtx = null;
function playMeow() {
  try {
    if (!audioCtx && wx.createWebAudioContext) {
      audioCtx = wx.createWebAudioContext();
    }
    if (!audioCtx) return; // 不支持则静默
    var now = audioCtx.currentTime || 0;
    for (var i = 0; i < 2; i++) { // 两声上扬啁啾
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      var t0 = now + i * 0.22;
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.linearRampToValueAtTime(880, t0 + 0.12);
      osc.frequency.linearRampToValueAtTime(660, t0 + 0.2);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.03);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    }
  } catch (e) {
    audioCtx = null; // 任何错误都静默运行
  }
}

/* ==================== 最佳成绩 ==================== */

function getBestFor(d) {
  try {
    var v = wx.getStorageSync('meowdoku_best_' + d.id);
    return v ? parseInt(v, 10) : null;
  } catch (e) { return null; }
}
function getBest() {
  return getBestFor(state.difficulty);
}
function setBestIfBetter(sec) {
  var best = getBest();
  if (best === null || sec < best) {
    try { wx.setStorageSync('meowdoku_best_' + state.difficulty.id, String(sec)); } catch (e) {}
    return true;
  }
  return false;
}
function formatTime(sec) {
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/* ==================== 布局计算 ==================== */

var layout = (function computeLayout() {
  var pad = 12;
  var boardSize = Math.min(W - pad * 2, H * 0.52);
  var boardX = (W - boardSize) / 2;
  var boardY = 92;
  var cell = boardSize / 9;
  return {
    pad: pad,
    boardSize: boardSize,
    boardX: boardX,
    boardY: boardY,
    cell: cell,
    padY: boardY + boardSize + 18
  };
})();

function numpadRect() {
  var n = 5;                 // 每行 5 个
  var gap = 8;
  var btnW = Math.floor((W - layout.pad * 2 - gap * (n - 1)) / n);
  var btnH = Math.min(58, btnW);
  return { n: n, gap: gap, btnW: btnW, btnH: btnH, x0: layout.pad, y0: layout.padY + 8 };
}

function toolbarRect() {
  var np = numpadRect();
  return { n: 5, gap: 8, btnW: np.btnW, btnH: 46, x0: layout.pad,
           y0: np.y0 + np.btnH * 2 + np.gap + 14 };
}

/* ==================== 绘制辅助 ==================== */

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawPaw(x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.18, size * 0.42, size * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  var toes = [
    [-0.34, -0.28, 0.17], [-0.12, -0.42, 0.19], [0.12, -0.42, 0.19], [0.34, -0.28, 0.17]
  ];
  for (var i = 0; i < toes.length; i++) {
    ctx.beginPath();
    ctx.ellipse(x + toes[i][0] * size, y + toes[i][1] * size,
      toes[i][2] * size, toes[i][2] * size * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 猫咪脸 mascot，expression: normal|happy|sad|celebrate
function drawCatFace(cx, cy, r, expression) {
  ctx.fillStyle = COLORS.orange;
  ctx.beginPath(); // 左耳
  ctx.moveTo(cx - r * 0.85, cy - r * 0.35);
  ctx.lineTo(cx - r * 1.05, cy - r * 1.15);
  ctx.lineTo(cx - r * 0.25, cy - r * 0.85);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); // 右耳
  ctx.moveTo(cx + r * 0.85, cy - r * 0.35);
  ctx.lineTo(cx + r * 1.05, cy - r * 1.15);
  ctx.lineTo(cx + r * 0.25, cy - r * 0.85);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = COLORS.pink; // 内耳
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.78, cy - r * 0.45);
  ctx.lineTo(cx - r * 0.90, cy - r * 0.98);
  ctx.lineTo(cx - r * 0.40, cy - r * 0.78);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.78, cy - r * 0.45);
  ctx.lineTo(cx + r * 0.90, cy - r * 0.98);
  ctx.lineTo(cx + r * 0.40, cy - r * 0.78);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = COLORS.orange; // 头
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(248,184,200,0.7)'; // 腮红
  ctx.beginPath(); ctx.ellipse(cx - r * 0.62, cy + r * 0.22, r * 0.18, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + r * 0.62, cy + r * 0.22, r * 0.18, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  // 眼睛
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.lineCap = 'round';
  function eye(ex, ey, kind) {
    ctx.beginPath();
    if (kind === 'happy' || kind === 'celebrate') { // ^^
      ctx.arc(ex, ey + r * 0.05, r * 0.13, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (kind === 'sad') { // 下垂
      ctx.arc(ex, ey + r * 0.16, r * 0.13, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else { // 圆眼
      ctx.fillStyle = COLORS.text;
      ctx.ellipse(ex, ey, r * 0.07, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  eye(cx - r * 0.35, cy - r * 0.12, expression);
  eye(cx + r * 0.35, cy - r * 0.12, expression);
  // 嘴
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  var my = cy + r * 0.28;
  if (expression === 'sad') {
    ctx.beginPath();
    ctx.arc(cx, my + r * 0.16, r * 0.14, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx - r * 0.10, my, r * 0.10, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.10, my, r * 0.10, 0, Math.PI);
    ctx.stroke();
  }
  // 鼻子
  ctx.fillStyle = COLORS.pinkDeep;
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.18, r * 0.06, r * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  // 胡须
  ctx.strokeStyle = 'rgba(91,74,67,0.7)';
  ctx.lineWidth = Math.max(1, r * 0.045);
  var wy = cy + r * 0.15;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, wy); ctx.lineTo(cx - r * 0.95, wy - r * 0.1);
  ctx.moveTo(cx - r * 0.5, wy + r * 0.1); ctx.lineTo(cx - r * 0.95, wy + r * 0.22);
  ctx.moveTo(cx + r * 0.5, wy); ctx.lineTo(cx + r * 0.95, wy - r * 0.1);
  ctx.moveTo(cx + r * 0.5, wy + r * 0.1); ctx.lineTo(cx + r * 0.95, wy + r * 0.22);
  ctx.stroke();
  // 庆祝：周围小圆点
  if (expression === 'celebrate') {
    ctx.fillStyle = COLORS.pink;
    for (var i = 0; i < 6; i++) {
      var ang = i * Math.PI / 3 + 0.4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * r * 1.5, cy + Math.sin(ang) * r * 1.3, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ==================== 场景绘制 ==================== */

function draw() {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  drawPaw(W - 34, H - 40, 20, 'rgba(232,116,154,0.15)');
  drawPaw(20, H - 60, 14, 'rgba(191,232,216,0.35)');

  if (state.scene === 'menu') { drawMenu(); return; }
  drawHUD();
  drawBoard();
  if (state.scene === 'playing') {
    drawNumpad();
    drawToolbar();
  }
  if (state.scene === 'paused') drawOverlay('已暂停', '点击继续，棋盘已藏好啦~');
  if (state.scene === 'gameover') drawOverlay('喵呜……失败啦', '失误 3 次，小猫难过地走开了');
  if (state.scene === 'win') drawWinOverlay();
}

function drawMenu() {
  drawCatFace(W / 2, 120, 56, 'happy');
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('喵独数', W / 2, 210);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText('Meowdoku · 猫咪数独', W / 2, 236);
  drawPaw(W * 0.2, 285, 12, 'rgba(232,116,154,0.4)');
  drawPaw(W * 0.3, 307, 10, 'rgba(248,200,155,0.5)');
  drawPaw(W * 0.4, 323, 8, 'rgba(191,232,216,0.6)');

  var by = 360;
  ctx.font = '15px sans-serif';
  ctx.fillStyle = COLORS.textSoft;
  ctx.textAlign = 'center';
  ctx.fillText('选择难度开始游戏', W / 2, by - 20);
  for (var i = 0; i < DIFFICULTIES.length; i++) {
    var d = DIFFICULTIES[i];
    var bh = 56;
    var y = by + i * (bh + 14);
    roundRect(layout.pad, y, W - layout.pad * 2, bh, 28);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    drawPaw(layout.pad + 34, y + bh / 2, 13, d.color);
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(d.name, layout.pad + 62, y + bh / 2 + 6);
    ctx.fillStyle = COLORS.textSoft;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    var best = getBestFor(d);
    if (best) {
      ctx.fillText('最佳 ' + formatTime(best), W - layout.pad - 20, y + bh / 2 - 12);
    }
    ctx.fillText(d.givens + ' 个提示数', W - layout.pad - 20, y + bh / 2 + 8);
    ctx.textAlign = 'center';
  }
}

function drawHUD() {
  var mood = state.catMood;
  if (state.moodUntil && state.now > state.moodUntil) {
    state.catMood = 'normal'; state.moodUntil = 0; mood = 'normal';
  }
  drawCatFace(40, 46, 25, mood);
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('喵独数', 76, 34);
  ctx.fillStyle = state.difficulty.color;
  ctx.font = '13px sans-serif';
  ctx.fillText(state.difficulty.name, 76, 54);
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(formatTime(state.time), W - 44, 28);
  // 失误爪印（3 个，失去的变灰）
  for (var i = 0; i < 3; i++) {
    var color = i < (3 - state.mistakes) ? COLORS.paw : COLORS.pawLost;
    drawPaw(W / 2 - 24 + i * 24, 66, 10, color);
  }
  // 提示数显示
  ctx.font = '12px sans-serif';
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText('提示 ' + state.hintsLeft, W - 44, 48);
}

function drawBoard() {
  var L = layout, cell = L.cell;
  roundRect(L.boardX - 4, L.boardY - 4, L.boardSize + 8, L.boardSize + 8, 8);
  ctx.fillStyle = COLORS.board;
  ctx.fill();
  ctx.strokeStyle = COLORS.gridBold;
  ctx.lineWidth = 2;
  ctx.stroke();

  var selR = -1, selC = -1, selV = 0;
  if (state.selected >= 0) {
    selR = Math.floor(state.selected / 9); selC = state.selected % 9;
    selV = state.cells[state.selected].value;
  }

  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      var i = idx(r, c);
      var x = L.boardX + c * cell, y = L.boardY + r * cell;
      var cl = state.cells[i];
      var highlight = false, same = false, sel = (i === state.selected);
      if (state.selected >= 0) {
        if (r === selR || c === selC ||
            (Math.floor(r / 3) === Math.floor(selR / 3) &&
             Math.floor(c / 3) === Math.floor(selC / 3))) highlight = true;
        if (selV !== 0 && cl.value === selV && !sel) same = true;
      }
      if (sel) { ctx.fillStyle = COLORS.selected; ctx.fillRect(x, y, cell, cell); }
      else if (same) { ctx.fillStyle = COLORS.sameDigit; ctx.fillRect(x, y, cell, cell); }
      else if (highlight) { ctx.fillStyle = COLORS.highlight; ctx.fillRect(x, y, cell, cell); }

      if (cl.value !== 0) {
        var shakeOff = 0;
        if (state.shakeCell === i && state.now - state.shakeStart < 0.5) {
          shakeOff = Math.sin((state.now - state.shakeStart) * 40) * 3;
        }
        var color;
        if (cl.given) color = COLORS.text;
        else if (state.flashCell === i && state.now < state.flashUntil) color = COLORS.correct;
        else color = (cl.value === state.solution[i]) ? COLORS.correct : COLORS.wrong;
        ctx.fillStyle = color;
        ctx.font = 'bold ' + Math.floor(cell * 0.62) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(cl.value), x + cell / 2 + shakeOff, y + cell * 0.68);
      } else {
        ctx.fillStyle = COLORS.textSoft;
        ctx.font = Math.floor(cell * 0.22) + 'px sans-serif';
        ctx.textAlign = 'center';
        for (var d = 0; d < 9; d++) {
          if (cl.notes[d]) {
            var nr = Math.floor(d / 3), nc = d % 3;
            ctx.fillText(String(d + 1),
              x + cell * (0.2 + nc * 0.3), y + cell * (0.32 + nr * 0.3));
          }
        }
      }
    }
  }
  // 细网格线
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (var k = 0; k <= 9; k++) {
    var gx = L.boardX + k * cell, gy = L.boardY + k * cell;
    ctx.beginPath(); ctx.moveTo(gx, L.boardY); ctx.lineTo(gx, L.boardY + L.boardSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L.boardX, gy); ctx.lineTo(L.boardX + L.boardSize, gy); ctx.stroke();
  }
  // 粗 3x3 线
  ctx.strokeStyle = COLORS.gridBold;
  ctx.lineWidth = 2;
  for (var b = 0; b <= 3; b++) {
    var bx = L.boardX + b * 3 * cell, byy = L.boardY + b * 3 * cell;
    ctx.beginPath(); ctx.moveTo(bx, L.boardY); ctx.lineTo(bx, L.boardY + L.boardSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L.boardX, byy); ctx.lineTo(L.boardX + L.boardSize, byy); ctx.stroke();
  }
  // 暂停时遮罩棋盘
  if (state.scene === 'paused') {
    ctx.fillStyle = 'rgba(253,246,236,0.97)';
    ctx.fillRect(L.boardX - 4, L.boardY - 4, L.boardSize + 8, L.boardSize + 8);
    drawPaw(L.boardX + L.boardSize / 2, L.boardY + L.boardSize / 2, 24, COLORS.pawLost);
  }
}

function drawButton(x, y, w, h, label, active) {
  roundRect(x, y, w, h, 10);
  ctx.fillStyle = active ? COLORS.pink : '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = active ? COLORS.pinkDeep : COLORS.gridBold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = active ? '#FFFFFF' : COLORS.text;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + 5);
}

function drawNumpad() {
  var np = numpadRect();
  for (var i = 0; i < 9; i++) {
    var col = i % np.n, row = Math.floor(i / np.n);
    var x = np.x0 + col * (np.btnW + np.gap);
    var y = np.y0 + row * (np.btnH + np.gap);
    drawButton(x, y, np.btnW, np.btnH, String(i + 1), false);
  }
}

var TOOL_LABELS = ['笔记', '橡皮', '提示', '撤销', '暂停'];

function drawToolbar() {
  var t = toolbarRect();
  for (var i = 0; i < 5; i++) {
    var x = t.x0 + i * (t.btnW + t.gap);
    var active = (i === 0 && state.notesMode);
    var label = TOOL_LABELS[i];
    if (i === 2) label = '提示' + state.hintsLeft;
    drawButton(x, t.y0, t.btnW, t.btnH, label, active);
  }
  ctx.font = '12px sans-serif';
  ctx.fillStyle = COLORS.textSoft;
  ctx.textAlign = 'center';
  ctx.fillText('点数字填入所选格 · 点“笔记”切换铅笔模式', W / 2, t.y0 + t.btnH + 24);
}

function drawOverlay(title, subtitle) {
  ctx.fillStyle = 'rgba(91,74,67,0.45)';
  ctx.fillRect(0, 0, W, H);
  var bw = W * 0.78, bh = 210;
  var bx = (W - bw) / 2, by = H / 2 - bh / 2;
  roundRect(bx, by, bw, bh, 18);
  ctx.fillStyle = COLORS.bg;
  ctx.fill();
  ctx.strokeStyle = COLORS.pink;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawCatFace(bx + bw / 2, by + 38, 22, 'sad');
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, by + 90);
  ctx.fillStyle = COLORS.textSoft;
  ctx.font = '13px sans-serif';
  ctx.fillText(subtitle, W / 2, by + 114);
  var labels = state.scene === 'paused' ? ['继续游戏', '回到菜单'] : ['重新开始', '换个难度'];
  for (var i = 0; i < 2; i++) {
    var byy = by + 134 + i * 46;
    roundRect(bx + 20, byy, bw - 40, 36, 18);
    ctx.fillStyle = i === 0 ? COLORS.pink : '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = COLORS.pinkDeep;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = i === 0 ? '#FFFFFF' : COLORS.text;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(labels[i], W / 2, byy + 24);
  }
}

function drawWinOverlay() {
  ctx.fillStyle = 'rgba(91,74,67,0.45)';
  ctx.fillRect(0, 0, W, H);
  var bw = W * 0.82, bh = 290;
  var bx = (W - bw) / 2, by = H / 2 - bh / 2;
  roundRect(bx, by, bw, bh, 18);
  ctx.fillStyle = COLORS.bg;
  ctx.fill();
  ctx.strokeStyle = COLORS.mintDeep;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawCatFace(bx + bw / 2, by + 44, 26, 'celebrate');
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('通关喵！', W / 2, by + 100);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText('用时 ' + formatTime(state.time) + ' · ' + state.difficulty.name, W / 2, by + 124);
  var best = getBest();
  ctx.fillStyle = state.newRecord ? COLORS.orangeDeep : COLORS.text;
  if (state.newRecord) {
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('新纪录！', W / 2, by + 146);
  } else {
    ctx.font = '14px sans-serif';
    ctx.fillText('最佳 ' + formatTime(best), W / 2, by + 146);
  }
  var labels = ['再来一局', '换个难度'];
  for (var i = 0; i < 2; i++) {
    var byy = by + 170 + i * 46;
    roundRect(bx + 24, byy, bw - 48, 36, 18);
    ctx.fillStyle = i === 0 ? COLORS.mint : '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = COLORS.mintDeep;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = i === 0 ? '#FFFFFF' : COLORS.text;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(labels[i], W / 2, byy + 24);
  }
}

/* ==================== 交互逻辑 ==================== */

function pushUndo(i, prev) {
  state.undoStack.push({ cell: i, value: prev.value, notes: prev.notes });
  if (state.undoStack.length > 200) state.undoStack.shift();
}

function inputDigit(v) {
  var i = state.selected;
  if (i < 0) return;
  var cl = state.cells[i];
  if (cl.given) return;
  if (state.notesMode) {
    pushUndo(i, { value: cl.value, notes: cl.notes.slice() });
    cl.notes[v - 1] = !cl.notes[v - 1];
    return;
  }
  if (cl.value === v) { // 再点同一数字：清除
    pushUndo(i, { value: cl.value, notes: cl.notes.slice() });
    cl.value = 0;
    return;
  }
  pushUndo(i, { value: cl.value, notes: cl.notes.slice() });
  cl.value = v;
  cl.notes = [false, false, false, false, false, false, false, false, false];
  if (v === state.solution[i]) {
    state.flashCell = i;
    state.flashUntil = state.now + 0.6;
    state.catMood = 'happy';
    state.moodUntil = state.now + 1.2;
    state.selected = -1;
    clearPeerNotes(i, v);
    checkWin();
  } else {
    state.catMood = 'sad';
    state.moodUntil = state.now + 1.5;
    state.shakeCell = i;
    state.shakeStart = state.now;
    state.mistakes++;
    if (state.mistakes >= 3) state.scene = 'gameover';
  }
}

function clearPeerNotes(i, v) {
  var r = Math.floor(i / 9), c = i % 9;
  var br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (var k = 0; k < 9; k++) {
    state.cells[idx(r, k)].notes[v - 1] = false;
    state.cells[idx(k, c)].notes[v - 1] = false;
    state.cells[idx(br + Math.floor(k / 3), bc + (k % 3))].notes[v - 1] = false;
  }
}

function eraseCell() {
  var i = state.selected;
  if (i < 0) return;
  var cl = state.cells[i];
  if (cl.given) return;
  if (cl.value === 0) {
    var has = false;
    for (var d = 0; d < 9; d++) if (cl.notes[d]) has = true;
    if (!has) return;
  }
  pushUndo(i, { value: cl.value, notes: cl.notes.slice() });
  cl.value = 0;
  cl.notes = [false, false, false, false, false, false, false, false, false];
}

function useHint() {
  if (state.hintsLeft <= 0) return;
  // 优先当前选中格，否则找一个空格
  var target = -1;
  if (state.selected >= 0 && !state.cells[state.selected].given &&
      state.cells[state.selected].value !== state.solution[state.selected]) {
    target = state.selected;
  } else {
    var empties = [];
    for (var i = 0; i < 81; i++) {
      if (!state.cells[i].given && state.cells[i].value !== state.solution[i]) empties.push(i);
    }
    if (empties.length === 0) return;
    target = empties[Math.floor(Math.random() * empties.length)];
  }
  var cl = state.cells[target];
  pushUndo(target, { value: cl.value, notes: cl.notes.slice() });
  cl.value = state.solution[target];
  cl.notes = [false, false, false, false, false, false, false, false, false];
  state.hintsLeft--;
  state.flashCell = target;
  state.flashUntil = state.now + 0.6;
  state.catMood = 'happy';
  state.moodUntil = state.now + 1.2;
  state.selected = -1;
  clearPeerNotes(target, cl.value);
  checkWin();
}

function undo() {
  var last = state.undoStack.pop();
  if (!last) return;
  var cl = state.cells[last.cell];
  cl.value = last.value;
  cl.notes = last.notes;
  state.selected = last.cell;
}

function togglePause() {
  if (state.scene === 'playing') state.scene = 'paused';
  else if (state.scene === 'paused') state.scene = 'playing';
}

function checkWin() {
  for (var i = 0; i < 81; i++) {
    if (state.cells[i].value !== state.solution[i]) return;
  }
  state.time = Math.floor(state.time);
  state.newRecord = setBestIfBetter(state.time);
  state.catMood = 'celebrate';
  state.moodUntil = 0; // 庆祝表情保持
  state.scene = 'win';
  playMeow();
}

function toMenu() { state.scene = 'menu'; }
function retryGame() { newGame(state.difficulty); }
function resumeGame() { togglePause(); }

/* ==================== 触摸输入 ==================== */

function pt(e) {
  return { x: e.touches[0].clientX, y: e.touches[0].clientY };
}

wx.onTouchStart(function (e) {
  var p = pt(e);
  if (state.scene === 'menu') {
    var by = 360;
    for (var i = 0; i < DIFFICULTIES.length; i++) {
      var y = by + i * (56 + 14);
      if (p.x >= layout.pad && p.x <= W - layout.pad && p.y >= y && p.y <= y + 56) {
        newGame(DIFFICULTIES[i]);
        return;
      }
    }
    return;
  }
  if (state.scene === 'paused') {
    var bw = W * 0.78, bh = 210;
    var bx = (W - bw) / 2, byy = H / 2 - bh / 2;
    if (hitPanel(p, bx, byy, bw, bh)) {
      if (p.y > byy + 134 && p.y < byy + 170) resumeGame();
      else if (p.y > byy + 180 && p.y < byy + 216) toMenu();
    } else {
      resumeGame();
    }
    return;
  }
  if (state.scene === 'gameover') {
    var bx2 = (W - W * 0.78) / 2, by2 = H / 2 - 105;
    if (hitPanel(p, bx2, by2, W * 0.78, 210)) {
      if (p.y > by2 + 134 && p.y < by2 + 170) retryGame();
      else if (p.y > by2 + 180 && p.y < by2 + 216) toMenu();
    }
    return;
  }
  if (state.scene === 'win') {
    var bx3 = (W - W * 0.82) / 2, by3 = H / 2 - 145;
    if (hitPanel(p, bx3, by3, W * 0.82, 290)) {
      if (p.y > by3 + 170 && p.y < by3 + 206) retryGame();
      else if (p.y > by3 + 216 && p.y < by3 + 252) toMenu();
    }
    return;
  }
  // playing
  var L = layout;
  if (p.x >= L.boardX && p.x < L.boardX + L.boardSize &&
      p.y >= L.boardY && p.y < L.boardY + L.boardSize) {
    var c = Math.floor((p.x - L.boardX) / L.cell);
    var r = Math.floor((p.y - L.boardY) / L.cell);
    state.selected = idx(r, c);
    return;
  }
  var np = numpadRect();
  if (p.y >= np.y0 && p.y < np.y0 + np.btnH * 2 + np.gap) {
    var row = Math.floor((p.y - np.y0) / (np.btnH + np.gap));
    var col = Math.floor((p.x - np.x0) / (np.btnW + np.gap));
    var d = row * np.n + col;
    if (row >= 0 && row < 2 && col >= 0 && col < np.n && d >= 1 && d <= 9) {
      inputDigit(d);
    }
    return;
  }
  var t = toolbarRect();
  if (p.y >= t.y0 && p.y <= t.y0 + t.btnH && p.x >= t.x0 && p.x <= W - t.x0) {
    var ti = Math.floor((p.x - t.x0) / (t.btnW + t.gap));
    var rel = p.x - t.x0 - ti * (t.btnW + t.gap);
    if (ti >= 0 && ti < 5 && rel <= t.btnW) {
      if (ti === 0) state.notesMode = !state.notesMode;
      else if (ti === 1) eraseCell();
      else if (ti === 2) useHint();
      else if (ti === 3) undo();
      else if (ti === 4) togglePause();
    }
  }
});

function hitPanel(p, bx, by, bw, bh) {
  return p.x >= bx && p.x <= bx + bw && p.y >= by && p.y <= by + bh;
}

/* ==================== 主循环 ==================== */

var lastFrame = Date.now();
function loop() {
  var nowMs = Date.now();
  var dt = (nowMs - lastFrame) / 1000;
  lastFrame = nowMs;
  if (dt > 0.1) dt = 0.1;
  if (state.scene === 'playing') {
    state.time += dt;
    state.now += dt;
  } else {
    state.now += dt;
  }
  draw();
  canvas.requestAnimationFrame(loop);
}
canvas.requestAnimationFrame(loop);

};
__require("__entry__")("./game.js");
})();
