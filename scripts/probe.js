#!/usr/bin/env node
/**
 * lx-source.js 端点巡检（v16.0：多日成功率统计）
 * 用法：
 *   node scripts/probe.js              # 探测全部端点，输出 README 可用性表（健康表）
 *   node scripts/probe.js --json       # 输出机器可读 JSON（供 CI 写回/告警）
 *   node scripts/probe.js --quick      # 快速模式：只测 HEAD/状态码，不做 Range 可播校验
 *
 * 判定规则（与音源内部一致）：
 *   - HTTP 2xx/3xx + 音频 content-type 或 Range 206 → 可用
 *   - 连续两次失败才判失效（CI 每日跑，单次探测失败仅记录）
 * 输出：README_HEALTH.md 覆盖写（含近7日成功率）/ 历史记录 docs/probe-history.jsonl 追加 / stdout JSON
 * v16.0：每次巡检结果追加到 docs/probe-history.jsonl，按 URL 聚合近 7 日成功率写入健康表
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SRC = path.join(__dirname, '..', 'lx-source.js');
const OUT = path.join(__dirname, '..', 'README_HEALTH.md');
const HIST_DIR = path.join(__dirname, '..', 'docs');
const HIST_FILE = path.join(HIST_DIR, 'probe-history.jsonl');
const HISTORY_DAYS = 7; // v16.0：近 7 日成功率窗口

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const quick = args.includes('--quick');

// v16.0：追加本次巡检结果到历史记录（CI 每日跑，历史随 commit 保留）
function appendHistory(results) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = results.map(r => JSON.stringify({ date, url: r.url, ok: r.ok, status: r.status, time: r.time, reason: r.reason }));
  if (!fs.existsSync(HIST_DIR)) fs.mkdirSync(HIST_DIR, { recursive: true });
  fs.appendFileSync(HIST_FILE, lines.join('\n') + '\n');
  return date;
}

// v16.0：按 URL 聚合近 HISTORY_DAYS 日成功率（每天取最后一次结果）
function aggregateHistory() {
  if (!fs.existsSync(HIST_FILE)) return {};
  const cutoffMs = Date.now() - HISTORY_DAYS * 864e5;
  const byUrl = {}; // url -> { date: ok }
  for (const line of fs.readFileSync(HIST_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    const t = Date.parse(r.date + 'T00:00:00Z');
    if (!t || t < cutoffMs) continue;
    const u = r.url;
    byUrl[u] = byUrl[u] || {};
    byUrl[u][r.date] = !!r.ok; // 同日多次取最后一次
  }
  const stats = {};
  for (const [url, days] of Object.entries(byUrl)) {
    const dates = Object.keys(days).sort();
    let ok = 0, fail = 0;
    for (const d of dates) { if (days[d]) ok++; else fail++; }
    // 连续失败天数：从最新一天往前数连续失败
    let streak = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (days[dates[i]]) break;
      streak++;
    }
    stats[url] = { days: dates.length, ok, fail, streak, rate: dates.length ? (ok / dates.length) : 1 };
  }
  return stats;
}

// v16.1：死源建议阈值——连续失败天数 ≥ 该值即建议关闭（写回健康表留档，供迭代时摘除）
const DEAD_STREAK_THRESHOLD = 3;
function collectDeadSources(hist, results) {
  const dead = [];
  const urlByResult = new Map(results.map(r => [r.url, r]));
  for (const [url, h] of Object.entries(hist)) {
    if (h.streak >= DEAD_STREAK_THRESHOLD) {
      const cur = urlByResult.get(url);
      dead.push({ url, streak: h.streak, rate: h.rate, currentOk: cur ? cur.ok : false, reason: cur ? cur.reason : '历史连续失败' });
    }
  }
  return dead.sort((a, b) => b.streak - a.streak);
}

// ---- 静态提取端点（与 lx-source.js 常量区一致的正则）----
function extractEndpoints(src) {
  const urls = new Set();
  const re = /https?:\/\/[^\s"'`\\)\]]+/g;
  let m;
  while ((m = re.exec(src))) {
    const u = m[0].replace(/[;:,]$/, '');
    if (u.includes('{id}') || u.includes('{level}')) continue; // 模板 URL 跳过（无真实参数无法探测）
    urls.add(u);
  }
  // 过滤明显非 API 的示例/文档 URL（v26.4 S5：旧正则末尾悬空 `|` 空分支使正则恒真、过滤形同虚设，已修正）
  return [...urls].filter(u => /api|music|search|antiserver|outer|\.js$|\.php/i.test(u) && !u.includes('${'));
}

// ---- 单端点探测（GET + Range 0-1023，2s 超时）----
function probeUrl(url, timeoutMs = 4000) {
  return new Promise(resolve => {
    let lib;
    try { lib = new URL(url).protocol === 'https:' ? https : http; }
    catch (e) { return resolve({ url, ok: false, status: 0, time: 0, reason: 'INVALID_URL' }); }
    const start = Date.now();
    const req = lib.get(url, { headers: { 'User-Agent': 'lx-source-probe/1.0', 'Range': 'bytes=0-1023' }, timeout: timeoutMs }, res => {
      const status = res.statusCode || 0;
      const ct = String(res.headers['content-type'] || '');
      res.resume();
      const ok = quick
        ? (status >= 200 && status < 500)
        : (status === 206 || (status >= 200 && status < 400)); // API 端点 2xx/3xx 即可用；音频 206/200 亦可用
      resolve({ url, ok, status, time: Date.now() - start, reason: ok ? 'OK' : `HTTP ${status}` });
    });
    req.on('timeout', () => { req.destroy(); resolve({ url, ok: false, status: 0, time: Date.now() - start, reason: 'TIMEOUT' }); });
    req.on('error', e => resolve({ url, ok: false, status: 0, time: Date.now() - start, reason: e.code || 'ERR' }));
  });
}

(async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const endpoints = extractEndpoints(src);
  if (!endpoints.length) { console.error('未提取到端点'); process.exit(1); }

  const results = await Promise.all(endpoints.map(u => probeUrl(u)));
  const okCount = results.filter(r => r.ok).length;

  if (asJson) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), total: results.length, ok: okCount, results }, null, 2));
    process.exit(okCount === results.length ? 0 : 2);
  }

  // 健康表写回 README_HEALTH.md（CI 每日刷新；v13.1 写回目标，README 引用它）
  // v16.0：追加本次结果到历史 + 近7日成功率列
  const today = appendHistory(results);
  const hist = aggregateHistory();
  const dead = collectDeadSources(hist, results);
  const lines = [];
  lines.push('# 端点健康表（自动巡检）');
  lines.push('');
  lines.push(`> 由 \`scripts/probe.js\` 自动生成 · 更新于 ${new Date().toISOString()} · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）`);
  lines.push('');
  lines.push(`共提取 ${results.length} 个端点，可用 ${okCount} 个；近 ${HISTORY_DAYS} 日成功率基于 \`docs/probe-history.jsonl\` 历史（${today} 追加）。`);
  lines.push('');
  lines.push('| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const tag = r.ok ? '✅ 可用' : '❌ 失败';
    const reason = r.reason.length > 40 ? r.reason.slice(0, 40) + '…' : r.reason;
    const h = hist[r.url];
    const rateCell = h ? `${Math.round(h.rate * 100)}% (${h.ok}/${h.days}天)` : '—';
    lines.push(`| \`${r.url.slice(0, 70)}${r.url.length > 70 ? '…' : ''}\` | ${tag} | ${r.status || '-'} | ${r.time} | ${rateCell} | ${reason} |`);
  }
  // v16.1：死源建议——连续 DEAD_STREAK_THRESHOLD 天以上失败的端点，建议关闭留档
  if (dead.length) {
    lines.push('');
    lines.push(`## ⚠️ 死源建议（连续 ${DEAD_STREAK_THRESHOLD} 天以上失败，供迭代时摘除/留档）`);
    lines.push('');
    for (const d of dead) {
      lines.push(`- \`${d.url}\`：连续 ${d.streak} 天失败（近7日成功率 ${Math.round(d.rate * 100)}%），当前${d.currentOk ? '恢复可用' : '仍失败'}${d.reason ? ` · ${d.reason}` : ''}`);
    }
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`已写回 ${OUT}：${okCount}/${results.length} 可用，历史 ${today} 已追加`);
  if (okCount < results.length) { console.log('存在失败端点，详见健康表'); process.exit(2); }
})();
