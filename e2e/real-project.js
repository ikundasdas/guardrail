// token-drift 的端到端验证：用真实项目当夹具，注入漂移看是否抓到。
//
// 为什么不用 PowerShell 写对照文件：Set-Content 默认编码会把 UTF-8 的
// 多字节字符写成 U+FFFD 替换字符，导致「解析器读不懂文件」被误判成
// 「解析器有 bug」。第一版就是这么误诊的 —— 花了时间查一个不存在的 bug。
// 写文件一律用 node，显式 utf8。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// __dirname 是 guardrail/e2e，需要再上两级才到「随笔/
// 少写一层会得到 _oss/miniprogram（不存在），报 ENOENT —— 已踩过
const REAL = path.join(ROOT, '..', '..', 'miniprogram');
const CLI = path.join(ROOT, 'src', 'cli.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-e2e-'));
let bad = 0;

// 这个 e2e 用真实项目当夹具，但它依赖本机存在该项目 ——
// 别人 clone 下来跑测试时不会有，所以要优雅跳过而不是报错。
// 一个「因为环境不同而失败」的测试，比没有测试更糟：
// 它会训练人忽略红色。
if (!fs.existsSync(path.join(REAL, 'app.json')) || !fs.existsSync(path.join(REAL, 'app.wxss'))) {
  console.log('  - 跳过：本机没有真实项目夹具，e2e 未执行');
  console.log('    （单元测试已覆盖同样逻辑，这里只是拿真实文件再验一遍）');
  process.exit(0);
}

const runCli = (dir) => {
  try {
    const out = execFileSync(process.execPath, [CLI, '--root', dir, '--json'], { encoding: 'utf8' });
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    return { code: e.status, json: JSON.parse((e.stdout || '{}') || '{}') };
  }
};

const setup = () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const f of ['app.wxss', 'app.json']) {
    fs.copyFileSync(path.join(REAL, f), path.join(tmp, f));
  }
};

try {
  // --- 1. 真实项目原样 ---
  setup();
  let r = runCli(tmp);
  const before = r.json.counts.error;
  if (before === 0) console.log('  ✓ 真实项目原样：0 error（说明当前配置与 token 一致）');
  else { console.log(`  ✗ 真实项目原样报了 ${before} 个 error —— 可能是误报`); bad++; }

  // 确认文件没被写坏（上一版踩过这个坑）
  const src = fs.readFileSync(path.join(tmp, 'app.json'), 'utf8');
  if (!src.includes('\uFFFD')) console.log('  ✓ 夹具文件编码完好（无 U+FFFD 替换字符）');
  else { console.log('  ✗ 夹具被写坏了，后面的结论不可信'); bad++; }

  // --- 2. 只改一处真配置，注释不动 ---
  const good = JSON.parse(src.replace(/^\s*\/\/.*$/gm, ''));
  good.window.navigationBarBackgroundColor = '#26262E'; // 旧墨蓝
  fs.writeFileSync(
    path.join(tmp, 'app.json'),
    src.replace('"navigationBarBackgroundColor": "#2E2A35"', '"navigationBarBackgroundColor": "#26262E"'),
    'utf8'
  );
  r = runCli(tmp);
  if (r.json.counts.error === 1) console.log('  ✓ 注入 1 处漂移 → 恰好报 1 个');
  else { console.log(`  ✗ 注入 1 处却报了 ${r.json.counts.error} 个`); bad++; }

  const f = r.json.findings[0];
  if (f && /#26262E/.test(f.message) && /--ink/.test(f.message)) console.log('  ✓ 指出是 --ink 漂移，并给出正确值');
  else { console.log('  ✗ finding 内容不对：' + (f && f.message)); bad++; }
  if (f && f.line === 13) console.log('  ✓ 行号精确（13）');
  else { console.log(`  ✗ 行号错了：${f && f.line}`); bad++; }

  // --- 3. _comment 里的旧色值不该被当成配置 ---
  setup();
  const withOldComment = fs.readFileSync(path.join(tmp, 'app.json'), 'utf8')
    .replace('"_comment": "', '"_comment": "旧值参考 #26262E / #F4EEE1，');
  fs.writeFileSync(path.join(tmp, 'app.json'), withOldComment, 'utf8');
  r = runCli(tmp);
  if (r.json.counts.error === 0) console.log('  ✓ _comment 里出现旧色值 → 不误报（注释是文档不是配置）');
  else { console.log(`  ✗ _comment 被误报成配置：${r.json.counts.error} 个`); bad++; }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 全部通过');
process.exit(bad ? 1 : 0);
