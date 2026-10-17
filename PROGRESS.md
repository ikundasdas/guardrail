# 开源进度 · guardrail

> 状态：**地基已验证，规则层未开工**
> 最后更新：2026-10-16 下班前

## 这项目要解决什么

给 **AI 生成的代码** 配一套自动化验证。AI 写得快，但它的失败模式是
**静默的** —— 不崩溃、不报错，只是悄悄地做错事。人肉 review 抓不住，
因为现象本身看不见（色值漂了、对比度不够、类名撞了、权限没声明）。

定位：不是 linter，是**验收**。linter 说「你写错了」，验收说「你做对了但你不知道」。

## 已确认的方向

| 项 | 决定 |
|---|---|
| 形态 | 通用 AI 代码验证框架（规则即插件） |
| 许可证 | MIT |
| 踩坑记录 | 保留，写进 README —— 这是差异化 |
| 命名 | `guardrail` |

## 目录

```
guardrail/
├── package.json          ✓ 零依赖，node >=18，test 用 node:test
├── src/
│   ├── utils/color.js    ✓ WCAG 对比度，8 测试全绿
│   ├── core/             ○ 空 —— 规则加载/配置/输出，待做
│   ├── rules/            ○ 空 —— 待做
│   └── cli.js            ○ 未创建（package.json 已引用）
├── test/
│   └── color.test.js     ✓ 8/8 通过
└── examples/             ○ 空
```

`core/` `rules/` `examples/` 三个目录已建但**完全没写**。

## 当前可运行

```powershell
cd D:\study\dsharness\随笔\_oss\guardrail
npm test          # 8 tests, 8 pass, 0 fail
```

## 这一轮真正学到的东西

写对比度算法时被抓出 **3 个 bug**，其中 2 个是我代码的、1 个是我测试期望写错的。
**全部是「静默失败」类型** —— 这正是这个项目存在的理由，记录下来当设计原则：

### 1. `m[0]` 是整个匹配串，不是第一个捕获组

```js
// 错的：从 m[0] 取
parseInt(m[0], 16)        // parseInt('#2E2A35', 16) → NaN
// 对的：捕获组从 m[1] 起
[1,2,3].map(i => parseInt(m[i], 16))
```

后果链：`NaN` → `map` 变 `null` → 对比度算出 `NaN` → **`NaN < 4.5` 是 `false`**
→ 所有颜色检查被跳过，规则形同虚设。全程零报错。

### 2. 「读不出来」绝不能兜底成「达标」

```js
const r = contrastRatio('var(--ink)', '#fff');
r || 21     // ✗ 把「解析失败」变成「完美达标」
```

现在统一返回 `null`，调用方必须显式处理。

### 3. 非法输入必须返回 null，不能抛异常

第一版 `contrastRatio` 写成 `isHexColor(fg) ? hexToRgb(fg) : fg`，
遇到 `var(--ink)` 时把字符串原样传下去 → `rgb.map` 抛 `TypeError` → **整条规则崩掉**。
一条规则因为一个坏输入整体挂掉，等于这条规则全程失效。

### 4. 检查器的 bug 比被检查的 bug 更危险

来源：拼豆项目里 `check-appjson.js` 的两轮自查。
剥注释正则 `^\s*//.*$` 遇到 `_comment` 值里的 `://` 会一路吃到行尾，
把真实的 `__usePrivacyCheck__: true` 吃掉 → **误报「没配置」**。

假警报的破坏力：人会去「修」本来正确的东西。
所以 guardrail 的规则**每一条都要有「故意写错」的负样本测试**。

### 5. 别为了让测试变绿去改代码

第 6、7 条测试失败时，我的期望写错了：
- 实际对比度是 **3.31** 不是 2.51（2.51 是 v2 旧配色 `--text-3 = #B9B2A4` 的值）
- 分界是 **18.66px** 不是 18px

正确做法是**改测试期望**。如果改代码去迎合错误的测试，就会把 18px 粗体
错误放宽到大字标准 3:1 —— 测试从此背书了一个 bug。

## 下一步（按优先级）

### 1. 核心框架 `src/core/`
- 规则接口：`{ id, name, severity, check(ctx) → Finding[] }`
- `Finding` 要能带**文件:行号 + 为什么这是问题 + 怎么修**，
  不能只有「不通过」。这是和普通 linter 的区别。
- 配置加载（rc 文件）、规则注册与过滤、`--fix` 先不做

### 2. CLI `src/cli.js`
`package.json` 已经引用但文件不存在，跑 `npm run check` 会失败。

### 3. 首批规则（从 `quality-check/` 提炼，**要脱掉 `../miniprogram` 硬编码**）
| 源脚本 | 可提炼的通用规则 | 难度 |
|---|---|---|
| `check-design.js` | token 对比度 / 类名冲突 / 触摸目标 <88rpx / 硬编码色值 | 中 |
| `check-appjson.js` | **token 漂移**（JSON 手抄 CSS 变量必然漂）/ 隐私三方对照 | 低，最有价值 |
| `test-gitignore.js` | 密钥是否真被 `.gitignore` 挡住（用 `git check-ignore`） | 低 |
| `test-legal.js` | 占位符检测 —— 用**临时改文件 + 子进程**验证两条路径 | 低 |

**token 漂移**是整个项目最该先做的规则，因为它最通用：
任何「JSON 里必须手抄设计 token」的场景（小程序、真配置、CI）都成立，
而手抄就一定会漂。

### 4. README（差异化就在这）
必须有：
- **真实踩坑案例**：`.sw` 类名撞车把色板挤成 48px、`--text-3` 对比度 2.51:1、
  `__usePrivacyCheck__` 没声明导致真机功能全挂、检查器自己的 bug
- 一句定位：**别人只有工具，我还有「怎么发现这些坑」的方法论**
- `examples/` 放一个真实小程序 fixture 当演示

### 5. 收尾
- `.gitignore`（`node_modules/`、`examples/*/out/`）
- LICENSE（MIT，填你的名字「张云浩」或你想要的署名）
- `git init` + 首次提交
  ⚠️ 注意：`_oss/` 在 `D:\study\dsharness\随笔` 内，而那个目录不是 git 仓库，
  所以这里 init 是安全的，不会有嵌套仓库问题。

## 取材来源（原始脚本）

`D:\study\dsharness\随笔\quality-check\` 共 19 个 JS、约 1400 行。
**不要整个搬**，里面有大量 `../miniprogram` 硬编码和一次性脚本：

- **值得提炼**：`check-appjson.js` `check-design.js` `test-gitignore.js` `test-legal.js`
- **一次性、别搬**：`migrate-v3-*.js`（配色迁移，只对 v2→v3 有意义）、
  `render-design.js` `compare.js` `lib-render.js`（渲染 PNG 对比图）、
  `ide-*.js`（依赖微信开发者工具自动化）
- **强依赖业务数据、难通用**：`check-templates.js` `test-quality.js`
  `img2template.js`（拼豆 291 色卡、色域距离算法）

## 待确认

- 项目名 `guardrail` 是不是太泛？GitHub 上重名的话改名
- README 用中文还是中英双语？（中文受众更好，英文更能证明国际化能力）
