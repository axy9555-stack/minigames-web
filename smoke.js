// smoke.js — 在 Node 里用桩环境跑每个 bundle，验证加载、初始化、触摸、几帧循环都不报错。
// 用法：node smoke.js [slug...]；不传参数则跑全部 7 个 canvas 游戏。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = '/home/hatch/workspace/minigames-web';
const GAMES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['snake-clash', 'suika', 'relax', 'tidy-up', 'magic-sort', 'meowdoku', 'rotate-rings', 'dream-garden'];

function makeCtx(canvas) {
  const gradient = { addColorStop() {} };
  const target = { canvas };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') return function () { return { width: 10 }; };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return function () { return gradient; };
      }
      if (prop === 'getImageData') return function () { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; };
      if (prop in t) return t[prop];
      return function () {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

function makeCanvas() {
  const c = {
    width: 0, height: 0, style: {},
    getContext() { if (!c._ctx) c._ctx = makeCtx(c); return c._ctx; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: c.width, height: c.height, right: c.width, bottom: c.height }; },
    toDataURL() { return ''; },
  };
  c.requestAnimationFrame = function (cb) { return window.requestAnimationFrame(cb); };
  c.cancelAnimationFrame = function (id) { return window.cancelAnimationFrame(id); };
  return c;
}

function runGame(slug) {
  const errors = [];
  let rafCallbacks = [];
  let rafId = 0;
  let drawCalls = 0;
  const listeners = {};
  const store = new Map();
  const audioNodes = [];

  function audioNode() {
    const n = {
      connect() {}, disconnect() {}, start() {}, stop() {},
      gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
      frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
      Q: { value: 0 }, type: '', buffer: null,
    };
    audioNodes.push(n);
    return n;
  }
  class FakeAudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.sampleRate = 44100; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createOscillator() { return audioNode(); }
    createGain() { return audioNode(); }
    createBufferSource() { return audioNode(); }
    createBiquadFilter() { return audioNode(); }
    createDynamicsCompressor() { return audioNode(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), numberOfChannels: ch, length: len }; }
    decodeAudioData() { return Promise.resolve(null); }
  }

  const documentStub = {
    hidden: false,
    body: { appendChild() {}, style: {} },
    documentElement: { style: {} },
    createElement(tag) {
      if (tag === 'canvas') return makeCanvas();
      return { style: {}, addEventListener() {}, appendChild() {}, setAttribute() {}, getContext: null };
    },
    getElementById() { return null; },
    addEventListener(type, cb) { (listeners['doc:' + type] = listeners['doc:' + type] || []).push(cb); },
    removeEventListener() {},
  };

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Float32Array, Uint8ClampedArray, ArrayBuffer,
    __GAME_ID__: slug,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.navigator = { userAgent: 'node-smoke', language: 'zh-CN' };
  sandbox.location = { href: 'http://localhost/' };
  sandbox.document = documentStub;
  sandbox.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  sandbox.innerWidth = 390; sandbox.innerHeight = 844;
  sandbox.devicePixelRatio = 2;
  sandbox.AudioContext = FakeAudioContext;
  sandbox.webkitAudioContext = FakeAudioContext;
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  sandbox.requestAnimationFrame = (cb) => { rafCallbacks.push(cb); return ++rafId; };
  sandbox.cancelAnimationFrame = (id) => { rafCallbacks = rafCallbacks.filter((c) => c !== id); };
  sandbox.addEventListener = (type, cb) => { (listeners['win:' + type] = listeners['win:' + type] || []).push(cb); };
  sandbox.removeEventListener = () => {};
  sandbox.performance = { now: () => Date.now() };

  vm.createContext(sandbox);
  function runFile(file) {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  try {
    runFile(path.join(ROOT, 'wx-shim.js'));
    runFile(path.join(ROOT, slug, 'bundle.js'));
  } catch (e) {
    return { slug, ok: false, stage: 'load', error: String(e && e.stack || e) };
  }
  // 跑约 90 帧
  try {
    for (let f = 0; f < 90; f++) {
      const cbs = rafCallbacks; rafCallbacks = [];
      for (const cb of cbs) cb(Date.now());
      drawCalls++;
    }
  } catch (e) {
    return { slug, ok: false, stage: 'frames', error: String(e && e.stack || e) };
  }
  // 模拟一次触摸：按下、移动、抬起
  try {
    const downs = listeners['win:pointerdown'] || [];
    const moves = listeners['win:pointermove'] || [];
    const ups = listeners['win:pointerup'] || [];
    const mk = (x, y, id) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, pageX: x, pageY: y, timeStamp: Date.now(), preventDefault() {} });
    for (const cb of downs) cb(mk(195, 400, 1));
    for (const cb of moves) cb(mk(195, 350, 1));
    for (const cb of moves) cb(mk(200, 300, 1));
    for (const cb of ups) cb(mk(200, 300, 1));
    for (let f = 0; f < 60; f++) {
      const cbs = rafCallbacks; rafCallbacks = [];
      for (const cb of cbs) cb(Date.now());
    }
  } catch (e) {
    return { slug, ok: false, stage: 'touch', error: String(e && e.stack || e) };
  }
  return { slug, ok: true, frames: 150 };
}

let failed = 0;
for (const slug of GAMES) {
  const r = runGame(slug);
  if (r.ok) console.log('PASS ' + slug + '（加载+150 帧+一次触摸无报错）');
  else { failed++; console.log('FAIL ' + slug + ' @' + r.stage + '\n' + r.error.split('\n').slice(0, 6).join('\n')); }
}
process.exit(failed ? 1 : 0);
