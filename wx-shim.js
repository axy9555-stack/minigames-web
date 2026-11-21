// wx-shim.js — 把微信小游戏的 wx 接口转成浏览器接口。
// 用法：在游戏 bundle 之前加载，并先设置 window.__GAME_ID__（用于存档隔离）。
// 约定：第一次 wx.createCanvas() 返回屏幕上的主画布，之后的调用返回离屏画布。
(function () {
  'use strict';
  var GAME_ID = window.__GAME_ID__ || 'game';

  function vw() { return window.innerWidth; }
  function vh() { return window.innerHeight; }
  function isDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }
  function sysInfo() {
    var w = vw(), h = vh();
    return {
      windowWidth: w, windowHeight: h,
      screenWidth: w, screenHeight: h,
      pixelRatio: window.devicePixelRatio || 1,
      statusBarHeight: 0, platform: 'web', language: 'zh_CN',
      theme: isDark() ? 'dark' : 'light',
      safeArea: { left: 0, top: 0, right: w, bottom: h, width: w, height: h }
    };
  }

  // ---------- canvas ----------
  var mainCanvas = null;
  function makeCanvas(onScreen) {
    var c = document.createElement('canvas');
    c.requestAnimationFrame = window.requestAnimationFrame.bind(window);
    c.cancelAnimationFrame = (window.cancelAnimationFrame || function (id) { clearTimeout(id); }).bind(window);
    if (onScreen) {
      c.id = 'game-canvas';
      c.style.cssText = 'position:fixed;inset:0;display:block;width:100vw;height:100vh;' +
        'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';
      document.body.appendChild(c);
    }
    return c;
  }

  // ---------- audio ----------
  var audioCtxs = [];
  function resumeAudio() {
    for (var i = 0; i < audioCtxs.length; i++) {
      try { if (audioCtxs[i].state === 'suspended') audioCtxs[i].resume(); } catch (e) {}
    }
  }
  function audioStub() {
    function node() {
      return { connect: function () {}, disconnect: function () {}, start: function () {}, stop: function () {},
        gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {}, linearRampToValueAtTime: function () {} },
        frequency: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {}, linearRampToValueAtTime: function () {} },
        Q: { value: 0 }, type: '' };
    }
    return { state: 'running', currentTime: 0, destination: {},
      resume: function () {}, suspend: function () {},
      createOscillator: node, createGain: node, createBufferSource: node,
      createBiquadFilter: node, createDynamicsCompressor: node,
      createBuffer: function () { return { getChannelData: function () { return new Float32Array(0); } }; },
      decodeAudioData: function () { return Promise.resolve(null); } };
  }

  // ---------- storage（按游戏隔离键名） ----------
  function skey(k) { return GAME_ID + ':' + String(k); }
  function storageGet(k) {
    try {
      var raw = window.localStorage.getItem(skey(k));
      if (raw === null || raw === undefined) return '';
      try { return JSON.parse(raw).v; } catch (e) { return raw; }
    } catch (e) { return ''; }
  }
  function storageSet(k, v) {
    try { window.localStorage.setItem(skey(k), JSON.stringify({ v: v })); } catch (e) {}
  }

  // ---------- touch：pointer 事件转成 wx touch 事件 ----------
  var touchHandlers = { touchstart: [], touchmove: [], touchend: [], touchcancel: [] };
  var activePointers = {}; // pointerId -> {identifier, clientX, clientY, pageX, pageY}
  function touchList() {
    var arr = [];
    for (var id in activePointers) arr.push(activePointers[id]);
    return arr;
  }
  function dispatchTouch(kind, changed) {
    var ev = {
      type: kind, timeStamp: Date.now(),
      touches: touchList(), changedTouches: changed || [],
      target: mainCanvas || null
    };
    var list = touchHandlers[kind];
    for (var i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (e) { /* 游戏内的触摸回调不能炸掉输入 */ }
    }
  }
  function onPointerDown(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      try { e.preventDefault(); } catch (err) {}
    }
    resumeAudio();
    var t = { identifier: (e.pointerId == null ? 0 : e.pointerId), clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, pageY: e.pageY };
    activePointers[t.identifier] = t;
    dispatchTouch('touchstart', [t]);
  }
  function onPointerMove(e) {
    var id = (e.pointerId == null ? 0 : e.pointerId);
    if (!(id in activePointers)) return;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      try { e.preventDefault(); } catch (err) {}
    }
    var t = { identifier: id, clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, pageY: e.pageY };
    activePointers[id] = t;
    dispatchTouch('touchmove', [t]);
  }
  function onPointerUp(e, kind) {
    var id = (e.pointerId == null ? 0 : e.pointerId);
    if (!(id in activePointers)) return;
    var t = activePointers[id];
    delete activePointers[id];
    dispatchTouch(kind, [t]);
  }
  window.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', function (e) { onPointerUp(e, 'touchend'); }, { passive: true });
  window.addEventListener('pointercancel', function (e) { onPointerUp(e, 'touchcancel'); }, { passive: true });
  window.addEventListener('blur', function () {
    var ids = Object.keys(activePointers);
    if (ids.length) {
      var changed = ids.map(function (id) { return activePointers[id]; });
      activePointers = {};
      var ev = { type: 'touchcancel', timeStamp: Date.now(), touches: [], changedTouches: changed, target: mainCanvas || null };
      var list = touchHandlers.touchcancel;
      for (var i = 0; i < list.length; i++) { try { list[i](ev); } catch (e) {} }
    }
  });
  // 触摸滚动/长按菜单在游戏里不需要
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- show / hide / resize / theme ----------
  var showHandlers = [], hideHandlers = [], resizeHandlers = [], themeHandlers = [];
  document.addEventListener('visibilitychange', function () {
    var list = document.hidden ? hideHandlers : showHandlers;
    for (var i = 0; i < list.length; i++) { try { list[i]({}); } catch (e) {} }
  });
  window.addEventListener('pageshow', function () {
    for (var i = 0; i < showHandlers.length; i++) { try { showHandlers[i]({}); } catch (e) {} }
  });
  window.addEventListener('pagehide', function () {
    for (var i = 0; i < hideHandlers.length; i++) { try { hideHandlers[i]({}); } catch (e) {} }
  });
  window.addEventListener('resize', function () {
    var info = { windowWidth: vw(), windowHeight: vh() };
    for (var i = 0; i < resizeHandlers.length; i++) { try { resizeHandlers[i](info); } catch (e) {} }
  });
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () {
      var info = { theme: isDark() ? 'dark' : 'light' };
      for (var i = 0; i < themeHandlers.length; i++) { try { themeHandlers[i](info); } catch (e) {} }
    };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
    else if (mq.addListener) mq.addListener(onTheme);
  } catch (e) {}

  // ---------- wx ----------
  window.wx = {
    createCanvas: function () {
      if (!mainCanvas) { mainCanvas = makeCanvas(true); return mainCanvas; }
      return makeCanvas(false);
    },
    getSystemInfoSync: sysInfo,
    getWindowInfo: sysInfo,
    getAppBaseInfo: function () {
      return { SDKVersion: '3.0.0', version: '1.0.0', language: 'zh_CN', theme: isDark() ? 'dark' : 'light' };
    },
    getMenuButtonBoundingClientRect: function () {
      var w = vw();
      return { left: w - 100, top: 8, width: 87, height: 32, right: w - 13, bottom: 40 };
    },
    getStorageSync: storageGet,
    setStorageSync: storageSet,
    createWebAudioContext: function () {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return audioStub();
        var ctx = new AC();
        audioCtxs.push(ctx);
        return ctx;
      } catch (e) { return audioStub(); }
    },
    onTouchStart: function (cb) { if (cb) touchHandlers.touchstart.push(cb); },
    onTouchMove: function (cb) { if (cb) touchHandlers.touchmove.push(cb); },
    onTouchEnd: function (cb) { if (cb) touchHandlers.touchend.push(cb); },
    onTouchCancel: function (cb) { if (cb) touchHandlers.touchcancel.push(cb); },
    offTouchStart: function () {}, offTouchMove: function () {},
    offTouchEnd: function () {}, offTouchCancel: function () {},
    onShow: function (cb) { if (cb) showHandlers.push(cb); },
    onHide: function (cb) { if (cb) hideHandlers.push(cb); },
    onWindowResize: function (cb) { if (cb) resizeHandlers.push(cb); },
    offWindowResize: function () {},
    onThemeChange: function (cb) { if (cb) themeHandlers.push(cb); }
  };
})();
