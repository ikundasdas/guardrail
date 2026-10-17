'use strict';

/**
 * Runner —— 按顺序跑规则，收集结果。
 *
 * 核心职责不是「跑」，是**兜住规则的崩溃**。
 *
 * 为什么这点最重要：一条规则抛异常时，如果 runner 也抛，整个检查就中断了，
 * 用户看到的是「工具坏了」，而不是「有一条规则查不了」。更糟的是如果
 * runner 吞掉异常继续跑，报告里那条规则会显示「没有 findings」，
 * 看起来像通过 —— 这就是静默失败。
 *
 * 所以这里的原则是：**规则崩溃 → 变成一条 error finding，带完整堆栈**。
 * 它出现在报告里，会让人看见，会挡住 CI。
 */

const path = require('node:path');
const { SEVERITY, finding, skipped: mkSkipped, compareFindings } = require('./finding');
const { defineRule } = require('./rule');
const { Project } = require('./project');
const color = require('../utils/color');

const IGNORE_FILE = /^.*\.(md|png|jpg|jpeg|gif|ico|woff2?|ttf|otf|lock)$/i;

/**
 * ctx.helpers —— 规则可用的公共工具。
 * 只放真正跨规则复用的东西，不放「以后可能有用」的。
 */
const helpers = {
  color,
};

/** 把规则返回的原始结果规范化。规则写错时这里会报出来。 */
function normalizeResult(rule, raw) {
  if (raw == null) {
    throw new Error(
      `规则 ${rule.id} 没有返回结果。必须返回 { findings, skipped } —— ` +
      `返回空对象意味着「我什么都没查」，这是不允许的（会表现为静默通过）。`
    );
  }
  if (Array.isArray(raw)) {
    throw new Error(
      `规则 ${rule.id} 直接返回了数组。必须返回 { findings, skipped }。` +
      `只返回 findings 意味着没声明「哪些没查成」，而没查成的部分会看起来像通过。`
    );
  }
  if (!Array.isArray(raw.findings)) {
    throw new Error(`规则 ${rule.id} 的 findings 必须是数组`);
  }
  return {
    findings: raw.findings,
    skipped: Array.isArray(raw.skipped) ? raw.skipped : [],
  };
}

/**
 * 跑所有规则。
 *
 * @param {object} opts
 * @param {string} opts.root     项目根目录
 * @param {Array}  opts.rules    规则数组（已 defineRule）
 * @param {object} opts.config   全量配置，每条规则读 config.rules[ruleId]
 * @param {string[]} [opts.only] 只跑这些 rule id
 * @returns {{findings, skipped, ran, crashed, ok}}
 */
function run({ root, rules, config = {}, only = null }) {
  const project = new Project(root);
  const allFindings = [];
  const allSkipped = [];
  const crashed = [];
  const ran = [];

  for (const rule of rules) {
    if (only && !only.includes(rule.id)) continue;

    const cfg = (config.rules && config.rules[rule.id]) || {};
    if (cfg.enabled === false) {
      allSkipped.push(mkSkipped(rule, { what: '整条规则', reason: '配置里已禁用' }));
      continue;
    }

    const ctx = { project, config: cfg, helpers, root: project.root };

    try {
      const { findings, skipped } = normalizeResult(rule, rule.check(ctx));
      ran.push(rule.id);
      for (const f of findings) {
        allFindings.push({ ...f, ruleName: rule.name });
      }
      for (const s of skipped) allSkipped.push(s);
    } catch (e) {
      // 规则崩了 —— 绝不能静默跳过，也绝不能中断整个检查。
      // 变成一条 error，附堆栈，让它出现在报告里。
      crashed.push({ ruleId: rule.id, error: e });
      allFindings.push(finding(rule, {
        message: `规则自身抛出异常，本次未完成检查：${e.message}`,
        severity: SEVERITY.ERROR,
        why: '规则崩溃时它没有检查任何东西。如果不报出来，报告会显示「无问题」，'
           + '看起来像通过 —— 这是最危险的静默失败。',
        fix: '这是 guardrail 或其规则的 bug，请连同堆栈提 issue。',
        evidence: e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '',
      }));
    }
  }

  allFindings.sort(compareFindings);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of allFindings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  return {
    findings: allFindings,
    skipped: allSkipped,
    ran,
    crashed,
    counts,
    ok: counts.error === 0,
  };
}

/** 从目录加载规则。文件名即顺序，便于稳定输出。 */
function loadRules(dir) {
  const fs = require('node:fs');
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort();
  } catch (e) {
    return out;
  }
  for (const f of files) {
    const full = path.join(dir, f);
    const mod = require(full);
    const specs = Array.isArray(mod) ? mod : [mod.rule || mod];
    for (const spec of specs) {
      if (!spec || typeof spec.check !== 'function') continue;
      out.push(defineRule({ ...spec, _path: full }));
    }
  }
  return out;
}

module.exports = { run, loadRules, helpers, IGNORE_FILE };
