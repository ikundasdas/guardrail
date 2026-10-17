'use strict';

/**
 * 规则接口。
 *
 * 一条规则 = 一个纯函数 + 元数据。故意不做 class、不做继承、
 * 不做插件生命周期 —— 那些抽象在实际写规则时全是负担，
 * 而每条规则都是独立的、几十行的检查逻辑。
 *
 * ctx 里给什么：
 *   - project：文件读取（唯一入口，见 project.js）
 *   - config：这条规则的配置（从 guardrail.config.js 的 rules 里取）
 *   - helpers：公共工具（color 等）
 *
 * 规则必须返回 { findings: Finding[], skipped?: Skipped[] }。
 * 返回数组会被当作「忘了 skipped 通道」而报错 —— 因为那意味着
 * 作者没考虑「检查不了」的情况，而这正是最危险的盲区。
 */

const { SEVERITY } = require('./finding');

const SEVERITIES = new Set(Object.values(SEVERITY));

/**
 * 定义一个规则。做校验，把「规则作者写错了」和
 * 「被检查的项目有问题」区分开 —— 前者必须立刻炸，不能混进报告。
 */
function defineRule(spec) {
  const { id, name, description, check } = spec;

  if (!id || !/^[a-z][\w-]*$/.test(id)) {
    throw new Error(`规则 id 必须是 kebab-case 小写，收到：${JSON.stringify(id)}`);
  }
  if (!name) throw new Error(`规则 ${id} 缺 name`);
  if (typeof check !== 'function') throw new Error(`规则 ${id} 的 check 必须是函数`);
  if (spec.severity != null && !SEVERITIES.has(spec.severity)) {
    throw new Error(`规则 ${id} 的 severity 非法：${spec.severity}`);
  }

  return {
    id,
    name,
    description: description || '',
    severity: spec.severity || SEVERITY.ERROR,
    // 规则自称能检查什么 —— 用于报告里解释「这次没跑它是因为不适用」
    appliesTo: spec.appliesTo || null,
    check,
    _path: spec._path || null,
  };
}

module.exports = { defineRule };
