'use strict';

/**
 * Reporter —— 把结果渲染成人能读/机器能读的形式。
 *
 * 设计要点：
 *   1. 未验证区必须显式打印。哪怕它是空的，也要印一行「全部检查项都跑了」。
 *      因为「没打印」和「打印了但没有」在终端里看起来一样，
 *      而用户需要知道这次到底有没有漏检。
 *   2. 每条 finding 要把 why / fix 打出来。这是和普通 linter 的核心区别，
 *      不能省。
 *   3. 默认输出必须能直接贴进 issue / 聊天窗口。
 */

const { SEVERITY_ORDER } = require('./finding');

const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yel: (s) => `\x1b[33m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
      grn: (s) => `\x1b[32m${s}\x1b[0m`, cyn: (s) => `\x1b[36m${s}\x1b[0m` }
  : { red: (s) => s, yel: (s) => s, dim: (s) => s, bold: (s) => s, grn: (s) => s, cyn: (s) => s };

const SEV_LABEL = {
  error: C.red('error'),
  warning: C.yel('warning'),
  info: C.cyn('info'),
};

function loc(f) {
  if (!f.file) return '';
  return f.line != null ? `${f.file}:${f.line}` : f.file;
}

/** 人读格式 */
function text(result, { showInfo = true } = {}) {
  const L = [];
  const fs = result.findings.filter((f) => showInfo || f.severity !== 'info');

  L.push('');
  for (const f of fs) {
    const head = `${SEV_LABEL[f.severity]} ${C.bold(f.ruleName || f.ruleId)}`;
    const where = loc(f);
    L.push(where ? `${head}  ${C.dim(where)}` : head);
    L.push(`  ${f.message}`);
    if (f.evidence) {
      for (const line of String(f.evidence).split('\n')) L.push(C.dim(`    │ ${line}`));
    }
    if (f.why) L.push(C.dim(`    为什么：${f.why}`));
    if (f.fix) L.push(C.dim(`    怎么修：${f.fix}`));
    L.push('');
  }

  // 未验证区 —— 必须显式，哪怕为空
  L.push(C.bold('未验证'));
  if (!result.skipped.length) {
    L.push(C.grn('  ✓ 无 —— 所有启用的规则都完整跑完了'));
  } else {
    for (const s of result.skipped) {
      L.push(C.yel(`  ! [${s.ruleId}] ${s.what} —— ${s.reason}`));
    }
    L.push(C.dim('  以上内容本次没有被检查，不代表它们没问题。'));
  }
  L.push('');

  const c = result.counts;
  const parts = [];
  if (c.error) parts.push(C.red(`${c.error} error`));
  if (c.warning) parts.push(C.yel(`${c.warning} warning`));
  if (c.info) parts.push(C.cyn(`${c.info} info`));

  L.push(parts.length ? parts.join('  ') : C.grn('没有问题'));

  if (result.ran.length) L.push(C.dim(`已跑规则：${result.ran.join(', ')}`));
  if (result.skipped.length) L.push(C.dim(`跳过/未完成：${result.skipped.length} 项`));

  return L.join('\n');
}

/** 机器读格式。给 CI 用，字段名稳定。 */
function json(result) {
  return JSON.stringify({
    ok: result.ok,
    counts: result.counts,
    findings: result.findings,
    skipped: result.skipped,
    ran: result.ran,
  }, null, 2);
}

/**
 * SARIF 风格的最小子集。GitHub Code Scanning 用这个格式，
 * 有它才能在 PR 里显示行内标注。这里只手写必要字段，不引入依赖。
 */
function sarif(result, { toolVersion = '0.0.0' } = {}) {
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'guardrail',
          version: toolVersion,
          rules: [...new Set(result.findings.map((f) => f.ruleId))].map((id) => ({
            id,
            name: (result.findings.find((f) => f.ruleId === id) || {}).ruleName || id,
          })),
        },
      },
      results: result.findings
        .filter((f) => f.file)
        .map((f) => ({
          ruleId: f.ruleId,
          level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
          message: { text: [f.message, f.why && `为什么：${f.why}`, f.fix && `怎么修：${f.fix}`].filter(Boolean).join('\n') },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: f.file },
              region: f.line != null ? { startLine: f.line } : undefined,
            },
          }],
        })),
    }],
  }, null, 2);
}

module.exports = { text, json, sarif, C, SEVERITY_ORDER };
