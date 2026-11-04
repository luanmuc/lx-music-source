#!/usr/bin/env node
/**
 * v8.0 自动健康日报：读取 probe-history.jsonl，按端点聚合近 7 日成功率/均时，
 * 连续 3 天真故障率超阈值的源生成"摘除建议"，输出 Markdown 日报到 docs/health-daily/。
 *
 * 用法：node scripts/health-daily.js [--date YYYY-MM-DD] [--out docs/health-daily/YYYY-MM-DD.md]
 * 每日 CI 定时跑，或手动执行。
 */
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'docs', 'probe-history.jsonl');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'health-daily');

// 端点 → 源名称映射（前缀匹配，与 lx-source.js SOURCE_HANDLERS 对应）
const ENDPOINT_MAP = [
  ['https://music-api.gdstudio.xyz/api.php', 'gdWy (GD Studio 网易)'],
  ['http://antiserver.kuwo.cn/anti.s', 'kuwoOfficial (酷我官方直连)'],
  ['http://nmobi.kuwo.cn/mobi.s', 'helloworldKw (helloworld kw)'],
  ['http://search.kuwo.cn/r.s', 'kuwoSearch (酷我搜索)'],
  ['https://musicserver.haitangw.cc/v1/music/resolve-url', 'helloworldHtw (haitangw v1)'],
  ['https://oiapi.net/api/Kuwo', 'suyinKuwo (溯音酷我)'],
  ['https://oiapi.net/api/Music_163', 'suyin163 (溯音163)'],
  ['https://oiapi.net/api/QQ_Music', 'suyinQQ (溯音QQ)'],
  ['https://api.xcvts.cn/api/music/migu', 'suyinMigu (溯音咪咕)'],
  ['https://yy.zddyr.top/lx/api/', 'xinghaiBackend (星海后端)'],
  ['https://music-dl.sayqz.com/api/', 'xinghaiBackup (星海备)'],
  ['https://api.music.lerd.dpdns.org', 'juheKw/juheTx/juheWy/juheKg/juheMg (Juhe 聚合)'],
  ['https://api.lingchuan.com/v1', 'lingchuan (聆川)'],
  ['https://lxmusicapi.onrender.com', 'huibq (Huibq)'],
  ['https://api.ikunshare.com', 'ikun (ikun)'],
  ['https://music.163.com/api/song/detail', 'wyDetail (网易 detail)'],
  ['https://music.163.com/api/song/lyric', 'wyLyric (网易歌词)'],
  ['https://img2.kuwo.cn/', 'kwPic (酷我封面模板)'],
  ['https://github.com/luanmuc/backend-api/releases', 'githubReleases (GitHub Release)'],
];

function mapEndpointName(url) {
  for (const [prefix, name] of ENDPOINT_MAP) {
    if (url.startsWith(prefix)) return name;
  }
  return url.slice(0, 50);
}

