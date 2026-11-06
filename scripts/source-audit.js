#!/usr/bin/env node
/**
 * 全源全接口深度巡检（v8.5 沉淀自 2026-11-06 v8.4 巡检）
 *
 * 与 scripts/probe.js 的区别：
 * - probe.js：端点连通/结构巡检（CI 每日跑，写 README_HEALTH）——只回答"端点活着没"
 * - 本脚本：源级取链巡检——真实调用每个源的 fn(platform, id, quality, songInfo)，
 *   拿到直链后做 Range 可播校验，回答"这个源现在能不能真的出可播链接"
 *
 * 用法：
 *   node scripts/source-audit.js            # 表格输出
 *   node scripts/source-audit.js --json     # JSON 输出（供机器消费/对比基线）
 *   node scripts/source-audit.js --only=kw  # 只测某平台
 *
 * 基线：docs/SOURCE_AUDIT.md（每次巡检后对照并更新）
 */
const http = require('http');
const https = require('https');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'lx-source.js');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const JSON_OUT = process.argv.includes('--json');
const TIMEOUT = 9000;
const FOLLOW_MAX = 5;

// ---- mock 宿主：真实网络转发（支持 302 跟随，避免 wyOuter 类源被误判）----
let requestHandler = null;
function realRequest(url, opts, cb) {
  const visit = (u, depth) => {
    const lib = String(u).startsWith('https') ? https : http;
    const req = lib.request(u, {
      method: (opts && opts.method) || 'GET',
      headers: (opts && opts.headers) || {},
      timeout: TIMEOUT,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < FOLLOW_MAX) {
        res.resume();
        return visit(new URL(res.headers.location, u).toString(), depth + 1);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => cb(null, {
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
        url: u,
      }));
    });
    req.on('timeout', () => { req.destroy(); cb(new Error('timeout'), null); });
    req.on('error', e => cb(e, null));
    if (opts && opts.body) req.write(opts.body);
    req.end();
  };
  try { visit(String(url), 0); } catch (e) { cb(e, null); }
}

globalThis.lx = {
  EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
  version: '2.6.0', env: 'mobile',
  utils: { buffer: { from: (d, e) => Buffer.from(d, e), bufToString: (b, e) => b.toString(e) } },
  request: realRequest,
  on(name, handler) { if (name === 'request') requestHandler = handler; },
  send() {},
};

const realLog = console.log;
console.log = () => {};
const mod = require(SRC);
console.log = realLog;

// 全开开关：默认关闭的源也要纳入巡检（结论用于判断"开启值不值"）
for (const k of Object.keys(mod.runtimeToggles)) mod.runtimeToggles[k] = true;

// 固定探测歌（各平台真实 ID，与 lx-source.js 探针池保持同一首歌便于对照）
const SONGS = {
  kw: { name: '晴天', singer: '周杰伦', album: '叶惠美', duration: 271000, interval: 271, hash: '228908', rid: 228908, songmid: '228908', id: '228908' },
  wy: { name: '晴天', singer: '周杰伦', album: '叶惠美', duration: 271000, interval: 271, id: 2652820720, songmid: '2652820720' },
  tx: { name: '晴天', singer: '周杰伦', album: '叶惠美', duration: 271000, interval: 271, songmid: '004Z8Ihr0JIu5s' },
  mg: { name: '晴天', singer: '周杰伦', album: '叶惠美', duration: 271000, interval: 271, songmid: '228908', id: '228908' },
  kg: { name: '晴天', singer: '周杰伦', album: '叶惠美', duration: 271000, interval: 271, hash: '228908', songmid: '228908' },
};

function rangeCheck(url) {
  return new Promise((resolve) => {
    if (!url || !/^https?:\/\//.test(String(url))) return resolve('NO_URL');
    const lib = String(url).startsWith('https') ? https : http;
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = lib.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Mobile', Range: 'bytes=0-1023' },
        timeout: 6000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nxt = new URL(res.headers.location, url).toString();
          const lib2 = nxt.startsWith('https') ? https : http;
          const r2 = lib2.get(nxt, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Mobile' }, timeout: 6000 }, (rr) => {
            fin(`${rr.statusCode} ${rr.headers['content-type'] || ''}`);
            rr.resume();
          });
          r2.on('error', () => fin('ERR'));
          return;
        }
        fin(`${res.statusCode} ${res.headers['content-type'] || ''}`);
        res.resume();
      });
      req.on('timeout', () => { req.destroy(); fin('TIMEOUT'); });
      req.on('error', () => fin('ERR'));
    } catch (e) { fin('ERR'); }
  });
}

(async () => {
  const rows = [];
  const platforms = ONLY ? [ONLY] : ['kw', 'wy', 'tx', 'mg', 'kg'];
  for (const plat of platforms) {
    const chain = mod.buildSourceChain(plat, '128k');
    for (const h of chain) {
      const song = SONGS[plat];
      const idVal = song.hash || song.songmid || song.id;
      const t0 = Date.now();
      try {
        const url = await h.fn(plat, idVal, '128k', song);
        const host = (String(url).match(/^(https?:\/\/[^/]+)/) || [, ''])[1];
        let playable = '';
        // 二次可播校验（识破"接口 200 但 CDN 死链"）
        if (/^https?:\/\//.test(String(url)) && !/\.php|kwplay/.test(String(url))) {
          playable = await rangeCheck(String(url));
        }
        rows.push({ src: h.id, plat, ok: true, code: 'OK', host, playable, ms: Date.now() - t0 });
      } catch (e) {
        const msg = String((e && e.message) || e);
        const code = (msg.match(/^([A-Z_]+):/) || [, 'ERR'])[1];
        rows.push({ src: h.id, plat, ok: false, code, msg: msg.slice(0, 100), ms: Date.now() - t0 });
      }
    }
  }

  if (JSON_OUT) {
    realLog(JSON.stringify({ checkedAt: new Date().toISOString(), total: rows.length, ok: rows.filter(r => r.ok).length, rows }, null, 2));
    return;
  }
  realLog('\n=== 全源深度巡检（128k 固定歌 晴天）===');
  realLog('源 | 平台 | 结果 | 码 | 域名/原因 | 可播 | 耗时');
  for (const r of rows) {
    realLog(`${r.src.padEnd(16)} | ${r.plat} | ${r.ok ? '✅' : '❌'} | ${String(r.code).padEnd(14)} | ${(r.ok ? (r.host || '') : r.msg).slice(0, 48).padEnd(48)} | ${String(r.playable || '').slice(0, 22)} | ${r.ms}ms`);
  }
  realLog(`\n统计：${rows.filter(r => r.ok).length}/${rows.length} 可用`);
  // v8.9：巡检完成后强制退出——HTTP keep-alive agent 会挂住事件循环，不加 exit 进程常驻。
  // 退出码：默认 0（巡检是信息性输出，死源属常态）；`--strict` 时有任一源不可用则返回 1（供 CI 门禁用）
  const strict = process.argv.includes('--strict');
  process.exit(strict && rows.some(r => !r.ok) ? 1 : 0);
})();
