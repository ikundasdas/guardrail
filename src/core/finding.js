'use strict';

/**
 * Finding —— 一条检查结果。
 *
 * 和普通 linter 的区别全在这个结构里：普通 linter 只说「第 42 行不合规」，
 * 而 AI 写的代码需要的是「第 42 行做错了什么、为什么这是问题、怎么改」。
 * 因为 AI 的失败模式是「静默的」—— 代码能跑、不报错、看起来没问题，
 * 所以光说「不合规」没用，得把「为什么」讲清楚，人才知道要不要改。
 *
 * 另外这里有个刻意设计：**「检查不了」是一等公民，不是 pass**。
 * 一个检查器最危险的失败不是报错，是悄悄跳过 —— 它显示全绿，
 * 让人以为检查过了，实际上什么都没查。所以：
 *   - 能读出值 → 判定
 *   - 读不出值 → 必须显式记录为 skipped，绝不当成通过
 *   - 规则崩了 → runner 记成 error，绝不当成通过
 */

const SEVERITY = {
  ERROR: 'error',      // 确定是问题，且会造成实际故障 / 合规风险
  WARNING: 'warning',  // 大概率是问题，但可能有正当理由
  INFO: 'info',        // 不是问题，只是值得知道
};

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * 构造一条 finding。
 *
 * why / fix 不是可选的装饰，是这个项目的核心价值：
 * 拿掉它们，它就是个普通 linter。
 */
function finding(rule, {
  message,
  file = null,
  line = null,
  column = null,
  why = '',
  fix = '',
  evidence = '',
  severity = SEVERITY.ERROR,
}) {
  if (!message) throw new Error('finding 必须有 message：说清哪里不对');
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_ORDER, severity)) {
    throw new Error(`未知 severity: ${severity}`);
  }
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    severity,
    message,
    file,
    line,
    column,
    why,
    fix,
    evidence,
  };
}

/**
 * 记录「某项没能检查」。
 *
 * 这些会出现在报告末尾的「未验证」区，而不是静默消失。
 * 为什么要专门做个函数：让规则作者有地方表达「我本来该查但查不了」，
 * 而不是写个 `return` 悄悄略过。
 */
function skipped(rule, { what, reason }) {
  return { ruleId: rule.id, ruleName: rule.name, what, reason };
}

/** 一条 finding 的稳定排序键：先按文件、再按行，最后按规则 */
function compareFindings(a, b) {
  const af = a.file || '\uffff';
  const bf = b.file || '\uffff';
  if (af !== bf) return af < bf ? -1 : 1;
  const al = a.line == null ? -1 : a.line;
  const bl = b.line == null ? -1 : b.line;
  if (al !== bl) return al - bl;
  const as = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (as !== 0) return as;
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
}

module.exports = { SEVERITY, SEVERITY_ORDER, finding, skipped, compareFindings };
