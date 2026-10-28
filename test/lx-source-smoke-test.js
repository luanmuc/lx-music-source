#!/usr/bin/env node
/**
 * lx-source.js 冒烟测试（v13.0 固化，替代 /tmp 原型）
 * 用途：mock 洛雪移动端宿主（globalThis.lx），验证加载即用 + 上报结构 + 请求链路 + 失败缓存差异化 + 熔断分类
 * 运行：node test/lx-source-smoke-test.js （CI 自动执行）
 * 设计说明：lx-source.js 是 side-effect 加载（无导出），测试通过捕获 on/send 事件与 mock request 计数断言。
 */
const assert = require('assert');
const path = require('path');
const SRC = path.join(__dirname, '..', 'lx-source.js');

let requestHandler = null;
const sentEvents = [];
const counts = {};        // url 前缀 -> 请求次数
let mockRoute = null;     // 当前路由模式

// ---- mock 宿主 ----
function resetMock() {
  // 注意：requestHandler 是加载时 on() 注册的，不能清空（只清发送事件与计数）
  sentEvents.length = 0;
  for (const k of Object.keys(counts)) delete counts[k];
}

// 默认音频路由：example.com 返回 206 audio（isAudioPlayable 可播）
const audioRoute = () => ({ statusCode: 206, headers: { 'content-type': 'audio/mpeg' }, body: '' });

function setMockLx() {
  const lx = {
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
    version: '1.2.0',
    env: {},
    utils: {
      buffer: {
        from: (data, enc) => Buffer.from(data, enc),
        bufToString: (buf, enc) => buf.toString(enc),
      },
    },
    request(url, opts, cb) {
      const u = String(url);
      const key = u.split('?')[0];
      counts[key] = (counts[key] || 0) + 1;
      const route = mockRoute ? mockRoute(u) : audioRoute;
      setTimeout(() => {
        if (route.error) return cb(new Error(route.error), null);
        cb(null, { statusCode: route.statusCode, headers: route.headers || {}, body: route.body ?? '', url: u });
      }, route.delay || 2);
    },
    on(name, handler) { if (name === 'request') requestHandler = handler; },
    send(name, payload) { sentEvents.push({ name, payload }); },
  };
  globalThis.lx = lx;
}

function loadSource(noConsole) {
  // require 缓存：单进程只加载一次
  if (require.cache[require.resolve(SRC)]) delete require.cache[require.resolve(SRC)];
  const saved = globalThis.console;
  if (noConsole) globalThis.console = undefined; // 模拟 D11：无 console 宿主
  try {
    require(SRC);
    if (noConsole) globalThis.console = saved;
    return null;
  } catch (e) {
    if (noConsole) globalThis.console = saved;
    return e;
  }
}

// 简化 mock 路由表（按 URL 特征 + 当前模式）
function buildRoutes(mode) {
  const json = (body) => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body });
  const map = {
    success: {
      'zddyr.top': json({ code: 200, url: 'https://example.com/xh.flac' }),               // 星海后端
      'oiapi.net/api/Kuwo': json({ data: { url: 'https://example.com/kw.flac' } }),        // 溯音酷我
      'search.kuwo.cn': { statusCode: 200, headers: {}, body: "{'MP3RID':'MP3_123','NAME':'晴天','ARTIST':'周杰伦','DURATION':271}" }, // 酷我搜索
      'antiserver.kuwo.cn': { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'https://example.com/kuwo.mp3' },   // 酷我转换
      'music.163.com/song/media/outer': { statusCode: 200, headers: { 'content-type': 'audio/mpeg' }, body: '' },                   // 网易 outer
      'oiapi.net/api/Music_163': json({ code: 0, data: [{ url: 'https://example.com/163.mp3' }] }),                                  // 溯音163
    },
    notfound: { // 404：歌不存在
      'zddyr.top': json({ code: 404, msg: '歌曲不存在' }),
      'oiapi.net/api/Kuwo': json({ message: '未找到' }),
    },
    expired: { // 410：签名死链
      'oiapi.net/api/Kuwo': json({ message: '音乐链接：https://example.com/expired.mp3' }), // 可解析出 URL
    },
    netfail: {}, // 全部网络错误
  };
  return (u) => {
    if (mode === 'netfail') return { error: 'ETIMEDOUT' };
    for (const [needle, route] of Object.entries(map[mode] || {})) {
      if (u.includes(needle)) return route;
    }
    // 探测兜底：未匹配 → 失败
    return { error: 'ECONNREFUSED' };
  };
}

