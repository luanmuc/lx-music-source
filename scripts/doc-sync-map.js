#!/usr/bin/env node
/**
 * doc-sync-map.js — 改动文件 → 必同步文档清单
 *
 * 用途（配合 scripts/hooks/ 下的 git hook，commit 时自动运行）：
 *   - 默认模式：列出本次暂存改动触发的「必同步文档清单」，账号照单在同提交内更新；
 *   - --check 模式：若本次改动含「硬触发文件」（改代码必更文档）但提交中不含任何文档更新，
 *     打印红色警告并返回非 0（拒绝提交，可用 --no-verify 绕过）。
 *
 * 规则表新增映射时，在此文件 RULES 中加一行即可（活文档原则）。
 */
'use strict';

const { execSync } = require('child_process');

// ── 规则表：路径模式（子串匹配） → 必同步文档/动作（数组）──────────────────
// 顺序优先：先匹配到即命中（不会叠加多条同文件规则，但会累计不同文件触发的文档）。
// 数组元素格式：'docs:路径' 或 'action:描述'（跨仓库/动作类提示）。
const RULES = [
  // 唯一权威产物：改音源必须同步三份主文档
  { match: 'lx-source.js', docs: [
    'docs:README.md（当前版本行 + 版本历史表）',
    'docs:docs/DEV_GUIDE.md（实测状态表 / 缺陷表 / 相应小节）',
    'docs:docs/ITERATION_ROADMAP.md（该版本 [ ]→[x]，候选顺延）',
    'docs:docs/AGENTS.md（命令段如有涉及）',
    'action:若涉及 actions/健康分/字段/音质能力变更 → 跨仓库：mobile 侧需按 docs/SYNC_POINTS.md 核对 userApi / Health.tsx / lang 三语言 / MUSIC_SOURCE_GUIDE',
  ]},
  // 测试用例：补用例需同步测试覆盖说明
  { match: 'test/', docs: [
    'docs:docs/DEV_GUIDE.md（D 系列测试覆盖说明，如用例数变化）',
  ]},
  // 工程脚本：改脚本需同步命令段与版本历史
  { match: 'scripts/', docs: [
    'docs:docs/AGENTS.md（命令段）',
    'docs:README.md（版本历史行，如脚本行为变化）',
  ]},
  // 版本信息头（发布类提交）：三向同步
  { match: '@version', docs: [
    'docs:README.md（当前版本行）',
    'docs:docs/ITERATION_ROADMAP.md（状态）',
  ]},
];

// ── 硬触发：这些文件被改、而提交不含任何 docs/README 更新 → --check 拒绝 ──
const HARD_TRIGGER = [
  'lx-source.js',        // 音源代码
  'test/',               // 测试
  'scripts/',            // 工程脚本（排除本脚本自身所在 hooks 安装提交，见下）
];
const HARD_TRIGGER_EXCLUDE = ['scripts/hooks/', 'scripts/doc-sync-map.js', 'scripts/install-hooks.sh', 'scripts/docs-audit.js'];

// ── 实现 ────────────────────────────────────────────────────────────────
function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function hasDocUpdate(files) {
  return files.some(f => f.startsWith('docs/') || f === 'README.md' || f.startsWith('README_'));
}

function main() {
  const checkMode = process.argv.includes('--check');
  const files = getStagedFiles();
  if (files.length === 0) {
    console.log('doc-sync-map: 无暂存改动。');
    return 0;
  }

  // 1) 收集本次改动触发的文档清单
  const triggered = new Set();
  for (const f of files) {
    for (const rule of RULES) {
      if (f.includes(rule.match)) {
        for (const d of rule.docs) triggered.add(d);
      }
    }
  }

  // 2) --check：硬触发校验（安装类提交排除）
  if (checkMode) {
    const hard = files.filter(f =>
      HARD_TRIGGER.some(m => f.includes(m)) &&
      !HARD_TRIGGER_EXCLUDE.some(x => f.includes(x))
    );
    if (hard.length > 0 && !hasDocUpdate(files)) {
      console.error('\n\x1b[31m⚠️ [doc-sync] 本次改动包含代码/脚本，但未包含任何文档更新：\x1b[0m');
      for (const f of hard) console.error(`   - ${f}`);
      console.error('   → 请按上文清单在同提交内更新对应文档（README / docs/*）。');
      console.error('   → 确认无需文档时可 `git commit --no-verify` 绕过。\n');
      return 1;
    }
  }

  // 3) 打印清单
  console.log('\n\x1b[36m📋 [doc-sync] 本次改动触发的「必同步文档」清单：\x1b[0m');
  if (triggered.size === 0) {
    console.log('   （无——本次改动不涉及需同步的文档）');
  } else {
    for (const d of triggered) console.log(`   • ${d}`);
  }
  console.log('');
  return 0;
}

process.exit(main());
