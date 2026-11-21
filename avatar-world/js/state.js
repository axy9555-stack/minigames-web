/* Avatar World 捏脸换装馆 —— 配置状态 + 画布渲染入口。
 * 本文件在 avatar.js 之前加载，所以凡是依赖 OPTIONS 的都在调用时才取。 */
(function (root) {
  'use strict';

  var ns = root.AvatarWorld = root.AvatarWorld || {};

  function options() {
    if (!ns.OPTIONS) throw new Error('AvatarWorld.OPTIONS 未加载（缺少 js/avatar.js）');
    return ns.OPTIONS;
  }

  function createDefault() {
    var opts = options(), cfg = {};
    for (var key in opts) cfg[key] = opts[key][0];
    return cfg;
  }

  function createRandom() {
    var opts = options(), cfg = {};
    for (var key in opts) {
      var list = opts[key];
      cfg[key] = list[Math.floor(Math.random() * list.length)];
    }
    return cfg;
  }

  var PRESETS = [
    {
      name: '草莓甜妹',
      cfg: {
        bg: '樱花粉', skin: '#ffe0c4', eyes: '星星眼', brows: '弯眉', mouth: '微笑', blush: '开',
        hair: '双马尾', hairColor: '#ff8fb1', outfit: '连衣裙', accessory: '蝴蝶结'
      }
    },
    {
      name: '街头酷哥',
      cfg: {
        bg: '星夜渐变', skin: '#e0a877', eyes: '单眼皮', brows: '上扬眉', mouth: '抿嘴', blush: '关',
        hair: '寸头', hairColor: '#2b2118', outfit: '卫衣', accessory: '棒球帽'
      }
    },
    {
      name: '墨染古风',
      cfg: {
        bg: '薄荷绿', skin: '#f6c9a0', eyes: '笑眼', brows: '平眉', mouth: '微笑', blush: '开',
        hair: '丸子头', hairColor: '#2b2118', outfit: '汉服', accessory: '耳环'
      }
    }
  ];

  var state = { createRandom: createRandom, PRESETS: PRESETS };
  // 每次读取都返回一份新的默认配置，避免被外部改脏
  Object.defineProperty(state, 'DEFAULT_CFG', { enumerable: true, get: createDefault });
  ns.state = state;

  // 把 cfg（缺省为默认形象）画到 #avatar-canvas；只依赖画布，不依赖面板
  ns.render = function (cfg) {
    var doc = root.document;
    var canvas = doc && doc.getElementById('avatar-canvas');
    if (!canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext('2d');
    var full = createDefault();
    if (cfg) for (var key in full) if (cfg[key] !== undefined) full[key] = cfg[key];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ns.drawAvatar(ctx, full);
    return full;
  };
})(typeof window !== 'undefined' ? window : globalThis);