// 一次 musicUrl 请求
async function requestUrl(source, type, musicInfo) {
  assert.ok(requestHandler, 'request handler 未注册');
  return requestHandler({ action: 'musicUrl', source, info: { type, musicInfo } });
}

// ---------------- 用例 ----------------
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('[T1] 加载防御');
  setMockLx(); mockRoute = buildRoutes('success');
  const loadErr = loadSource(true); // 无 console 加载
  assert.strictEqual(loadErr, null, `无console加载抛错: ${loadErr && loadErr.message}`);

  console.log('[T2] 上报结构（inited）');
  const inited = sentEvents.find(e => e.name === 'inited');
  assert.ok(inited, '未收到 inited');
  assert.strictEqual(Object.keys(inited.payload.sources).length, 5, '应上报5平台');
  assert.deepStrictEqual(inited.payload.sources.wy.qualitys, ['128k', '320k', 'flac'], 'wy 上报音质应裁剪为真实能力');
  assert.ok(inited.payload.status === true, 'inited status 应为 true');

  console.log('[T3] updateAlert 发版通知');
  const alert = sentEvents.find(e => e.name === 'updateAlert');
  assert.ok(alert, '未收到 updateAlert');
  assert.ok(/github\.com\/luanmuc\/lx-music-source/.test(alert.payload.updateUrl), 'updateUrl 应为音源仓库 releases');

  console.log('[T4] musicUrl 请求链路（kw flac → 星海/溯音酷我竞速）');
  const song = { name: '晴天', singer: '周杰伦', duration: 271000, songmid: '228908' };
  const url = await requestUrl('kw', 'flac', song);
  assert.ok(url && url.startsWith('https://example.com/'), `返回URL异常: ${url}`);

  console.log('[T5] 成功缓存：重复请求不重复外呼');
  resetMock(); // 清计数（requestHandler 仍在）
  const countsAfter = {};
  for (const k of Object.keys(counts)) countsAfter[k] = counts[k];
  const url2 = await requestUrl('kw', 'flac', song);
  assert.strictEqual(url2, url, '缓存命中应返回同一URL');
  const newCalls = Object.values(counts).reduce((s, v) => s + v, 0) - Object.values(countsAfter).reduce((s, v) => s + v, 0);
  assert.strictEqual(newCalls, 0, `成功缓存后不应有新增外呼，实际+${newCalls}`);

  console.log('[T6] 失败缓存差异化：404(歌不存在) → 缓存1h（重复请求不重试）');
  resetMock();
  mockRoute = buildRoutes('notfound');
  // 用独立歌曲隔离成功缓存/其他用例的缓存
  const notFoundSong = { name: '不存在的测试歌404', singer: '未知', duration: 200000, songmid: 'notfound-song-1' };
  let thrown = null;
  try { await requestUrl('kw', 'flac', notFoundSong); } catch (e) { thrown = e; }
  assert.ok(thrown, '404 模式应抛错');
  const before = Object.values(counts).reduce((s, v) => s + v, 0);
  try { await requestUrl('kw', 'flac', notFoundSong); } catch (e) { /* 预期再次失败 */ }
  const after = Object.values(counts).reduce((s, v) => s + v, 0);
  assert.strictEqual(after, before, `404失败缓存(1h)后不应重试，实际+${after - before}`);

  console.log('[T7] 失败缓存差异化：网络错误 → 不缓存（立即重试）');
  resetMock();
  mockRoute = buildRoutes('netfail');
  const netFailSong = { name: '网络错误测试歌', singer: '未知', duration: 180000, songmid: 'netfail-song-1' };
  try { await requestUrl('kw', 'flac', netFailSong); } catch (e) { /* 预期失败 */ }
  const before2 = Object.values(counts).reduce((s, v) => s + v, 0);
  try { await requestUrl('kw', 'flac', netFailSong); } catch (e) { /* 预期再次失败 */ }
  const after2 = Object.values(counts).reduce((s, v) => s + v, 0);
  assert.ok(after2 > before2, `网络错误不应缓存，重复请求应重新外呼（${before2}→${after2}）`);

  console.log('[T8] 熔断分类：业务失败(NOT_FOUND)不熔断、网络错误累计3次熔断');
  // 8a 网络错误 x3 → 熔断（后续请求报"已熔断"，不进入源）
  resetMock();
  mockRoute = buildRoutes('netfail');
  const breakerSong = { name: '熔断测试歌', singer: '未知', duration: 180000, songmid: 'breaker-song-1' };
  for (let i = 0; i < 3; i++) { try { await requestUrl('kw', 'flac', breakerSong); } catch (e) { /* 累积 */ } }
  // 熔断后：3 个源并发都熔断则整体抛"已熔断"；切回成功模式，仍可能因断路器挡路
  mockRoute = buildRoutes('success');
  let breakerHit = false;
  try { await requestUrl('kw', 'flac', breakerSong); } catch (e) { if (/熔断/.test(e.message)) breakerHit = true; }
  // 说明：kw flac 链 = suyinKuwo+xinghaiBackend（均熔断），应命中"已熔断"
  assert.ok(breakerHit, '网络错误3次后应熔断，实际未命中熔断错误');

  console.log('[T9] v14.0 失败原因结构化透出：聚合错误携带 code + detail 数组');
  resetMock();
  mockRoute = buildRoutes('netfail');
  const detailSong = { name: '结构化失败测试歌', singer: '未知', duration: 200000, songmid: 'detail-song-1' };
  let detailErr = null;
  try { await requestUrl('kw', 'flac', detailSong); } catch (e) { detailErr = e; }
  assert.ok(detailErr, 'netfail 全败应抛错');
  assert.ok(detailErr.code, `聚合错误应带代表码，实际 code=${detailErr.code}`);
  assert.ok(Array.isArray(detailErr.detail) && detailErr.detail.length > 0, '聚合错误应带非空 detail 数组');
  for (const d of detailErr.detail) {
    assert.ok(d && typeof d === 'object', 'detail 每项应为对象');
    assert.ok(typeof d.source === 'string' && d.source.length > 0, `detail.source 应为非空字符串，实际=${d.source}`);
    assert.ok(typeof d.quality === 'string' && d.quality.length > 0, `detail.quality 应为非空字符串，实际=${d.quality}`);
    assert.ok(typeof d.code === 'string' && d.code.length > 0, `detail.code 应为非空字符串，实际=${d.code}`);
    assert.ok(typeof d.reason === 'string', `detail.reason 应为字符串，实际=${d.reason}`);
  }
  assert.ok(detailErr.detail.every(d => d.code === 'NETWORK_ERROR' || d.code === 'NETWORK_TIMEOUT' || d.code === 'RATE_LIMIT'),
    `netfail 全败 detail.code 应全为网络类码，实际=${detailErr.detail.map(d => d.code).join(',')}`);

  console.log('[T10] v14.1 源健康权重自学习：健康评分排序（真实样本主导 + 探测低权重参考 + 连续失败惩罚）');
  const mod = require(SRC);
  const fake = (id) => ({ id, name: id });
  // srcA：真实 10/10 全成功 快（应排第一）
  const a = mod.getBreaker('srcA');
  a.totalRequests = 10; a.totalSuccess = 10; a.totalTime = 2000; a.probeRequests = 0; a.probeSuccess = 0; a.probeTime = 0; a.failureCount = 0;
  // srcB：真实 5/10 成功率低 慢（应排第三）
  const b = mod.getBreaker('srcB');
  b.totalRequests = 10; b.totalSuccess = 5; b.totalTime = 20000; b.probeRequests = 0; b.probeSuccess = 0; b.probeTime = 0; b.failureCount = 0;
  // srcC：真实 2/6 + 连续失败 3 次（惩罚后应排第四）
  const c = mod.getBreaker('srcC');
  c.totalRequests = 6; c.totalSuccess = 2; c.totalTime = 4000; c.probeRequests = 0; c.probeSuccess = 0; c.probeTime = 0; c.failureCount = 3;
  // srcD：仅探测样本 4/4（低权重参考，应介于 A 与 B 之间）
  const d = mod.getBreaker('srcD');
  d.totalRequests = 0; d.totalSuccess = 0; d.totalTime = 0; d.probeRequests = 4; d.probeSuccess = 4; d.probeTime = 1200; d.failureCount = 0;
  const order = mod.sortChainByHealth([fake('srcB'), fake('srcC'), fake('srcD'), fake('srcA')]);
  assert.deepStrictEqual(order.map(h => h.id), ['srcA', 'srcD', 'srcB', 'srcC'], `健康排序异常: ${order.map(h => h.id).join(',')}`);
  // 连续失败惩罚生效：清空 srcC 失败计数后分数应上升
  const scoreWithStreak = mod.computeHealthScore('srcC').score;
  c.failureCount = 0;
  const scoreNoStreak = mod.computeHealthScore('srcC').score;
  assert.ok(scoreNoStreak > scoreWithStreak, `连续失败惩罚应降低分数(${scoreWithStreak}→${scoreNoStreak})`);
  // 探测样本不进入 total 统计（不污染真实成功率）
  assert.strictEqual(d.totalRequests, 0, '探测样本不应计入 totalRequests');
  assert.strictEqual(d.totalSuccess, 0, '探测样本不应计入 totalSuccess');

  console.log('[T11] v14.2 竞速结果匹配校验：verified 源优先，未校验源不抢答');
  // 恢复 T8/T9 熔断的源（180s 冷却无法等待，直接重置状态）
  for (const id of ['suyinKuwo', 'xinghaiBackend', 'kuwoOfficial', 'changqingVip', 'nianxinVip', 'ikun', 'gdWy', 'suyin163', 'wyOuter', 'huibq', 'lingchuan']) {
    const b = mod.getBreaker(id);
    b.state = 'closed'; b.failureCount = 0; b.lastFailureTime = 0;
  }
  const json = (body) => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body });
  // 11a：星海(未verified)快 2ms 先返回，溯音酷我(verified)慢 80ms → 应等 verified 源，返回其 URL
  // （溯音酷我内部 songInfoMatch 校验要求响应带 song/singer/duration 字段）
  resetMock();
  mockRoute = (u) => {
    if (u.includes('zddyr.top')) return { ...json({ code: 200, url: 'https://example.com/xh.flac' }), delay: 2 };
    if (u.includes('oiapi.net/api/Kuwo')) return { ...json({ data: { url: 'https://example.com/kw.flac', song: '匹配校验测试歌', singer: '未知', duration: 200 } }), delay: 80 };
    if (u.includes('example.com')) return { statusCode: 206, headers: { 'content-type': 'audio/mpeg' }, body: '' }; // CDN Range 探测可播
    return { error: 'ECONNREFUSED' };
  };
  const matchSong = { name: '匹配校验测试歌', singer: '未知', duration: 200000, songmid: 'match-song-1' };
  const verifiedUrl = await requestUrl('kw', 'flac', matchSong);
  assert.ok(verifiedUrl.includes('example.com/kw.flac'), `verified 源应优先，实际=${verifiedUrl}`);
  // 11b：verified 源失败，未校验候选窗口后兜底返回
  resetMock();
  mockRoute = (u) => {
    if (u.includes('zddyr.top')) return { ...json({ code: 200, url: 'https://example.com/xh.flac' }), delay: 2 };
    if (u.includes('oiapi.net/api/Kuwo')) return { error: 'ECONNREFUSED' };
    if (u.includes('example.com')) return { statusCode: 206, headers: { 'content-type': 'audio/mpeg' }, body: '' };
    return { error: 'ECONNREFUSED' };
  };
  const fallbackSong = { name: '匹配校验兜底歌', singer: '未知', duration: 200000, songmid: 'match-song-2' };
  const fallbackUrl = await requestUrl('kw', 'flac', fallbackSong);
  assert.ok(fallbackUrl.includes('example.com/xh.flac'), `未校验候选应兜底返回，实际=${fallbackUrl}`);

  console.log('[T12] v14.3 探测巡检增强：分级轮次 + 失效源休眠复活');
  // 12a：分级轮次判定——core 每轮，secondary 每3轮一探
  assert.strictEqual(mod.tierShouldProbe(1, 'core'), true, 'core 第1轮应探测');
  assert.strictEqual(mod.tierShouldProbe(2, 'secondary'), false, 'secondary 第2轮不应探测');
  assert.strictEqual(mod.tierShouldProbe(3, 'secondary'), true, 'secondary 第3轮应探测');
  assert.strictEqual(mod.tierShouldProbe(4, 'secondary'), false, 'secondary 第4轮不应探测');
  // 12b：连续3轮失败 → 进入休眠，buildProbeConfig 不再包含该源（用真实次要源 kuwoOfficial）
  const oldRound = globalThis.__probeRound;
  globalThis.__probeRound = 1;
  const sleepId = 'kuwoOfficial';
  for (let i = 0; i < 3; i++) mod.applyProbeResult(sleepId, false);
  assert.strictEqual(mod.probeState.sleeping[sleepId], true, '连续3轮失败应进入休眠');
  assert.ok(!(sleepId in mod.buildProbeConfig()), '休眠中且未到复活轮，配置不应包含该源');
  // 12c：到复活轮（轮差>=10），buildProbeConfig 重新包含该源
  globalThis.__probeRound = 12; // 1 + 11 = 12，轮差 11 >= 10
  assert.ok(sleepId in mod.buildProbeConfig(), '到达复活试探轮应重新包含该源');
  // 12d：探测通过即复活，清休眠状态
  mod.applyProbeResult(sleepId, true);
  assert.ok(!mod.probeState.sleeping[sleepId], '探测通过应清休眠');
  assert.ok(!mod.probeState.deadCount[sleepId], '探测通过应清失败累计');
  globalThis.__probeRound = oldRound;

  console.log('[T13] v15.0 歌词/封面透出：wy lyric/pic + kw pic，不支持平台安全拒绝');
  // 13a：wy 歌词（网易云公开接口，返回带时间标签歌词）
  resetMock();
  mockRoute = (u) => {
    if (u.includes('music.163.com/api/song/lyric')) return json({ lrc: { lyric: '[00:00.000] 测试歌词第一行\n[00:05.000] 测试歌词第二行' }, tlyric: { lyric: '[00:00.000] Test Line 1' } });
    return { error: 'ECONNREFUSED' };
  };
  const wySong = { name: '测试歌', singer: '歌手', duration: 200000, songmid: '2652820720' };
  const lyricInfo = await requestHandler({ action: 'lyric', source: 'wy', info: { type: 'flac', musicInfo: wySong } });
  assert.ok(lyricInfo && typeof lyricInfo.lyric === 'string' && /\[\d\d:\d\d\.\d\d\d\]/.test(lyricInfo.lyric), `歌词应带时间标签，实际=${JSON.stringify(lyricInfo).slice(0, 80)}`);
  assert.ok(typeof lyricInfo.tlyric === 'string' && lyricInfo.tlyric.includes('Test Line'), '应返回翻译歌词');
  // 13b：wy 封面（detail 接口 picUrl → https 字符串）
  resetMock();
  mockRoute = (u) => {
    if (u.includes('music.163.com/api/song/detail')) return json({ songs: [{ picUrl: 'https://p2.music.126.net/ab12cd/cover.jpg' }] });
    return { error: 'ECONNREFUSED' };
  };
  const picUrl = await requestHandler({ action: 'pic', source: 'wy', info: { type: 'flac', musicInfo: wySong } });
  assert.ok(typeof picUrl === 'string' && /^https:/.test(picUrl), `封面应返回 https URL，实际=${picUrl}`);
  // 13c：kw 封面（搜索接口单引号 abslist → hts_MVPIC）
  resetMock();
  mockRoute = (u) => {
    if (u.includes('search.kuwo.cn')) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: "{'abslist':[{'NAME':'测试歌','MP3RID':'MP3_123','hts_MVPIC':'https://img2.kuwo.cn/ab12/cd.jpg'}]}" };
    return { error: 'ECONNREFUSED' };
  };
  const kwSong = { name: '测试歌', singer: '歌手', duration: 200000, songmid: '228908' };
  const kwPic = await requestHandler({ action: 'pic', source: 'kw', info: { type: 'flac', musicInfo: kwSong } });
  assert.ok(typeof kwPic === 'string' && kwPic.includes('img2.kuwo.cn'), `kw 封面应返回 hts_MVPIC，实际=${kwPic}`);
  // 13d：不支持平台安全拒绝（tx lyric → NOT_FOUND）
  resetMock();
  let txRejected = false;
  try { await requestHandler({ action: 'lyric', source: 'tx', info: { type: 'flac', musicInfo: wySong } }); } catch (e) { txRejected = true; }
  assert.ok(txRejected, 'tx 歌词无接口应 reject（App 走内置源兜底）');

  console.log('[T14] v15.2 健康统计快照：14 源全量 + 字段完整 + 健康分排序可用');
  const snap = mod.getHealthSnapshot();
  assert.ok(snap && typeof snap === 'object', '应返回快照对象');
  assert.ok(Object.keys(snap).length >= 14, `应覆盖全部源，实际${Object.keys(snap).length}个`);
  for (const id of Object.keys(snap)) {
    const s = snap[id];
    assert.ok(typeof s.name === 'string' && s.name.length > 0, `${id} 缺 name`);
    assert.ok(typeof s.enabled === 'boolean', `${id} 缺 enabled`);
    assert.ok(typeof s.successRate === 'number', `${id} 缺 successRate`);
    assert.ok(typeof s.avgTime === 'number', `${id} 缺 avgTime`);
    assert.ok(['closed', 'open', 'half-open'].includes(s.state), `${id} state 异常: ${s.state}`);
    assert.ok(typeof s.healthScore === 'number' && s.healthScore >= -2 && s.healthScore <= 1, `${id} healthScore 越界: ${s.healthScore}`);
  }

  console.log('[T15] v16.3 健康 action：request(health) 返回快照对象（App fork 通道可用）');
  const healthViaAction = await requestHandler({ action: 'health', source: 'wy', info: {} });
  assert.ok(healthViaAction && typeof healthViaAction === 'object', 'health action 应返回对象');
  assert.ok(Object.keys(healthViaAction).length >= 14, `health action 应覆盖全部源，实际${Object.keys(healthViaAction).length}个`);
  const firstHealth = healthViaAction[Object.keys(healthViaAction)[0]];
  assert.ok(firstHealth && typeof firstHealth.healthScore === 'number', 'health action 应含 healthScore');

  console.log('\n冒烟测试完成：15 组用例');
  if (process.exitCode) console.error('存在失败用例');
  process.exit(process.exitCode || 0);
})();
