#!/usr/bin/env node
/**
 * lx-source.js 端点巡检（v4.0：多日成功率统计）
 * 用法：
 *   node scripts/probe.js              # 探测全部端点，输出 README 可用性表（健康表）
 *   node scripts/probe.js --json       # 输出机器可读 JSON（供 CI 写回/告警）
 *   node scripts/probe.js --quick      # 快速模式：只测 HEAD/状态码，不做 Range 可播校验
 *
 * 判定规则（与音源内部一致）：
 *   - HTTP 2xx/3xx + 音频 content-type 或 Range 206 → 可用
 *   - 连续两次失败才判失效（CI 每日跑，单次探测失败仅记录）
 * 输出：README_HEALTH.md 覆盖写（含近7日成功率）/ 历史记录 docs/probe-history.jsonl 追加 / stdout JSON
 * v4.0：每次巡检结果追加到 docs/probe-history.jsonl，按 URL 聚合近 7 日成功率写入健康表
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SRC = path.join(__dirname, '..', 'lx-source.js');
const OUT = path.join(__dirname, '..', 'README_HEALTH.md');
const HIST_DIR = path.join(__dirname, '..', 'docs');
const HIST_FILE = path.join(HIST_DIR, 'probe-history.jsonl');
const HISTORY_DAYS = 7; // v4.0：近 7 日成功率窗口
const CONCURRENCY = 5; // v29.6：并发池——同时最多 5 个请求，避免被风控封 IP
const DEAD_STREAK_THRESHOLD = 3; // v16.1：连续失败天数阈值
const UA_POOL = [ // v29.6：UA 池轮换，降低被风控概率
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'lx-source-probe/1.0',
];

// v29.5：平台映射表——用于自动生成 README.md 的"音源可用性"表格
// 每个平台关联一组端点关键词（匹配 URL 子串），自动汇总状态
const PLATFORM_MAP = [
  {
    name: '网易云 wy',
    qualities: '128k / 320k / flac',
    mainSources: '溯音163 / wyOuter / gdWy',
    endpointKeys: ['oiapi.net/api/Music_163', 'music.163.com/api/song/lyric', 'music.163.com/api/song/detail', 'gdstudio.xyz'],
  },
  {
    name: '酷我 kw',
    qualities: '128k / 320k / flac',
    mainSources: '溯音酷我 + 星海后端（双源 v12.0）',
    endpointKeys: ['oiapi.net/api/Kuwo', 'zddyr.top', 'search.kuwo.cn', 'antiserver.kuwo.cn', 'nmobi.kuwo.cn'],
  },
  {
    name: 'QQ tx',
    qualities: '128k（走溯音酷我兜底）',
    mainSources: '溯音QQ 关闭',
    endpointKeys: ['oiapi.net/api/QQ_Music'],
  },
  {
    name: '酷狗 kg',
    qualities: '128k（走溯音酷我兜底）',
    mainSources: '—',
    endpointKeys: [], // 无独立源，走 kw 兜底
  },
  {
    name: '咪咕 mg',
    qualities: '128k（走溯音酷我兜底）',
    mainSources: '溯音咪咕关闭',
    endpointKeys: ['api.xcvts.cn/api/music/migu'],
  },
];

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const quick = args.includes('--quick');

// v4.0：追加本次巡检结果到历史记录（CI 每日跑，历史随 commit 保留）
// v8.0：30 天滚动清理——只保留近 30 天数据，防止文件无限增长
const HISTORY_RETENTION_DAYS = 30;
function appendHistory(results) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = results.map(r => JSON.stringify({ date, url: r.url, ok: r.ok, status: r.status, time: r.time, reason: r.reason }));
  if (!fs.existsSync(HIST_DIR)) fs.mkdirSync(HIST_DIR, { recursive: true });
  fs.appendFileSync(HIST_FILE, lines.join('\n') + '\n');
  // v8.0：清理 30 天前的旧数据
  const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 864e5).toISOString().slice(0, 10);
  const allLines = fs.readFileSync(HIST_FILE, 'utf8').split('\n').filter(l => l.trim());
  const kept = [];
  for (const line of allLines) {
    try {
      const r = JSON.parse(line);
      if (r.date >= cutoff) kept.push(line);
    } catch (e) { kept.push(line); } // 解析失败的行保留（防丢数据）
  }
  if (kept.length < allLines.length) {
    fs.writeFileSync(HIST_FILE, kept.join('\n') + '\n');
    console.log(`历史清理：${allLines.length} 行 → ${kept.length} 行（删除 ${allLines.length - kept.length} 行 ${HISTORY_RETENTION_DAYS} 天前旧数据）`);
  }
  return date;
}

// v4.0：按 URL 聚合近 HISTORY_DAYS 日成功率（每天取最后一次结果）
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
  // 过滤明显非 API 的示例/文档 URL（v27.3 S5：旧正则末尾悬空 `|` 空分支使正则恒真、过滤形同虚设，已修正；
  // 加 `kuwo` 关键词——正则白名单化后 nmobi.kuwo.cn/mobi.s(helloworldKw 主通道 convert_url_with_sign)
  // 不含 api/music/search 等关键词会被误过滤，导致新源主通道脱离端点巡检）
  return [...urls].filter(u => /api|music|search|antiserver|outer|kuwo|\.js$|\.php/i.test(u) && !u.includes('${'));
}

// v29.6：并发池——限制同时最多 N 个请求，避免被上游风控
async function poolRun(tasks, concurrency) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- 单端点探测（GET + Range 0-1023，4s 超时，失败重试 1 次）----
function probeUrl(url, timeoutMs = 4000, retry = true) {
  return new Promise(resolve => {
    let lib;
    try { lib = new URL(url).protocol === 'https:' ? https : http; }
    catch (e) { return resolve({ url, ok: false, status: 0, time: 0, reason: 'INVALID_URL' }); }
    const start = Date.now();
    const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
    const req = lib.get(url, { headers: { 'User-Agent': ua, 'Range': 'bytes=0-1023' }, timeout: timeoutMs }, res => {
      const status = res.statusCode || 0;
      res.resume();
      // v29.6：403/429 不算可用——被封/限流等于不能用
      const ok = quick
        ? (status >= 200 && status < 400) // quick 模式：2xx/3xx 可用，4xx/5xx 不可用
        : (status === 206 || (status >= 200 && status < 400));
      resolve({ url, ok, status, time: Date.now() - start, reason: ok ? 'OK' : `HTTP ${status}` });
    });
    req.on('timeout', () => {
      req.destroy();
      // v29.6：超时重试 1 次（减少网络抖动误判）
      if (retry) return resolve(probeUrl(url, timeoutMs, false));
      resolve({ url, ok: false, status: 0, time: Date.now() - start, reason: 'TIMEOUT' });
    });
    req.on('error', e => {
      // v29.6：网络错误重试 1 次
      if (retry && (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ENOTFOUND')) {
        return resolve(probeUrl(url, timeoutMs, false));
      }
      resolve({ url, ok: false, status: 0, time: Date.now() - start, reason: e.code || 'ERR' });
    });
  });
}

(async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const endpoints = extractEndpoints(src);
  if (!endpoints.length) { console.error('未提取到端点'); process.exit(1); }

  // v29.6：用并发池替代 Promise.all——限制同时最多 CONCURRENCY 个请求
  const results = await poolRun(endpoints.map(u => () => probeUrl(u)), CONCURRENCY);
  const okCount = results.filter(r => r.ok).length;

  if (asJson) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), total: results.length, ok: okCount, results }, null, 2));
    process.exit(okCount === results.length ? 0 : 2);
  }

  // 健康表写回 README_HEALTH.md（CI 每日刷新；v13.1 写回目标，README 引用它）
  // v4.0：追加本次结果到历史 + 近7日成功率列
  const today = appendHistory(results);
  const hist = aggregateHistory();
  const dead = collectDeadSources(hist, results);

  // v29.6：平台级健康汇总——按 PLATFORM_MAP 分组统计
  function platformSummary() {
    const lines = [];
    lines.push('### 平台健康汇总');
    lines.push('');
    for (const p of PLATFORM_MAP) {
      if (!p.endpointKeys.length) {
        lines.push(`- **${p.name}**：无独立源，走 kw 兜底`);
        continue;
      }
      const hits = p.endpointKeys.map(k => results.find(r => r.url.includes(k))).filter(Boolean);
      const okHits = hits.filter(r => r.ok);
      const emoji = okHits.length === hits.length ? '🟢' : okHits.length > 0 ? '🟡' : '🔴';
      lines.push(`- ${emoji} **${p.name}**：${okHits.length}/${hits.length} 端点可用`);
    }
    return lines.join('\n');
  }

  const lines = [];
  lines.push('# 端点健康表（自动巡检）');
  lines.push('');
  lines.push(`> 由 \`scripts/probe.js\` 自动生成 · 更新于 ${new Date().toISOString()} · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）`);
  lines.push('');
  lines.push(`共提取 ${results.length} 个端点，可用 ${okCount} 个；近 ${HISTORY_DAYS} 日成功率基于 \`docs/probe-history.jsonl\` 历史（${today} 追加）。`);
  lines.push('');
  lines.push(platformSummary());
  lines.push('');
  lines.push('| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    // v29.6：恢复标记——历史有失败但当前恢复了，加 🟡 "已恢复观察中"
    const h = hist[r.url];
    let tag = r.ok ? '✅ 可用' : '❌ 失败';
    if (r.ok && h && h.streak > 0) tag = '🟡 已恢复观察中';
    const reason = r.reason.length > 40 ? r.reason.slice(0, 40) + '…' : r.reason;
    const rateCell = h ? `${Math.round(h.rate * 100)}% (${h.ok}/${h.days}天)` : '—';
    lines.push(`| \`${r.url.slice(0, 70)}${r.url.length > 70 ? '…' : ''}\` | ${tag} | ${r.status || '-'} | ${r.time} | ${rateCell} | ${reason} |`);
  }
  // v16.1：死源建议——连续 DEAD_STREAK_THRESHOLD 天以上失败的端点，建议关闭留档
  if (dead.length) {
    lines.push('');
    lines.push(`## ⚠️ 死源建议（连续 ${DEAD_STREAK_THRESHOLD} 天以上失败，供迭代时摘除/留档）`);
    lines.push('');
    // v29.6：按平台分组——紧急（主路全挂）vs 次要（备用源挂）
    const urgent = [];
    const minor = [];
    for (const d of dead) {
      const platform = PLATFORM_MAP.find(p => p.endpointKeys.some(k => d.url.includes(k)));
      if (platform) {
        // 主路端点（第一个 key）失败算紧急，其他算次要
        if (d.url.includes(platform.endpointKeys[0])) urgent.push(d);
        else minor.push(d);
      } else {
        minor.push(d);
      }
    }
    if (urgent.length) {
      lines.push('### 🔴 紧急（主路端点连续失败）');
      lines.push('');
      for (const d of urgent) lines.push(`- \`${d.url}\`：连续 ${d.streak} 天失败（近7日成功率 ${Math.round(d.rate * 100)}%），当前${d.currentOk ? '恢复可用' : '仍失败'}${d.reason ? ` · ${d.reason}` : ''}`);
      lines.push('');
    }
    if (minor.length) {
      lines.push('### 🟡 次要（备用/边缘端点连续失败）');
      lines.push('');
      for (const d of minor) lines.push(`- \`${d.url}\`：连续 ${d.streak} 天失败（近7日成功率 ${Math.round(d.rate * 100)}%），当前${d.currentOk ? '恢复可用' : '仍失败'}${d.reason ? ` · ${d.reason}` : ''}`);
    }
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`已写回 ${OUT}：${okCount}/${results.length} 可用，历史 ${today} 已追加`);

  // v29.6：自动更新 README.md 里的"音源可用性"表格（日期 + 状态 + 原因标注）
  const README = path.join(__dirname, '..', 'README.md');
  const readmeContent = fs.readFileSync(README, 'utf8');
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // v29.6：原因标注——把 HTTP 状态码翻译成可读的原因
  function reasonLabel(status, reason) {
    if (status === 403) return '403 被封';
    if (status === 429) return '429 限流';
    if (reason === 'ENOTFOUND') return '域名失效';
    if (reason === 'TIMEOUT') return '超时不稳定';
    if (reason === 'OK') return '正常';
    return reason || '-';
  }

  // 根据巡检结果生成各平台的交叉验证列内容（按域名去重 + 原因标注）
  function buildCrossValidation(keys) {
    if (!keys.length) return '—（无独立源，走 kw 兜底）';
    const seen = new Set();
    const parts = [];
    for (const key of keys) {
      const hit = results.find(r => r.url.includes(key));
      if (hit) {
        const domain = new URL(hit.url).hostname;
        if (seen.has(domain)) continue; // 同一域名只显示一次
        seen.add(domain);
        const label = hit.ok ? '✅' : `❌ ${reasonLabel(hit.status, hit.reason)}`;
        parts.push(`${domain} ${label}`);
      }
    }
    return parts.join('；') || '—';
  }

  // 生成表格行
  const tableRows = PLATFORM_MAP.map(p =>
    `| ${p.name} | ${p.qualities} | ${p.mainSources} | ${buildCrossValidation(p.endpointKeys)} |`
  ).join('\n');

  // 替换 README.md 里的整段"音源可用性"表格（从标题到下一个 ## 之前）
  const updatedReadme = readmeContent.replace(
    /## 音源可用性（\d{4}-\d{2}-\d{2} 核验）[\s\S]*?(?=\n## )/,
    `## 音源可用性（${todayStr} 核验）

> 本表 = 本仓库实测基线 + 生态交叉验证；端点级实时健康状态见 [README_HEALTH.md](./README_HEALTH.md)（\`scripts/probe.js\` 每日自动刷新）。
> 口径：pdone 探测来自 CI 服务器 IP，与本仓库 IP 维度不同，分歧 ≠ 某一方错误（典型：溯音咪咕上游域名可用但本机 IP 被封）。

| 平台 | 可用音质 | 主路子源 | 交叉验证 |
|---|---|---|---|
${tableRows}

> 详细对照表、缺陷与**后续规划（v27 系列新候选实证接入 / v8.0 健康日报 / v29 App 配合项）**见 [DEV_GUIDE.md](./docs/DEV_GUIDE.md)。`
  );

  if (updatedReadme !== readmeContent) {
    fs.writeFileSync(README, updatedReadme);
    console.log(`已自动更新 README.md 音源可用性表格（日期 ${todayStr}）`);
  }

  // v29.6：退出码优化——只有"某平台主路全挂"才 exit(2)，单个备用源失败不退出
  // 避免每天 CI 都是红色的，用户麻木了反而忽略真正紧急的问题
  const allPlatformsDown = PLATFORM_MAP.every(p => {
    if (!p.endpointKeys.length) return false; // 没有独立源的平台跳过
    return p.endpointKeys.every(key => {
      const hit = results.find(r => r.url.includes(key));
      return hit && !hit.ok;
    });
  });
  if (allPlatformsDown) {
    console.log('❌ 所有平台主路都不可用——紧急！');
    process.exit(2);
  }
  if (okCount < results.length) {
    console.log(`⚠️ 有 ${results.length - okCount} 个端点失败（非全挂，不阻断 CI）`);
  }
})();
