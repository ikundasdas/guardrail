'use strict';

/**
 * WCAG 2.1 颜色对比度计算。
 *
 * 这块最容易写错的地方有两个，都在这里处理了：
 *
 *   1. sRGB 伽马。直接对 0-255 做线性加权是错的，会让所有对比度偏高，
 *      浅色底上的浅灰字会被算成「刚好达标」，实际肉眼完全看不清。
 *      必须先把 sRGB 转线性。
 *   2. 分母的 +0.05。两色同色时对比度不是 1 而是 ~1.0，漏掉会让
 *      「文字和背景同色」这种最严重的情况算出接近 1 的假达标值。
 *
 * 参考：https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * 解析 hex 色值，支持 3/6/8 位。
 * 带 alpha 的 8 位会直接忽略 alpha —— 因为我们没法知道 alpha 叠在什么底色上，
 * 猜测会得出错误结论。返回 null 表示「不该判」，而不是「判定为 0」。
 */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const s = hex.trim();

  // 注意：m[0] 是整个匹配串，色通道从 m[1] 开始。
  // 这里曾从 m[0] 取值，于是 parseInt('#2E2A35', 16) → NaN，再经 map 变 null，
  // 最后算出 NaN 对比度 —— 而 NaN < 4.5 是 false，于是所有颜色检查被静默跳过，
  // 规则形同虚设。这是最难查的一类 bug：不崩溃、不报错，只是悄悄什么都不检查了。
  let m = HEX3.exec(s);
  if (m) return [1, 2, 3].map((i) => parseInt(m[i] + m[i], 16));

  m = HEX6.exec(s);
  if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16));

  m = HEX8.exec(s);
  if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16)); // m[4] 是 alpha，丢弃

  return null;
}

function isHexColor(s) {
  return typeof s === 'string' && (HEX3.test(s.trim()) || HEX6.test(s.trim()) || HEX8.test(s.trim()));
}

/** sRGB 单通道 → 线性光。阈值 0.04045 来自 WCAG 规范，不能改。 */
function srgbToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 相对亮度 L。权重 0.2126 / 0.7152 / 0.0722 来自 WCAG 规范。 */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 对比度，返回 1~21 的浮点数。
 * 任一色值无法解析时返回 null —— 调用方必须处理 null，
 * 绝不能 `|| 21` 或 `|| 1` 兜底，那会把「读不出来」误报成「完美达标」。
 */
function contrastRatio(fg, bg) {
  // 这里必须严格分流。原实现写成
  //   isHexColor(fg) ? hexToRgb(fg) : fg
  // 意图是「已经传数组就放行」，但当 fg 是 'var(--ink)' 这类非法字符串时，
  // isHexColor 为 false，于是把字符串原样传下去，
  // relativeLuminance 里 rgb.map 抛 TypeError —— 崩溃，而不是返回 null。
  // 检查器遇到不该判的输入必须「不判定」，绝不能抛异常：
  // 一条规则因为一个坏输入整体崩掉，等于这条规则全程失效。
  const toRgb = (v) => {
    if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')) return v;
    if (typeof v === 'string' && isHexColor(v)) return hexToRgb(v);
    return null;
  };
  const a = toRgb(fg);
  const b = toRgb(bg);
  if (!a || !b) return null;

  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * AA 级阈值。
 * 正文 4.5:1，大字（>=18.66px 粗体 或 >=24px）3:1。
 * bold:fontSize 单位是 px；rpx 场景由调用方换算后传入 pxFontSize。
 */
function requiredRatio(fontSizePx, bold) {
  // WCAG 的大字定义是「>= 18.66px 且加粗」或「>= 24px」，
  // 边界值本身算大字，所以用 >= 而不是 >。
  // 写成 > 时 18.66px 粗体会被判成正文(4.5)，卡在及格线上的设计就漏过了。
  const isLarge = fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
  return isLarge ? 3 : 4.5;
}

function round(n, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

module.exports = { hexToRgb, isHexColor, relativeLuminance, contrastRatio, requiredRatio, round };
