#!/usr/bin/env node
/**
 * recheck-candidates.js — 判否候选恢复探测（触发式待办自动监控）
 *
 * 探测已判否候选的关键通道，若恢复则提示可重评（触发式待办 → 主动发现）：
 *   - hyw    ：后端 `103.79.184.97` 全端点曾 nginx 502（2026-10-30 判否）
 *   - huanyin：music-dl.sayqz.com DNS 曾不可解析 + api.xcvts.cn 咪咕业务 502（2026-11-05 判否）
 *
 * 输出：终端报告 + 自动更新 docs/candidate-status.md（CI 提交回 master，
 * 恢复时状态文件变化即通知各账号可重评）。
 *
 * 用法：node scripts/recheck-candidates.js
 * 兼容 Node 18+（无第三方依赖，仅内置 dns/https/fetch）。
 */
'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');

// ── 候选探测表 ───────────────────────────────────────────────────────────
const CANDIDATES = [
  {
    name: 'hyw（HYWmusic v1.2.0）',
    judge: '2026-10-30 判否：后端 103.79.184.97 全端点 http/https 均 nginx 502（脚本本身协议规范、未混淆、10 平台上报）',
    checks: [
      { label: '后端 http 103.79.184.97', type: 'http', url: 'http://103.79.184.97/' },
      { label: '后端 https 103.79.184.97', type: 'http', url: 'https://103.79.184.97/' },
    ],
  },
  {
    name: 'huanyin（幻音 v3）',
    judge: '2026-11-05 判否：music-dl.sayqz.com DNS 不可解析（域名失效）+ api.xcvts.cn 咪咕 502（IP 被限），双通道失效',
    checks: [
      { label: 'DNS music-dl.sayqz.com', type: 'dns', host: 'music-dl.sayqz.com' },
      { label: '业务 api.xcvts.cn 咪咕', type: 'http', url: 'https://api.xcvts.cn/api/music/migu?keyword=test&page=1&pageSize=1' },
    ],
  },
];

// ── 探测实现 ────────────────────────────────────────────────────────────
const TIMEOUT_MS = 10000;

async function checkHttp(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'lx-source-recheck/1.0' } });
    clearTimeout(timer);
    const text = await resp.text().catch(() => '');
    let bizCode = null;
    try {
      const j = JSON.parse(text);
      bizCode = j && typeof j === 'object' && 'code' in j ? j.code : null;
    } catch (_) { /* 非 JSON（如 HTML/纯文本 502 页） */ }
    return { ok: true, status: resp.status, bizCode, sample: text.slice(0, 80).replace(/\n/g, ' ') };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '超时' : (e.cause?.code || e.message || String(e)) };
  }
}

async function checkDns(host) {
  try {
    const addrs = await dns.resolve4(host);
    return { ok: true, addresses: addrs };
  } catch (e) {
    return { ok: false, error: e.code || String(e) };
  }
}

async function runCheck(c) {
  const r = await (c.type === 'dns' ? checkDns(c.host) : checkHttp(c.url));
  return { ...c, result: r };
}

// 判定单候选状态：'recovered'（可重评）| 'review'（需人工核查）| 'dead'（仍失效）
function candidateState(checks) {
  // 域名恢复（huanyin）：DNS 可解析 → 重评信号
  if (checks.some(c => c.type === 'dns' && c.result.ok)) return 'recovered';
  // 业务通道：成功结构（code 0/200 且含数据）→ 恢复；502 → 仍被限；400 → 疑似协议/参数变更
  let sawBiz = false;
  for (const c of checks) {
    if (c.result.ok && c.result.bizCode !== null && c.result.bizCode !== undefined) {
      sawBiz = true;
      if (c.result.bizCode === 0 || c.result.bizCode === 200) return 'recovered';
    }
  }
  if (sawBiz && checks.some(c => c.result.ok && c.result.bizCode === 400)) return 'review';
  // http 通道（hyw）：非 502 且非连接错误 → 恢复
  for (const c of checks) {
    if (c.result.ok && typeof c.result.status === 'number') {
      if (c.result.status !== 502) return 'recovered';
    }
  }
  return 'dead';
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const lines = [];
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  console.log(`候选恢复探测（${stamp}）\n`);

  for (const cand of CANDIDATES) {
    console.log(`◆ ${cand.name}`);
    console.log(`  判否依据：${cand.judge}`);
    const results = [];
    for (const c of cand.checks) {
      const r = await runCheck(c);
      const rStr = r.type === 'dns'
        ? (r.result.ok ? `✅ 可解析 ${r.result.addresses.join(',')}` : `❌ ${r.result.error}`)
        : (r.result.ok ? `HTTP ${r.result.status}` + (r.result.bizCode !== null ? ` · 业务码 ${r.result.bizCode}` : '') : `❌ ${r.result.error}`);
      console.log(`  - ${r.label}: ${rStr}`);
      results.push(r);
    }
    const st = candidateState(results);
    const verdict = st === 'recovered' ? '🟢 已恢复 —— 可启动重评（候选实证流程）'
      : st === 'review' ? '🟡 需人工核查 —— 接口有响应但参数/协议疑变更，建议重评'
      : '🔴 仍失效 —— 继续等待';
    console.log(`  ➜ ${verdict}\n`);
    const stLabel = st === 'recovered' ? '🟢 已恢复-可重评' : st === 'review' ? '🟡 需人工核查' : '🔴 仍失效';
    lines.push(`| ${cand.name} | ${stLabel} | ${cand.checks.map(c => {
      const r = results.find(x => x.label === c.label);
      return r.type === 'dns'
        ? (r.result.ok ? `${c.label}=可解析` : `${c.label}=${r.result.error}`)
        : `${c.label}=${r.result.ok ? 'HTTP ' + r.result.status + (r.result.bizCode !== null ? '/' + r.result.bizCode : '') : r.result.error}`;
    }).join('；')} |`);
  }

  // 写状态文件
  const out = path.join(__dirname, '..', 'docs', 'candidate-status.md');
  const md = [
    '# 判否候选恢复状态（自动探测）',
    '',
    `> 由 \`scripts/recheck-candidates.js\` 自动生成 · ${stamp} · 探测到「已恢复」即提示启动候选实证重评流程（判否记录见 DEV_GUIDE）。`,
    '',
    '| 候选 | 状态 | 探测证据 |',
    '|---|---|---|',
    ...lines,
    '',
  ].join('\n');
  fs.writeFileSync(out, md);
  console.log(`\n状态已写入 docs/candidate-status.md`);
}

main().catch(e => { console.error(e); process.exit(1); });
