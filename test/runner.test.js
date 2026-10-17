'use strict';

// runner 的测试。重点不是「能跑」，是**规则崩了会怎样**。
//
// 这个项目所有设计都围绕一个前提：静默失败比崩溃危险得多。
// 所以 runner 必须是「规则的崩溃变成一条可见的 error」，
// 而不是「规则崩了但报告显示全绿」。下面每个用例都在证明这件事。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../src/core/runner');
const { defineRule } = require('../src/core/rule');
const { SEVERITY, finding } = require('../src/core/finding');

/** 造一个临时项目目录，用完删掉 */
function withFixture(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-'));
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

const okRule = defineRule({
  id: 'ok',
  name: '正常规则',
  check: () => ({ findings: [], skipped: [] }),
});

test('正常规则：无 findings，ok 为 true', () => {
  withFixture({ 'a.txt': 'x' }, (root) => {
    const r = run({ root, rules: [okRule] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ran, ['ok']);
    assert.equal(r.findings.length, 0);
  });
});

test('规则抛异常 → 变成 error finding，且不中断其它规则', () => {
  const boom = defineRule({
    id: 'boom',
    name: '会崩的规则',
    check: () => { throw new Error('内部炸了'); },
  });
  const after = defineRule({
    id: 'after',
    name: '崩溃之后的规则',
    check: () => ({ findings: [finding({ id: 'after', name: '崩溃之后的规则' }, {
      message: '后面的规则也要跑到',
    })], skipped: [] }),
  });

  withFixture({}, (root) => {
    const r = run({ root, rules: [boom, after] });

    // 1) 崩溃被转成了 error
    const crashFinding = r.findings.find((f) => f.ruleId === 'boom');
    assert.ok(crashFinding, '崩溃必须产生一条 finding，否则报告会显示「无问题」');
    assert.equal(crashFinding.severity, SEVERITY.ERROR);
    assert.match(crashFinding.message, /内部炸了/);
    assert.ok(crashFinding.evidence.includes('Error'), '应带上堆栈');

    // 2) 崩溃没有中断后续规则
    assert.ok(r.ran.includes('after'), '崩溃不应阻止后续规则运行');

    // 3) 崩溃让整体不通过
    assert.equal(r.ok, false, '崩溃必须让 ok 变 false，否则 CI 会放行');
    assert.equal(r.crashed.length, 1);
  });
});

test('findings 按 文件 → 行 → 严重度 排序', () => {
  const r1 = defineRule({
    id: 'r1', name: 'r1',
    check: () => ({
      findings: [
        finding({ id: 'r1', name: 'r1' }, { message: 'b.js:20', file: 'b.js', line: 20 }),
        finding({ id: 'r1', name: 'r1' }, { message: 'a.js:10', file: 'a.js', line: 10 }),
        finding({ id: 'r1', name: 'r1' }, { message: 'a.js:5', file: 'a.js', line: 5, severity: SEVERITY.WARNING }),
      ],
      skipped: [],
    }),
  });
  withFixture({}, (root) => {
    const r = run({ root, rules: [r1] });
    assert.deepEqual(r.findings.map((f) => f.message), ['a.js:5', 'a.js:10', 'b.js:20']);
  });
});

test('规则直接返回数组 → 报错而非静默通过', () => {
  // 这是最需要防的写法：只返回 findings，没声明哪些没查成
  const sloppy = defineRule({
    id: 'sloppy', name: '偷懒的规则',
    check: () => [finding({ id: 'sloppy', name: 'x' }, { message: 'x' })],
  });
  withFixture({}, (root) => {
    const r = run({ root, rules: [sloppy] });
    const f = r.findings.find((x) => x.ruleId === 'sloppy');
    assert.ok(f && /必须返回/.test(f.message), `应报出用法错误，实际：${f && f.message}`);
    assert.equal(r.ok, false);
  });
});

test('规则返回 null → 报错而非静默通过', () => {
  const n = defineRule({ id: 'n', name: 'n', check: () => null });
  withFixture({}, (root) => {
    const r = run({ root, rules: [n] });
    assert.equal(r.ok, false);
    assert.match(r.findings[0].message, /没有返回结果/);
  });
});

test('配置里 enabled:false → 记入 skipped，不跑', () => {
  let called = false;
  const c = defineRule({ id: 'c', name: 'c', check: () => { called = true; return { findings: [], skipped: [] }; } });
  withFixture({}, (root) => {
    const r = run({ root, rules: [c], config: { rules: { c: { enabled: false } } } });
    assert.equal(called, false, '禁用的规则不应被执行');
    assert.ok(r.skipped.some((s) => s.ruleId === 'c'));
  });
});

test('only 过滤：只跑指定规则', () => {
  const a = defineRule({ id: 'a', name: 'a', check: () => ({ findings: [], skipped: [] }) });
  const b = defineRule({ id: 'b', name: 'b', check: () => ({ findings: [], skipped: [] }) });
  withFixture({}, (root) => {
    const r = run({ root, rules: [a, b], only: ['b'] });
    assert.deepEqual(r.ran, ['b']);
  });
});

test('Project.read 读不到返回 null，不是空字符串', () => {
  // 这两者混为一谈会让规则把「文件不存在」当成「文件里没问题」
  withFixture({ 'exists.txt': '' }, (root) => {
    const r = run({
      root,
      rules: [defineRule({
        id: 'probe', name: 'probe',
        check: ({ project }) => ({
          findings: [
            finding({ id: 'probe', name: 'probe' }, {
              message: `missing=${project.read('nope.txt') === null} empty=${project.read('exists.txt') === ''}`,
            }),
          ],
          skipped: [],
        }),
      })],
    });
    assert.match(r.findings[0].message, /missing=true empty=true/);
  });
});
