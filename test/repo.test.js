'use strict';

// 仓库自身的一致性检查。
//
// 这个文件不看「代码逻辑对不对」，只看**仓库里的文件和文档是否自洽**：
// 同一个名字有没有散落在多处、改了这处漏了那处。
//
// 这类问题统统一致：不崩、不报错、测试全绿，只是用户照着文档做的时候踩空。
// 本轮真实踩到的三个（都写进了 README 的踩坑记录）：
//   - README 写 npx guardrail，但 npm 上 guardrail 是别人的包 → 静默装错
//   - README 写 require('guardrail/core/finding')，但包名已改 → 路径不存在
//   - .gitattributes 少了开头的 `*`，整行变成匹配「名为 text 的文件」→ 完全失效
//
// 共同解法：断言「文件里实际写了什么」，而不是「我以为它写了什么」。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const BIN = Object.keys(pkg.bin || {})[0];

/** 读文本并统一换行 —— 见下面 README 用例里记的 CRLF 踩坑。 */
const readText = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

test('package.json 必须有 bin，否则用户无法调用', () => {
  assert.ok(BIN, 'bin 缺失 → README 里的任何 npx 用法都不成立');
});

test('--help 显示的命令名与 package.json 的 bin 一致', () => {
  const { main } = require('../src/cli');

  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  try {
    main(['--help']);
  } finally {
    process.stdout.write = orig;
  }

  const esc = BIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(out, new RegExp(`用法\\s*\\n\\s*${esc} \\[选项\\]`),
    `帮助文本里必须写 ${BIN}，否则用户照帮助敲的命令不存在`);
});

test('README 代码块里所有 npx 命令都指向真实存在的包名', () => {
  // 读进来先归一化换行。
  // 这里踩过一次：正则写成 ```[a-z]*\n，本机 README 是 LF 所以全绿，
  // 但别人 clone 时 core.autocrlf 会把文件转成 CRLF，
  // ` ```bash\r ` 后面就不是 \n 了 —— 围栏一个都抓不到，测试直接红。
  // 教训：对仓库文本做正则前，先统一换行。
  const readme = readText('README.md');

  // 只看围栏代码块。
  // 正文里会引用旧名字来解释「为什么改名」，那是叙述不是给用户敲的指令；
  // 把它也当命令，会逼着人把说明写含糊。
  const code = [...readme.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');

  // 逐行看，只取「行首就是 npx」的。
  // 代码块里的注释也会出现 npx 字样（比如 `# 验证 npx 可用`），
  // 那是说明文字：整行以 # 开头的跳过，行尾注释先剥掉。
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
    const ok = c === BIN || c.startsWith('github:');
    assert.ok(ok, `README 代码块里的 \`npx ${c}\` 有问题：既不是本包的命令 ${BIN}，`

      + '也不是 github: 安装。如果这个名字在 npm 上属于别人，用户会静默装上别人的包');
  }
});

test('README 里的 require 子路径用的是本包的包名', () => {
  const readme = readText('README.md');
  const specs = [...readme.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);

  for (const s of specs) {
    const root = s.split('/')[0];
    if (root.startsWith('.') || root.startsWith('node:')) continue;
    assert.equal(root, pkg.name,
      `README 里 require('${s}') 用的包名和 package.json 的 ${pkg.name} 不一致`);
  }
});

test('.gitattributes 的每一行都带有效模式（防「少了 `*` 整文件失效」）', () => {
  const raw = readText('.gitattributes');

  // gitattributes 的行格式是「模式 属性…」。
  // 少了模式的后果很隐蔽：`text eol=lf` 会被理解成
  // 「匹配名为 text 的文件，给它设 eol=lf」—— 而没人叫 text，于是整行失效。
  // 属性名一共就那几个，用它们当模式几乎必然是漏了 `*`。
  const ATTR_WORDS = /^(-?text|binary|eol=|diff=|merge=|linguist-|whitespace=|filter=|export-ignore|export-subst)/;

  const lines = raw.split('\n')
    .map((l, i) => ({ no: i + 1, text: l.trim() }))
    .filter(({ text }) => text && !text.startsWith('#'));

  assert.ok(lines.length > 0, '.gitattributes 不该是空的');

  for (const { no, text } of lines) {
    const pattern = text.split(/\s+/)[0];
    assert.ok(!ATTR_WORDS.test(pattern),
      `.gitattributes 第 ${no} 行的模式是「${pattern}」，看起来是属性名而不是文件名模式。`
      + '多半是漏了开头的通配符 —— 比如 `* text eol=lf` 写成了 `text eol=lf`，'
      + '那行就什么都不匹配，整个文件形同虚设');
  }
});

test('.gitattributes 真的作用到了文件上（用 git 自己判断，不靠肉眼）', (t) => {
  // 上面那条是静态检查；这条是实证 —— 问 git 本人。
  // 「文件里写了什么」和「git 实际怎么处理」是两回事，
  // 这条测试专门堵住它们不一致的情况。
  if (!fs.existsSync(path.join(REPO, '.git'))) {
    t.skip('不在 git 仓库里（比如作为依赖被安装），跳过');
    return;
  }

  let out;
  try {
    out = execFileSync('git', ['check-attr', 'text', 'eol', '--', 'README.md'],
      { cwd: REPO, encoding: 'utf8' });
  } catch {
    t.skip('本机没有可用的 git，跳过');
    return;
  }

  assert.doesNotMatch(out, /unspecified/,
    `.gitattributes 没有作用到 README.md 上：\n${out}\n`
    + '说明模式没匹配上 —— 检查是不是漏了 `*`');
  assert.match(out, /eol: lf/,
    `README.md 的换行没有被锁定成 LF：\n${out}\n`
    + '不锁定的话，Windows 上 checkout 会变 CRLF，'
    + '跨机器 diff 整个文件都显示为改动');
});
