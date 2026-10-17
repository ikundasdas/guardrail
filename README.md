# guardrail

给 **AI 生成的代码** 配自动化验证。

不是 linter。linter 告诉你「这行写错了」，guardrail 告诉你
「这里做对了但你以为它做对了，其实没有」。

```bash
npx guardrail
```

```
error 手抄 token 漂移  app.json:13
  色值 #26262E（第 13 行）与 token --ink = #2E2A35 不一致，只差一点，看起来是抄错或漏改。
    │ "navigationBarBackgroundColor": "#26262E"
    为什么：app.json 和 app.wxss 是两个地方，改配色时只改一边就会出现
           「页面是新配色、这里还是旧的」。这类问题本地开发常常看不见，
           上线后才表现为颜色不统一。
    怎么修：把 #26262E 改成 #2E2A35。
```

## 为什么需要它

AI 写代码的失败模式和人的不一样。人写的 bug 常常会崩、会报错、会有异常堆栈。
**AI 写的 bug 往往是静默的** —— 代码能跑、测试全绿、看起来没问题，
只是悄悄地做错了事。

因为 AI 的目标是「让代码看起来对」，而它不知道你的设计系统有 87 个 token、
不知道导航栏的颜色必须和页面保持一致、不知道这个接口在真机上需要声明。

人类 review 抓不住这类问题，因为**现象本身是不可见的**。
你不会在 diff 里看到「颜色差了 8 个色阶」，也不会看到「AI 换了类名但另一个文件还在用旧的」。

guardrail 把这些「看不见的检查」变成可执行的文件。

## 和 linter 的区别

| | 普通 linter | guardrail |
|---|---|---|
| 输出 | 「第 42 行不合规」 | 哪里不对 + **为什么** + **怎么修** |
| 「查不了」 | 静默跳过 | 记入「未验证」区，显式列出 |
| 规则崩溃 | 中断或静默 | 变成一条 error，附堆栈 |
| 定位 | 语法/风格 | 跨文件的**一致性与意图** |

第三行是核心。一条检查器最危险的失败不是报错，是**悄悄跳过** ——
报告显示全绿，让人以为检查过了，实际上什么都没查。

## 安装

```bash
npm install -D guardrail
npx guardrail --root ./miniprogram
```

零依赖，Node >= 18。

## 用法

```bash
guardrail                        # 检查当前目录
guardrail --root ./miniprogram   # 指定根目录
guardrail --only token-drift     # 只跑一条规则
guardrail --json                 # 机器可读
guardrail --sarif                # GitHub Code Scanning（PR 里显示行内标注）
guardrail --list-rules           # 列出所有规则
```

**退出码**：`0` 通过 / `1` 有问题 / `2` 工具自身出错。
区分 1 和 2 是有意的 —— 「你的项目有问题」和「工具坏了」要能分开，
否则 CI 红了不知道从哪查。

## 规则

### `token-drift` — 手抄 token 漂移

有些配置文件读不了 CSS 变量，值只能**手抄**。微信小程序的 `app.json`
就是典型：它读不了 `--ink`，所以 `#2E2A35` 只能抄进去。

只要存在手抄，就一定会漂。改配色时人会去改 CSS（真源），
想不起来还有几处副本。结果就是导航栏新配色、页面旧配色。

```
tokenFile    默认 app.wxss，CSS 变量真源
configFiles  默认 ['app.json']，要检查的配置文件
tolerance    默认 24，通道差之和。超过就认为「本来就不同」，不报
ignoreKeys   默认 _comment/$comment/注释类 key
```

`tolerance` 的设计：不报「所有色值」，只报**近似但不相等**的。
配置里可以有合理的独立颜色，要抓的是「看起来想抄这个 token 但抄错了」。

配置示例（`guardrail.config.js`）：

```js
module.exports = {
  rules: {
    'token-drift': {
      tokenFile: 'styles/tokens.css',
      configFiles: ['theme.json', 'android/colors.xml'],
    },
  },
};
```

## 一条规则长什么样

```js
const { finding, skipped } = require('guardrail/core/finding');

module.exports.rule = {
  id: 'my-rule',
  name: '我的检查',
  severity: 'error',
  check(ctx) {
    const { project, config } = ctx;

    const src = project.read('config.json');
    if (src == null) {
      // 读不到 → 显式声明「没检查」，不要静默通过
      return { findings: [], skipped: [skipped(this, {
        what: 'config.json',
        reason: '读不到，本次未检查。这不代表它没问题。',
      })] };
    }

    return {
      findings: [
        finding(this, {
          message: '哪里不对',
          file: 'config.json',
          line: 12,
          why: '为什么这是问题',      // 别省，这是核心价值
          fix: '怎么改',              // 别省
        }),
      ],
      skipped: [],
    };
  },
};
```

规则**必须**返回 `{ findings, skipped }`。直接返回数组会被报错，
因为那意味着作者没考虑「检查不了」的情况 —— 而那正是最危险的盲区。

