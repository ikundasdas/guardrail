'use strict';

// 用 WCAG 官方的标准测试向量校准颜色算法。
//
// 为什么要单独测这个：对比度算错是「静默错误」——不崩、不报错，
// 只是把 2.5:1 的低对比度算成 4.5:1，于是检查器放行了看不清的字。
// 一旦这样，规则就变成了摆设，而且没人会发现。
const assert = require('node:assert/strict');
const test = require('node:test');
const { contrastRatio, hexToRgb, requiredRatio, isHexColor } = require('../src/utils/color');

test('hex 解析：3/6/8 位都要对', () => {
  assert.deepEqual(hexToRgb('#FFF'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToRgb('#2E2A35'), [0x2e, 0x2a, 0x35]);
  assert.deepEqual(hexToRgb('2E2A35'), [0x2e, 0x2a, 0x35], '无 # 也应解析');
  // 8 位带 alpha：忽略 alpha 通道
  assert.deepEqual(hexToRgb('#2E2A3580'), [0x2e, 0x2a, 0x35]);
});

test('hex 解析：非法输入返回 null 而不是猜一个值', () => {
  for (const bad of ['rgb(1,2,3)', 'var(--ink)', '', '#GGGGGG', '#12345', null, undefined, 42]) {
    assert.equal(hexToRgb(bad), null, `${JSON.stringify(bad)} 应解析为 null`);
  }
});

test('WCAG 官方标准向量', () => {
  // 这些是 W3C 明确列出的答案，不是我们自己算的
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrastRatio('#595959', '#ffffff').toFixed(2), '7.00');
  assert.equal(contrastRatio('#a0a0a0', '#ffffff').toFixed(2), '2.61');
});

test('对比度是对称的（前景背景互换结果相同）', () => {
  const pairs = [['#2E2A35', '#F4EBDD'], ['#857E8E', '#F4EBDD'], ['#000', '#fff']];
  for (const [a, b] of pairs) {
    assert.equal(contrastRatio(a, b).toFixed(4), contrastRatio(b, a).toFixed(4));
  }
});

test('真实踩坑：#857E8E 在米纸上到底多少', () => {
  // 本项目 --text-3 在 --paper 上的实测值是 3.31:1。
  // 注意别和 2.51 混淆 —— 那是 v2 旧配色（--text-3 = #B9B2A4 米灰）的值，
  // v3 换成 #857E8E 紫灰后已经改善到 3.31。记混会导致按旧值去断言，
  // 然后对着已经修好的代码报「还是不合格」。
  //
  // 这条测试的价值是把 3.31 钉死：它低于正文标准 4.5，所以这个 token
  // 只能用于「非正文」的辅助文字。一旦有人调亮它到 4.5 以上想改成正文色，
  // 测试会先挡住，避免「为了达标而牺牲设计意图」或反之。
  const r = contrastRatio('#857E8E', '#F4EBDD');
  assert.ok(r < 4.5, `#857E8E on #F4EBDD 应低于正文标准 4.5，实际 ${r.toFixed(2)}`);
  assert.ok(r > 3, `实际 ${r.toFixed(2)}，应高于大字标准 3`);
  assert.equal(r.toFixed(2), '3.31', '对比度数值变了，要重新评估这个 token 的用途');
});

test('解析失败必须返回 null，不能兜底成 21 或 1', () => {
  // 这是最危险的错误模式：|| 21 会把「读不出来」当成「完美达标」
  assert.equal(contrastRatio('var(--ink)', '#ffffff'), null);
  assert.equal(contrastRatio('#ffffff', 'not-a-color'), null);
});

test('AA 阈值：18.66px 粗体是分界', () => {
  assert.equal(requiredRatio(16, false), 4.5);
  assert.equal(requiredRatio(16, true), 4.5);
  // 分界是 18.66px，不是 18px。18px 粗体仍算正文 —— 这条期望第一版写错了，
  // 是把「18.66 附近」粗略记成了「18」。若照此改代码去迎合错误测试，
  // 就会把 18px 粗体错误地放宽到大字标准(3:1)。
  assert.equal(requiredRatio(18, true), 4.5, '18px 粗体还没到分界，仍是正文');
  assert.equal(requiredRatio(18, false), 4.5, '18px 常规仍是正文');
  assert.equal(requiredRatio(18.66, true), 3, '恰好等于分界算大字');
  assert.equal(requiredRatio(19, true), 3);
  assert.equal(requiredRatio(24, false), 3, '24px 无论粗细都是大字');
  assert.equal(requiredRatio(30, false), 3);
});

test('isHexColor 与 hexToRgb 判定一致', () => {
  for (const s of ['#fff', '#FFFFFF', '#2E2A35', '#2E2A3580']) {
    assert.equal(isHexColor(s), true, s);
    assert.notEqual(hexToRgb(s), null, s);
  }
  for (const s of ['red', 'rgb(0,0,0)', 'var(--x)', '']) {
    assert.equal(isHexColor(s), false, s);
    assert.equal(hexToRgb(s), null, s);
  }
});
