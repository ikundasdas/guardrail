'use strict';

/**
 * 配置文件里的色值扫描（字符串/注释感知）。
 *
 * 为什么不能直接用正则扫全文：实测发现，真实的 app.json 里有一段
 * `_comment` 说明文字，内容是
 *
 *   "以下色值必须与 app.wxss 的 token 保持一致：navigationBarBackgroundColor = --ink #26262E；…"
 *
 * 这段注释里**也**含有色值。用正则扫全文会把注释当成配置报出来 ——
 * 改一次 token 就误报一片，而且指向的是「文档」，改也不是、不改也不是。
 *
 * 假警报的破坏力不比漏报小：它会消耗信任，最后人就不看报告了。
 * 所以必须区分「值」和「文档」。
 *
 * 这个扫描器逐个字符走，跟踪字符串状态、注释状态、以及「当前这个字符串
 * 属于哪个 key」，从而排除：
 *   1. 注释型 key 的值（_comment / $comment / __comment / comment / //）
 *   2. 真正的注释（// 行注释、/* 块注释，JSONC 用）
 *   3. 字符串内部出现的 // （例如 "https://example.com" 不能被当成注释）
 */

// 颜色字面量。3/4/6/8 位都收，alpha 由 normalizeHex 丢弃。
const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;

const DEFAULT_IGNORE_KEYS = ['_comment', '$comment', '__comment', 'comment', '//', '_note', 'note', 'description'];

/** 归一化成 6 位大写，#abc → #AABBCC。非色值返回 null。 */
function normalizeHex(h) {
  const s = String(h).replace('#', '');
  if (s.length === 3) return '#' + s.split('').map((c) => c + c).join('').toUpperCase();
  if (s.length === 6) return '#' + s.toUpperCase();
  if (s.length === 8) return '#' + s.slice(0, 6).toUpperCase();
  if (s.length === 4) return '#' + s.slice(0, 3).split('').map((c) => c + c).join('').toUpperCase();
  return null;
}

function parseHex(h) {
  const n = normalizeHex(h);
  if (!n) return null;
  return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
}

/** 通道差绝对值之和。用于判断「近似但不相等」＝ 想抄却抄错。 */
function hexDistance(a, b) {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return Infinity;
  return Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
}

/** 偏移量 → 行号（1-based） */
function lineOf(src, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

/**
 * 扫描出「值位置」的颜色。
 *
 * @returns {Array<{raw, value, key, offset, line}>}
 */
function scanColorValues(src, { ignoreKeys = DEFAULT_IGNORE_KEYS } = {}) {
  const ignore = new Set(ignoreKeys);
  const out = [];

  let i = 0;
  let currentKey = null;   // 最近一个「后面跟了冒号」的字符串
  const n = src.length;

  const skipWs = (j) => {
    while (j < n && /\s/.test(src[j])) j++;
    return j;
  };

  while (i < n) {
    const c = src[i];

    // ---- 块注释 /* ... */ ----
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // ---- 行注释 // ... ----
    // 只在「不在字符串里」时才会走到这里，所以 "https://" 不会被误判
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }

    // ---- 字符串 ----
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let buf = '';
      while (i < n) {
        if (src[i] === '\\') { buf += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === quote) break;
        buf += src[i];
        i++;
      }
      const endPos = i; // 指向闭合引号
      i++;

      // 判断这个字符串是 key 还是 value：看后面第一个非空白字符是不是冒号
      const after = skipWs(endPos + 1);
      const isKey = src[after] === ':';
      if (isKey) {
        currentKey = buf;
      } else {
        // 是 value —— 排除注释型 key 下的内容
        if (!(currentKey != null && ignore.has(currentKey))) {
          for (const m of buf.matchAll(HEX_RE)) {
            // 字符串内的偏移要换算回源文件偏移
            const offset = start + 1 + m.index;
            out.push({
              raw: m[0],
              value: buf,
              key: currentKey,
              offset,
              line: lineOf(src, offset),
            });
          }
        }
      }
      continue;
    }

    // 数组里出现裸色值（少见但合法）也收一下
    if (c === '#' && /[0-9A-Fa-f]/.test(src[i + 1] || '')) {
      const m = /^#[0-9A-Fa-f]{3,8}\b/.exec(src.slice(i));
      if (m) {
        out.push({ raw: m[0], value: m[0], key: currentKey, offset: i, line: lineOf(src, i) });
        i += m[0].length;
        continue;
      }
    }

    i++;
  }

  return out;
}

module.exports = { scanColorValues, normalizeHex, hexDistance, lineOf, HEX_RE, DEFAULT_IGNORE_KEYS };
