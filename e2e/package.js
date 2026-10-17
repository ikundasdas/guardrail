// 打包验证：证明 README 里承诺的用法真的能用。
//
// 为什么要专门验：package.json 缺 bin / exports / shebang 时，
// 本地 `node src/cli.js` 照样能跑，开发者完全不会察觉 ——
// 但用户 `npx guardrail` 会失败、`require('guardrail/core/finding')` 会失败。
// 「文档写了但实际不工作」是典型静默问题，必须在发布前用真实安装验一次。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-pack-'));
let bad = 0;

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts, shell: process.platform === 'win32' });

try {
  // 1) 打包
  const tgz = run('npm', ['pack', '--silent'], { cwd: PKG }).trim().split('\n').pop().trim();
  const tgzPath = path.join(PKG, tgz);
  console.log(`  包文件: ${tgz}  (${(fs.statSync(tgzPath).size / 1024).toFixed(1)} KB)`);

  // 2) 装进干净项目
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  run('npm', ['install', '--silent', tgzPath], { cwd: consumer });
  console.log('  ✓ 安装成功');

  // 3) 建一个会触发 token-drift 的最小项目
  const proj = path.join(consumer, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'app.wxss'), 'page{--ink:#2E2A35;}');
  fs.writeFileSync(path.join(proj, 'app.json'), '{"window":{"navigationBarBackgroundColor":"#26262E"}}');

  // 4) 用 npx 跑 CLI —— README 承诺的用法
  let out = '';
  try {
    out = run('npx', ['--no-install', 'guardrail', '--root', proj], { cwd: consumer });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    if (e.status === 1) {
      // 退出码 1 = 发现问题，这是预期行为
    } else {
      console.log(`  ✗ npx guardrail 异常退出 code=${e.status}`);
      console.log(out.slice(0, 500));
      bad++;
    }
  }
  if (/#26262E/.test(out) && /--ink/.test(out)) console.log('  ✓ npx guardrail 可用，且抓到了漂移');
  else { console.log('  ✗ npx guardrail 没抓到漂移'); console.log(out.slice(0, 400)); bad++; }

  // 5) 验证 exports 子路径 —— README 的规则示例用到
  //
  // 注意：probe 必须建在 consumer 目录**里面**。
  // Node 按「文件所在位置」向上找 node_modules，不看 cwd ——
  // 建到 consumer 外面（比如 work/probe.js）会找不到已安装的包，
  // 从而把「测试脚本路径写错」误诊成「包的 exports 坏了」。已踩过。
  const probe = path.join(consumer, 'probe.js');
  fs.writeFileSync(probe, `
    const { finding, skipped } = require('guardrail/core/finding');
    const { defineRule } = require('guardrail/core/rule');
    const api = require('guardrail');
    console.log('finding:', typeof finding, 'skipped:', typeof skipped, 'defineRule:', typeof defineRule);
    console.log('api.guardrail:', typeof api.guardrail, 'api.SEVERITY:', typeof api.SEVERITY);
  `);
  try {
    const o = run(process.execPath, [probe], { cwd: consumer });
    if (/finding: function skipped: function defineRule: function/.test(o) && /api\.guardrail: function/.test(o)) {
      console.log('  ✓ exports 子路径可用（README 的规则示例成立）');
    } else { console.log('  ✗ exports 子路径有问题:\n' + o); bad++; }
  } catch (e) {
    console.log('  ✗ require 子路径失败:\n' + ((e.stdout || '') + (e.stderr || '')).slice(0, 400));
    bad++;
  }

  // 6) 确认打出的包里没有测试/多余文件
  const listing = run('tar', ['-tzf', tgzPath]).split('\n').filter(Boolean);
  const leaked = listing.filter((f) => /test\/|e2e\/|PROGRESS|\.test\.js/.test(f));
  if (leaked.length === 0) console.log('  ✓ 包内无测试/内部文件泄漏');
  else { console.log('  ✗ 包里混入了:\n' + leaked.map((f) => '    ' + f).join('\n')); bad++; }
  console.log(`  包内文件数: ${listing.filter((f) => !f.endsWith('/')).length}`);

  // 清理
  fs.rmSync(tgzPath, { force: true });
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 打包与安装验证全部通过');
process.exit(bad ? 1 : 0);
