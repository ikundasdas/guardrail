'use strict';

// 配置文件扫描器测试。
//
// 这个模块是被一次真实误报催生的：规则第一版用正则扫全文，
// 把 app.json 里 `_comment` 说明文字中的色值也当成了配置 ——
// 于是每次改 token 都会误报一片，而且指向的是文档，改也不是不改也不是。
//
// 所以下面每个用例都对应一种「看起来像配置、其实不是」的情况。
const assert = require('node:assert/strict');
const test = require('node:test');
const { scanColorValues, normalizeHex, hexDistance, lineOf } = require('../src/utils/scan-config');

const vals = (src, opts) => scanColorValues(src, opts).map((o) => o.raw);

test('基本：只取值位置的色值', () => {
  const src = '{"a":"#111111","b":"#222222"}';
  assert.deepEqual(vals(src), ['#111111', '#222222']);
});

test('排除 _comment 的值 —— 这是催生本模块的真实误报', () => {
  const src = JSON.stringify({
    _comment: '配色标注：navigationBarBackgroundColor = --ink #26262E；backgroundColor = --paper #F4EEE1',
    window: { navigationBarBackgroundColor: '#2E2A35' },
  }, null, 2);
  assert.deepEqual(vals(src), ['#2E2A35'], '_comment 里的色值是文档，不是配置');
});

test('排除各种注释型 key', () => {
  for (const key of ['_comment', '$comment', '__comment', 'comment', '//', '_note', 'note', 'description']) {
    const src = `{"${key}":"#AAAAAA","real":"#BBBBBB"}`;
    assert.deepEqual(vals(src), ['#BBBBBB'], `${key} 应被排除`);
  }
});

test('可自定义忽略的 key', () => {
  const src = '{"doc":"#AAAAAA","real":"#BBBBBB"}';
  assert.deepEqual(vals(src), ['#AAAAAA', '#BBBBBB'], '默认不忽略 doc');
  assert.deepEqual(vals(src, { ignoreKeys: ['doc'] }), ['#BBBBBB'], '配置后应忽略');
});

test('行注释 // 里的色值不算（JSONC）', () => {
  const src = [
    '{',
    '  // 这里写的是 --ink #26262E 的说明',
    '  "color": "#2E2A35"',
    '}',
  ].join('\n');
  assert.deepEqual(vals(src), ['#2E2A35']);
});

test('字符串里的 // 不是注释 —— https:// 不能被吃掉', () => {
  // 这是最容易写错的地方：按行剥 // 会从 https:// 一路吃到行尾
  const src = '{"url":"https://example.com/#FF0000","color":"#00FF00"}';
  assert.deepEqual(vals(src), ['#FF0000', '#00FF00'], 'URL 里的 #FF0000 是字符串内容，应保留');
});

test('块注释 /* */ 里的色值不算', () => {
  const src = '{\n  /* 旧值 #26262E */\n  "color": "#2E2A35"\n}';
  assert.deepEqual(vals(src), ['#2E2A35']);
});

test('转义引号不会提前结束字符串', () => {
  const src = '{"a":"say \\"hi\\" #111111","b":"#222222"}';
  const out = vals(src);
  assert.ok(out.includes('#222222'));
});

test('数组里的裸色值也能收', () => {
  const src = '{"list":["#111111","#222222"]}';
  assert.deepEqual(vals(src), ['#111111', '#222222']);
});

test('行号精确到色值所在行', () => {
  const src = ['{', '  "a": "#111111",', '  "b": "#222222"', '}'].join('\n');
  const got = scanColorValues(src).map((o) => o.line);
  assert.deepEqual(got, [2, 3]);
});

test('行号：多行字符串里的色值也定位正确', () => {
  const src = '{\n  "big": "line1\nline2 #123456\nline3",\n  "c": "#654321"\n}';
  const got = scanColorValues(src).map((o) => `${o.raw}@${o.line}`);
  assert.deepEqual(got, ['#123456@3', '#654321@5']);
});

test('不把 key 里的色值当 value', () => {
  const src = '{"#FF0000":"value","real":"#00FF00"}';
  assert.deepEqual(vals(src), ['#00FF00']);
});

test('lineOf 边界', () => {
  assert.equal(lineOf('abc', 0), 1);
  assert.equal(lineOf('a\nb', 2), 2);
  assert.equal(lineOf('a\nb\nc', 4), 3);
});

test('normalizeHex / hexDistance', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC');
  assert.equal(normalizeHex('#abcd'), '#AABBCC', '4 位 alpha 形式丢弃 alpha');
  assert.equal(normalizeHex('#abcdef'), '#ABCDEF');
  assert.equal(normalizeHex('#ABCDEF80'), '#ABCDEF');
  assert.equal(hexDistance('#000000', '#000000'), 0);
  assert.equal(hexDistance('#000000', '#010101'), 3);
});
