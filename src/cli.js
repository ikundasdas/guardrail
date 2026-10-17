#!/usr/bin/env node
'use strict';

/**
 * guardrail CLI。
 *
 * 用法：
 *   guardrail                     检查当前目录
 *   guardrail --root ./miniprogram
 *   guardrail --only token-drift
 *   guardrail --json              机器读
 *   guardrail --sarif             给 GitHub Code Scanning
 *
 * 退出码：0 = 通过，1 = 有 error，2 = 工具自身出错。
 * 分这两个码是有意的：「你的项目有问题」和「工具坏了」要能区分，
 * 否则 CI 红了不知道为什么。
 */

const fs = require('node:fs');
const path = require('node:path');
const { run, loadRules } = require('./core/runner');
const reporter = require('./core/reporter');
const pkg = require('../package.json');

const RULES_DIR = path.join(__dirname, 'rules');
const CONFIG_NAMES = ['guardrail.config.js', '.guradrailrc.js', '.guardrailrc.json'];

function parseArgs(argv) {
  const o = { root: '.', only: null, format: 'text', quiet: false, showInfo: true, config: null, listRules: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '-r') o.root = argv[++i];
    else if (a === '--only') o.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') o.format = 'json';
    else if (a === '--sarif') o.format = 'sarif';
    else if (a === '--quiet' || a === '-q') o.quiet = true;
    else if (a === '--no-info') o.showInfo = false;
    else if (a === '--config' || a === '-c') o.config = argv[++i];
    else if (a === '--list-rules') o.listRules = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a.startsWith('-')) { o.error = `未知参数：${a}`; }
  }
  return o;
}

const HELP = `
guardrail —— 给 AI 生成的代码配自动化验证

用法
  guardrail [选项]

选项
  -r, --root <dir>     项目根目录（默认当前目录）
      --only <ids>     只跑指定规则，逗号分隔
  -c, --config <file>  指定配置文件
      --json           输出 JSON
      --sarif          输出 SARIF（GitHub Code Scanning 用）
  -q, --quiet          只输出结果摘要
      --no-info        隐藏 info 级别的结果
      --list-rules     列出所有可用规则后退出
  -h, --help           显示帮助
  -v, --version        显示版本

退出码
  0  通过
  1  存在 error 级别问题
  2  工具自身出错（配置读不了、根目录不存在等）
`.trim();

function loadConfig(root, explicit) {
  const files = explicit ? [explicit] : CONFIG_NAMES;
  for (const f of files) {
    const full = path.isAbsolute(f) ? f : path.join(root, f);
    if (!fs.existsSync(full)) continue;
    if (f.endsWith('.json')) {
      try {
        return { config: JSON.parse(fs.readFileSync(full, 'utf8')), file: full };
      } catch (e) {
        throw new Error(`配置文件 ${f} 不是合法 JSON：${e.message}`);
      }
    }
    try {
      // eslint-disable-next-line global-require
      const c = require(full);
      return { config: c && c.default ? c.default : c, file: full };
    } catch (e) {
      throw new Error(`配置文件 ${f} 加载失败：${e.message}`);
    }
  }
  return { config: {}, file: null };
}

function main(argv) {
  const opt = parseArgs(argv);

  if (opt.help) { process.stdout.write(HELP + '\n'); return 0; }
  if (opt.version) { process.stdout.write(pkg.version + '\n'); return 0; }
  if (opt.error) { process.stderr.write(opt.error + '\n\n' + HELP + '\n'); return 2; }

  const root = path.resolve(opt.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.stderr.write(`根目录不存在或不是目录：${root}\n`);
    return 2;
  }

  const rules = loadRules(RULES_DIR);

  if (opt.listRules) {
    process.stdout.write(`\n可用规则（${rules.length}）\n\n`);
    for (const r of rules) {
      process.stdout.write(`  ${r.id}\n    ${r.name}\n    ${r.description}\n\n`);
    }
    return 0;
  }

  if (!rules.length) {
    process.stderr.write(`没有加载到任何规则（${RULES_DIR}）。工具目录不完整。\n`);
    return 2;
  }

  let config, configFile;
  try {
    ({ config, file: configFile } = loadConfig(root, opt.config));
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 2;
  }

  const result = run({ root, rules, config, only: opt.only });

  if (opt.format === 'json') process.stdout.write(reporter.json(result) + '\n');
  else if (opt.format === 'sarif') process.stdout.write(reporter.sarif(result, { toolVersion: pkg.version }) + '\n');
  else if (!opt.quiet) process.stdout.write(reporter.text(result, { showInfo: opt.showInfo }) + '\n');
  else process.stdout.write(JSON.stringify(result.counts) + '\n');

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, parseArgs, loadConfig };
