// build.js — 把 7 款 canvas 微信小游戏打包成网页版（wx-shim + mini-CJS bundle）。
// Block Blast 用现成的 DOM 网页版 web-version-reference.html，不走这条路。
// 用法：node build.js
const fs = require('fs');
const path = require('path');

const SRC = '/home/hatch/workspace';
const OUT = '/home/hatch/workspace/minigames-web';

// slug, 中文名，副标题，源目录
const GAMES = [
  { slug: 'snake-clash', name: '蛇蛇竞技场', desc: '4 蛇同场竞技，吃豆变长，活到最后', src: 'snake-clash-minigame' },
  { slug: 'suika', name: '合成大西瓜', desc: '水果合成，两个西瓜相碰 +1000 分', src: 'suika-minigame' },
  { slug: 'relax', name: 'Relax · 40 个减压小游戏', desc: '捏泡泡纸、切肥皂、动感沙……10 款可玩', src: 'relax-minigame' },
  { slug: 'tidy-up', name: '收纳达人', desc: '把东西放回原位，限时评星', src: 'tidy-up-minigame' },
  { slug: 'magic-sort', name: '魔法分类', desc: '点瓶倒色，把同色液体收到一起', src: 'magic-sort-minigame' },
  { slug: 'meowdoku', name: '猫咪数独', desc: '标准 9×9 数独，三档难度', src: 'meowdoku-minigame' },
  { slug: 'rotate-rings', name: '旋转圆环', desc: '转一格，让每条辐条同色', src: 'rotate-rings-minigame' },
  { slug: 'dream-garden', name: '梦幻花园', desc: '种花、浇水、收花卖钱，经营你的花园', src: 'dream-garden-minigame' },
  { slug: 'block-blast', name: '积木爆破', desc: '把积木拖到棋盘上，填满整行整列消除', src: 'block-blast-minigame', dom: true },
];

function collectJs(dir, base) {
  // 返回 [{id, file}]，id 为相对游戏根目录的路径（game.js / js/*.js）
  const out = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d).sort()) {
      const f = path.join(d, name);
      const st = fs.statSync(f);
      if (st.isDirectory()) { walk(f); continue; }
      if (!name.endsWith('.js')) continue;
      if (name === 'selftest.js' || name === 'smoketest.js') continue;
      out.push({ id: path.relative(base, f).split(path.sep).join('/'), file: f });
    }
  })(dir);
  return out;
}

function bundleJs(modules) {
  const parts = [];
  parts.push('(function(){\n\'use strict\';\n');
  parts.push('var __modules={};\nvar __cache={};\n');
  parts.push('function __resolve(from,req){\n' +
    '  if(req.charAt(0)!==".") return req;\n' +
    '  var base=from.split("/").slice(0,-1);\n' +
    '  var ps=req.split("/");\n' +
    '  for(var i=0;i<ps.length;i++){var p=ps[i];\n' +
    '    if(p===""||p===".") continue;\n' +
    '    if(p==="..") base.pop(); else base.push(p);}\n' +
    '  return base.join("/");\n}\n');
  parts.push('function __require(from){\n' +
    '  return function(req){\n' +
    '    var id=__resolve(from,req);\n' +
    '    if(__cache[id]) return __cache[id].exports;\n' +
    '    var fn=__modules[id];\n' +
    '    if(!fn) throw new Error("Cannot find module "+req+" (resolved: "+id+")");\n' +
    '    var module={exports:{}};\n' +
    '    __cache[id]=module;\n' +
    '    fn(module,module.exports,__require(id));\n' +
    '    return module.exports;\n' +
    '  };\n}\n');
  for (const m of modules) {
    const src = fs.readFileSync(m.file, 'utf8');
    parts.push('__modules[' + JSON.stringify(m.id) + ']=function(module,exports,require){\n' + src + '\n};\n');
  }
  parts.push('__require("__entry__")("./game.js");\n})();\n');
  return parts.join('');
}

// 静态资源版本号：每次修 bug 改这里，index.html 里 bundle.js 带 ?v=，
// 旧版 bundle 就算被浏览器/边缘缓存了 4 小时也不会再被命中。
// 2026-11-24 梦幻花园买种子 bug 后发现：只改 bundle 内容不够，手机缓存的旧 bundle 仍会跑。
const ASSET_V = '20261124-seedrow';

function gamePage(game) {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n' +
    '<title>' + game.name + '</title>\n' +
    '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}' +
    'canvas{position:fixed;inset:0;display:block;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}</style>\n' +
    '</head>\n<body>\n' +
    '<script>window.__GAME_ID__=' + JSON.stringify(game.slug) + ';</script>\n' +
    '<script src="../wx-shim.js?v=' + ASSET_V + '"></script>\n' +
    '<script src="bundle.js?v=' + ASSET_V + '"></script>\n' +
    '</body>\n</html>\n';
}

function hubPage(games) {
  const cards = games.map(function (g) {
    return '  <a class="card" href="./' + g.slug + '/">\n' +
      '    <b>' + g.name + '</b>\n    <span>' + g.desc + '</span>\n  </a>';
  }).join('\n');
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<title>小游戏合集</title>\n<style>\n' +
    '*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#10101a;color:#fff;padding:24px 16px 40px}\n' +
    'h1{font-size:22px;margin:4px 0 4px}p.sub{color:#9a9ab0;margin:0 0 20px;font-size:14px}\n' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;max-width:720px;margin:0 auto}\n' +
    '.card{display:block;background:#1c1c2e;border:1px solid #2c2c44;border-radius:16px;padding:18px 14px;text-decoration:none;color:#fff}\n' +
    '.card b{display:block;font-size:17px;margin-bottom:6px}.card span{font-size:13px;color:#9a9ab0;line-height:1.5}\n' +
    '.card:active{background:#262640}\n</style>\n</head>\n<body>\n' +
    '<div style="max-width:720px;margin:0 auto"><h1>🎮 小游戏合集</h1>\n' +
    '<p class="sub">点开即玩，进度保存在本机浏览器里</p></div>\n' +
    '<div class="grid">\n' + cards + '\n</div>\n</body>\n</html>\n';
}

fs.mkdirSync(OUT, { recursive: true });
for (const g of GAMES) {
  const dir = path.join(OUT, g.slug);
  fs.mkdirSync(dir, { recursive: true });
  if (g.dom) {
    const ref = fs.readFileSync(path.join(SRC, g.src, 'web-version-reference.html'), 'utf8');
    fs.writeFileSync(path.join(dir, 'index.html'), ref);
    console.log(g.slug + ': DOM web version copied');
    continue;
  }
  const modules = collectJs(path.join(SRC, g.src), path.join(SRC, g.src));
  const bundle = bundleJs(modules);
  fs.writeFileSync(path.join(dir, 'bundle.js'), bundle);
  fs.writeFileSync(path.join(dir, 'index.html'), gamePage(g));
  console.log(g.slug + ': ' + modules.length + ' modules, bundle ' + bundle.length + ' bytes');
}
fs.writeFileSync(path.join(OUT, 'index.html'), hubPage(GAMES));
console.log('hub written');
