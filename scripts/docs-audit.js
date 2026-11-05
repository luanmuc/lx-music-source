#!/usr/bin/env node
/**
 * docs-audit.js — 文档一致性巡检（L4 定时兜底）
 *
 * 目的：Hook 管"当下提交"，本脚本管"历史欠账"——每日检查文档中
 * 与真实状态漂移的「确定性低风险项」（数字/版本串/URL），自动对齐；
 * 语义类项（章节内容）只报告不修改。
 *
 * 用法：
 *   node scripts/docs-audit.js            # 自动修复低风险项
 *   node scripts/docs-audit.js --dry-run  # 只报告，不修改
 *
 * 修复前打印 before → after，全部为从真实文件提取的值（可复核）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const report = [];
let fixed = 0;

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function write(p, s) { fs.writeFileSync(path.join(ROOT, p), s); }

function fix(p, oldStr, newStr, note) {
  const s = read(p);
  if (s.includes(newStr)) return; // 已对齐
  if (!s.includes(oldStr)) {
    report.push(`⚠️ [${p}] 期望 ${JSON.stringify(oldStr)} 未找到，跳过`);
    return;
  }
  if (DRY) {
    report.push(`🟡 [${p}] ${note}\n    ${JSON.stringify(oldStr)} → ${JSON.stringify(newStr)}`);
  } else {
    write(p, s.replace(oldStr, newStr));
    fixed++;
    report.push(`✅ [${p}] ${note}\n    ${JSON.stringify(oldStr)} → ${JSON.stringify(newStr)}`);
  }
}

// ── 规则 1：冒烟用例数 ↔ AGENTS.md ─────────────────────────────────────
function ruleSmokeCount() {
  const test = read('test/lx-source-smoke-test.js');
  const count = (test.match(/console\.log\('\[T\d+\]/g) || []).length;
  const agents = read('docs/AGENTS.md');
  const m = agents.match(/(\d+) 组用例/);
  if (m && Number(m[1]) !== count) {
    fix('docs/AGENTS.md', `${m[1]} 组用例`, `${count} 组用例`, `冒烟用例数 ${m[1]}→${count}`);
  }
}

// ── 规则 2：lx-source.js @version ↔ README 当前版本行 ───────────────────
function ruleVersion() {
  const src = read('lx-source.js');
  const m = src.match(/@version\s+([\d.]+)/);
  if (!m) { report.push('⚠️ lx-source.js 未找到 @version'); return; }
  const v = m[1];
  const readme = read('README.md');
  // 注意：README「当前版本」行是工具层版本（v8.1），lx-source.js @version 是音源层大版本（8.0），
  // 两条独立版本链——只对齐 README 行内「lx-source.js 内 @version X」子串标注。
  const m2 = readme.match(/lx-source\.js\u201d 内 \u201c?@version ([\d.]+)/) || readme.match(/@version ([\d.]+)\u201d/);
  if (m2 && m2[1] !== v) {
    fix('README.md', `@version ${m2[1]}`, `@version ${v}`, `README 内 @version 子串标注 ${m2[1]}→${v}`);
  }
}

// ── 规则 3：pdone 对照仓库名（防 URL 漂移回旧名）──────────────────────
function rulePdoneUrl() {
  const agents = read('docs/AGENTS.md');
  if (agents.includes('github.com/pdone/backend-api')) {
    fix('docs/AGENTS.md',
      'https://github.com/pdone/backend-api',
      'https://github.com/pdone/lx-music-source',
      'pdone 仓库 URL 回退旧名');
  }
}

// ── 规则 4：健康表更新时间戳新鲜度（报告项）────────────────────────────
function ruleHealthFresh() {
  const h = read('README_HEALTH.md');
  const m = h.match(/更新于 ([\dT:.\-]+Z)/);
  if (m) {
    const ageH = (Date.now() - new Date(m[1]).getTime()) / 3600000;
    if (ageH > 28) report.push(`🔴 README_HEALTH 已 ${ageH.toFixed(0)}h 未更新（probe 未跑？）`);
    else report.push(`🟢 README_HEALTH 最近更新 ${ageH.toFixed(0)}h 前`);
  }
}

// ── 规则 5：candidate-status 是否今日生成（报告项）─────────────────────
function ruleCandidateFresh() {
  try {
    const c = read('docs/candidate-status.md');
    const m = c.match(/自动生成 · ([\dT:.\-]+Z)/);
    if (m) {
      const ageH = (Date.now() - new Date(m[1]).getTime()) / 3600000;
      if (ageH > 28) report.push(`🔴 candidate-status 已 ${ageH.toFixed(0)}h 未更新（recheck 未跑？）`);
      else report.push(`🟢 candidate-status 最近更新 ${ageH.toFixed(0)}h 前`);
    }
  } catch (_) {
    report.push('🔴 docs/candidate-status.md 不存在（recheck-candidates 未跑过）');
  }
}

// ── 执行 ────────────────────────────────────────────────────────────────
ruleSmokeCount();
ruleVersion();
rulePdoneUrl();
ruleHealthFresh();
ruleCandidateFresh();

console.log(`\n[L4 文档巡检] ${DRY ? 'DRY-RUN（不修改）' : '自动修复'} — ${new Date().toISOString().slice(0, 10)}\n`);
for (const r of report) console.log(r);
console.log(`\n汇总：${DRY ? '待处理' : '已修复'} ${fixed} 项 · 报告 ${report.length - fixed} 项\n`);
process.exit(0);  // 恒成功：修复/报告已落盘，workflow 以 git diff 判断是否有提交
