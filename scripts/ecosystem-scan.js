#!/usr/bin/env node
/**
 * scripts/ecosystem-scan.js —— v26.3 生态扫描脚本化
 *
 * 例行生态扫描（原手动）：抓取 pdone/lx-music-source 每日 CI 健康表（health-status 分支 health-state.json），
 * 与本仓库 SOURCE_HANDLERS 交叉对比，自动产出：
 *   1) 共有源状态交叉（pdone 探测 vs 本仓库实测——IP 维度不同，分歧仅作参考）
 *   2) 新候选（pdone 可用、本仓库未接入 → 待逐个真实取链/Range 实测，按用户规则"可用才接入"）
 *   3) 已失效源（pdone 连续失效，不投入）
 *
 * 用法：
 *   node scripts/ecosystem-scan.js            # 控制台报告
 *   node scripts/ecosystem-scan.js --json     # 仅输出 JSON（供 CI/其他脚本消费）
 *
 * 无第三方依赖（仅 Node 内置 https）；抓取失败明确报错退出（不静默产出空报告）。
 */
'use strict';

const https = require('https');

const PDONE_HEALTH_URL =
  'https://raw.githubusercontent.com/pdone/lx-music-source/health-status/health-state.json';

// pdone 源名 → 本仓库 SOURCE_HANDLERS id 映射（按源族对应；无映射 = 本仓库未接入）
const PDONE_TO_LOCAL = {
  changqing: 'changqingVip',
  huibq: 'huibq',
  ikun: 'ikun',
  juhe: 'juheKw',
  xinghai: 'xinghaiBackend',
  yuningxi: 'nianxinVip',
  // fish/flower/grass/helloworld/huanyin/hyw/jiexiang/lx/qdy → 本仓库无对应
};

// 本仓库源（与 lx-source.js SOURCE_HANDLERS 保持同步；self-check 不校验此表，更新源时顺手维护）
const LOCAL_SOURCES = [
  'gdWy', 'wyOuter', 'kuwoOfficial', 'ikun', 'xinghaiBackup', 'xinghaiBackend',
  'huibq', 'lingchuan', 'suyinQQ', 'suyin163', 'suyinKuwo', 'juheKw',
  'juheTx', 'juheWy', 'juheKg', 'juheMg', 'suyinMigu', 'changqingVip', 'nianxinVip',
];

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'lx-music-source-ecosystem-scan' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} 抓取失败: ${url}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON 解析失败: ${e.message}`)); }
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`抓取超时(${timeoutMs}ms): ${url}`)); });
  });
}

async function main() {
  const asJson = process.argv.includes('--json');
  const health = await fetchJson(PDONE_HEALTH_URL);
  if (!health || !health.sources) throw new Error('pdone 健康表结构异常：缺少 sources 字段');
  const pdoneSources = health.sources;

  const cross = [];      // 共有源交叉
  const newCandidates = []; // pdone 可用、本仓库未接入
  const deadUpstream = [];  // pdone 失效/异常

  for (const [pdoneName, status] of Object.entries(pdoneSources)) {
    const localId = PDONE_TO_LOCAL[pdoneName];
    if (localId) {
      cross.push({ pdoneName, localId, pdoneStatus: status, localHas: LOCAL_SOURCES.includes(localId) });
    } else if (status === '可用') {
      newCandidates.push({ pdoneName, status, note: 'pdone 每日 CI 可用，本仓库未接入 → 待真实取链/Range 实测' });
    } else {
      deadUpstream.push({ pdoneName, status });
    }
  }

  const result = {
    scannedAt: new Date().toISOString(),
    pdoneUpdatedAt: health.updated_at || null,
    cross,
    newCandidates,
    deadUpstream,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  console.log('===== 生态扫描报告 =====');
  console.log(`pdone 健康表更新时间: ${result.pdoneUpdatedAt || '未知'} | 扫描时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  console.log('');
  console.log(`① 共有源交叉（${cross.length}）——pdone 为 CI 服务器 IP、本仓库为本地 IP，分歧仅作参考：`);
  for (const c of cross) {
    console.log(`   - ${c.pdoneName} → 本仓库 ${c.localId}：pdone=${c.pdoneStatus}`);
  }
  console.log('');
  console.log(`② 新候选（pdone 可用、本仓库未接入，${newCandidates.length}）——按规则逐个真实验证后才接入：`);
  if (!newCandidates.length) console.log('   （无）');
  for (const c of newCandidates) {
    console.log(`   - ${c.pdoneName}（${c.status}）：${c.note}`);
  }
  console.log('');
  console.log(`③ pdone 已失效/异常（${deadUpstream.length}，不投入）：`);
  if (!deadUpstream.length) console.log('   （无）');
  for (const c of deadUpstream) {
    console.log(`   - ${c.pdoneName}（${c.status}）`);
  }
  console.log('');
  console.log(`候选接入下一步：对 ② 中每个候选抓取 latest.js 分析上游 → 真实取链 → CDN Range 206 + 魔数/码率校验 → 通过才接入 kw 链。`);
}

main().catch((e) => {
  process.stderr.write(`生态扫描失败: ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
});
