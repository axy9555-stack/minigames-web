/* Avatar World 捏脸换装馆 —— 纯渲染核心。
 * 只用 Canvas 2D 路径绘制，不碰 DOM、不碰 localStorage、不加载图片。
 * 画布坐标固定为 480x600。 */
(function (root) {
  'use strict';

  var W = 480, H = 600;
  var CX = 240;            // 中轴
  var HEAD_Y = 245;        // 头中心
  var HEAD_RX = 108, HEAD_RY = 112;
  var EYE_Y = 250, EYE_DX = 42;
  var INK = '#3a2420';     // 五官线条色

  var OPTIONS = {
    bg: ['奶油黄', '薄荷绿', '天空蓝', '樱花粉', '日落渐变', '星夜渐变'],
    skin: ['#ffe0c4', '#f6c9a0', '#e0a877', '#b97a50', '#7d4f33'],
    eyes: ['圆眼', '笑眼', '星星眼', '单眼皮', '闭眼弯弯'],
    brows: ['平眉', '弯眉', '上扬眉'],
    mouth: ['微笑', '露齿笑', '嘟嘴', '抿嘴', '张嘴笑'],
    blush: ['开', '关'],
    hair: ['短发', '长直发', '双马尾', '丸子头', '卷发', '寸头'],
    hairColor: ['#2b2118', '#6b4226', '#d9a441', '#ff8fb1', '#7b5cd6', '#c9d6e8'],
    outfit: ['T恤', '连衣裙', '卫衣', '西装', '汉服', '运动服'],
    accessory: ['无', '圆眼镜', '耳环', '棒球帽', '蝴蝶结']
  };

  var BG_COLORS = {
    '奶油黄': ['#fff3c4'],
    '薄荷绿': ['#c9f2e0'],
    '天空蓝': ['#cfe8ff'],
    '樱花粉': ['#ffd9e6'],
    '日落渐变': ['#ffc77b', '#ff7eb3'],
    '星夜渐变': ['#2f2468', '#8a6fd8']
  };

  /* ---------- 小工具 ---------- */

  // 十六进制颜色加减亮度
  function shade(hex, amt) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    if (isNaN(n)) return hex;
    function ch(v) { return Math.max(0, Math.min(255, v + amt)); }
    var r = ch(n >> 16 & 255), g = ch(n >> 8 & 255), b = ch(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function pick(list, value) {
    return list.indexOf(value) >= 0 ? value : list[0];
  }

  function circle(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function oval(ctx, x, y, rx, ry, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function rrect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function stroke(ctx, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function star(ctx, x, y, rOuter, rInner, fill) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 === 0 ? rOuter : rInner;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /* ---------- 背景 ---------- */

  function drawBg(ctx, name) {
    var colors = BG_COLORS[name];
    if (colors.length > 1) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, colors[0]);
      g.addColorStop(1, colors[1]);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = colors[0];
    }
    ctx.fillRect(0, 0, W, H);
    if (name === '星夜渐变') {
      var stars = [[60, 70, 7], [410, 60, 9], [380, 190, 5], [70, 230, 5], [430, 330, 6], [40, 380, 4]];
      for (var i = 0; i < stars.length; i++) {
        star(ctx, stars[i][0], stars[i][1], stars[i][2], stars[i][2] * 0.45, 'rgba(255,240,170,0.9)');
      }
    } else {
      // 柔和的装饰圆
      circle(ctx, 70, 90, 46, 'rgba(255,255,255,0.35)');
      circle(ctx, 420, 150, 30, 'rgba(255,255,255,0.3)');
      circle(ctx, 400, 60, 14, 'rgba(255,255,255,0.4)');
    }
  }

  /* ---------- 身体与服装（全部在 y>=395，与脸不重叠） ---------- */

  function bodyPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(98, H);
    ctx.lineTo(98, 475);
    ctx.quadraticCurveTo(98, 410, 172, 400);
    ctx.lineTo(308, 400);
    ctx.quadraticCurveTo(382, 410, 382, 475);
    ctx.lineTo(382, H);
    ctx.closePath();
  }

  function fillBody(ctx, color) {
    bodyPath(ctx);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // 脖子：depth 为圆领向下的深度
  function neckRound(ctx, skin, depth) {
    rrect(ctx, 214, 335, 52, 68, 8, skin);
    oval(ctx, CX, 401, 26, depth, skin);
    oval(ctx, CX, 362, 26, 10, shade(skin, -22)); // 下巴阴影
  }

  // 脖子 + V 领露肤
  function neckV(ctx, skin, bottomY) {
    rrect(ctx, 214, 335, 52, 68, 8, skin);
    ctx.beginPath();
    ctx.moveTo(208, 398);
    ctx.lineTo(272, 398);
    ctx.lineTo(CX, bottomY);
    ctx.closePath();
    ctx.fillStyle = skin;
    ctx.fill();
    oval(ctx, CX, 362, 26, 10, shade(skin, -22));
  }

  function sleeveLines(ctx, color) {
    ctx.beginPath();
    ctx.moveTo(140, 480); ctx.lineTo(140, H);
    ctx.moveTo(340, 480); ctx.lineTo(340, H);
    stroke(ctx, color, 4);
  }

  var OUTFITS = {
    'T恤': function (ctx, skin) {
      var c = '#ffb703';
      fillBody(ctx, c);
      neckRound(ctx, skin, 20);
      ctx.beginPath();
      ctx.ellipse(CX, 401, 30, 24, 0, 0, Math.PI);
      stroke(ctx, '#fb8500', 6);
      sleeveLines(ctx, shade(c, -30));
      star(ctx, CX, 500, 26, 12, '#ffffff');
    },
    '连衣裙': function (ctx, skin) {
      var c = '#ff8fab';
      fillBody(ctx, skin); // 露肩
      neckRound(ctx, skin, 6);
      ctx.beginPath();
      ctx.moveTo(136, H);
      ctx.lineTo(136, 458);
      ctx.quadraticCurveTo(190, 432, CX, 466);
      ctx.quadraticCurveTo(290, 432, 344, 458);
      ctx.lineTo(344, H);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(166, 448); ctx.lineTo(192, 402);
      ctx.moveTo(314, 448); ctx.lineTo(288, 402);
      stroke(ctx, c, 14);
      // 胸前小蝴蝶结
      ctx.beginPath();
      ctx.moveTo(CX, 472); ctx.lineTo(214, 458); ctx.lineTo(214, 488); ctx.closePath();
      ctx.moveTo(CX, 472); ctx.lineTo(266, 458); ctx.lineTo(266, 488); ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      circle(ctx, CX, 472, 6, '#ffe3ec');
      // 裙摆波点
      var dots = [[170, 530], [215, 560], [265, 530], [310, 560], [240, 515]];
      for (var i = 0; i < dots.length; i++) circle(ctx, dots[i][0], dots[i][1], 6, '#ffd0dc');
    },
    '卫衣': function (ctx, skin) {
      var c = '#7b5cd6';
      // 帽兜堆在肩后
      ctx.beginPath();
      ctx.moveTo(160, 420);
      ctx.bezierCurveTo(150, 372, 200, 366, CX, 372);
      ctx.bezierCurveTo(280, 366, 330, 372, 320, 420);
      ctx.closePath();
      ctx.fillStyle = shade(c, -28);
      ctx.fill();
      fillBody(ctx, c);
      neckRound(ctx, skin, 16);
      ctx.beginPath();
      ctx.ellipse(CX, 402, 34, 22, 0, 0, Math.PI);
      stroke(ctx, shade(c, -28), 9);
      // 抽绳
      ctx.beginPath();
      ctx.moveTo(222, 424); ctx.lineTo(220, 478);
      ctx.moveTo(258, 424); ctx.lineTo(260, 478);
      stroke(ctx, '#ffffff', 4);
      circle(ctx, 220, 480, 5, '#ffffff');
      circle(ctx, 260, 480, 5, '#ffffff');
      // 袋鼠兜
      rrect(ctx, 176, 530, 128, 80, 18, shade(c, -18));
      sleeveLines(ctx, shade(c, -28));
    },
    '西装': function (ctx, skin) {
      var c = '#2b2d42';
      fillBody(ctx, c);
      // 白衬衫
      ctx.beginPath();
      ctx.moveTo(196, 398); ctx.lineTo(284, 398); ctx.lineTo(262, H); ctx.lineTo(218, H);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      neckV(ctx, skin, 430);
      // 衬衫领
      ctx.beginPath();
      ctx.moveTo(208, 396); ctx.lineTo(CX, 432); ctx.lineTo(214, 446); ctx.closePath();
      ctx.moveTo(272, 396); ctx.lineTo(CX, 432); ctx.lineTo(266, 446); ctx.closePath();
      ctx.fillStyle = '#f1f3f8';
      ctx.fill();
      // 领带
      ctx.beginPath();
      ctx.moveTo(230, 432); ctx.lineTo(250, 432); ctx.lineTo(246, 448);
      ctx.lineTo(256, 560); ctx.lineTo(CX, 580); ctx.lineTo(224, 560); ctx.lineTo(234, 448);
      ctx.closePath();
      ctx.fillStyle = '#d62839';
      ctx.fill();
      // 翻领
      ctx.beginPath();
      ctx.moveTo(190, 400); ctx.lineTo(160, 470); ctx.lineTo(196, 478); ctx.lineTo(220, H); ctx.lineTo(186, H);
      ctx.lineTo(172, 404);
      ctx.closePath();
      ctx.moveTo(290, 400); ctx.lineTo(320, 470); ctx.lineTo(284, 478); ctx.lineTo(260, H); ctx.lineTo(294, H);
      ctx.lineTo(308, 404);
      ctx.closePath();
      ctx.fillStyle = shade(c, 26);
      ctx.fill();
      sleeveLines(ctx, shade(c, 26));
    },
    '汉服': function (ctx, skin) {
      var c = '#c8553d', band = '#fff1d6';
      fillBody(ctx, c);
      neckV(ctx, skin, 452);
      // 交领：右襟在下，左襟压上（呈 y 字）
      ctx.beginPath();
      ctx.moveTo(276, 394); ctx.lineTo(200, 520);
      stroke(ctx, band, 18);
      ctx.beginPath();
      ctx.moveTo(204, 394); ctx.lineTo(300, 540);
      stroke(ctx, band, 18);
      ctx.beginPath();
      ctx.moveTo(204, 394); ctx.lineTo(300, 540);
      stroke(ctx, '#e0b973', 3);
      // 腰带
      rrect(ctx, 98, 540, 284, 34, 0, '#3d405b');
      rrect(ctx, 226, 534, 28, 46, 6, '#e0b973');
      // 宽袖纹
      ctx.beginPath();
      ctx.moveTo(128, 470); ctx.quadraticCurveTo(118, 510, 128, 540);
      ctx.moveTo(352, 470); ctx.quadraticCurveTo(362, 510, 352, 540);
      stroke(ctx, shade(c, -30), 4);
    },
    '运动服': function (ctx, skin) {
      var c = '#06a77d';
      fillBody(ctx, c);
      neckRound(ctx, skin, 8);
      // 立领
      ctx.beginPath();
      ctx.moveTo(204, 388); ctx.lineTo(204, 416); ctx.quadraticCurveTo(CX, 436, 276, 416); ctx.lineTo(276, 388);
      ctx.quadraticCurveTo(CX, 420, 204, 388);
      ctx.closePath();
      ctx.fillStyle = shade(c, -26);
      ctx.fill();
      // 拉链
      ctx.beginPath();
      ctx.moveTo(CX, 426); ctx.lineTo(CX, H);
      stroke(ctx, '#ffffff', 4);
      rrect(ctx, 234, 430, 12, 20, 4, '#ffd166');
      // 肩部双条纹
      ctx.beginPath();
      ctx.moveTo(176, 402); ctx.quadraticCurveTo(116, 414, 112, 480); ctx.lineTo(112, H);
      ctx.moveTo(304, 402); ctx.quadraticCurveTo(364, 414, 368, 480); ctx.lineTo(368, H);
      stroke(ctx, '#ffffff', 6);
      ctx.beginPath();
      ctx.moveTo(182, 414); ctx.quadraticCurveTo(130, 424, 126, 484); ctx.lineTo(126, H);
      ctx.moveTo(298, 414); ctx.quadraticCurveTo(350, 424, 354, 484); ctx.lineTo(354, H);
      stroke(ctx, '#ffffff', 6);
    }
  };

  /* ---------- 头与五官 ---------- */

  function drawHead(ctx, skin) {
    circle(ctx, 131, 258, 17, skin);
    circle(ctx, 349, 258, 17, skin);
    circle(ctx, 131, 258, 8, shade(skin, -22));
    circle(ctx, 349, 258, 8, shade(skin, -22));
    oval(ctx, CX, HEAD_Y, HEAD_RX, HEAD_RY, skin);
  }

  var EYES = {
    '圆眼': function (ctx, x) {
      oval(ctx, x, EYE_Y, 15, 17, '#ffffff');
      circle(ctx, x, EYE_Y + 2, 11, INK);
      circle(ctx, x + 4, EYE_Y - 3, 4, '#ffffff');
    },
    '笑眼': function (ctx, x) {
      ctx.beginPath();
      ctx.arc(x, EYE_Y + 8, 15, Math.PI * 1.1, Math.PI * 1.9);
      stroke(ctx, INK, 6);
    },
    '星星眼': function (ctx, x) {
      circle(ctx, x, EYE_Y, 17, INK);
      star(ctx, x, EYE_Y, 12, 5.5, '#ffd43b');
      circle(ctx, x + 7, EYE_Y - 8, 3, '#ffffff');
    },
    '单眼皮': function (ctx, x) {
      oval(ctx, x, EYE_Y + 2, 13, 8, '#ffffff');
      circle(ctx, x, EYE_Y + 2, 7, INK);
      ctx.beginPath();
      ctx.moveTo(x - 16, EYE_Y - 1);
      ctx.quadraticCurveTo(x, EYE_Y - 11, x + 16, EYE_Y - 1);
      stroke(ctx, INK, 5);
    },
    '闭眼弯弯': function (ctx, x) {
      var dir = x < CX ? -1 : 1;
      ctx.beginPath();
      ctx.arc(x, EYE_Y - 6, 15, Math.PI * 0.12, Math.PI * 0.88);
      stroke(ctx, INK, 5);
      // 外眼角睫毛
      ctx.beginPath();
      ctx.moveTo(x + dir * 13, EYE_Y + 2); ctx.lineTo(x + dir * 21, EYE_Y + 6);
      ctx.moveTo(x + dir * 8, EYE_Y + 7); ctx.lineTo(x + dir * 13, EYE_Y + 14);
      stroke(ctx, INK, 3);
    }
  };

  var BROWS = {
    '平眉': function (ctx, x, dir, color) {
      ctx.beginPath();
      ctx.moveTo(x - 16, 221); ctx.lineTo(x + 16, 221);
      stroke(ctx, color, 6);
    },
    '弯眉': function (ctx, x, dir, color) {
      ctx.beginPath();
      ctx.moveTo(x - 17, 224); ctx.quadraticCurveTo(x, 210, x + 17, 224);
      stroke(ctx, color, 5);
    },
    '上扬眉': function (ctx, x, dir, color) {
      // 内低外高
      ctx.beginPath();
      ctx.moveTo(x - dir * 16, 226); ctx.lineTo(x + dir * 17, 213);
      stroke(ctx, color, 6);
    }
  };

  var MOUTHS = {
    '微笑': function (ctx) {
      ctx.beginPath();
      ctx.arc(CX, 292, 22, Math.PI * 0.18, Math.PI * 0.82);
      stroke(ctx, INK, 5);
    },
    '露齿笑': function (ctx) {
      ctx.beginPath();
      ctx.moveTo(212, 298);
      ctx.lineTo(268, 298);
      ctx.bezierCurveTo(266, 326, 214, 326, 212, 298);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      stroke(ctx, INK, 4);
      ctx.beginPath();
      ctx.moveTo(231, 299); ctx.lineTo(231, 316);
      ctx.moveTo(249, 299); ctx.lineTo(249, 316);
      stroke(ctx, '#d8d8e0', 2);
    },
    '嘟嘴': function (ctx) {
      oval(ctx, CX, 306, 10, 9, '#ff6b8a');
      oval(ctx, CX, 306, 4, 3.5, '#b8324f');
    },
    '抿嘴': function (ctx) {
      ctx.beginPath();
      ctx.moveTo(222, 306); ctx.lineTo(258, 306);
      stroke(ctx, INK, 5);
    },
    '张嘴笑': function (ctx) {
      ctx.beginPath();
      ctx.moveTo(210, 294);
      ctx.lineTo(270, 294);
      ctx.bezierCurveTo(270, 340, 210, 340, 210, 294);
      ctx.closePath();
      ctx.fillStyle = '#8c2f39';
      ctx.fill();
      oval(ctx, CX, 322, 15, 8, '#ff7b93'); // 舌头
      rrect(ctx, 222, 294, 36, 8, 3, '#ffffff'); // 上牙
    }
  };

  function drawBlush(ctx) {
    oval(ctx, 170, 286, 20, 12, 'rgba(255,110,140,0.38)');
    oval(ctx, 310, 286, 20, 12, 'rgba(255,110,140,0.38)');
  }

  /* ---------- 头发 ---------- */

  // 盖住头顶的发帽。top: 发顶 y；sideY: 鬓角垂到的 y；out: 两侧外扩；bangs: 刘海样式
  function hairCap(ctx, color, top, sideY, out, bangs) {
    var l = 132 - out, r = 348 + out;
    ctx.beginPath();
    ctx.moveTo(l, sideY);
    ctx.bezierCurveTo(l - 8, 160, 168, top, CX, top);
    ctx.bezierCurveTo(312, top, r + 8, 160, r, sideY);
    ctx.lineTo(332, sideY);
    if (bangs === 'fringe') {            // 齐刘海
      ctx.quadraticCurveTo(338, 228, 326, 204);
      ctx.quadraticCurveTo(300, 222, 283, 200);
      ctx.quadraticCurveTo(262, 222, CX, 200);
      ctx.quadraticCurveTo(218, 222, 197, 200);
      ctx.quadraticCurveTo(180, 222, 154, 204);
    } else if (bangs === 'swept') {      // 斜刘海
      ctx.quadraticCurveTo(338, 226, 318, 198);
      ctx.bezierCurveTo(280, 214, 220, 206, 184, 164);
      ctx.quadraticCurveTo(168, 196, 152, 212);
    } else {                             // 高发际线
      ctx.quadraticCurveTo(332, 200, 300, 180);
      ctx.quadraticCurveTo(CX, 160, 180, 180);
      ctx.quadraticCurveTo(148, 200, 148, sideY);
    }
    ctx.quadraticCurveTo(142, 228, 148, sideY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function curlRing(ctx, color, pts, r) {
    for (var i = 0; i < pts.length; i++) circle(ctx, pts[i][0], pts[i][1], r, color);
  }

  // back：画在身体/头后面；front：画在脸上面
  var HAIR = {
    '短发': {
      back: function (ctx, c) {
        rrect(ctx, 116, 150, 248, 170, 60, shade(c, -14));
      },
      front: function (ctx, c) {
        hairCap(ctx, c, 116, 304, 14, 'swept');
      }
    },
    '长直发': {
      back: function (ctx, c) {
        rrect(ctx, 104, 130, 272, 400, 70, shade(c, -14));
      },
      front: function (ctx, c) {
        hairCap(ctx, c, 114, 340, 16, 'fringe');
      }
    },
    '双马尾': {
      back: function (ctx, c) {
        var sides = [-1, 1];
        for (var i = 0; i < 2; i++) {
          var s = sides[i];
          ctx.beginPath();
          ctx.moveTo(CX + s * 104, 206);
          ctx.bezierCurveTo(CX + s * 190, 200, CX + s * 214, 330, CX + s * 168, 452);
          ctx.bezierCurveTo(CX + s * 150, 400, CX + s * 132, 330, CX + s * 104, 262);
          ctx.closePath();
          ctx.fillStyle = shade(c, -14);
          ctx.fill();
        }
      },
      front: function (ctx, c) {
        hairCap(ctx, c, 116, 262, 8, 'fringe');
        circle(ctx, 124, 226, 12, '#ffd166'); // 发圈
        circle(ctx, 356, 226, 12, '#ffd166');
      }
    },
    '丸子头': {
      back: function () {},
      front: function (ctx, c) {
        circle(ctx, CX, 104, 44, c);
        ctx.beginPath();
        ctx.arc(CX, 104, 26, Math.PI * 1.15, Math.PI * 1.85);
        stroke(ctx, shade(c, 34), 4);
        rrect(ctx, 214, 134, 52, 12, 6, '#ff6b8a'); // 发绳
        hairCap(ctx, c, 122, 256, 6, 'swept');
      }
    },
    '卷发': {
      back: function (ctx, c) {
        curlRing(ctx, shade(c, -14), [
          [118, 190], [104, 244], [106, 300], [122, 350], [152, 384],
          [362, 190], [376, 244], [374, 300], [358, 350], [328, 384],
          [150, 140], [330, 140], [240, 116]
        ], 40);
      },
      front: function (ctx, c) {
        hairCap(ctx, c, 124, 250, 10, 'high');
        curlRing(ctx, c, [
          [132, 214], [150, 172], [186, 144], [222, 132], [258, 132],
          [294, 144], [330, 172], [348, 214]
        ], 30);
        curlRing(ctx, c, [[176, 186], [218, 176], [262, 176], [304, 186]], 22);
        ctx.beginPath();
        ctx.arc(186, 150, 13, Math.PI * 1.1, Math.PI * 1.9);
        ctx.moveTo(307, 150);
        ctx.arc(294, 150, 13, Math.PI * 2, Math.PI * 1.2, true);
        stroke(ctx, shade(c, 34), 3);
      }
    },
    '寸头': {
      back: function () {},
      front: function (ctx, c) {
        hairCap(ctx, c, 128, 232, 0, 'high');
        // 发茬小点
        var dots = [[200, 150], [240, 142], [280, 150], [170, 172], [310, 172], [220, 164], [260, 164]];
        for (var i = 0; i < dots.length; i++) circle(ctx, dots[i][0], dots[i][1], 2.5, shade(c, 40));
      }
    }
  };

  /* ---------- 配饰 ---------- */

  var ACCESSORIES = {
    '无': function () {},
    '圆眼镜': function (ctx) {
      var frame = '#3a2a78';
      circle(ctx, CX - EYE_DX, EYE_Y, 29, 'rgba(255,255,255,0.22)');
      circle(ctx, CX + EYE_DX, EYE_Y, 29, 'rgba(255,255,255,0.22)');
      ctx.beginPath();
      ctx.arc(CX - EYE_DX, EYE_Y, 29, 0, Math.PI * 2);
      ctx.moveTo(CX + EYE_DX + 29, EYE_Y);
      ctx.arc(CX + EYE_DX, EYE_Y, 29, 0, Math.PI * 2);
      ctx.moveTo(CX - 13, EYE_Y - 4);
      ctx.quadraticCurveTo(CX, EYE_Y - 12, CX + 13, EYE_Y - 4);
      ctx.moveTo(CX - EYE_DX - 29, EYE_Y); ctx.lineTo(132, EYE_Y - 6);
      ctx.moveTo(CX + EYE_DX + 29, EYE_Y); ctx.lineTo(348, EYE_Y - 6);
      stroke(ctx, frame, 5);
    },
    '耳环': function (ctx) {
      var xs = [128, 352];
      for (var i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(xs[i], 290, 11, 0, Math.PI * 2);
        stroke(ctx, '#f4b400', 5);
        circle(ctx, xs[i], 302, 5, '#ff6b8a');
      }
    },
    '棒球帽': function (ctx) {
      var c = '#3a2a78', brim = '#ffb703';
      ctx.beginPath();
      ctx.moveTo(122, 204);
      ctx.bezierCurveTo(112, 84, 368, 84, 358, 204);
      ctx.quadraticCurveTo(CX, 176, 122, 204);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      // 帽檐
      ctx.beginPath();
      ctx.moveTo(116, 202);
      ctx.quadraticCurveTo(CX, 168, 364, 202);
      ctx.quadraticCurveTo(382, 216, 362, 224);
      ctx.quadraticCurveTo(CX, 194, 118, 224);
      ctx.quadraticCurveTo(98, 216, 116, 202);
      ctx.closePath();
      ctx.fillStyle = brim;
      ctx.fill();
      circle(ctx, CX, 114, 8, brim);
      star(ctx, CX, 154, 17, 8, '#ffffff');
    },
    '蝴蝶结': function (ctx) {
      var c = '#ff4d6d', x = 318, y = 146;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 20, y - 36, x - 56, y - 30, x - 48, y);
      ctx.bezierCurveTo(x - 56, y + 30, x - 20, y + 36, x, y);
      ctx.bezierCurveTo(x + 20, y - 36, x + 56, y - 30, x + 48, y);
      ctx.bezierCurveTo(x + 56, y + 30, x + 20, y + 36, x, y);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      circle(ctx, x, y, 11, shade(c, -40));
      circle(ctx, x - 3, y - 3, 3, 'rgba(255,255,255,0.6)');
    }
  };

  /* ---------- 主入口 ---------- */

  function drawAvatar(ctx, cfg) {
    cfg = cfg || {};
    var c = {};
    for (var key in OPTIONS) c[key] = pick(OPTIONS[key], cfg[key]);
    var hair = HAIR[c.hair];

    ctx.save();
    drawBg(ctx, c.bg);
    hair.back(ctx, c.hairColor);
    OUTFITS[c.outfit](ctx, c.skin);
    drawHead(ctx, c.skin);
    if (c.blush === '开') drawBlush(ctx);
    hair.front(ctx, c.hairColor);
    BROWS[c.brows](ctx, CX - EYE_DX, -1, shade(c.hairColor, -30));
    BROWS[c.brows](ctx, CX + EYE_DX, 1, shade(c.hairColor, -30));
    EYES[c.eyes](ctx, CX - EYE_DX);
    EYES[c.eyes](ctx, CX + EYE_DX);
    MOUTHS[c.mouth](ctx);
    ACCESSORIES[c.accessory](ctx);
    ctx.restore();
  }

  // 合并而不是覆盖：state.js 先于本文件加载
  var ns = root.AvatarWorld = root.AvatarWorld || {};
  ns.drawAvatar = drawAvatar;
  ns.OPTIONS = OPTIONS;
})(typeof window !== 'undefined' ? window : globalThis);
