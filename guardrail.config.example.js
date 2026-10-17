// guardrail 配置示例。
//
// 用法：把本文件复制成 guardrail.config.js 放在项目根目录，
// 或在 package.json 里显式指定 --config。
//
// 全部字段都可选。不配就用默认值。
module.exports = {
  rules: {
    // ---- token-drift：手抄 token 漂移 ----
    'token-drift': {
      // 设计系统真源。CSS 变量从这里解析。
      // 微信小程序：app.wxss；通用 Web：styles/tokens.css
      tokenFile: 'app.wxss',

      // 要检查的配置文件。这些文件读不了 CSS 变量，值只能手抄。
      configFiles: ['app.json'],

      // 通道差之和的阈值。默认 24（约每通道差 8，人眼开始能分辨）。
      // 调大 → 少数漂移漏掉；调小 → 合理独立色被误报。
      tolerance: 24,

      // 这些 key 下的色值被当作「文档」而非配置，跳过。
      // 典型：_comment 里写着「旧值 #26262E 已废弃」。
      ignoreKeys: ['_comment', '$comment', '__comment', 'comment', '//', '_note', 'note', 'description'],

      // 关掉这条规则
      // enabled: false,
    },
  },
};
