'use strict';

// 编程式 API 的测试。它是对外契约（别人会 require 它写自己的规则），
// 所以和 CLI 一样要有测试覆盖。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const api = require('../src/index');

function withFixture(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-api-'));
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

test('导出了写自定义规则所需的全部东西', () => {
  for (const k of ['guardrail', 'defineRule', 'finding', 'skipped', 'SEVERITY', 'reporter', 'run', 'loadRules']) {
    assert.ok(api[k] != null, `应导出 ${k}`);
  }
});

test('不传 rules 时用内置规则', () => {
  withFixture({ 'app.wxss': 'page{--a:#111111;}', 'app.json': '{"x":"#111111"}' }, (root) => {
    const r = api.guardrail({ root });
    assert.ok(r.ran.includes('token-drift'), `应跑到内置规则，实际跑了 ${r.ran}`);
  });
});

test('可以传自定义规则，与内置规则并存（传了就不加载内置）', () => {
  const custom = api.defineRule({
    id: 'custom', name: '自定义',
    check: () => ({ findings: [api.finding({ id: 'custom', name: '自定义' }, { message: '来自自定义规则' })], skipped: [] }),
  });
  withFixture({}, (root) => {
    const r = api.guardrail({ root, rules: [custom] });
    assert.deepEqual(r.ran, ['custom']);
    assert.equal(r.findings[0].message, '来自自定义规则');
  });
});

test('配置能透传到规则', () => {
  let seen = null;
  const probe = api.defineRule({
    id: 'probe', name: 'probe',
    check: (ctx) => { seen = ctx.config; return { findings: [], skipped: [] }; },
  });
  withFixture({}, (root) => {
    api.guardrail({ root, rules: [probe], config: { rules: { probe: { hello: 42 } } } });
    assert.deepEqual(seen, { hello: 42 });
  });
});

test('reporter 三种格式都产出可用字符串', () => {
  withFixture({}, (root) => {
    const r = api.guardrail({ root, rules: [
      api.defineRule({ id: 'x', name: 'x', check: () => ({ findings: [
        api.finding({ id: 'x', name: 'x' }, { message: 'm', file: 'a.js', line: 1, why: 'w', fix: 'f' }),
      ], skipped: [] }) }),
    ] });

    const t = api.reporter.text(r);
    assert.match(t, /a\.js:1/);
    assert.match(t, /为什么：w/);
    assert.match(t, /怎么修：f/);
    assert.match(t, /未验证/, '即使为空也必须打印未验证区');

    const j = JSON.parse(api.reporter.json(r));
    assert.equal(j.counts.error, 1);
    assert.equal(j.ok, false);

    const s = JSON.parse(api.reporter.sarif(r));
    assert.equal(s.version, '2.1.0');
    assert.equal(s.runs[0].results[0].ruleId, 'x');
    assert.equal(s.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  });
});

test('reporter.text：未验证区为空时也要明确说「都跑完了」', () => {
  // 「没打印」和「打印了但没有」在终端里看起来一样，
  // 用户需要知道这次到底有没有漏检
  withFixture({}, (root) => {
    const r = api.guardrail({ root, rules: [api.defineRule({ id: 'y', name: 'y', check: () => ({ findings: [], skipped: [] }) })] });
    assert.match(api.reporter.text(r), /无 —— 所有启用的规则都完整跑完了/);
  });
});

test('reporter.text：有 skipped 时要提醒「没查 ≠ 没问题」', () => {
  withFixture({}, (root) => {
    const r = api.guardrail({ root, rules: [api.defineRule({
      id: 'z', name: 'z',
      check: (ctx) => ({ findings: [], skipped: [api.skipped({ id: 'z', name: 'z' }, { what: '某文件', reason: '读不到' })] }),
    })] });
    const t = api.reporter.text(r);
    assert.match(t, /某文件/);
    assert.match(t, /不代表它们没问题/);
  });
});