## 踩坑记录

README 里专门留这一节，是因为**踩坑本身比工具更有价值**。
下面每一条都是真实发生过的，而且每一条都导致过一个「看起来全绿但实际没检查」的状态。

### 1. `m[0]` 是整个匹配串，不是第一个捕获组

写颜色解析时：

```js
const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec('#2E2A35');
// m = ['#2E2A35', '2E', '2A', '35']
//       ^^^^^^^^^ m[0] 是整个匹配串
parseInt(m[0], 16);  // → NaN
```

后果链：`NaN` → `map` 变 `null` → 对比度算出 `NaN`
→ **`NaN < 4.5` 是 `false`** → 所有颜色检查被跳过，规则形同虚设。

全程零报错。这是最难查的一类 bug：不崩溃，只是悄悄什么都不做了。

### 2. 「读不出来」绝不能兜底成「达标」

```js
const r = contrastRatio('var(--ink)', '#ffffff');
r || 21;   // ✗ 把「解析失败」变成「完美达标」
```

现在统一返回 `null`，调用方**必须**显式处理。
测试里专门有一条断言这件事。

### 3. 非法输入必须返回 `null`，不能抛异常

```js
// ✗ 第一版
isHexColor(fg) ? hexToRgb(fg) : fg
```

遇到 `'var(--ink)'` 时 `isHexColor` 为 false，于是把字符串原样传下去，
`rgb.map` 抛 `TypeError` —— **整条规则崩掉**。

一条规则因为一个坏输入整体挂掉，等于这条规则全程失效。
现在 runner 会把崩溃转成可见的 error（不让它静默），
但规则本身也该尽量返回 `null` 而不是抛。

### 4. 检查器自己的 bug 比被检查的 bug 更危险

真实的例子：一个用来验证配置漂移的脚本，剥注释用的正则遇到
`_comment` 值里的 `://`，会从那里一路吃到行尾，把后面真实的配置吞掉。
结果把一个**已经正确配置**的项目判成「缺配置」。

假警报的破坏力不比漏报小：它会让人去「修」本来正确的东西，
而且一旦发现是误报，人就不再看报告了。

所以 guardrail 的每条规则都要有**负样本测试** —— 故意写对的项目必须零 finding。

### 5. 别为了让测试变绿去改代码

上面这些 bug 里有一条，一开始我以为是对比度算法错了，
实际是**我的测试期望写错了**（记成了 2.51，实际 3.31；分界记成 18 实际 18.66）。

如果当时改代码去迎合错误的测试，就会把 18px 粗体错误地放宽到大字标准 3:1 ——
测试从此开始背书一个 bug。

**测试失败时，先确认期望本身对不对。**

### 6. 注释里的色值是文档，不是配置

`token-drift` 第一版用正则扫全文，把 `app.json` 里这段也当成了配置：

```json
"_comment": "以下色值必须与 app.wxss 的 token 一致：navigationBarBackgroundColor = --ink #26262E；…"
```

改一次 token 就误报一片，而且指向的是**文档**，改也不是、不改也不是。

现在扫描器逐字符跟踪字符串/注释状态和「当前 key」，会排除注释型 key 的值。
而且专门测了 `https://example.com/#FF0000` 这种 URL 里的 `#` 不会被误判。

### 7. 本地能跑 ≠ 用户能用

收尾时发现 `package.json` 里没有 `bin`、没有 `exports`，`cli.js` 也没有 shebang。

三个都缺，但**本地开发完全感觉不到**：

```bash
node src/cli.js          # 好用得很
npx guardrail            # 失败：找不到可执行文件
require('guardrail/core/finding')   # 失败：包没声明这个子路径
```

README 里这两条用法都写着 —— 文档承诺了，包不兑现。

这类问题只有一种抓法：`npm pack` 出真实包，装进一个**干净的项目**，
按文档写的方式跑一遍。`e2e/package.js` 干的就是这件事。

顺带一提，写这个验证脚本时我自己也踩了一下：
把探针文件建在了消费者目录**外面**，于是 `require` 找不到已安装的包。
Node 按「文件所在位置」向上找 `node_modules`，不看 cwd ——
差点把「我路径写错了」误诊成「包的 exports 坏了」。

## 开发

```bash
npm test           # 单元测试
npm run test:e2e   # 用真实小程序的端到端验证（没该项目时自动跳过）
npm run test:pack  # 打包 + 装进干净项目，验证 npx 和子路径导入真的可用
```

`test:pack` 值得单独说一句：它会 `npm pack` 出真实包、装进临时项目，
再跑 `npx guardrail` 和 `require('guardrail/core/finding')`。
之所以要这么做，是因为 `bin` / `exports` / shebang 缺失时，
本地 `node src/cli.js` 照样能跑，开发者根本不会察觉 —— 但用户会失败。

## 许可

MIT
