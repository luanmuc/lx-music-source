#!/usr/bin/env node
/**
 * v23.1 发布前自检门（L2）：
 *   1. @version 与 logInfo「豆包定制聚合音源 vX.Y」同步（App 内置升级正则依赖，b38 教训）
 *   2. sourceConfig 各平台 actions 声明齐全（health/toggle/probe 全平台，lyric/pic 按平台）
 *   3. README 版本历史存在当前版本条目
 *   4. ROADMAP 当前版本迭代已标 [x]（防止提交未完成版本；挂起项标注外部依赖可存在）
 * 任一失败 → 进程退出码 1 → CI 阻断发布
 */
const fs = require('fs');
const path = require('path');

let failed = false;
const fail = (msg) => { failed = true; console.error('[自检失败] ' + msg); };

const srcPath = path.join(__dirname, '..', 'lx-source.js');
const readmePath = path.join(__dirname, '..', 'README.md');
const roadmapPath = path.join(__dirname, '..', 'docs', 'ITERATION_ROADMAP.md');
const src = fs.readFileSync(srcPath, 'utf-8');

// 1) 版本串同步
const verHeaderMatch = src.match(/@version\s+(\S+)/);
const verLogMatch = src.match(/豆包定制聚合音源\s+v(\S+)/);
const verHeader = verHeaderMatch ? verHeaderMatch[1] : null;
const verLog = verLogMatch ? verLogMatch[1] : null;
if (!verHeader) fail('lx-source.js 缺少 @version');
if (!verLog) fail('lx-source.js logInfo 缺少「豆包定制聚合音源 vX.Y」串');
else if (verHeader && verLog !== verHeader) fail('版本串不同步：@version=' + verHeader + ' vs logInfo=' + verLog);

// 2) actions 声明齐全
const cfgIdx = src.indexOf('const sourceConfig');
const actionBlock = src.slice(cfgIdx, cfgIdx + 1500);
if (cfgIdx === -1) fail('sourceConfig 定义缺失');
if (!src.includes('const PLATFORM_QUALITIES')) fail('PLATFORM_QUALITIES 定义缺失');
const reportIdx = src.indexOf('const REPORT_QUALITIES');
const reportBlock = src.slice(reportIdx, reportIdx + 500);
for (const plat of ['wy', 'tx', 'kw', 'kg', 'mg']) {
  if (!reportBlock.includes(plat + ':')) fail('REPORT_QUALITIES 缺少平台 ' + plat);
}
for (const act of ['health', 'toggle', 'probe']) {
  if (!actionBlock.includes(act)) fail('sourceConfig 构建块缺少 ' + act);
}
if (!actionBlock.includes('lyric')) fail('wy 歌词 action 声明缺失');
if (!actionBlock.includes('"musicUrl"')) fail('musicUrl 基础 action 缺失');

// 3) README 版本历史
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, 'utf-8');
  if (verHeader && !readme.includes('v' + verHeader)) fail('README 版本历史缺少 v' + verHeader + ' 条目');
} else fail('README.md 不存在');

// 4) ROADMAP 当前版本已交付
if (fs.existsSync(roadmapPath)) {
  const roadmap = fs.readFileSync(roadmapPath, 'utf-8');
  if (verHeader) {
    const esc = verHeader.replace(/\./g, '\\.');
    const re = new RegExp('\\| \\*\\*v' + esc + '\\*\\*[^\\n]*');
    const curLine = roadmap.match(re);
    if (curLine && curLine[0].indexOf('[x]') === -1) fail('ROADMAP 当前版本 v' + verHeader + ' 未标记 [x] 已交付');
  }
} else fail('docs/ITERATION_ROADMAP.md 不存在');

if (failed) {
  console.error('发布前自检未通过，阻断发布。');
  process.exit(1);
}
console.log('自检通过：@version=' + verHeader + '，actions 齐全，README/ROADMAP 同步。');
process.exit(0);
