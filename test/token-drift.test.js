'use strict';

// token-drift 规则测试。
//
// 每条规则都必须有「正样本 + 负样本」：
//   - 正样本：故意写错的项目，必须被抓到（否则规则是摆设）
//   - 负样本：写对的项目，必须零 finding（否则是假警报，会让人去改对的东西）
//
// 假警报的破坏力不比漏报小 —— 它会消耗信任，最后人就不看报告了。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../src/core/runner');
const { defineRule } = require('../src/core/rule');
const { rule, _internal } = require('../src/rules/token-drift');

const RULE = defineRule({
  id: rule.id, name: rule.name, description: rule.description, check: rule.check,
});

function withFixture(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-drift-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const WXSS = `
page {
  --ink: #2E2A35;
  --paper: #F4EBDD;
  --sun: #FFC93C;
}
`;

// ---------- 负样本：抄对了必须零 finding ----------

test('负样本：配置和 token 完全一致 → 无 finding', () => {
  withFixture({
    'app.wxss': WXSS,
    'app.json': JSON.stringify({
      window: { navigationBarBackgroundColor: '#2E2A35', backgroundColor: '#F4EBDD' },
      tabBar: { color: '#FFC93C' },
    }, null, 2),
  }, (root) => {
    const r = run({ root, rules: [RULE] });
    assert.deepEqual(r.findings, [], '抄对了不该报任何问题');
    assert.equal(r.ok, true);
  });
});

test('负样本：配置里的颜色与所有 token 都差很远 → 不是漂移，不报', () => {
  // 配置里可以有名副其实的独立颜色。距离很远 = 不是想抄 token 抄错了。
  withFixture({
    'app.wxss': WXSS,
    'app.json': JSON.stringify({
      // #00FF00 离 --ink/#2E2A35 和 --paper/#F4EBDD 都很远
      wechat: { someColor: '#00FF00' },
    }, null, 2),
  }, (root) => {
    const r = run({ root, rules: [RULE] });
    assert.deepEqual(r.findings, [], '明显不同的颜色不该被误判为漂移');
  });
});

// ---------- 正样本：真漂移必须抓到 ----------

test('正样本：漏改一处 → 抓到，且指出是哪个 token', () => {
  withFixture({
    'app.wxss': WXSS,
    'app.json': JSON.stringify({
      window: { navigationBarBackgroundColor: '#2E2A35' }, // 对
      tabBar: { backgroundColor: '#26262E' },              // 旧值 #26262E，漂移了
    }, null, 2),
  }, (root) => {
    const r = run({ root, rules: [RULE] });
    assert.equal(r.findings.length, 1, `应抓到 1 处漂移，实际 ${r.findings.length}`);
    const f = r.findings[0];
    assert.match(f.message, /#26262E/);
    assert.match(f.message, /--ink/, '应指出最接近的 token 是 --ink');
    assert.match(f.message, /#2E2A35/, '应给出正确值');
    assert.equal(f.file, 'app.json');
    assert.ok(f.line > 0, '应定位到行号');
    // why / fix 不能空 —— 这是和普通 linter 的区别
    assert.ok(f.why.length > 10, 'why 必须解释清楚');
    assert.ok(f.fix.length > 5, 'fix 必须给出动作');
  });
});

test('正样本：多处漂移全部抓到，行号各自正确', () => {
  withFixture({
    'app.wxss': WXSS,
    'app.json': [
      '{',
      '  "window": {',
      '    "navigationBarBackgroundColor": "#26262E",',   // 第 3 行，漂移
      '    "backgroundColor": "#F4EEE1"',                // 第 4 行，漂移（旧 paper）
      '  },',
      '  "tabBar": {',
      '    "color": "#FFC93C"',                          // 第 7 行，正确
      '    "selectedColor": "#FFC93C"',                  // 第 8 行，正确
      '  }',
      '}',
    ].join('\n'),
  }, (root) => {
    const r = run({ root, rules: [RULE] });
    assert.equal(r.findings.length, 2, `应抓到 2 处，实际 ${r.findings.length}`);
    const lines = r.findings.map((f) => f.line).sort((a, b) => a - b);
    assert.deepEqual(lines, [3, 4], '行号必须精确到发生漂移的那一行');
  });
});

// ---------- 边界：读不到必须显式跳过，不能静默通过 ----------

test('token 源文件读不到 → 记入 skipped，而不是显示「无问题」', () => {
  withFixture({
    'app.json': '{"window":{"navigationBarBackgroundColor":"#26262E"}}',
  }, (root) => {
    const r = run({ root, rules: [RULE] });
    assert.equal(r.findings.length, 0);
    assert.equal(r.skipped.length, 1, '必须显式声明没检查，否则报告会误导');
    assert.match(r.skipped[0].reason, /读不到/);
    assert.match(r.skipped[0].reason, /不代表.*是对的/, '要提醒「没查」≠「没问题」');
  });
});

test('token 源里没有色值 token → 记入 skipped', () => {
  withFixture({
    'app.wxss': 'page { --gap: 16rpx; }',
    'app.json': '{}',
  }, (root) => {
    const r = run({ root, rules: [RULE] });
    assert.equal(r.skipped.length, 1);
  });
});

// ---------- 工具函数 ----------

test('normalizeHex 处理 3/6/8 位，大小写归一', () => {
  assert.equal(_internal.normalizeHex('#abc'), '#AABBCC');
  assert.equal(_internal.normalizeHex('#ABCDEF'), '#ABCDEF');
  assert.equal(_internal.normalizeHex('#abcdef'), '#ABCDEF');
  assert.equal(_internal.normalizeHex('#ABCDEF80'), '#ABCDEF');
});

test('hexDistance：相等为 0，差值为通道差之和', () => {
  assert.equal(_internal.hexDistance('#000000', '#000000'), 0);
  assert.equal(_internal.hexDistance('#000000', '#010101'), 3);
  assert.equal(_internal.hexDistance('#000000', '#FFFFFF'), 765);
});

test('可配置：换成非微信栈也能用（tokenFile / configFiles）', () => {
  withFixture({
    'tokens.css': ':root { --brand: #112233; }',
    'theme.ini': 'primary=#112244\n',
  }, (root) => {
    const r = run({
      root,
      rules: [RULE],
      config: { rules: { 'token-drift': { tokenFile: 'tokens.css', configFiles: ['theme.ini'] } } },
    });
    assert.equal(r.findings.length, 1, '非微信栈同样应能检测');
    assert.match(r.findings[0].message, /--brand/);
    assert.equal(r.findings[0].file, 'theme.ini');
  });
});
