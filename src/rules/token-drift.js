'use strict';

/**
 * token-drift —— 检测「手抄的设计 token 与实际定义漂移」。
 *
 * ## 为什么这条规则最值得先做
 *
 * 有些配置文件读不了 CSS 变量，值只能**手抄一遍**。典型场景：
 *
 *   - 微信小程序 app.json 的 navigationBarBackgroundColor / tabBar.color
 *     —— JSON 读不了 --ink，只好把 #2E2A35 抄进去
 *   - Android/iOS 的启动屏、推送图标颜色
 *   - CI / 部署脚本里写死的品牌色
 *   - 邮件模板（CSS 支持差，常要写死十六进制）
 *
 * 只要存在手抄，就一定会漂。改配色时人会去改 CSS（"真源"），
 * 想不起来还有几处副本。结果就是导航栏是新配色、页面是旧配色。
 *
 * ## 这类 bug 的特征
 *
 * 不崩溃、不报错、测试全绿。只有人肉盯着屏幕才可能看出来，
 * 而本地开发常常看不见 —— 你可能一直在改页面，没注意状态栏。
 *
 * ## 判定逻辑
 *
 *   1. 从 CSS 变量文件解析出 --token: #value（真源）
 *   2. 扫配置文件里的色值（排除注释和普通文本，见 scan-config.js）
 *   3. 对每个色值找最接近的 token
 *   4. **近似但不相等** → 判定漂移
 *
 * 第 4 步是关键。不能「见到色值就报」—— 配置里可以有合理的独立颜色。
 * 要报的是「你看起来想抄这个 token，但抄错了」。
 * 距离用通道差之和衡量，超过 tolerance 就认为不是想抄，不报。
 */

const { finding, skipped } = require('../core/finding');
const { scanColorValues, normalizeHex, hexDistance, DEFAULT_IGNORE_KEYS } = require('../utils/scan-config');

const rule = {
  id: 'token-drift',
  name: '手抄 token 漂移',
  description:
    '配置文件里手抄的设计 token 与 CSS 变量定义不一致。' +
    '典型表现：改了配色但导航栏/状态栏还是旧色，上线后页面是花的。',
  severity: 'error',

  check(ctx) {
    const cfg = ctx.config || {};
    const { project } = ctx;

    const tokenFile = cfg.tokenFile || 'app.wxss';
    const configFiles = cfg.configFiles || ['app.json'];
    // 通道差之和的阈值。24 ≈ 每通道差 8，人眼在相邻色块上开始能分辨。
    // 设太大会把「本来就不同的颜色」误报成漂移。
    const tolerance = cfg.tolerance == null ? 24 : cfg.tolerance;
    const ignoreKeys = cfg.ignoreKeys || DEFAULT_IGNORE_KEYS;

    // ---- 1. 真源 ----
    const vars = project.parseCssVars(tokenFile);
    if (vars == null) {
      return {
        findings: [],
        skipped: [skipped(rule, {
          what: `token 源文件 ${tokenFile}`,
          reason: '读不到。无法确定设计系统真源，因此整条规则未执行。'
            + '这不代表配置文件里的色值是对的 —— 只是没人检查它们。',
        })],
      };
    }

    const hexTokens = new Map();
    for (const [name, value] of vars) {
      if (/^#[0-9A-Fa-f]{3,8}$/.test(value.trim())) {
        hexTokens.set(name, normalizeHex(value.trim()));
      }
    }
    if (hexTokens.size === 0) {
      return {
        findings: [],
        skipped: [skipped(rule, {
          what: `${tokenFile} 里的色值 token`,
          reason: '一个都没解析到。可能确实没有十六进制 token，'
            + '也可能解析规则不匹配。若确认没有，请在配置里禁用本规则以免每次提示。',
        })],
      };
    }

    // ---- 2 & 3. 扫配置、比对 ----
    const findings = [];
    let probedFiles = 0;

    for (const rel of configFiles) {
      const src = project.read(rel);
      if (src == null) continue;
      probedFiles++;

      const occurrences = scanColorValues(src, { ignoreKeys });

      for (const occ of occurrences) {
        const norm = normalizeHex(occ.raw);
        if (!norm) continue;

        // 抄对了 → 跳过
        if ([...hexTokens.values()].some((v) => v === norm)) continue;

        // 找最接近的 token
        let best = null;
        for (const [name, val] of hexTokens) {
          const dist = hexDistance(norm, val);
          if (!best || dist < best.dist) best = { name, val, dist };
        }

        // 近似但不相等 → 漂移
        if (best && best.dist > 0 && best.dist <= tolerance) {
          findings.push(finding(rule, {
            message:
              `色值 ${occ.raw}（第 ${occ.line} 行）与 token ${best.name} = ${best.val} 不一致，` +
              `只差一点，看起来是抄错或漏改。`,
            file: rel,
            line: occ.line,
            evidence: `"${occ.key || '(数组元素)'}": ${occ.raw}`,
            why:
              `${rel} 和 ${tokenFile} 是两个地方，改配色时只改一边就会出现` +
              `「页面是新配色、这里还是旧的」。这类问题本地开发常常看不见，` +
              `上线后才表现为颜色不统一。`,
            fix:
              `把 ${occ.raw} 改成 ${best.val}。若这里的颜色本来就该独立于设计系统，` +
              `请在 guardrail 配置里把它加进 ignoreKeys 或放宽 tolerance。`,
          }));
        }
      }
    }

    // 一个配置文件都没读到 —— 必须说出来，不能因为「没东西可查」就显示通过
    if (probedFiles === 0) {
      return {
        findings,
        skipped: [skipped(rule, {
          what: `配置文件 ${configFiles.join(', ')}`,
          reason: '一个都读不到，本次没有任何文件被检查。'
            + '请检查配置里的 configFiles 路径是否正确。',
        })],
      };
    }

    return { findings, skipped: [] };
  },
};

module.exports = { rule, _internal: { normalizeHex, hexDistance } };
