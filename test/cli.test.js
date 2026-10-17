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

const { loadConfig } = require('../src/cli');

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
// 注：README / package.json / .gitattributes 之间的一致性检查在
// test/repo.test.js —— 那些是「仓库文件是否自洽」，和 CLI 行为不是一回事。
// ---------------------------------------------------------------------------
