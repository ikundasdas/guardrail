'use strict';

/**
 * Project —— 规则读取项目文件的唯一入口。
 *
 * 为什么要包一层，而不是让规则自己 fs.readFileSync：
 *
 *   1. 文件读不到时的行为必须统一。散落的 readFileSync 会各自 try/catch，
 *      有的吞掉异常返回 ''，有的往上抛 —— 前者会让规则「读到空内容」
 *      然后判定通过，这是最危险的静默失败。
 *   2. 路径必须是相对的、正斜杠的。Windows 上 path.join 给的是反斜杠，
 *      直接写进 finding 会让人复制不出来，也让跨机器 diff 不稳定。
 *   3. 需要「这个文件存不存在」和「读到了什么」分开。存在但读不了
 *      （权限、编码）和不存在是两回事，处理方式不同。
 */
const fs = require('node:fs');
const path = require('node:path');

class Project {
  constructor(root) {
    this.root = path.resolve(root);
    this._readCache = new Map();
    this._existCache = new Map();
  }

  /** 转成相对 root 的正斜杠路径，用于展示。root 外的路径保持绝对。 */
  rel(absOrRel) {
    const abs = path.resolve(this.root, absOrRel);
    const r = path.relative(this.root, abs);
    if (r.startsWith('..')) return abs.split(path.sep).join('/');
    return r.split(path.sep).join('/');
  }

  abs(rel) {
    return path.resolve(this.root, rel);
  }

  exists(rel) {
    if (this._existCache.has(rel)) return this._existCache.get(rel);
    const v = fs.existsSync(this.abs(rel));
    this._existCache.set(rel, v);
    return v;
  }

  /**
   * 读文件。读不到返回 null。
   *
   * 关键约定：**返回 null ≠ 返回空字符串**。
   * null 表示「这里没有文件」，空字符串表示「文件是空的」。
   * 规则必须区分这两者 —— 混为一谈就会把「文件不存在」当成
   * 「文件里没找到问题」然后放行。
   */
  read(rel) {
    if (this._readCache.has(rel)) return this._readCache.get(rel);
    let v = null;
    try {
      v = fs.readFileSync(this.abs(rel), 'utf8');
    } catch (e) {
      v = null; // 不存在 / 是目录 / 权限不足，统一返回 null
    }
    this._readCache.set(rel, v);
    return v;
  }

  /** 读目录下的文件名（只一层）。读不到返回空数组 —— 这里空数组是安全的，调用方会自己判空目录。 */
  listDir(rel) {
    try {
      return fs.readdirSync(this.abs(rel), { withFileTypes: true })
        .map((d) => ({ name: d.name, isDir: d.isDirectory() }));
    } catch (e) {
      return [];
    }
  }

  /** 递归收集文件，返回相对路径。用于「扫描整个项目」型规则。 */
  walk(relStart = '.', { ignore = DEFAULT_IGNORE, maxDepth = 12 } = {}) {
    const out = [];
    const walkDir = (rel, depth) => {
      if (depth > maxDepth) return;
      for (const { name, isDir } of this.listDir(rel)) {
        if (ignore.some((re) => re.test(name))) continue;
        const child = rel === '.' ? name : `${rel}/${name}`;
        if (isDir) walkDir(child, depth + 1);
        else out.push(child);
      }
    };
    walkDir(relStart, 0);
    return out.sort();
  }

  /**
   * 解析 CSS 变量定义：--name: value;
   * 用于「JSON 手抄了 CSS 变量值」这类漂移检查。
   */
  parseCssVars(rel) {
    const src = this.read(rel);
    if (src == null) return null;
    const vars = new Map();
    for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
      vars.set(m[1], m[2].trim());
    }
    return vars;
  }
}

const DEFAULT_IGNORE = [
  /^\.git$/,
  /^node_modules$/,
  /^miniprogram_npm$/,
  /^\.DS_Store$/,
];

module.exports = { Project, DEFAULT_IGNORE };
