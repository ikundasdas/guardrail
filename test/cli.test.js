'use strict';

// CLI 配置发现测试。
//
// 为什么专门测这个：CONFIG_NAMES 里曾经有一个拼错的文件名 ——
// `.guradrailrc.js`（guardrail 写成了 guradrail）。
// 这个错字不会报错、不会崩、测试全绿，只是**那个配置文件永远加载不到**。
// 用户写了配置文件却毫无效果，是最难查的一类问题：没有错误信息可以搜。
//
// 所以这里的用例不看「代码里写了哪些名字」，而是真的把文件建出来、
// 调 loadConfig 看能不能找到。拼错的名字会在测试里立刻现形。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig, main } = require('../src/cli');

/** 建一个临时工作目录，用完自动删。 */
function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('三种约定的配置文件名都能被发现', (t) => {
  const names = ['guardrail.config.js', '.guardrailrc.js', '.guardrailrc.json'];
  for (const name of names) {
    // 每个名字单独一个目录，避免互相干扰
    const root = tempRoot(t);
    if (name.endsWith('.json')) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ _marker: name }));
    } else {
      fs.writeFileSync(path.join(root, name), `module.exports = { _marker: ${JSON.stringify(name)} };`);
    }

    const { config, file } = loadConfig(root);
    assert.equal(config._marker, name, `${name} 应该被加载到`);
    assert.equal(path.basename(file), name, `${name} 应该被报告为来源文件`);
  }
});

test('没有配置文件时返回空配置，不报错', (t) => {
  const root = tempRoot(t);
  const { config, file } = loadConfig(root);
  assert.deepEqual(config, {});
  assert.equal(file, null, '「没有配置」要能和「配置是空对象」区分开');
});

test('拼错的文件名不该被当成配置 —— 这是修过的真实 bug', (t) => {
  const root = tempRoot(t);
  // 曾经 CONFIG_NAMES 里就是这个名字，多一个 a、少一个 a，肉眼极难看出来
  fs.writeFileSync(path.join(root, '.guradrailrc.js'), 'module.exports = { _marker: "typo" };');

  const { config, file } = loadConfig(root);
  assert.deepEqual(config, {}, '拼错的文件名不该被加载');
  assert.equal(file, null);
});

test('优先级：guardrail.config.js 排在 .guardrailrc.* 前面', (t) => {
  const root = tempRoot(t);
  fs.writeFileSync(path.join(root, 'guardrail.config.js'), 'module.exports = { _which: "config.js" };');
  fs.writeFileSync(path.join(root, '.guardrailrc.json'), JSON.stringify({ _which: 'rc.json' }));

  const { config } = loadConfig(root);
  assert.equal(config._which, 'config.js', '同时存在时用排在前面的那个');
});

test('JSON 配置文件非法时报明确错误，而不是静默跳过', (t) => {
  const root = tempRoot(t);
  fs.writeFileSync(path.join(root, '.guardrailrc.json'), '{ 这不是 JSON }');

  assert.throws(
    () => loadConfig(root),
    /不是合法 JSON/,
    '配置文件写坏了要明确报错 —— 静默忽略会让用户以为配置生效了',
  );
});

// ---------------------------------------------------------------------------
// 下面两个用例防的是同一类问题：**同一个名字散落在多个文件里，改一处漏一处**。
// 包从 guardrail 改名 ai-guardrail 时，帮助文本和 README 都可能忘了跟着改。
// 这类残留不会报错，只会让用户敲了一个不存在的命令（或者更糟，别人的包）。
// ---------------------------------------------------------------------------

const REPO = path.join(__dirname, '..');
const readPkg = () => JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

test('--help 显示的命令名与 package.json 的 bin 一致', (t) => {
  const pkg = readPkg();
  const binName = Object.keys(pkg.bin || {})[0];
  assert.ok(binName, 'package.json 必须有 bin，否则用户没法调用');

  const out = captureStdout(() => main(['--help']));
  assert.match(out, new RegExp(`用法\\s*\\n\\s*${binName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\[选项\\]`),
    `帮助文本里必须写 ${binName}，否则用户照帮助敲的命令不存在`);
});

test('README 里所有 npx 命令都指向真实存在的包名', () => {
  const pkg = readPkg();
  const binName = Object.keys(pkg.bin || {})[0];
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');

  // 只看围栏代码块里的命令。
  // 正文里会引用旧名字来说明「为什么改名」（比如讲述 npm 重名那段），
  // 那是叙述而不是给用户敲的指令 —— 把它也当成命令会逼着人把说明写含糊。
  const code = [...readme.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');

  // 逐行看，只看「行首就是 npx」的。
  // 代码块里的注释也会出现 npx 字样（比如 `# 验证 npx 和子路径导入真的可用`），
  // 那是说明文字；整行首是 # 的直接跳过，行尾注释也先剥掉。
  const cmds = [];
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.split(/\s+#/)[0];
    const m = /^npx\s+([^\s`#]+)/.exec(body);
    if (m && m[1] !== '-y' && m[1] !== '--yes') cmds.push(m[1]);
  }
  assert.ok(cmds.length > 0, 'README 的代码块里应该至少有一条 npx 用法');

  for (const c of cmds) {
    const ok = c === binName || c.startsWith('github:');
    assert.ok(ok, `README 代码块里的 \`npx ${c}\` 有问题：既不是本包的命令 ${binName}，`
      + '也不是 github: 安装。如果这个名字在 npm 上属于别人，用户会静默装上别人的包');
  }
});

test('README 里的 require 子路径用的是本包的包名', () => {
  const pkg = readPkg();
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');

  const specs = [...readme.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  for (const s of specs) {
    const root = s.split('/')[0];
    if (root.startsWith('.') || root.startsWith('node:')) continue;
    assert.equal(root, pkg.name, `README 里 require('${s}') 用的包名和 package.json 的 ${pkg.name} 不一致`);
  }
});

/** 临时接住 process.stdout.write，拿到 CLI 的输出。 */
function captureStdout(fn) {
  const orig = process.stdout.write;
  let buf = '';
  process.stdout.write = (s) => { buf += s; return true; };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return buf;
}
