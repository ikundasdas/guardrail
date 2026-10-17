# guardrail · 进度

> 状态：**v0.1.0 已发布** → https://github.com/ikundasdas/guardrail
> 最后更新：2026-10-17

## 现在是什么

**给 AI 生成的代码配自动化验证**的框架。定位不是 linter，是「验收」。

核心论点：AI 写的 bug 往往是**静默的** —— 不崩、不报错、测试全绿，
只是悄悄做错事。人肉 review 抓不住，因为现象本身不可见。

## 已验证的状态

```
npm test                  →  46 tests, 46 pass, 0 fail
npm run test:e2e          →  6 项全过（用真实拼豆项目当夹具）
npm run test:pack         →  打包 + 干净安装 + npx/子路径导入，全过
全新 clone 后跑测试       →  46 pass（别人 clone 下来就能用）
```

## 交付物

```
guardrail/
├── package.json               零依赖，Node >=18
├── README.md                  含「踩坑记录」一节（差异化所在）
├── LICENSE                    MIT，署名 zmxy
├── .gitignore / .gitattributes
├── PROGRESS.md                本文件
├── guardrail.config.example.js
├── src/
│   ├── index.js               编程式 API
│   ├── cli.js                 CLI（--json / --sarif / --only / --list-rules）
│   ├── core/
│   │   ├── finding.js         结果结构，why/fix 必填
│   │   ├── project.js         文件读取唯一入口，读不到 → null
│   │   ├── rule.js            规则定义与校验
│   │   ├── runner.js          跑规则 + 兜住崩溃
│   │   └── reporter.js        text / json / sarif
│   ├── rules/
│   │   └── token-drift.js     手抄 token 漂移检测
│   └── utils/
│       ├── color.js           WCAG 对比度（官方测试向量校准）
│       └── scan-config.js     字符串/注释感知的色值扫描
├── test/                      5 个测试文件
└── e2e/
    ├── real-project.js        端到端：用真实拼豆项目当夹具
    └── package.js             端到端：打包 + 干净安装，验证 npx/子路径导入
```

## 三条设计红线（写新规则时别破）

1. **规则必须返回 `{ findings, skipped }`** —— 直接返回数组会被 runner 报错。
   因为那意味着作者没考虑「检查不了」的情况，而那是最危险的盲区。
2. **「读不到」绝不能算「通过」** —— `project.read()` 读不到返回 `null`，
   不是空字符串。规则必须显式记 `skipped`。
3. **规则崩溃不能静默** —— runner 把异常转成可见的 error（附堆栈），
   既不让它中断整个检查，也不让它消失。有测试专门钉这两点。

## 本轮真正抓到的东西（都是静默 bug）

开发中被自己的测试抓出 **6 个**，收尾时又抓到第 7 个，全部写进了 README：

| # | bug | 为什么危险 |
|---|---|---|
| 1 | `m[0]` 是整个匹配串，非第一个捕获组 | `NaN` → 对比度 `NaN` → `NaN < 4.5` 为 false → **所有颜色检查被跳过，零报错** |
| 2 | `r \|\| 21` 兜底 | 把「解析失败」变成「完美达标」 |
| 3 | 非法输入抛异常而非返 null | 一条规则整体崩掉 = 该规则全程失效 |
| 4 | 剥注释正则吃了 `://` | 把已正确配置判成「缺失」→ **误报，会让人去改对的东西** |
| 5 | 测试期望写错（2.51 vs 3.31、18 vs 18.66） | 若改代码迎合错误测试，等于让测试背书一个 bug |
| 6 | `_comment` 里的色值被当配置 | 改 token 就误报一片，且指向文档 |
| 7 | `package.json` 缺 `bin` / `exports` / shebang | **README 承诺的 `npx guardrail` 和 `require('guardrail/core/finding')` 全是空的**。本地 `node src/cli.js` 照样能跑，所以永远发现不了 |

第 6 条是本轮最有价值的发现 —— 它催生了 `utils/scan-config.js`
（逐字符跟踪字符串/注释状态），并带来一整套负样本测试。

第 7 条则是「文档说了但实际不工作」的典型：**本地开发路径和用户使用路径不是同一条**，
只有真的 `npm pack` + 装到干净项目里跑，才能暴露。这就是 `e2e/package.js` 的由来。

## 待办

### 高优先级
- [x] **推送到 GitHub** → https://github.com/ikundasdas/guardrail （master 改名 main，
      公开仓库，topics 已设）
- [x] 加 `bin` / `exports` / shebang，并用 `e2e/package.js` 验证 `npx guardrail`
      和 `require('guardrail/core/finding')` 真的可用（原先 README 承诺的用法全是空的）
- [ ] 真机/真实项目用一段时间，积累第 2、3 个用户场景（目前只有拼豆一个）

### 中优先级（第二批规则）
从 `D:\study\dsharness\随笔\quality-check\` 提炼，**要脱掉 `../miniprogram` 硬编码**：

| 源脚本 | 可提炼规则 | 备注 |
|---|---|---|
| `check-appjson.js` | 隐私三方对照（代码调用 ↔ 声明 ↔ 协议正文） | 最有料，规则复杂 |
| `test-gitignore.js` | 密钥是否真被忽略（用 `git check-ignore` 验） | 简单且通用 |
| `check-design.js` | 硬编码色值 / 类名冲突 / 触摸目标 <88rpx | 拆分后各自成规则 |
| `test-legal.js` | 占位符检测（临时改文件 + 子进程验两条路径） | 模式值得复用 |

### 低优先级
- [ ] `--fix` 自动修复（token-drift 理论上可修，但要小心语义）
- [ ] 规则「适用性」声明（`appliesTo`），非小程序项目自动跳过小程序规则
- [ ] 英文 README（中文受众好，英文能证明国际化能力 —— 尚未决定）

## 已知限制

- 只有 1 条规则。框架的地基比内容多 —— 这是有意的（先证明地基能兜住），
  但**只有 1 条规则的框架说服力不足**，第二批规则要尽快补。
- `scan-config.js` 只处理类 JSON/JS 对象字面量，不支持 XML/YAML/TOML。
  小程序 `app.json`、Web `theme.json` 够用，Android `colors.xml` 不行。
- `--sarif` 输出是手写的最小子集，没在真实 GitHub Code Scanning 上验证过。

## 一个还没验证的假设

README 开头宣称「AI 写的 bug 往往是静默的」——
这是从拼豆项目 5 个真 bug 归纳出来的，**样本量只有 1 个项目**。
推广到「AI 生成的代码」整体，逻辑上成立但缺数据。
如果后面要写文章，这里该补一些外部案例或数据，别只凭一个项目就下结论。
