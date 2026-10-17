'use strict';

/**
 * 编程式 API。
 *
 * 给两类场景用：
 *   1. 不想走 CLI，想在自己的脚本里跑（例如 CI 里做自定义判断）
 *   2. 想写自定义规则并在同一进程里跑
 *
 * CLI 里 `--json` 得到的结构，和这里 result 的结构一致 ——
 * 有意保持，避免两套输出格式各自演化。
 */
const path = require('node:path');
const { run, loadRules } = require('./core/runner');
const { defineRule } = require('./core/rule');
const { finding, skipped, SEVERITY } = require('./core/finding');
const reporter = require('./core/reporter');

const RULES_DIR = path.join(__dirname, 'rules');

/**
 * @param {object} opts
 * @param {string} opts.root        项目根目录
 * @param {Array}  [opts.rules]     自定义规则（不传则用内置）
 * @param {object} [opts.config]    配置，形如 { rules: { 'rule-id': {...} } }
 * @param {string[]} [opts.only]    只跑这些 rule id
 */
function guardrail(opts = {}) {
  const root = path.resolve(opts.root || process.cwd());
  const rules = opts.rules || loadRules(RULES_DIR);
  return run({ root, rules, config: opts.config || {}, only: opts.only || null });
}

module.exports = {
  guardrail,
  // 写自定义规则用
  defineRule,
  finding,
  skipped,
  SEVERITY,
  // 输出
  reporter,
  // 底层，需要时直接用
  run,
  loadRules,
};