const FAIL_RATE_THRESHOLD = 0.5; // 真故障率超 50% 触发摘除建议
const CONSECUTIVE_FAIL_DAYS = 3; // 连续 3 天

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  return fs.readFileSync(HISTORY_PATH, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function aggregate(entries, days = 7) {
  // 按 url 分组
  const byUrl = {};
  for (const e of entries) {
    if (!byUrl[e.url]) byUrl[e.url] = [];
    byUrl[e.url].push(e);
  }
  // 取最近 N 天的日期集合
  const allDates = [...new Set(entries.map(e => e.date))].sort();
  const recentDates = allDates.slice(-days);
  const recentSet = new Set(recentDates);

  const results = [];
  for (const [url, recs] of Object.entries(byUrl)) {
    const recent = recs.filter(r => recentSet.has(r.date))
      .sort((a, b) => a.date.localeCompare(b.date)); // 按日期升序，确保取最新
    if (!recent.length) continue;
    const total = recent.length;
    const success = recent.filter(r => r.ok).length;
    const fail = total - success;
    const rate = total ? (success / total * 100).toFixed(1) : '0.0';
    const avgTime = recent.length
      ? Math.round(recent.reduce((s, r) => s + (r.time || 0), 0) / recent.length)
      : 0;
    // 连续失败天数（从最新一天往前数）
    const byDate = {};
    for (const r of recent) {
      if (!byDate[r.date]) byDate[r.date] = { ok: 0, fail: 0 };
      if (r.ok) byDate[r.date].ok++; else byDate[r.date].fail++;
    }
    const datesSorted = Object.keys(byDate).sort();
    let consecutiveFail = 0;
    for (let i = datesSorted.length - 1; i >= 0; i--) {
      const d = byDate[datesSorted[i]];
      if (d.ok === 0) consecutiveFail++;
      else break;
    }
    // 摘除建议：连续 N 天全失败 或 近 N 天真故障率超阈值
    const failRate = total ? fail / total : 0;
    const shouldFlag = consecutiveFail >= CONSECUTIVE_FAIL_DAYS || failRate > FAIL_RATE_THRESHOLD;
    results.push({
      url,
      name: mapEndpointName(url),
      total, success, fail,
      rate: parseFloat(rate),
      avgTime,
      consecutiveFail,
      failRate: parseFloat((failRate * 100).toFixed(1)),
      shouldFlag,
      latestStatus: recent[recent.length - 1]?.ok ? '✅' : '❌',
    });
  }
  return { results, recentDates };
}

function renderReport({ results, recentDates }, targetDate) {
  const lines = [];
  lines.push(`# 健康日报 ${targetDate}`);
  lines.push('');
  lines.push(`> 统计窗口：近 ${recentDates.length} 天（${recentDates[0]} ~ ${recentDates[recentDates.length - 1]}）`);
  lines.push(`> 生成脚本：\`scripts/health-daily.js\`（v8.0）`);
  lines.push(`> 数据口径：probe-history.jsonl 记录的是端点 GET 探测结果，**不等于实际取链行为**（部分源取链为 POST 带参数）；摘除建议为参考，最终以 L2 实测为准。`);
  lines.push('');
  lines.push('## 端点状态总览');
  lines.push('');
  lines.push('| 端点 | 名称 | 样本 | 成功率 | 均时 | 连续失败 | 最新状态 |');
  lines.push('|---|---|---|---|---|---|---|');
  // 按成功率升序（差的在前）
  results.sort((a, b) => a.rate - b.rate);
  for (const r of results) {
    const flag = r.shouldFlag ? ' ⚠️' : '';
    lines.push(`| \`${r.url.slice(0, 40)}\` | ${r.name}${flag} | ${r.total} | ${r.rate}% | ${r.avgTime}ms | ${r.consecutiveFail}天 | ${r.latestStatus} |`);
  }
  lines.push('');
  // 摘除建议
  const flagged = results.filter(r => r.shouldFlag);
  if (flagged.length) {
    lines.push('## ⚠️ 摘除建议');
    lines.push('');
    lines.push('以下端点近窗口真故障率超阈值或连续多天失败，建议评估关闭/摘除：');
    lines.push('');
    for (const r of flagged) {
      const reason = r.consecutiveFail >= CONSECUTIVE_FAIL_DAYS
        ? `连续 ${r.consecutiveFail} 天全失败`
        : `近 ${r.total} 次成功率仅 ${r.rate}%`;
      lines.push(`- **${r.name}**（\`${r.url.slice(0, 50)}\`）：${reason}，均时 ${r.avgTime}ms`);
    }
  } else {
    lines.push('## ✅ 无需摘除');
    lines.push('');
    lines.push('所有端点近窗口成功率正常，无摘除建议。');
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const outIdx = args.indexOf('--out');
  const targetDate = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);
  const outPath = outIdx >= 0 ? args[outIdx + 1]
    : path.join(OUT_DIR, `${targetDate}.md`);

  const entries = loadHistory();
  if (!entries.length) {
    console.error('probe-history.jsonl 无数据');
    process.exit(1);
  }
  const { results, recentDates } = aggregate(entries);
  const report = renderReport({ results, recentDates }, targetDate);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, report);
  console.log(`✅ 日报已生成: ${outPath}`);
  console.log(`   ${results.length} 个端点，${results.filter(r => r.shouldFlag).length} 个建议摘除`);

  // v8.0：90 天滚动清理——只保留近 90 天日报，防止文件无限堆积
  const RETENTION_DAYS = 90;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5);
  const oldFiles = fs.readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.md') && f !== path.basename(outPath))
    .filter(f => {
      const d = new Date(f.replace('.md', ''));
      return !isNaN(d) && d < cutoff;
    });
  for (const f of oldFiles) {
    fs.unlinkSync(path.join(OUT_DIR, f));
  }
  if (oldFiles.length) console.log(`   清理 ${oldFiles.length} 个 ${RETENTION_DAYS} 天前旧日报`);
}

main();
