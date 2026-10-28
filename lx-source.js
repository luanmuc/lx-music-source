/*!
 * @name 豆包定制[聚合音源]
 * @description v16.3 App健康面板联动(health action：App fork 声明即注册 getHealth，聚合快照直通设置页面板)；v16.2发布后监控/回滚决策(Release自动巡检基线+核心源连续失败≥3天回滚)；v16.1死源建议(连续3天失败自动标记)；v16.0仓库级成功率统计(probe-history近7日)；v15.2健康统计快照(getHealthSnapshot)；v15.0歌词/封面透出(wy lyric+pic/kw pic)；v14.3分级探测+休眠复活；v14.2竞速匹配校验；v14.1健康权重自学习；v14.0失败原因结构化透出；v13.4配置化+v12.1失败缓存差异化；保留v12.0星海kw高音质双源+v11.12防错歌加固
 * @version 16.3 App健康面板联动版
 * @author 豆包定制
 * @contribution 基线同v11.11(2026-10-15实测)；v11.12为代码加固(防错歌/https/熔断分类/探测一致性/清理)；v11.13(2026-10-28)：D11日志防御——vm无console沙箱验证通过(修复前加载抛TypeError复现)，真机装包待验证；v12.0(2026-10-28)：星海后端kw高音质——E10实测(128k/320k/flac/flac24bit四档code200、URL均Range 206、魔数正确、码率吻合、ID3歌名对应songmid)，解除仅128k限制并接入kw链双源，URL http→https升级(实测https 206可播)；v12.1-v13.4(2026-10-28)：失败缓存差异化+探测收敛+决策日志+updateAlert+自动化测试CI+端点巡检+音质表收敛+配置化，走验证链L0-L1(L2按需)
 */
// ============================================================
// 第〇部分：用户配置区（v13.4 配置化 — 开配置即用，默认不暴露）
// 需配置源（ikun 卡密 / 聆川密钥）从这里读取：
//   方式一：直接改下方 USER_CONFIG 常量（改源码即生效）；
//   方式二：宿主全局注入 globalThis.__lxSourceConfig = { ikunApiKey, lingchuanApiKey }（fork App 可做，不改源码）。
// 星海令牌默认自动生成（device_id 随机）；如需固定可在此配置 xinghaiDeviceId。
// ============================================================
const USER_CONFIG = {
  ikunApiKey: (typeof globalThis !== "undefined" && globalThis.__lxSourceConfig && globalThis.__lxSourceConfig.ikunApiKey) || "", // 填入 ikun 卡密后开启
  lingchuanApiKey: (typeof globalThis !== "undefined" && globalThis.__lxSourceConfig && globalThis.__lxSourceConfig.lingchuanApiKey) || "",
  xinghaiDeviceId: (typeof globalThis !== "undefined" && globalThis.__lxSourceConfig && globalThis.__lxSourceConfig.xinghaiDeviceId) || "",
};

// ============================================================
// 第一部分：常量配置
// ============================================================
const CACHE_TTL_MS = 21600000;          // 6小时 成功缓存
const FAIL_CACHE_TTL_MS = 300000;       // 5分钟 失败缓存（v12.1 起按失败类型差异化：见 getFailCached）
const CACHE_MAX_SIZE = 500;
const FAIL_CACHE_MAX_SIZE = 300;
const HTTP_URL_REGEX = /^https?:\/\//i;
const BREAKER_THRESHOLD = 3;            // 连续失败熔断阈值
const BREAKER_COOLDOWN_MS = 180000;     // 熔断冷却 3分钟
const RETRY_TIMES = 1;                  // 网络错误重试次数(v11.8:2→1，避免重试放大)
const RACE_OVERALL_TIMEOUT_MS = 6000;   // fallbackRace 整体超时(v11.8新增)
const RACE_MATCH_WAIT_MS = 600;         // v14.2：未校验源首个成功后的等待窗口——给已验证源(内部做songInfoMatch)机会，防"快但错歌"抢答

const ERROR_CODES = {
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PARAM_ERROR: 'PARAM_ERROR',
  COPYRIGHT_LIMIT: 'COPYRIGHT_LIMIT',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  MISMATCH: 'SONG_MISMATCH',
  CONFIG_ERROR: 'CONFIG_ERROR',
  LINK_EXPIRED: 'LINK_EXPIRED'   // v12.1：HTTP 410 签名/直链过期
};

// v12.1：失败缓存差异化 TTL（404=歌确实不存在，缓存1h；410=签名死链，很快恢复，缓存1min；网络类/限流=瞬时，不缓存）
const FAIL_CACHE_TTL_BY_CODE = {
  [ERROR_CODES.NOT_FOUND]: 60 * 60 * 1000,        // 404/无版权/搜索无结果 → 1小时
  [ERROR_CODES.MISMATCH]: 60 * 60 * 1000,          // 歌信息不匹配(近1h内重查意义低) → 1小时
  [ERROR_CODES.LINK_EXPIRED]: 60 * 1000,           // 410 签名死链 → 1分钟
  [ERROR_CODES.RATE_LIMIT]: 0,                     // 限流 → 不缓存(会恢复)
  [ERROR_CODES.NETWORK_TIMEOUT]: 0,                // 超时 → 不缓存(瞬时)
  [ERROR_CODES.NETWORK_ERROR]: 0,                  // 网络错误 → 不缓存(瞬时)
  [ERROR_CODES.SERVER_ERROR]: 0,                   // 5xx → 不缓存(服务端会恢复)
};

const TIMEOUT_CONFIG = { search: 3000, parse: 5000, default: 5000 }; // v11.8: parse 8000→5000

// API 端点
// GD Studio（实测：仅网易云 netease，br=999→真实flac/br=320→320k/br=128→128k；免费公共服务，5分钟50次限制，仅用于wy高音质链，不进128k兜底竞速）
const GD_API = "https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light";
const XINGHAI_BACKUP_API = "https://music-dl.sayqz.com/api/"; // 实测：域名不可解析，已失效（保留常量便于恢复）
// 溯音系（实测：仅 Kuwo 可用；QQ -403维护中；163 免费歌恢复可用；咪咕 502 IP限制）
const SUYIN_QQ_API = "https://oiapi.net/api/QQ_Music";
const SUYIN_QQ_KEY = "oiapi-ef6133b7-ac2f-dc7d-878c-d3e207a82575";
const SUYIN_163_API = "https://oiapi.net/api/Music_163";
const SUYIN_KUWO_API = "https://oiapi.net/api/Kuwo";
const SUYIN_MIGU_API = "https://api.xcvts.cn/api/music/migu";
// Huibq：实测仅酷我真实可用，其他平台假兜底，默认关闭
const HUIBQ_API = "https://lxmusicapi.onrender.com";
const HUIBQ_REQUEST_KEY = "share-v3";
// 聆川（未配置，默认关闭）
const LINGCHUAN_API = "https://api.lingchuan.com/v1";
// 星海后端主域聚合（v11.8重新接入kw；v12.0起支持 kw 128k/320k/flac 三档，E10实测四档code200+206可播+ID3对应；wy 签名URL本机403疑绑定后端出口IP，未接入wy）
const XINGHAI_BACKEND_API = "https://yy.zddyr.top/lx/api/";
// 网易云官方 outer 直连（免费歌302→真实mp3；VIP/无版权歌404自动跳过；固定128k）
const WY_OUTER_API = "https://music.163.com/song/media/outer/url?id={id}.mp3";
// v15.0：歌词/封面接口（实测：网易云公开 lyric/detail 接口可用；酷我仅封面 hts_MVPIC 可用，歌词无稳定接口）
const WY_LYRIC_API = "https://music.163.com/api/song/lyric";
const WY_DETAIL_API = "https://music.163.com/api/song/detail";
// 酷我官方直连（自研：搜索r.s→rid→convert_url，固定128k真实mp3，无第三方）
const KUWO_SEARCH_API = "http://search.kuwo.cn/r.s";
const KUWO_CONVERT_API = "http://antiserver.kuwo.cn/anti.s";
// ikun 服务器源（v13.4：卡密从 USER_CONFIG.ikunApiKey 读取；开启 ikun 开关后生效）
const IKUN_API = "https://api.ikunshare.com";

// 长青SVIP（实测：IP白名单/无链接/需付费level，已失效，默认关闭）
const CHANGQING_URL_TEMPLATES = {
  tx: "http://175.27.166.236/kgqq/qq.php?type=mp3&id={id}&level={level}",
  wy: "http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level={level}",
  kw: "https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={level}",
  kg: "https://music.haitangw.cc/kgqq/kg.php?type=mp3&id={id}&level={level}",
  mg: "https://music.haitangw.cc/musicapi/mg.php?type=mp3&id={id}&level={level}"
};
// 念心SVIP（实测：全部404/空跳转，已失效，默认关闭）
const NIANXIN_URL_TEMPLATES = {
  tx: "https://music.nxinxz.com/kgqq/tx.php?id={id}&level={level}&type=mp3",
  wy: "http://music.nxinxz.com/wy.php?id={id}&level={level}&type=mp3",
  kw: "http://music.nxinxz.com/kw.php?id={id}&level={level}&type=mp3",
  kg: "https://music.nxinxz.com/kgqq/kg.php?id={id}&level={level}&type=mp3",
  mg: "http://music.nxinxz.com/mg.php?id={id}&level={level}&type=mp3"
};

// ============================================================
// 第二部分：音源开关（按实测结果配置，可自行调整）
// ============================================================
const SOURCE_TOGGLES = {
  // ---- 默认开启（实测可用） ----
  suyinKuwo: true,      // 溯音酷我：全平台兜底(第三方，支持flac/320k/128k)
  wyOuter: true,        // 网易云官方outer直连：固定128k免费歌直链(实测可用)
  kuwoOfficial: true,   // 酷我官方直连：固定128k真实mp3(实测可用，无第三方)
  suyin163: true,       // 溯音163：免费歌真实128k直链，VIP歌url:null自动跳过
  gdWy: true,           // GD Studio：wy flac/320k高音质优先源(限5min50次，仅高音质链用)
  xinghaiBackend: true, // 星海后端主域：kw 高音质双源(v12.0，与溯音酷我并列flac/320k) + 128k 兜底(与酷我官方并列)
  // ---- 默认关闭（接口失效/需配置，可自行开启） ----
  xinghaiBackup: false, // 星海备：域名不可解析
  suyinQQ: false,       // 溯音QQ：2026-10-28实测仍-403(oiapi.net维护中)，保持关闭待上游恢复
  suyinMigu: false,     // 溯音咪咕：2026-10-28实测——上游api.xcvts.cn域名200可达(0.26s)但接口502"服务器IP可能被咪咕限制"，换备用域名不可行(IP级限制)，待上游恢复
  changqingVip: true,  // 长青：v11.9实测仅kw恢复(302→car-er.kuwo.cn新鲜mp3)，仅kw 128k兜底
  nianxinVip: true,    // 念心：v11.9实测仅kw恢复(302→car-er.kuwo.cn新鲜mp3)，仅kw 128k兜底
  huibq: false,         // Huibq：实测仅酷我真实，其他平台假兜底
  lingchuan: false,     // 聆川：需配置
  ikun: false           // ikun服务器源：需卡密(USER_CONFIG.ikunApiKey)，填入后开启
};

// ============================================================
// 第二部分B：健康探测模块（v11.8：探测清单收敛为当前可用源 + 并发探测 + 统一跟随302）
// ============================================================
// 运行时开关：随探测结果自动变化；buildSourceChain 以它为准
const runtimeToggles = { ...SOURCE_TOGGLES };

const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 每10分钟一轮
const HEALTH_CHECK_INITIAL_DELAY_MS = 60 * 1000; // 加载后1分钟开始第一轮
const HEALTH_CHECK_TIMEOUT = 6000;                // 单次探测超时(v11.8:4000→6000，减少误摘)
const PROBE_PASS_REQUIRED = 2;                    // 连续通过2次才判定可用（防抖动）
const PROBE_FAIL_REQUIRED = 2;                    // 连续失败2次才判定失效（防抖动）
// v14.3：分级探测——核心源(播放主链路)每轮探测，次要源每3轮一探（省请求且减少对免费源的骚扰）
const PROBE_TIER_CORE_INTERVAL = 1;
const PROBE_TIER_SECONDARY_INTERVAL = 3;
// v14.3：失效源休眠——连续3轮失败进入休眠(不再每轮空打)，每10轮做一次复活试探（新端点/上游恢复时自动回归）
const PROBE_SLEEP_AFTER_DEAD = 3;
const PROBE_WAKE_EVERY_ROUND = 10;
// v11.11：探测歌曲池轮换（晴天/海阔天空/稻香），避免单曲被风控导致探测误判
const PROBE_SONG_POOL = ["晴天", "海阔天空", "稻香"];
// v11.12 (D9)：溯音163 探测免费歌池（实测 code:0 + data[0].url 真实mp3；186016周杰伦VIP无url已排除）
const PROBE_163_IDS = ["2652820720", "347230"];

// 各源探测请求定义：仅保留当前可用源，失效源不再每轮空打
function buildProbeConfig() {
  const probeSong = PROBE_SONG_POOL[(globalThis.__probeRound || 0) % PROBE_SONG_POOL.length];
  const cfg = {
    gdWy: {
      tier: "core",
      // v11.12 (D9)：补 Range 可播性二次校验（防"网关200+签名过期410"假存活）；GD 探测 ID 暂固定 186016（沙箱不可达，未验证新曲）
      url: `${GD_API}&types=url&source=netease&id=186016&br=320`,
      check: b => !!b && typeof b === "object" && typeof b.url === "string" && b.url.length > 0,
      extractUrl: b => (b && typeof b === "object" && typeof b.url === "string" && b.url.length > 0) ? b.url : null
    },
    xinghaiBackend: {
      tier: "core",
      url: `${XINGHAI_BACKEND_API}?source=kw&name=${encodeURIComponent("晴天")}&singer=${encodeURIComponent("周杰伦")}&songmid=1&interval=&albumName=&quality=128k`,
      headers: { "X-Token": xinghaiBackendToken(), "X-Client": "lx-aggregate/11.7" },
      check: b => !!b && typeof b === "object" && Number(b.code) === 200 && typeof b.url === "string" && b.url.length > 0
    },
    suyin163: {
      tier: "core",
      // v11.12 (D9)：免费歌池轮换 + Range 可播性二次校验（与溯音酷我探测标准一致）
      url: `${SUYIN_163_API}?id=${PROBE_163_IDS[(globalThis.__probeRound || 0) % PROBE_163_IDS.length]}`,
      check: b => !!b && typeof b === "object" && Array.isArray(b.data) && typeof (b.data[0] || {}).url === "string" && b.data[0].url.length > 0,
      extractUrl: b => (b && Array.isArray(b.data) && typeof (b.data[0] || {}).url === "string" && b.data[0].url.length > 0) ? b.data[0].url : null
    },
    suyinKuwo: {
      tier: "core",
      // v11.10 P0：双音质分域探测(flac br=1 + 128k br=7)，任一可播即算源存活；
      // 修复"128k仍410死链但flac已恢复新签名"时单路探测误判整体失效、误摘高音质源
      // v11.11：探测歌曲走 PROBE_SONG_POOL 轮换，防单曲被风控误判
      probes: [
        {
          url: `${SUYIN_KUWO_API}?msg=${encodeURIComponent(probeSong)}&n=1&br=1`,
          check: b => !!b && typeof b === "object" && (!!(b.data && b.data.url) || /音乐链接/.test(String(b.message || ""))),
          extractUrl: b => ((b && b.data && b.data.url) ? b.data.url : (String((b && b.message) || "").match(/音乐链接[：:](\S+)/) || [])[1]) || null
        },
        {
          url: `${SUYIN_KUWO_API}?msg=${encodeURIComponent(probeSong)}&n=1&br=7`,
          check: b => !!b && typeof b === "object" && (!!(b.data && b.data.url) || /音乐链接/.test(String(b.message || ""))),
          extractUrl: b => ((b && b.data && b.data.url) ? b.data.url : (String((b && b.message) || "").match(/音乐链接[：:](\S+)/) || [])[1]) || null
        }
      ]
    },
    wyOuter: {
      tier: "core",
      url: WY_OUTER_API.replace("{id}", "2652820720"),
      headers: { "User-Agent": getMobileUserAgent() },
      checkRes: res => res.statusCode === 200 && /audio|octet|mpeg/i.test(String(res.headers?.["content-type"] || ""))
    },
    kuwoOfficial: {
      tier: "secondary",
      url: `${KUWO_SEARCH_API}?client=kt&all=${encodeURIComponent("晴天 周杰伦")}&pn=0&rn=1&ft=music&rformat=json&encoding=utf8`,
      headers: { "User-Agent": getMobileUserAgent() },
      check: b => {
        const raw = typeof b === "string" ? b : String(b || "");
        return raw.includes("MP3RID") && raw.includes("abslist");
      }
    },
    // v11.9：长青kw/念心kw 302→car-er.kuwo.cn新鲜mp3，Range校验可播(用rid=228908 晴天周杰伦)
    changqingVip: {
      tier: "secondary",
      url: CHANGQING_URL_TEMPLATES.kw.replace("{id}", "228908").replace("{level}", "standard"),
      headers: { "User-Agent": getMobileUserAgent(), "Range": "bytes=0-1023" },
      checkRes: res => (res.statusCode === 200 || res.statusCode === 206) && /audio|octet|mpeg/i.test(String(res.headers?.["content-type"] || "")) && !/kw\.php/.test(String(res.url || ""))
    },
    nianxinVip: {
      tier: "secondary",
      url: NIANXIN_URL_TEMPLATES.kw.replace("{id}", "228908").replace("{level}", "standard"),
      headers: { "User-Agent": getMobileUserAgent(), "Range": "bytes=0-1023" },
      checkRes: res => (res.statusCode === 200 || res.statusCode === 206) && /audio|octet|mpeg/i.test(String(res.headers?.["content-type"] || "")) && !/nxinxz\.com/.test(String(res.url || ""))
    }
  };
  // v14.3：休眠源过滤——连续 PROBE_SLEEP_AFTER_DEAD 轮失败后不再每轮空打；
  // 每 PROBE_WAKE_EVERY_ROUND 轮做一次复活试探（上游恢复/新端点时自动回归）
  const round = globalThis.__probeRound || 0;
  for (const id of Object.keys(cfg)) {
    if (probeState.sleeping[id]) {
      const since = probeState.sleepRound[id] || 0;
      if (round - since < PROBE_WAKE_EVERY_ROUND) {
        delete cfg[id]; // 休眠中且未到复活轮：跳过本轮探测
      } else {
        logWarn(`健康探测: [${id}] 到达复活试探轮，重探`);
      }
    }
  }
  return cfg;
}

// v14.3：分级探测轮次判定（core 每轮 / secondary 每 N 轮一探）
function tierShouldProbe(round, tier) {
  const interval = tier === "secondary" ? PROBE_TIER_SECONDARY_INTERVAL : PROBE_TIER_CORE_INTERVAL;
  return round % interval === 0;
}

const probeState = {
  passCount: {},
  failCount: {},
  // v14.3：失效休眠状态——deadCount 连续失败累计；sleeping=true 进入休眠；sleepRound 记录休眠起点轮
  deadCount: {},
  sleeping: {},
  sleepRound: {},
  running: false
};

async function probeSingleSource(id, cfg) {
  // v11.10 P0：支持多路探测(probes)，任一路"结构+可播"通过即算源存活；
  // 解决溯音酷我"flac已恢复但128k仍410"时，单路(仅128k)探测误判整体失效、误摘高音质源的问题
  const probes = cfg.probes || [{
    url: cfg.url,
    headers: cfg.headers,
    check: cfg.check,
    checkRes: cfg.checkRes,
    extractUrl: cfg.extractUrl
  }];
  try {
    const results = await Promise.all(probes.map(async p => {
      const startProbe = Date.now();
      try {
        const res = await httpRequest(p.url || "", {
          method: "GET",
          headers: { "User-Agent": getMobileUserAgent(), ...(p.headers || {}) },
          timeout: HEALTH_CHECK_TIMEOUT,
          follow_max: 5   // v11.8 P0：统一跟随302，修复wyOuter(outer 302→mp3)被误判失败
        });
        let usable = p.checkRes ? p.checkRes(res) : (p.check ? p.check(res.body) : true);
        // v11.9 P0：结构/状态通过后，对解析出的音频URL做Range可播性二次校验，
        // 识破"网关200、结构完整、但CDN签名已过期410死链"的假存活(如溯音酷我)
        if (usable && typeof p.extractUrl === "function") {
          const audioUrl = p.extractUrl(res.body);
          usable = audioUrl ? await isAudioPlayable(audioUrl) : false;
        }
        return { usable, duration: Date.now() - startProbe };
      } catch (e) {
        return { usable: false, duration: Date.now() - startProbe };
      }
    }));
    const usable = results.some(r => r.usable);
    // v12.1：探测结果并入竞速统计（成功率/均时供 sortChainByHealth 排序复用；
    // 只更新统计、不触发熔断——熔断仅由真实播放请求触发，避免探测与熔断双机制打架）
    recordProbeResult(id, usable, results.reduce((s, r) => s + r.duration, 0) / Math.max(results.length, 1));
    return { usable, raw: null };
  } catch (e) {
    recordProbeResult(id, false, 0);
    return { usable: false, raw: null };
  }
}

// v12.1：探测结果并入竞速统计（见 probeSingleSource）
// v14.1：探测样本独立计数（probe*），与真实请求样本分级加权——探测仅作低权重参考，真实请求主导健康评分
function recordProbeResult(id, usable, avgDuration) {
  const b = getBreaker(id);
  b.probeRequests = (b.probeRequests || 0) + 1;
  if (usable) {
    b.probeSuccess = (b.probeSuccess || 0) + 1;
    b.probeTime = (b.probeTime || 0) + (avgDuration || 0);
  }
}

function applyProbeResult(id, usable) {
  if (usable) {
    probeState.failCount[id] = 0;
    probeState.passCount[id] = (probeState.passCount[id] || 0) + 1;
    // v14.3：探测通过即复活（清休眠），避免复活试探成功后被下一次抖动打回休眠
    delete probeState.deadCount[id];
    delete probeState.sleeping[id];
    delete probeState.sleepRound[id];
    if (probeState.passCount[id] >= PROBE_PASS_REQUIRED) {
      const wasOff = runtimeToggles[id] === false;
      if (wasOff) {
        runtimeToggles[id] = true;
        logInfo(`健康探测: [${id}] 连续${PROBE_PASS_REQUIRED}次探测通过，已自动启用`);
      }
      probeState.passCount[id] = 0; // 重置，避免反复打日志
    }
  } else {
    probeState.passCount[id] = 0;
    probeState.failCount[id] = (probeState.failCount[id] || 0) + 1;
    if (probeState.failCount[id] >= PROBE_FAIL_REQUIRED) {
      const wasOn = runtimeToggles[id] === true;
      if (wasOn) {
        runtimeToggles[id] = false;
        logWarn(`健康探测: [${id}] 连续${PROBE_FAIL_REQUIRED}次探测失败，已自动关闭(恢复后会自动启用)`);
      }
      probeState.failCount[id] = 0;
    }
    // v14.3：连续失败累计 → 休眠（不再每轮空打无效请求）
    probeState.deadCount[id] = (probeState.deadCount[id] || 0) + 1;
    if (probeState.deadCount[id] >= PROBE_SLEEP_AFTER_DEAD && !probeState.sleeping[id]) {
      probeState.sleeping[id] = true;
      probeState.sleepRound[id] = globalThis.__probeRound || 0;
      logWarn(`健康探测: [${id}] 连续${PROBE_SLEEP_AFTER_DEAD}轮失败，进入休眠(每${PROBE_WAKE_EVERY_ROUND}轮复活试探一次)`);
    }
  }
}

async function runHealthCheck() {
  if (probeState.running) return;
  probeState.running = true;
  // v11.11：轮次先递增再构建配置，确保探测歌曲池轮换从首轮生效
  const round = (globalThis.__probeRound = (globalThis.__probeRound || 0) + 1);
  const probeConfig = buildProbeConfig();
  // v14.3：分级探测——核心源每轮，次要源每 PROBE_TIER_SECONDARY_INTERVAL 轮一探
  const ids = Object.keys(probeConfig).filter(id => tierShouldProbe(round, probeConfig[id].tier || "core"));
  logInfo(`健康探测: 开始第${round}轮，共${ids.length}个源(核心每轮/次要${PROBE_TIER_SECONDARY_INTERVAL}轮一探)`);
  // v11.8 P2：改并发探测，一轮从~50s降到~6s
  await Promise.all(ids.map(async id => {
    const result = await probeSingleSource(id, probeConfig[id]);
    applyProbeResult(id, result.usable);
  }));
  const active = Object.keys(runtimeToggles).filter(k => runtimeToggles[k]);
  logInfo(`健康探测: 本轮完成，当前自动启用: ${active.join(", ")}`);
  probeState.running = false;
}

function startHealthCheck() {
  setTimeout(async () => {
    try { await runHealthCheck(); } catch (e) { logWarn(`健康探测异常: ${e.message}`); }
    setTimeout(function tick() {
      runHealthCheck().then(() => {
        setTimeout(tick, HEALTH_CHECK_INTERVAL_MS);
      }).catch(() => {
        setTimeout(tick, HEALTH_CHECK_INTERVAL_MS);
      });
    }, HEALTH_CHECK_INTERVAL_MS);
  }, HEALTH_CHECK_INITIAL_DELAY_MS);
}

const Q = ["128k", "320k", "flac", "flac24bit"];
const PLATFORM_QUALITIES = { wy: Q, tx: Q, kw: Q, kg: Q, mg: Q };
// v11.8 P0-6：上报 qualitys 按真实能力裁剪——不再上报无人能交付的 flac24bit
const REPORT_QUALITIES = {
  wy: ["128k", "320k", "flac"],   // outer/suyin163=128k；GD Studio=flac；suyinKuwo=flac兜底
  tx: ["128k", "320k", "flac"],   // 仅 suyinKuwo 搜索酷我兜底
  kw: ["128k", "320k", "flac"],   // kuwoOfficial/xinghaiBackend=128k；suyinKuwo=flac
  kg: ["128k", "320k", "flac"],   // 仅 suyinKuwo 搜索酷我兜底
  mg: ["128k", "320k", "flac"]    // 仅 suyinKuwo 搜索酷我兜底
};

const PLATFORM_TO_XINGHAI_BACKUP = { wy: "netease", tx: "qq", kw: "kuwo" };
// v13.3 (E11)：音质映射 magic number 收敛——统一 QUALITY_TO_X 表，按官方"源内映射"模型组织（请求音质 → 各源内部编码）
// 各子源只从本表取编码，禁止散落 magic number（gdBrMap 等已并入）
const QUALITY_TO_X = {
  // 通用 br 参考（星海 level 语义 / 长青念心 level）：flac24bit/hires 均 999
  br: { "128k": "128", "192k": "192", "320k": "320", flac: "740", flac24bit: "999", "24bit": "999" },
  // 溯音QQ：br 数值（hires=3/atmos=2/master=1/24bit=1 专用值直传）
  suyinQQ: { "128k": 7, "320k": 5, flac: 4, hires: 3, atmos: 2, master: 1, "24bit": 1 },
  // 酷我系（溯音酷我搜索 br 参数）：flac=1 / 320k=5 / 128k=7
  kuwo: { flac: 1, "320k": 5, "128k": 7, "24bit": 1 },
  // GD Studio：br 字符串（flac/hires 均走 999 真实 flac）
  gd: { "128k": "128", "192k": "320", "320k": "320", flac: "999", flac24bit: "999", hires: "999" }
};
const HIRES_QUALITY_SET = new Set(["24bit", "flac", "flac24bit", "hires", "master", "atmos"]);
// v11.8 P0-4：实际音质降级阶梯（去掉无源区分的192k短接），请求音质放首位再向下降级
const QUALITY_PRIORITY = ["flac24bit", "flac", "320k", "128k"];
// v11.8 P0-1：音质等级数值，用于源能力过滤与缓存音质校验
const QUALITY_RANK = { "128k": 1, "192k": 2, "320k": 3, flac: 4, flac24bit: 5, hires: 4, master: 5, atmos: 5, "24bit": 5 };
function qualityRank(q) { return QUALITY_RANK[String(q || "128k").toLowerCase()] || 1; }
const QUALITY_FIRST = true; // 音质优先模式：解析从请求音质(默认flac)开始逐级降级

const { EVENT_NAMES, request, on, send, utils, env, version } = globalThis.lx;

// ============================================================
// 第三部分：日志 + LRU双层缓存 + 断路器
// ============================================================
// v11.13 D11：console 宿主防御 — 官方移动版「可用宿主环境 API」仅 setTimeout/clearTimeout（无 console 保证）
// 依据：lxmusic.toside.cn/mobile/custom-source 宿主 API 清单 + fork user-api-preload.js 未注入 console + vm 无 console 沙箱复现（修复前加载即抛 TypeError）
const safeConsole = {
  log: (typeof console !== "undefined" && typeof console.log === "function") ? console.log.bind(console) : () => {},
  warn: (typeof console !== "undefined" && typeof console.warn === "function") ? console.warn.bind(console) : () => {},
  error: (typeof console !== "undefined" && typeof console.error === "function") ? console.error.bind(console) : () => {},
};
const LOG_ENABLED = true;
// v12.2：debug 级源级决策日志（默认关；排查时改 LOG_DEBUG=true 或宿主注入 __lxSourceConfig.logDebug=true）
const LOG_DEBUG = (typeof globalThis !== "undefined" && globalThis.__lxSourceConfig && globalThis.__lxSourceConfig.logDebug) || false;
function logInfo(...args) { if (LOG_ENABLED) safeConsole.log("[聚合音源][信息]", ...args); }
function logWarn(...args) { if (LOG_ENABLED) safeConsole.warn("[聚合音源][警告]", ...args); }
function logError(...args) { if (LOG_ENABLED) safeConsole.error("[聚合音源][错误]", ...args); }
function logDebug(...args) { if (LOG_ENABLED && LOG_DEBUG) safeConsole.log("[聚合音源][决策]", ...args); }

// v11.8：直接用原字符串作 Map 键（Map 支持字符串键），省掉32位哈希与碰撞覆盖
function createLRUCache(maxSize, ttl) {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp >= ttl) { map.delete(key); return null; }
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, timestamp: Date.now() });
      if (map.size > maxSize) {
        const firstKey = map.keys().next().value;
        if (firstKey !== undefined) map.delete(firstKey);
      }
    },
    hasExpired(key) {
      const entry = map.get(key);
      if (!entry) return false;
      return Date.now() - entry.timestamp >= ttl;
    },
    getExpired(key) {
      const entry = map.get(key);
      return entry ? entry.value : null;
    }
  };
}
const successCache = createLRUCache(CACHE_MAX_SIZE, CACHE_TTL_MS);
// v12.1：失败缓存 LRU 不再用固定5min TTL——过期由 getFailCached 按失败类型差异化判断(404→1h/410→1min/网络错误不缓存)
const failCache = createLRUCache(FAIL_CACHE_MAX_SIZE, Number.MAX_SAFE_INTEGER);

const breakerMap = new Map();
function getBreaker(sourceId) {
  if (!breakerMap.has(sourceId)) {
    breakerMap.set(sourceId, { state: 'closed', failureCount: 0, lastFailureTime: 0, totalRequests: 0, totalSuccess: 0, totalTime: 0,
      // v14.1：探测样本单独计数（与真实请求分级加权，避免探测污染真实成功率）
      probeRequests: 0, probeSuccess: 0, probeTime: 0 });
  }
  return breakerMap.get(sourceId);
}
function canExecute(sourceId) {
  const b = getBreaker(sourceId);
  if (b.state === 'closed') return true;
  if (b.state === 'open') {
    if (Date.now() - b.lastFailureTime >= BREAKER_COOLDOWN_MS) {
      b.state = 'half-open';
      return true;
    }
    return false;
  }
  return false;
}
function recordSuccess(sourceId, duration) {
  const b = getBreaker(sourceId);
  b.totalRequests++;
  b.totalSuccess++;
  b.totalTime += duration;
  if (b.state === 'half-open') { b.state = 'closed'; b.failureCount = 0; logWarn(`断路器[${sourceId}] 半开试探成功，恢复`); }
  b.failureCount = 0;
}
function recordFailure(sourceId) {
  const b = getBreaker(sourceId);
  b.totalRequests++;
  b.failureCount++;
  b.lastFailureTime = Date.now();
  if (b.state === 'half-open') { b.state = 'open'; logWarn(`断路器[${sourceId}] 半开试探失败，重新熔断`); return; }
  if (b.state === 'closed' && b.failureCount >= BREAKER_THRESHOLD) {
    b.state = 'open';
    logWarn(`断路器[${sourceId}] 连续失败${BREAKER_THRESHOLD}次，熔断${BREAKER_COOLDOWN_MS / 1000}秒`);
  }
}
function getSourceStats(sourceId) {
  const b = getBreaker(sourceId);
  return {
    successRate: b.totalRequests === 0 ? 1 : b.totalSuccess / b.totalRequests,
    avgTime: b.totalSuccess === 0 ? 9999 : b.totalTime / b.totalSuccess,
    state: b.state
  };
}

// v14.1：源健康权重自学习——健康评分 = 真实样本成功率(置信度收缩) − 均时惩罚 − 连续失败惩罚
// 探测样本仅作低权重参考（环境因素多，权重 0.3）；真实请求样本主导
const HEALTH_PRIOR_K = 4;      // 置信度收缩伪计数（样本少时成功率向 0.5 收缩，防止"1 次成功=满分"）
const HEALTH_PROBE_WEIGHT = 0.3; // 探测样本并入权重（低）
const HEALTH_TIME_PENALTY = 0.5; // 均时惩罚系数（归一化到 5000ms）
const HEALTH_STREAK_STEP = 0.08; // 每 1 次连续失败扣分
const HEALTH_STREAK_CAP = 0.5;   // 连续失败惩罚上限
function computeHealthScore(sourceId) {
  const b = getBreaker(sourceId);
  const realReq = Math.max(b.totalRequests - (b.probeRequests || 0), 0);
  const realSuccess = Math.max(b.totalSuccess - (b.probeSuccess || 0), 0);
  // 真实样本成功率（置信度收缩）
  const rateReal = realReq === 0 ? 0.5 : (realSuccess + HEALTH_PRIOR_K * 0.5) / (realReq + HEALTH_PRIOR_K);
  // 探测样本参考（纯探测期：无真实样本时用探测成功率收缩）
  const probeReq = b.probeRequests || 0;
  const probeSuccess = b.probeSuccess || 0;
  const rateProbe = probeReq === 0 ? 0.5 : (probeSuccess + HEALTH_PRIOR_K * 0.5) / (probeReq + HEALTH_PRIOR_K);
  const rate = realReq > 0 ? rateReal : rateProbe; // 真实样本存在时主导，否则退回探测参考
  // 均时惩罚：真实样本均时优先，纯探测用探测均时；无样本按 9999 最劣
  const avgTime = realSuccess > 0
    ? (b.totalTime - (b.probeTime || 0)) / realSuccess
    : (probeSuccess > 0 ? (b.probeTime || 0) / probeSuccess : 9999);
  const timePenalty = Math.min(avgTime / 5000, 1) * HEALTH_TIME_PENALTY;
  // 连续失败惩罚（熔断阈值内递增；已熔断由 canExecute 挡链，此处仅影响参考分）
  const streakPenalty = Math.min(b.failureCount * HEALTH_STREAK_STEP, HEALTH_STREAK_CAP);
  const score = rate - timePenalty - streakPenalty;
  return { score, rate, avgTime, state: b.state };
}

// ============================================================
// 第四部分：HTTP 请求封装
// ============================================================
function httpRequest(url, options = { method: "GET" }) {
  const timeout = options.timeout || TIMEOUT_CONFIG.default;
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    request(url, { timeout, ...options }, (err, res) => {
      const duration = Date.now() - startTime;
      if (err) {
        const code = String(err.message || "").includes("timeout") ? ERROR_CODES.NETWORK_TIMEOUT : ERROR_CODES.NETWORK_ERROR;
        const error = new Error(`${code}: ${err.message}`);
        error.code = code;
        reject(error);
        return;
      }
      let body = res?.body;
      if (typeof body === "string") {
        const trimmed = body.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
          try { body = JSON.parse(trimmed); } catch (e) { /* 保持原始 */ }
        }
      }
      const result = { statusCode: res?.statusCode ?? 0, headers: res?.headers || {}, body, duration, url: res?.url || url };
      if (result.statusCode >= 500) {
        const error = new Error(`${ERROR_CODES.SERVER_ERROR}: HTTP ${result.statusCode}`);
        error.code = ERROR_CODES.SERVER_ERROR;
        reject(error);
      } else if (result.statusCode === 429) {
        const error = new Error(`${ERROR_CODES.RATE_LIMIT}: 被限流`);
        error.code = ERROR_CODES.RATE_LIMIT;
        reject(error);
      } else if (result.statusCode === 410) {
        // v12.1：410 Gone = 签名/直链过期（死链），单独映射，供失败缓存差异化(1min)与诊断
        const error = new Error(`${ERROR_CODES.LINK_EXPIRED}: 链接已过期(HTTP 410)`);
        error.code = ERROR_CODES.LINK_EXPIRED;
        reject(error);
      } else if (result.statusCode === 404) {
        // v12.1：404 = 歌曲/资源不存在，单独映射，供失败缓存差异化(1h)与诊断
        const error = new Error(`${ERROR_CODES.NOT_FOUND}: 资源不存在(HTTP 404)`);
        error.code = ERROR_CODES.NOT_FOUND;
        reject(error);
      } else if (result.statusCode >= 400) {
        const error = new Error(`${ERROR_CODES.NETWORK_ERROR}: HTTP ${result.statusCode}`);
        error.code = ERROR_CODES.NETWORK_ERROR;
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

async function httpRequestWithRetry(url, options = {}, retries = RETRY_TIMES) {
  let lastError = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await httpRequest(url, options);
    } catch (e) {
      lastError = e;
      // 网络错误/超时/5xx临时错误重试；4xx(403/404)与429限流不重试
      if (e.code !== ERROR_CODES.NETWORK_TIMEOUT && e.code !== ERROR_CODES.NETWORK_ERROR && e.code !== ERROR_CODES.SERVER_ERROR) break;
      if (i < retries) {
        const delay = Math.pow(2, i) * 200;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

function buildQueryString(params = {}) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? "?" + parts.join("&") : "";
}

async function httpGet(url, params = {}, timeoutType = 'default') {
  const fullUrl = url + buildQueryString(params);
  const res = await httpRequestWithRetry(fullUrl, { method: "GET", timeout: TIMEOUT_CONFIG[timeoutType] || TIMEOUT_CONFIG.default });
  return res.body;
}

// v11.9 P0：轻量音频可播性判定——Range 取前1KB，206/200音频即视为可播；410/403/超时一律视为死链
async function isAudioPlayable(audioUrl, timeoutMs = 3000) {
  if (!audioUrl || typeof audioUrl !== "string" || !HTTP_URL_REGEX.test(audioUrl)) return false;
  try {
    const res = await httpRequest(audioUrl, {
      method: "GET",
      headers: { "User-Agent": getMobileUserAgent(), "Range": "bytes=0-1023" },
      timeout: timeoutMs,
      follow_max: 5
    });
    const ct = String(res.headers?.["content-type"] || "");
    if (res.statusCode === 206) return true;
    if (res.statusCode === 200 && /audio|octet|mpeg|mp3|flac|ogg|aac/i.test(ct)) return true;
    return false;
  } catch (e) {
    return false; // 410 Gone/403/超时/网络错误 均判定不可播
  }
}

// ============================================================
// 第五部分：歌曲信息与匹配工具
// ============================================================
// v11.12 (D10)：已移除死代码 normalizeQuality/selectQuality/qualityToNetease（链级统一降级，源内直接使用请求音质）
function qualityToSuyinQQ(quality) {
  const q = String(quality || "128k").toLowerCase();
  if (q === "flac24bit") return "hires";
  if (q === "192k") return "320k";
  return QUALITY_TO_X.suyinQQ[q] ? q : "128k";
}

function getMobileUserAgent() {
  return "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
}

// v11.12 (D10)：已移除死代码 getSongId
function getHashOrMid(songInfo) {
  return songInfo?.hash ?? songInfo?.songmid ?? songInfo?.id ?? null;
}

function getQQSongId(songInfo) {
  const mid = songInfo?.meta?.qq?.mid || songInfo?.meta?.mid || songInfo?.songmid ||
    (typeof songInfo?.id === "string" && !/^\d+$/.test(songInfo.id) ? songInfo.id : null);
  if (mid) return { type: "mid", value: mid };
  const songid = songInfo?.meta?.qq?.songid || songInfo?.meta?.songid ||
    (typeof songInfo?.id === "number" ? songInfo.id :
      (typeof songInfo?.id === "string" && /^\d+$/.test(songInfo.id) ? Number(songInfo.id) : null));
  if (songid) return { type: "songid", value: songid };
  return null;
}

// v11.12 (D10)：已移除死代码 normalizeSongInfo/getFirstData
function normalizeKeyword(keyword) {
  if (!keyword) return "";
  return String(keyword)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\w\u4e00-\u9fa5]/g, "")
    .trim()
    .toLowerCase();
}

function titleMatch(a, b) {
  const na = normalizeKeyword(a);
  const nb = normalizeKeyword(b);
  if (!na || !nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function durationMatch(dur1, dur2, threshold = 5) {
  if (!dur1 || !dur2) return true;
  return Math.abs(Number(dur1) - Number(dur2)) <= threshold;
}

function buildSearchKeywords(songInfo) {
  const keywords = [];
  const name = songInfo?.name || "";
  const album = songInfo?.albumName || songInfo?.album || "";
  const singer = songInfo?.singer || "";
  if (name && album) {
    const kw = normalizeKeyword(name + album);
    if (kw) keywords.push({ keyword: kw, strict: true });
  }
  if (name && singer) {
    const kw = normalizeKeyword(name + singer);
    if (kw) keywords.push({ keyword: kw, strict: true });
  }
  if (name) {
    const kw = normalizeKeyword(name);
    if (kw) keywords.push({ keyword: kw, strict: false });
  }
  return keywords;
}

// v11.12 P0-1 (D1)：片段/试听特征词。必须对原始歌名匹配（normalizeKeyword 会删括号内容，如"难却(15秒0.8x片段)"归一化后与"难却"相同）
const FRAGMENT_RE = /(15\s*秒|0\.?\s*8x|片段|试听|demo|preview|teaser)/i;

// v11.12 P0-4 (D4)：时长归一化到秒（兼容 ms/秒混用：>5000 视为毫秒）
function normalizeDurationSec(d) {
  const v = Number(d);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 5000 ? Math.floor(v / 1000) : Math.round(v);
}

function songInfoMatch(responseData, songInfo) {
  const song = responseData?.song || responseData?.data?.song || "";
  const singer = responseData?.singer || responseData?.data?.singer || "";
  const album = responseData?.album || responseData?.data?.album || "";
  if (!titleMatch(song, songInfo?.name || "")) return false;
  // v11.12 P0-1 (D1)：目标歌名无片段特征词而返回歌名含 → 拒绝（防《难却》匹配到15秒0.8x片段）
  const targetName = String(songInfo?.name || "");
  if (targetName && song && !FRAGMENT_RE.test(targetName) && FRAGMENT_RE.test(String(song))) return false;
  if (songInfo?.singer && singer && !titleMatch(singer, songInfo.singer)) return false;
  if ((songInfo?.albumName || songInfo?.album) && album && !titleMatch(album, songInfo.albumName || songInfo.album)) return false;
  // v11.12 P0-4 (D4)：双方时长已知且差>5s → 拒绝（片段版时长明显短于完整版）
  const tDur = normalizeDurationSec(songInfo?.duration);
  const rDur = normalizeDurationSec(responseData?.duration || responseData?.data?.duration || responseData?.musicInfo?.duration);
  if (tDur && rDur && !durationMatch(tDur, rDur, 5)) return false;
  return true;
}

function parseMessageSongInfo(message) {
  if (!message) return null;
  const result = {};
  const lines = String(message).split("\n");
  for (const line of lines) {
    if (line.startsWith("歌名：")) result.song = line.replace("歌名：", "").trim();
    if (line.startsWith("歌手：")) result.singer = line.replace("歌手：", "").trim();
    if (line.startsWith("专辑：")) result.album = line.replace("专辑：", "").trim();
    // v11.12 P0-4 (D4)：消息路径带时长时一并解析，供时长校验使用
    if (line.startsWith("时长：")) result.duration = Number(line.replace("时长：", "").trim()) || 0;
  }
  return result.song ? result : null;
}

function validateUrl(url, sourceName) {
  if (!url || typeof url !== "string") throw new Error(`${ERROR_CODES.NOT_FOUND}: ${sourceName}返回空URL`);
  if (!HTTP_URL_REGEX.test(url.trim())) throw new Error(`${ERROR_CODES.PARAM_ERROR}: ${sourceName}非法URL格式`);
  return url;
}

// v11.12 P0-3 (D2)：kw CDN 音频链 http→https（实测 https 升级后 206 可播，部分网络/播放器对 http 音频处理异常）
function upgradeToHttps(url) {
  if (!url || typeof url !== "string") return url;
  return url.replace(/^http:\/\//i, "https://");
}

// v11.8 P1：缓存 key 加入 songId 维度，避免同名不同版本冲突
function buildCacheKey(prefix, songInfo, quality = "") {
  const id = songInfo?.id || songInfo?.songmid || songInfo?.hash || songInfo?.rid || "";
  const name = songInfo?.name || "";
  const singer = songInfo?.singer || "";
  const album = songInfo?.albumName || songInfo?.album || "";
  return `${prefix}_${id}_${name}_${singer}_${album}_${quality}`;
}

// v11.8 P1：缓存值记录实际音质 {url, quality}，命中/过期兜底时校验
function getCachedUrl(cacheKey) { return successCache.get(cacheKey); }
function setCachedUrl(cacheKey, url, quality) { successCache.set(cacheKey, { url, quality: quality || "128k" }); }
// v12.1：失败缓存差异化——按失败类型记录，get 时按差异化 TTL 判断过期（404→1h / 410→1min / 网络错误不缓存）
function setFailCached(failKey, code) { failCache.set(failKey, { code: code || ERROR_CODES.NETWORK_ERROR, ts: Date.now() }); }
function getFailCached(failKey) {
  const entry = failCache.get(failKey);
  if (!entry) return false;
  const ttl = FAIL_CACHE_TTL_BY_CODE[entry.code];
  if (ttl === undefined) return true; // 未配置的 code 按旧行为 5min
  if (ttl === 0) return false;        // 网络错误/限流 → 不缓存
  return (Date.now() - entry.ts) < ttl;
}

// ============================================================
// 第六部分：音源实现
// ============================================================

/* 网易云官方 outer 直连（免费歌302直链，固定128k，VIP/无版权歌404自动跳过） */
async function wyOuterGetUrl(platform, songId, quality, songInfo) {
  if (platform !== "wy") throw new Error(`${ERROR_CODES.PARAM_ERROR}: 网易云官方仅支持wy平台`);
  const id = songId ?? songInfo?.id ?? songInfo?.songmid;
  if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 网易云官方缺少歌曲ID`);
  const url = WY_OUTER_API.replace("{id}", encodeURIComponent(String(id)));
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "User-Agent": getMobileUserAgent() },
    timeout: TIMEOUT_CONFIG.parse,
    follow_max: 5
  });
  const ct = String(res.headers?.["content-type"] || "");
  if (res.statusCode !== 200 || !/audio|octet|mpeg/i.test(ct)) {
    throw new Error(`${ERROR_CODES.NOT_FOUND}: 网易云该歌曲不可试听(可能需VIP)，跳过`);
  }
  return res.url || url;
}

/* 酷我官方直连（自研：搜索 r.s → rid → convert_url，固定128k真实mp3，无第三方） */
function kuwoUnescape(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

async function kuwoOfficialSearch(keyword, rn = 10) {
  const url = `${KUWO_SEARCH_API}?client=kt&all=${encodeURIComponent(keyword)}&pn=0&rn=${rn}&ft=music&rformat=json&encoding=utf8`;
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "User-Agent": getMobileUserAgent() },
    timeout: TIMEOUT_CONFIG.search
  });
  const raw = typeof res.body === "string" ? res.body : String(res.body || "");
  // 酷我返回 Python repr 风格(单引号)，清洗为 JSON
  const cleaned = raw.replace(/'/g, '"');
  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (e) { /* 解析失败走正则兜底 */ }
  if (parsed && Array.isArray(parsed.abslist)) {
    return parsed.abslist.map(item => ({
      rid: String(item.MP3RID || "").replace("MP3_", ""),
      name: kuwoUnescape(item.NAME),
      singer: kuwoUnescape(item.ARTIST),
      duration: Number(item.DURATION) || 0
    })).filter(i => i.rid);
  }
  // 正则兜底
  const items = [];
  const blockRe = /\{'MP3RID':'MP3_(\d+)'/g;
  let m;
  while ((m = blockRe.exec(raw))) {
    items.push({ rid: m[1], name: "", singer: "", duration: 0 });
  }
  return items;
}

/* ============================================================
 * v15.0：歌词/封面透出（App fork 已支持 lyric/pic action，音源声明即注册）
 * 实证：网易云公开 lyric(带时间标签) / detail(picUrl) 接口可用；酷我搜索 abslist 含 hts_MVPIC 封面；
 *      酷我歌词无稳定公开接口、tx/kg/mg 无签名接口 → 对应平台不声明，App 自动走内置源兜底
 * ============================================================ */

// 酷我封面搜索（单引号 Python repr → 清洗 JSON，取 abslist[0].hts_MVPIC）
async function kuwoPicSearch(keyword) {
  const url = `${KUWO_SEARCH_API}?client=kt&all=${encodeURIComponent(keyword)}&pn=0&rn=1&ft=music&rformat=json&encoding=utf8`;
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "User-Agent": getMobileUserAgent() },
    timeout: TIMEOUT_CONFIG.search
  });
  const raw = typeof res.body === "string" ? res.body : String(res.body || "");
  const cleaned = raw.replace(/'/g, '"');
  try {
    const parsed = JSON.parse(cleaned);
    const item = parsed?.abslist?.[0];
    if (item) {
      // hts_MVPIC 为完整 https 封面；MVPIC 为短路径需拼 img2.kuwo.cn 前缀
      const pic = item.hts_MVPIC || (item.MVPIC ? `https://img2.kuwo.cn/${item.MVPIC}` : null);
      if (typeof pic === "string" && /^https?:/.test(pic)) return pic;
    }
  } catch (e) { /* 解析失败走 NOT_FOUND */ }
  throw new Error(`${ERROR_CODES.NOT_FOUND}: 酷我封面获取失败`);
}

// 歌词透出：仅 wy（网易云公开接口），返回 {lyric, tlyric, rlyric}（App verifyLyricInfo 校验 lyric 非空且≤51200）
async function getLyricForPlatform(platform, songInfo) {
  if (!songInfo || typeof songInfo !== "object") throw new Error(`${ERROR_CODES.PARAM_ERROR}: 无效的歌曲信息`);
  if (platform !== "wy") throw new Error(`${ERROR_CODES.NOT_FOUND}: ${platform} 平台暂无稳定歌词接口`);
  const id = songInfo?.songmid || songInfo?.id;
  if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 网易云歌词缺少歌曲ID`);
  const res = await httpGet(WY_LYRIC_API, { id: String(id), lv: 1, kv: 1, tv: -1 }, 'parse');
  const lyric = res?.lrc?.lyric;
  if (typeof lyric !== "string" || !lyric.length) throw new Error(`${ERROR_CODES.NOT_FOUND}: 网易云歌词不存在或需VIP`);
  return {
    lyric,
    tlyric: (typeof res?.tlyric?.lyric === "string" && res.tlyric.lyric.length) ? res.tlyric.lyric : null,
    rlyric: null
  };
}

// 封面透出：wy 用 detail 接口 picUrl；kw 用搜索接口 hts_MVPIC；返回 https 字符串 URL（App 校验）
async function getPicForPlatform(platform, songInfo) {
  if (!songInfo || typeof songInfo !== "object") throw new Error(`${ERROR_CODES.PARAM_ERROR}: 无效的歌曲信息`);
  if (platform === "wy") {
    const id = songInfo?.songmid || songInfo?.id;
    if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 网易云封面缺少歌曲ID`);
    const res = await httpGet(WY_DETAIL_API, { id: String(id), ids: `[${String(id)}]` }, 'parse');
    const picUrl = res?.songs?.[0]?.picUrl;
    if (typeof picUrl !== "string" || !/^https?:/.test(picUrl)) throw new Error(`${ERROR_CODES.NOT_FOUND}: 网易云封面获取失败`);
    return picUrl;
  }
  if (platform === "kw") {
    const keyword = songInfo?.name ? `${songInfo.name} ${songInfo?.singer || ""}`.trim() : "";
    if (!keyword) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 酷我封面缺少歌曲名`);
    return kuwoPicSearch(keyword);
  }
  throw new Error(`${ERROR_CODES.NOT_FOUND}: ${platform} 平台暂无稳定封面接口`);
}

async function kuwoOfficialConvert(rid) {
  if (!rid) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 酷我官方缺少rid`);
  const url = `${KUWO_CONVERT_API}?type=convert_url&rid=${encodeURIComponent(rid)}&format=mp3&response=url`;  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "User-Agent": getMobileUserAgent() },
    timeout: TIMEOUT_CONFIG.parse
  });
  const text = typeof res.body === "string" ? res.body.trim() : String(res.body || "").trim();
  if (!text || text === "refuse request!" || !HTTP_URL_REGEX.test(text)) {
    throw new Error(`${ERROR_CODES.NOT_FOUND}: 酷我官方convert_url未返回链接`);
  }
  return text;
}

async function kuwoOfficialGetUrl(platform, songId, quality, songInfo) {
  if (platform !== "kw") throw new Error(`${ERROR_CODES.PARAM_ERROR}: 酷我官方仅支持kw平台`);
  if (!songInfo?.name) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 酷我官方需要歌曲名`);
  const cacheKey = buildCacheKey("kwoff", songInfo, "128k");
  const cached = getCachedUrl(cacheKey);
  if (cached && cached.url) return cached.url;
  const targetName = normalizeKeyword(songInfo.name);
  const targetSinger = normalizeKeyword(songInfo.singer);
  const items = await kuwoOfficialSearch(`${songInfo.name} ${songInfo.singer || ""}`.trim(), 10);
  if (!items.length) throw new Error(`${ERROR_CODES.NOT_FOUND}: 酷我官方搜索无结果`);
  // 匹配优先级：歌名精确 → 歌名包含 → 第一首；歌手/时长辅助校验
  let match = null;
  for (const item of items) {
    if (normalizeKeyword(item.name) === targetName) { match = item; break; }
  }
  if (!match) {
    for (const item of items) {
      const n = normalizeKeyword(item.name);
      if (n && n.includes(targetName)) { match = item; break; }
    }
  }
  if (!match) match = items[0];
  const url = await kuwoOfficialConvert(match.rid);
  setCachedUrl(cacheKey, url, "128k");
  return url;
}

/* ikun 服务器源（需卡密，默认关闭；v13.4 卡密从 USER_CONFIG.ikunApiKey 读取，开配置即用） */
async function ikunGetUrl(platform, songId, quality, songInfo) {
  if (!USER_CONFIG.ikunApiKey) throw new Error(`${ERROR_CODES.CONFIG_ERROR}: ikun未配置卡密(USER_CONFIG.ikunApiKey)`);
  if (platform !== "kw" && platform !== "wy") throw new Error(`${ERROR_CODES.PARAM_ERROR}: ikun仅支持kw/wy平台`);
  const id = songInfo?.hash ?? songInfo?.songmid ?? songId;
  if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: ikun缺少歌曲ID`);
  const url = `${IKUN_API}/url?source=${encodeURIComponent(platform)}&songId=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality || "128k")}`;
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", "User-Agent": getMobileUserAgent(), "X-Request-Key": USER_CONFIG.ikunApiKey },
    timeout: TIMEOUT_CONFIG.parse,
    follow_max: 5
  });
  const body = res.body;
  if (!body || typeof body !== "object" || Number.isNaN(Number(body.code))) throw new Error(`${ERROR_CODES.SERVER_ERROR}: ikun返回无效`);
  const code = Number(body.code);
  if (code === 200 && body.url) return body.url;
  if (code === 403) throw new Error(`${ERROR_CODES.CONFIG_ERROR}: ikun卡密失效/鉴权失败`);
  if (code === 429) throw new Error(`${ERROR_CODES.RATE_LIMIT}: ikun请求过频`);
  throw new Error(`${ERROR_CODES.NOT_FOUND}: ikun ${body.message || "获取URL失败"}`);
}

/* GD Studio（v11.8接入：仅wy，br=999真实flac/br=320 320k/br=128 128k；限5min50次，仅用于wy高音质链，高音质优先、不进128k兜底竞速） */
async function gdWyGetUrl(platform, songId, quality, songInfo) {
  if (platform !== "wy") throw new Error(`${ERROR_CODES.PARAM_ERROR}: GD Studio仅支持网易云`);
  const id = songId ?? songInfo?.id;
  if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 缺少wy songId`);
  const q = String(quality || "flac").toLowerCase();
  // v13.3：音质编码统一走 QUALITY_TO_X.gd（原 gdBrMap 已并入）
  const br = QUALITY_TO_X.gd[q] || "320";
  const url = `${GD_API}&types=url&source=netease&id=${encodeURIComponent(id)}&br=${br}`;
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "User-Agent": "LX-Music-Mobile", Accept: "application/json" },
    timeout: TIMEOUT_CONFIG.parse
  });
  const body = res.body;
  if (!body || typeof body !== "object" || !body.url) throw new Error((body && body.message) || `${ERROR_CODES.NOT_FOUND}: GD Studio未返回可用URL`);
  return body.url;
}

/* 星海备（实测域名不可解析，默认关闭，保留函数便于恢复） */
async function xinghaiBackupGetUrl(platform, songId, quality, songInfo) {
  const source = PLATFORM_TO_XINGHAI_BACKUP[platform];
  if (!source) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 星海备不支持该平台`);
  const id = songId ?? getHashOrMid(songInfo);
  if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 缺少songId`);
  const selectedQuality = String(quality || "128k").toLowerCase(); // v11.12 (D10)：链级已过滤，直接音质
  return `${XINGHAI_BACKUP_API}?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&type=url&br=${encodeURIComponent(selectedQuality)}`;
}

/* 星海后端主域聚合（v11.8：仅 kw；v12.0：128k/320k/flac 三档，E10 实测） */
function xinghaiBackendToken() {
  try {
    const payload = {
      // v13.4：device_id 可配置（USER_CONFIG.xinghaiDeviceId），默认自动生成
      device_id: USER_CONFIG.xinghaiDeviceId || ('lx-' + Math.random().toString(36).substring(2, 10)),
      ip: '0.0.0.0',
      timestamp: Math.floor(Date.now() / 1000),
      random: Math.random().toString(36).substring(2, 12)
    };
    if (globalThis.lx?.utils?.buffer?.from) {
      const buf = globalThis.lx.utils.buffer.from(JSON.stringify(payload), 'utf-8');
      return globalThis.lx.utils.buffer.bufToString(buf, 'base64');
    }
    return btoa(JSON.stringify(payload));
  } catch (e) {
    return '';
  }
}
async function xinghaiBackendGetUrl(platform, songId, quality, songInfo) {
  if (platform !== "kw") {
    throw new Error(`${ERROR_CODES.PARAM_ERROR}: 星海后端主域仅接入kw(wy签名URL本机403疑绑定后端出口IP，需家庭宽带自验后再开)`);
  }
  // v12.0 (E10)：后端实测支持 128k/320k/flac 三档（flac24bit 亦返回 flac 同链，故 maxQuality 记为 flac），不再限制 128k
  const selectedQuality = String(quality || "128k").toLowerCase();
  const id = songId ?? getHashOrMid(songInfo) ?? "1";
  const params = {
    source: "kw",
    name: songInfo?.name || '',
    singer: songInfo?.singer || '',
    songmid: id,
    interval: songInfo?.interval || songInfo?.duration || '',
    albumName: songInfo?.albumName || songInfo?.album || '',
    quality: selectedQuality
  };
  const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const res = await httpRequestWithRetry(`${XINGHAI_BACKEND_API}?${query}`, {
    method: "GET",
    headers: {
      "X-Token": xinghaiBackendToken(),
      "X-Client": "lx-aggregate/12.0",
      "User-Agent": "LX-Music-Mobile"
    },
    timeout: TIMEOUT_CONFIG.parse
  });
  const body = res.body;
  if (!body || typeof body !== "object") throw new Error(`${ERROR_CODES.SERVER_ERROR}: 星海后端返回无效`);
  if (Number(body.code) !== 200 || !body.url) throw new Error(body.msg ? `${ERROR_CODES.NOT_FOUND}: ${body.msg}` : `${ERROR_CODES.NOT_FOUND}: 星海后端无可用链接`);
  // v12.0 (D2 模式)：实测 https 同路径 206 可播，http→https 升级，避免明文播放受限
  return String(body.url).replace(/^http:\/\//i, "https://");
}

/* Huibq（实测仅酷我真实，其他平台假兜底，默认关闭） */
async function huibqGetUrl(platform, songId, quality, songInfo) {
  if (!HUIBQ_API || !HUIBQ_REQUEST_KEY) throw new Error(`${ERROR_CODES.CONFIG_ERROR}: Huibq未配置`);
  const songIdVal = songInfo?.hash ?? songInfo?.songmid ?? songId;
  if (!songIdVal) throw new Error(`${ERROR_CODES.PARAM_ERROR}: Huibq缺少ID`);
  const selectedQuality = String(quality || "128k").toLowerCase(); // v11.12 (D10)：链级已过滤，直接音质
  const url = `${HUIBQ_API}/url/${platform}/${encodeURIComponent(songIdVal)}/${encodeURIComponent(selectedQuality)}`;
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", "User-Agent": getMobileUserAgent(), "X-Request-Key": HUIBQ_REQUEST_KEY },
    timeout: TIMEOUT_CONFIG.parse
  });
  const body = res.body;
  if (!body || typeof body !== "object" || Number.isNaN(Number(body.code))) throw new Error(`${ERROR_CODES.SERVER_ERROR}: Huibq返回无效`);
  if (Number(body.code) !== 0 || !body.url) throw new Error(body.msg || `${ERROR_CODES.NOT_FOUND}: Huibq未返回URL`);
  return body.url;
}

/* 聆川（未配置，默认关闭；v13.4 密钥从 USER_CONFIG.lingchuanApiKey 读取，开配置即用） */
async function lingchuanGetUrl(platform, songId, quality, songInfo) {
  if (!LINGCHUAN_API) throw new Error(`${ERROR_CODES.CONFIG_ERROR}: 聆川未配置`);
  const hashOrMid = songInfo?.hash ?? songInfo?.songmid;
  if (!hashOrMid) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 聆川缺少hash/songmid`);
  const selectedQuality = String(quality || "128k").toLowerCase(); // v11.12 (D10)：链级已过滤，直接音质
  const url = `${LINGCHUAN_API}/url?source=${encodeURIComponent(platform)}&songId=${encodeURIComponent(hashOrMid)}&quality=${encodeURIComponent(selectedQuality)}`;
  const res = await httpRequestWithRetry(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", "User-Agent": getMobileUserAgent(), ...(USER_CONFIG.lingchuanApiKey ? { "Authorization": `Bearer ${USER_CONFIG.lingchuanApiKey}` } : {}) },
    follow_max: 5,
    timeout: TIMEOUT_CONFIG.parse
  });
  const body = res.body;
  if (!body || typeof body !== "object" || Number.isNaN(Number(body.code))) throw new Error(`${ERROR_CODES.SERVER_ERROR}: 聆川返回无效`);
  if (Number(body.code) !== 200 || !body.url) throw new Error(body.message || `${ERROR_CODES.NOT_FOUND}: 聆川未返回URL`);
  return body.url;
}

/* 溯音QQ（实测-403维护中，默认关闭） */
async function suyinQQGetUrl(songInfo, quality) {
  const qqId = getQQSongId(songInfo);
  if (!qqId) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 溯音QQ缺少songmid/id`);
  const normalizedQuality = qualityToSuyinQQ(quality);
  const startBr = QUALITY_TO_X.suyinQQ[normalizedQuality] || QUALITY_TO_X.suyinQQ["128k"];
  const brList = [startBr, 4, 5, 7]
    .filter((val, idx, arr) => arr.indexOf(val) === idx && val >= startBr)
    .sort((a, b) => a - b);
  let lastError = null;
  for (const br of brList) {
    try {
      const reqParams = { key: SUYIN_QQ_KEY, type: "json", br, n: 1 };
      if (qqId.type === "mid") reqParams.mid = qqId.value;
      else reqParams.songid = qqId.value;
      const res = await httpGet(SUYIN_QQ_API, reqParams, 'parse');
      if (res?.music) return res.music;
      if (res?.url) return res.url;
      if (res?.message) {
        const match = String(res.message).match(/音频链接[：:](.+?)(?:\n|$)/);
        if (match && match[1]) return match[1].trim();
      }
      throw new Error(`${ERROR_CODES.NOT_FOUND}: 溯音QQ未找到音频链接`);
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error(`${ERROR_CODES.NOT_FOUND}: 溯音QQ全部音质尝试失败`);
}

/* 溯音163（免费歌真实128k直链，VIP歌url:null自动跳过，默认开启） */
async function suyin163GetUrl(songInfo) {
  const id = songInfo?.songmid || songInfo?.id;
  if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 溯音163缺少songmid/id`);
  const res = await httpGet(SUYIN_163_API, { id }, 'parse');
  if (res?.code === 0 && res?.data) {
    const item = Array.isArray(res.data) ? res.data[0] : res.data;
    if (item?.url) return item.url;
  }
  throw new Error(`${ERROR_CODES.NOT_FOUND}: 溯音163获取失败`);
}

/* 溯音酷我（实测可用：核心音源 + 全平台兜底，支持flac/320k/128k） */
async function suyinKuwoSearch(keyword, br, songInfo = null) {
  const res = await httpGet(SUYIN_KUWO_API, { msg: keyword, n: 1, br }, 'parse');
  if (res?.data?.url) {
    if (songInfo && !songInfoMatch(res, songInfo)) throw new Error(`${ERROR_CODES.MISMATCH}: 溯音酷我歌曲信息不匹配`);
    return res.data.url;
  }
  if (res?.message) {
    const match = String(res.message).match(/音乐链接[：:](\S+)/);
    if (match && match[1]) {
      if (songInfo) {
        const parsed = parseMessageSongInfo(res.message);
        if (parsed && !songInfoMatch(parsed, songInfo)) throw new Error(`${ERROR_CODES.MISMATCH}: 溯音酷我歌曲信息不匹配`);
      }
      return match[1];
    }
  }
  throw new Error(`${ERROR_CODES.NOT_FOUND}: 溯音酷我未找到链接`);
}

async function suyinKuwoGetUrl(songInfo, quality) {
  if (!songInfo?.name) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 溯音酷我需要歌曲名`);
  const cacheKey = buildCacheKey("kw", songInfo, quality);
  const cached = getCachedUrl(cacheKey);
  if (cached && cached.url) return cached.url;
  // v11.12 (D10)：链级已按 maxQuality 过滤，此处直接用请求音质，不再二次降级
  const br = QUALITY_TO_X.kuwo[String(quality || "128k").toLowerCase()] || 1;
  const keywords = buildSearchKeywords(songInfo);
  let lastError = null;
  for (const item of keywords) {
    try {
      // v11.12 P0-2：兜底档(strict=false)也做歌名校验+时长校验（轻量：歌手/专辑可放宽，但歌名与时长必须一致）
      const url = await suyinKuwoSearch(item.keyword, br, item.strict ? songInfo : { name: songInfo.name, duration: songInfo.duration });
      if (url) {
        // v11.9 P0：解析出的酷我CDN链接必须Range可播，否则视为签名过期死链(410)，不缓存、不计成功，继续下一源
        // v11.12 P0-3 (D2)：先升级 https 再校验，确保返回的 https 直链真实可播
        const httpsUrl = upgradeToHttps(url);
        if (!await isAudioPlayable(httpsUrl, 2500)) {
          throw new Error(`${ERROR_CODES.NOT_FOUND}: 溯音酷我签名URL已过期(CDN 410)，不可播`);
        }
        setCachedUrl(cacheKey, httpsUrl, String(quality || "128k").toLowerCase());
        return httpsUrl;
      }
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error(`${ERROR_CODES.NOT_FOUND}: 溯音酷我失败`);
}

/* 溯音咪咕（实测502，默认关闭） */
async function suyinMiguGetUrl(songInfo) {
  if (!songInfo?.name) throw new Error(`${ERROR_CODES.PARAM_ERROR}: 溯音咪咕需要歌曲名`);
  const cacheKey = buildCacheKey("mg", songInfo);
  const cached = getCachedUrl(cacheKey);
  if (cached && cached.url) return cached.url;
  const keywords = buildSearchKeywords(songInfo);
  let lastError = null;
  for (const item of keywords) {
    try {
      const res = await httpGet(SUYIN_MIGU_API, { gm: item.keyword, n: 1, num: 1, type: "json" }, 'parse');
      if (res?.code === 200 && res?.musicInfo) {
        // v11.12 P0-2：兜底档也做歌名校验+时长校验（与溯音酷我一致，轻量：歌手/专辑可放宽）
        if (!songInfoMatch(res, item.strict ? songInfo : { name: songInfo.name, duration: songInfo.duration })) throw new Error(`${ERROR_CODES.MISMATCH}: 溯音咪咕歌曲信息不匹配`);
        setCachedUrl(cacheKey, res.musicInfo, "128k");
        return res.musicInfo;
      }
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error(`${ERROR_CODES.NOT_FOUND}: 溯音咪咕失败`);
}

/* 溯音统一入口 */
async function suyinGetUrl(platform, songId, quality, songInfo) {
  switch (platform) {
    case "tx": return suyinQQGetUrl(songInfo, quality);
    case "wy": return suyin163GetUrl(songInfo);
    case "kw": return suyinKuwoGetUrl(songInfo, quality);
    case "mg": return suyinMiguGetUrl(songInfo);
    default: throw new Error(`${ERROR_CODES.PARAM_ERROR}: 溯音不支持该平台`);
  }
}

/* 长青/念心SVIP（v11.9实测仅kw恢复：302→car-er.kuwo.cn新鲜mp3；其余平台仍403/401/404；v11.12 D10模板工厂化） */
function createTemplateVipSource(templateUrl, rejectRe, sourceName) {
  return async function templateVipGetUrl(platform, songId, quality, songInfo) {
    if (platform !== "kw") throw new Error(`${ERROR_CODES.PARAM_ERROR}: ${sourceName}今日仅kw恢复(其余平台仍403/401/404)`);
    const id = getPlatformSongId(platform, songInfo);
    if (!id) throw new Error(`${ERROR_CODES.PARAM_ERROR}: ${sourceName}缺少kw rid`);
    // 仅128k测通，固定standard级别，忽略请求音质
    const target = templateUrl.replace("{id}", encodeURIComponent(String(id))).replace("{level}", encodeURIComponent("standard"));
    // v11.9：跟随302取car-er.kuwo.cn新鲜mp3直链（Range轻量校验，不下载全曲）
    const res = await httpRequestWithRetry(target, {
      method: "GET",
      headers: { "User-Agent": getMobileUserAgent(), "Range": "bytes=0-1023" },
      timeout: TIMEOUT_CONFIG.parse,
      follow_max: 5
    });
    const finalUrl = res.url || target;
    if (!HTTP_URL_REGEX.test(finalUrl) || rejectRe.test(finalUrl)) {
      throw new Error(`${ERROR_CODES.NOT_FOUND}: ${sourceName}未跟随到音频直链`);
    }
    // v11.12 P0-3 (D2)：http→https 升级
    return upgradeToHttps(finalUrl);
  };
}

const changqingGetUrl = createTemplateVipSource(CHANGQING_URL_TEMPLATES.kw, /kw\.php/, "长青");
const nianxinGetUrl = createTemplateVipSource(NIANXIN_URL_TEMPLATES.kw, /nxinxz\.com/, "念心");

function getPlatformSongId(platform, songInfo) {
  if (platform === "kg") return songInfo?.hash || songInfo?.songmid || songInfo?.id || songInfo?.rid || songInfo?.mid || null;
  if (platform === "tx") {
    const qqId = getQQSongId(songInfo);
    if (qqId?.value) return qqId.value;
  }
  return songInfo?.songmid || songInfo?.id || songInfo?.songId || songInfo?.rid || songInfo?.hash || null;
}

// v15.2：健康统计快照——供 App 健康面板/巡检消费；返回各源成功率/均时/熔断状态/健康分
function getHealthSnapshot() {
  const snapshot = {};
  for (const id of Object.keys(SOURCE_HANDLERS)) {
    const h = SOURCE_HANDLERS[id];
    const stats = getSourceStats(id);
    const score = computeHealthScore(id);
    snapshot[id] = {
      name: h.name,
      maxQuality: h.maxQuality,
      enabled: runtimeToggles[id] !== false,
      successRate: stats.successRate,
      avgTime: stats.avgTime,
      state: stats.state,
      healthScore: Number(score.score.toFixed(3))
    };
  }
  return snapshot;
}

// ============================================================
// 第七部分：音源注册表 + 调度（源级音质过滤 + 竞速回退 + 6s整体超时）
// ============================================================
// v11.8 P0-1：每个源标注 maxQuality 真实能力；buildSourceChain 按请求音质过滤，杜绝128k源冒充flac竞速
const SOURCE_HANDLERS = {
  gdWy: { id: "gdWy", name: "GD Studio(网易)", fn: gdWyGetUrl, maxQuality: "flac" },
  wyOuter: { id: "wyOuter", name: "网易云官方", fn: wyOuterGetUrl, maxQuality: "128k" },
  kuwoOfficial: { id: "kuwoOfficial", name: "酷我官方直连", fn: kuwoOfficialGetUrl, maxQuality: "128k" },
  ikun: { id: "ikun", name: "ikun", fn: ikunGetUrl, maxQuality: "flac" },
  xinghaiBackup: { id: "xinghaiBackup", name: "星海备", fn: xinghaiBackupGetUrl, maxQuality: "128k" },
  xinghaiBackend: { id: "xinghaiBackend", name: "星海后端", fn: xinghaiBackendGetUrl, maxQuality: "flac" },
  huibq: { id: "huibq", name: "Huibq", fn: huibqGetUrl, maxQuality: "320k" },
  lingchuan: { id: "lingchuan", name: "聆川", fn: lingchuanGetUrl, maxQuality: "320k" },
  suyinQQ: { id: "suyinQQ", name: "溯音QQ", fn: (platform, songId, quality, songInfo) => suyinGetUrl("tx", songId, quality, songInfo), maxQuality: "flac" },
  suyin163: { id: "suyin163", name: "溯音163", fn: (platform, songId, quality, songInfo) => suyinGetUrl("wy", songId, quality, songInfo), maxQuality: "128k" },
  suyinKuwo: { id: "suyinKuwo", name: "溯音酷我", fn: (platform, songId, quality, songInfo) => suyinKuwoGetUrl(songInfo, quality), maxQuality: "flac", verified: true }, // v14.2：内部做 songInfoMatch 校验，竞速优先
  suyinMigu: { id: "suyinMigu", name: "溯音咪咕", fn: (platform, songId, quality, songInfo) => suyinGetUrl("mg", songId, quality, songInfo), maxQuality: "flac", verified: true }, // v14.2：内部做 songInfoMatch 校验，竞速优先
  changqingVip: { id: "changqingVip", name: "长青kw", fn: changqingGetUrl, maxQuality: "128k" },
  nianxinVip: { id: "nianxinVip", name: "念心kw", fn: nianxinGetUrl, maxQuality: "128k" }
};

// 构建音源链：按平台 + 请求音质过滤源能力（maxQuality >= 请求音质），高音质源在前
function buildSourceChain(platform, quality) {
  const chain = [];
  const t = runtimeToggles;
  const q = String(quality || "128k").toLowerCase();
  const canDo = (h) => qualityRank(h.maxQuality) >= qualityRank(q);
  const push = (h) => {
    if (h && canDo(h)) chain.push(h);
    else if (h && LOG_DEBUG) logDebug(`[链] ${h.id}(maxQuality=${h.maxQuality}) 不满足请求音质(${q})，已过滤`);
  };

  if (platform === "kw") {
    // 高音质(flac/320k)：溯音酷我 + 星海后端 双源(v12.0)；128k：溯音酷我 + 星海后端 + 酷我官方 + 长青 + 念心 多源竞速兜底
    if (t.suyinKuwo) push(SOURCE_HANDLERS.suyinKuwo);
    if (t.xinghaiBackend) push(SOURCE_HANDLERS.xinghaiBackend);
    if (t.kuwoOfficial) push(SOURCE_HANDLERS.kuwoOfficial);
    // v11.9：长青/念心 kw 128k，排在现有稳定源之后
    if (t.changqingVip) push(SOURCE_HANDLERS.changqingVip);
    if (t.nianxinVip) push(SOURCE_HANDLERS.nianxinVip);
    if (t.ikun) push(SOURCE_HANDLERS.ikun);
  }
  if (platform === "wy") {
    // 高音质(flac/320k)：GD Studio 优先(高音质补充)，suyinKuwo 搜索兜底；
    // 128k：suyin163 + wyOuter 官方直连优先（GD Studio 不进128k链，省配额）
    if (t.gdWy && (q === "flac" || q === "flac24bit" || q === "320k" || q === "hires")) push(SOURCE_HANDLERS.gdWy);
    if (t.suyin163) push(SOURCE_HANDLERS.suyin163);
    if (t.wyOuter) push(SOURCE_HANDLERS.wyOuter);
    if (t.ikun) push(SOURCE_HANDLERS.ikun);
  }
  // 全平台兜底（kw 已在上面 push，这里其余平台追加）
  if (t.suyinKuwo && platform !== "kw") push(SOURCE_HANDLERS.suyinKuwo);
  // 其他平台/备用源
  if (t.suyinQQ && platform === "tx") push(SOURCE_HANDLERS.suyinQQ);
  if (t.suyinMigu && platform === "mg") push(SOURCE_HANDLERS.suyinMigu);
  if (t.xinghaiBackup && platform !== "kg") push(SOURCE_HANDLERS.xinghaiBackup);
  // 长青/念心已在 kw 块内按 kw-only 顺序 push（maxQuality=128k，仅进kw 128k链）
  if (t.huibq) push(SOURCE_HANDLERS.huibq);
  if (t.lingchuan) push(SOURCE_HANDLERS.lingchuan);
  return chain;
}

// v14.1：排序改用综合健康评分（成功率×置信度 + 均时 + 连续失败惩罚）；分数差>0.05 优先，否则按均时兜底
function sortChainByHealth(chain) {
  return chain.slice().sort((a, b) => {
    const ha = computeHealthScore(a.id);
    const hb = computeHealthScore(b.id);
    if (Math.abs(hb.score - ha.score) > 0.05) return hb.score - ha.score;
    return ha.avgTime - hb.avgTime;
  });
}

function raceFirst(promises) {
  // v14.2：校验感知竞速——resolve 值带 {verified, url}；verified 源(内部 songInfoMatch 校验)结果优先返回；
  // 未校验源首个成功仅作候选，等 RACE_MATCH_WAIT_MS 窗口内是否有 verified 源成功（错歌校验更可信），超时后返回候选
  return new Promise((resolve, reject) => {
    let remaining = promises.length;
    const errs = [];
    let candidate = null;
    let settled = false;
    let waiter = null;
    const settle = (val) => {
      if (settled) return;
      settled = true;
      if (waiter) clearInterval(waiter);
      resolve(val);
    };
    for (const p of promises) {
      Promise.resolve(p).then(
        (res) => {
          if (settled) return;
          const item = (res && typeof res === "object" && res.url) ? res : { verified: false, url: res };
          if (item.verified) return settle(item.url);
          if (!candidate) {
            candidate = item;
            const deadline = Date.now() + RACE_MATCH_WAIT_MS;
            waiter = setInterval(() => {
              if (!settled && Date.now() >= deadline) settle(candidate.url);
            }, 40);
          }
        },
        (e) => {
          errs.push(e);
          if (--remaining === 0) {
            if (settled) return;
            settled = true;
            if (waiter) clearInterval(waiter);
            reject({ allFailed: true, errors: errs });
          }
        }
      );
    }
  });
}

async function wrapExecute(handler, platform, songInfo, quality) {
  if (!canExecute(handler.id)) {
    logDebug(`[断路器] ${handler.id} 处于${getBreaker(handler.id).state}状态，跳过`);
    throw new Error(`${ERROR_CODES.RATE_LIMIT}: 音源[${handler.name}]已熔断`);
  }
  const startTime = Date.now();
  try {
    const url = await handler.fn(platform, getHashOrMid(songInfo), quality, songInfo);
    recordSuccess(handler.id, Date.now() - startTime);
    const finalUrl = validateUrl(url, handler.name);
    logInfo(`[${handler.name}] 解析成功: ${songInfo?.name || ""} 音质[${quality || "128k"}]`);
    return finalUrl;
  } catch (e) {
    // v14.0：失败原因结构化透出——给错误附加源 id，供聚合 detail 关联具体子源
    if (e && typeof e === "object" && !e.sourceId) e.sourceId = handler.id;
    // v12.1：决策日志——区分熔断类错误(网络类)与业务失败(不熔断)
    logDebug(`[${handler.name}] 失败 code=${e.code || "?"} msg=${e.message}; 熔断类=${e.code === ERROR_CODES.NETWORK_TIMEOUT || e.code === ERROR_CODES.NETWORK_ERROR || e.code === ERROR_CODES.SERVER_ERROR || e.code === ERROR_CODES.RATE_LIMIT}`);
    // v11.12 (D8)：仅网络类错误(超时/5xx/429)计入熔断——业务失败(NOT_FOUND/MISMATCH等)说明源已正常响应，
    // 不应因"歌不存在/无版权"累积连续失败而误熔断健康源
    if (e.code === ERROR_CODES.NETWORK_TIMEOUT || e.code === ERROR_CODES.NETWORK_ERROR ||
        e.code === ERROR_CODES.SERVER_ERROR || e.code === ERROR_CODES.RATE_LIMIT) {
      recordFailure(handler.id);
    } else {
      recordSuccess(handler.id, Date.now() - startTime);
    }
    throw e;
  }
}

// v11.8 P0-5：fallbackRace 加 6s 整体超时；超时后继续 rest 串行
async function fallbackRace(chain, platform, songInfo, quality) {
  // v14.0：失败原因结构化——detail 数组每项 {source, quality, code, reason}，供 App 端展示/统计
  const collectDetails = [];
  if (chain.length === 1) {
    try {
      return await wrapExecute(chain[0], platform, songInfo, quality);
    } catch (e) {
      const code = extractErrorCode(e);
      const aggErr = new Error(`${chain[0].name}: ${e.message}`);
      aggErr.code = code;
      collectDetails.push({ source: chain[0].id, quality, code, reason: String((e && e.message) || "") });
      aggErr.detail = collectDetails;
      throw aggErr;
    }
  }
  const firstBatch = chain.slice(0, 3);
  const rest = chain.slice(3);
  const errors = [];
  const details = collectDetails;
  // v12.1：聚合错误携带"代表性"失败码——业务失败码优先(NOT_FOUND/MISMATCH/LINK_EXPIRED，稳定结论)，
  // 网络类码仅在全部为网络错误时兜底；避免"flac级业务失败 + 128k级网络错误"被覆盖成不缓存
  let aggCode = ERROR_CODES.NETWORK_ERROR;
  const mergeCode = (code) => {
    if (code === ERROR_CODES.NOT_FOUND || code === ERROR_CODES.MISMATCH || code === ERROR_CODES.LINK_EXPIRED) aggCode = code;
    else if (aggCode === ERROR_CODES.NETWORK_ERROR) aggCode = code;
  };
  const recordFail = (handlerId, q, err) => {
    const code = extractErrorCode(err);
    mergeCode(code);
    details.push({ source: handlerId, quality: q, code, reason: String((err && err.message) || "") });
    errors.push(err.message);
  };
  let timeoutHandle;
  const overallTimeout = new Promise((_, rej) => {
    timeoutHandle = setTimeout(() => rej(new Error(`RACE_TIMEOUT:${RACE_OVERALL_TIMEOUT_MS}ms整体超时`)), RACE_OVERALL_TIMEOUT_MS);
  });
  try {
    const winner = await Promise.race([
      raceFirst(firstBatch.map(h => wrapExecute(h, platform, songInfo, quality).then(url => ({ verified: !!h.verified, url })))),
      overallTimeout
    ]);
    clearTimeout(timeoutHandle);
    return winner;
  } catch (e) {
    // v12.1：raceFirst 全部失败时透出 {allFailed, errors}，逐个归并失败码（业务码优先）
    if (e && e.allFailed && Array.isArray(e.errors)) {
      for (const err of e.errors) { recordFail(err.sourceId || "race", quality, err); }
    } else {
      recordFail("race", quality, e);
    }
  }
  for (const handler of rest) {
    try {
      return await wrapExecute(handler, platform, songInfo, quality);
    } catch (e) { recordFail(handler.id, quality, e); }
  }
  const aggErr = new Error(errors.join("; "));
  aggErr.code = aggCode; // v12.1：聚合错误带代表性失败码
  aggErr.detail = details; // v14.0：结构化失败明细
  throw aggErr;
}

// v11.8 P0-4：请求音质放首位，再按 QUALITY_PRIORITY 向下降级，截到≤3级；flac24bit/192k不再被短路
function buildQualityChain(requested) {
  const req = String(requested || "flac").toLowerCase();
  if (QUALITY_FIRST) {
    const chain = [req];
    const idx = QUALITY_PRIORITY.indexOf(req);
    if (idx >= 0) {
      for (let i = idx + 1; i < QUALITY_PRIORITY.length && chain.length < 3; i++) {
        chain.push(QUALITY_PRIORITY[i]);
      }
    } else {
      for (const q of ["flac", "320k", "128k"]) {
        if (!chain.includes(q) && chain.length < 3) chain.push(q);
      }
    }
    return chain;
  }
  const req2 = String(requested || "128k").toLowerCase();
  const idx2 = QUALITY_PRIORITY.indexOf(req2);
  const start = idx2 >= 0 ? idx2 : QUALITY_PRIORITY.length - 1;
  const chain = [];
  for (let i = start; i < QUALITY_PRIORITY.length; i++) {
    chain.push(QUALITY_PRIORITY[i]);
  }
  if (!chain.includes(req2)) chain.unshift(req2);
  return chain;
}

// v12.1：统一错误码提取——业务层抛错沿用"CODE: msg"前缀风格(e.code 未设置)，从 message 前缀还原 code，
// 供失败缓存差异化与决策日志使用；无前缀按网络错误处理(不缓存)
function extractErrorCode(e) {
  if (e && e.code) return e.code;
  const m = String((e && e.message) || "").match(/^([A-Z_]+):/);
  return m && ERROR_CODES[m[1]] ? m[1] : ERROR_CODES.NETWORK_ERROR;
}

async function getUrlWithFallback(platform, songInfo, quality) {
  if (!platform || typeof platform !== "string" || !PLATFORM_QUALITIES[platform]) {
    throw new Error(`${ERROR_CODES.PARAM_ERROR}: 无效的平台参数`);
  }
  if (!songInfo || typeof songInfo !== "object") {
    throw new Error(`${ERROR_CODES.PARAM_ERROR}: 无效的歌曲信息`);
  }

  const cacheKey = buildCacheKey(platform, songInfo, quality);

  // 1. 成功缓存命中（缓存值带实际音质）
  const cached = getCachedUrl(cacheKey);
  if (cached && cached.url) return cached.url;

  // 2. 失败缓存命中（v12.1：差异化 TTL——404→1h / 410→1min / 网络错误不缓存）
  const failKey = buildCacheKey(`fail_${platform}`, songInfo, quality);
  if (getFailCached(failKey)) {
    logDebug(`失败缓存命中[${platform}] ${songInfo?.name || ""} 音质${quality || "128k"}，跳过重复请求`);
    throw new Error(`${ERROR_CODES.NOT_FOUND}: 该请求已知失败，跳过`);
  }

  const errors = [];
  const details = []; // v14.0：结构化失败明细（跨音质级汇总，供 App 端展示）
  // v12.1：代表性失败码——业务码(NOT_FOUND/MISMATCH/LINK_EXPIRED)一旦出现即固定(稳定结论)，
  // 网络类码仅在没有业务码时记录；防止低音质级(128k)的网络错误覆盖高音质级的"歌不存在"
  let lastFailCode = ERROR_CODES.NETWORK_ERROR;
  const mergeLastCode = (code) => {
    if (code === ERROR_CODES.NOT_FOUND || code === ERROR_CODES.MISMATCH || code === ERROR_CODES.LINK_EXPIRED) lastFailCode = code;
    else if (lastFailCode === ERROR_CODES.NETWORK_ERROR) lastFailCode = code;
  };

  // 3. 音质降级链（请求音质首位→向下降级；链内按源能力过滤，末级必有源）
  const qualityChain = buildQualityChain(quality || (QUALITY_FIRST ? "flac" : "128k"));
  for (const q of qualityChain) {
    const selectedQuality = q; // v11.12 (D10)：buildQualityChain 已产出具体音质，无需再选
    const chain = sortChainByHealth(buildSourceChain(platform, selectedQuality));
    if (!chain.length) {
      errors.push(`[${q}] 无可用音源`);
      continue;
    }
    logDebug(`[${platform}][${q}] 音源链: ${chain.map(h => h.id).join(">")} (按健康排序)`);
    try {
      const url = await fallbackRace(chain, platform, songInfo, selectedQuality);
      setCachedUrl(cacheKey, url, selectedQuality); // v11.8：记录实际音质
      return url;
    } catch (e) {
      mergeLastCode(extractErrorCode(e)); // v12.1：业务码优先归并
      errors.push(`[${q}] ${e.message}`);
      // v14.0：透出结构化失败明细（fallbackRace 已结构化；旧路径兜底单条）
      if (e && Array.isArray(e.detail) && e.detail.length) {
        for (const d of e.detail) details.push({ ...d });
      } else {
        details.push({ source: "chain", quality: q, code: extractErrorCode(e), reason: String((e && e.message) || "") });
      }
    }
  }

  // 4. 过期缓存兜底：仅当过期记录的实际音质不低于请求音质时才返回（防128k冒充flac）
  if (successCache.hasExpired(cacheKey)) {
    const expired = successCache.getExpired(cacheKey);
    if (expired && expired.url) {
      if (qualityRank(expired.quality || "128k") >= qualityRank(quality)) {
        logWarn(`全部音源失败，返回过期缓存兜底(缓存音质${expired.quality}, 请求${quality})`);
        return expired.url;
      }
      logWarn(`过期缓存音质(${expired.quality})低于请求(${quality})，不兜底`);
    }
  }

  // 5. 记录失败缓存（v12.1：按代表性失败码差异化 TTL；网络错误不缓存，下次立即重试）
  setFailCached(failKey, lastFailCode);
  logDebug(`失败缓存写入[${platform}] code=${lastFailCode} ttl=${FAIL_CACHE_TTL_BY_CODE[lastFailCode] === 0 ? "不缓存" : ((FAIL_CACHE_TTL_BY_CODE[lastFailCode] || FAIL_CACHE_TTL_MS) / 1000) + "s"}`);
  const finalErr = new Error(`${ERROR_CODES.NOT_FOUND}: 所有源均失败 [${errors.join(" | ")}]`);
  finalErr.code = lastFailCode; // v12.1：代表性失败码
  finalErr.detail = details; // v14.0：结构化失败明细（{source, quality, code, reason} 数组）
  throw finalErr;
}

// ============================================================
// 第八部分：音源配置上报 + 事件监听（洛雪官方协议）
// ============================================================
const sourceConfig = {};
const PLATFORM_NAMES = {
  wy: "网易云音乐", tx: "QQ音乐", kw: "酷我音乐", kg: "酷狗音乐", mg: "咪咕音乐"
};
Object.keys(PLATFORM_QUALITIES).forEach(platform => {
  // v15.0：歌词/封面按平台真实能力声明（App fork 声明即注册 getLyric/getPic）——
  // wy: 歌词+封面（网易云公开接口实测可用）；kw: 封面（搜索 hts_MVPIC 实测可用）；
  // tx/kg/mg: 无稳定接口不声明，App 自动走内置源兜底
  const actions = ["musicUrl"];
  if (platform === "wy") actions.push("lyric", "pic");
  else if (platform === "kw") actions.push("pic");
  actions.push("health"); // v16.3：健康快照 action（App fork 声明即注册 getHealth，与平台无关的聚合查询）
  sourceConfig[platform] = {
    name: PLATFORM_NAMES[platform],
    type: "music",
    actions,
    qualitys: REPORT_QUALITIES[platform] || ["128k"] // v11.8 P0-6：按真实能力裁剪
  };
});

on(EVENT_NAMES.request, ({ action, source, info }) => {
  // v16.3：健康快照 action（聚合查询，与请求的 source 无关）
  if (action === "health") {
    return Promise.resolve(getHealthSnapshot());
  }
  // v15.0：歌词/封面 action（App fork userApi 已支持；失败 App 自动走内置源兜底）
  if (action === "lyric") {
    return getLyricForPlatform(source, info?.musicInfo).catch(err => Promise.reject(err));
  }
  if (action === "pic") {
    return getPicForPlatform(source, info?.musicInfo).catch(err => Promise.reject(err));
  }
  if (action !== "musicUrl") {
    return Promise.reject(new Error(`${ERROR_CODES.PARAM_ERROR}: action not support`));
  }
  if (!info?.musicInfo) {
    return Promise.reject(new Error(`${ERROR_CODES.PARAM_ERROR}: 请求参数不完整`));
  }
  return getUrlWithFallback(source, info.musicInfo, info.type || (QUALITY_FIRST ? "flac" : "128k"))
    .catch(err => Promise.reject(err));
});

send(EVENT_NAMES.inited, {
  status: true,
  openDevTools: false,
  sources: sourceConfig
});

// v12.3：发版通知（updateAlert）——App 导入新版音源时弹更新提示（fork 行为已实证：仅可调一次，第二次调用 reject）
// 注释：若宿主 EVENT_NAMES 无 updateAlert（老宿主），自动跳过，不影响加载
if (EVENT_NAMES && EVENT_NAMES.updateAlert && typeof send === "function") {
  try {
    send(EVENT_NAMES.updateAlert, {
      log: "v13.4 迭代就绪版：失败缓存差异化+探测收敛+决策日志+音质表收敛+配置化；v12.3 起每次发版自动弹更新提示",
      updateUrl: "https://github.com/luanmuc/lx-music-source/releases"
    });
  } catch (e) {
    logWarn(`updateAlert 发送失败(已忽略): ${e.message}`);
  }
}

logInfo(`豆包定制聚合音源 v13.4 迭代就绪版已加载，上报 ${Object.keys(sourceConfig).length} 个音源；v12.1失败缓存差异化(404→1h/410→1min/网络错误不缓存)+探测并入竞速统计；v12.2决策日志(debug级)；v12.3 updateAlert发版通知；v13.3音质映射表收敛；v13.4配置化(USER_CONFIG)；保留v12.0星海kw高音质双源+日志宿主防御+防错歌加固+健康自愈`);

// 启动健康探测（全自动自愈）
startHealthCheck();

// v14.1：测试导出块——宿主动态执行无 module，自动跳过；冒烟测试 require 后可断言纯函数
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeHealthScore,
    sortChainByHealth,
    buildSourceChain,
    getUrlWithFallback,
    getBreaker,
    recordSuccess,
    recordFailure,
    ERROR_CODES,
    QUALITY_PRIORITY,
    // v14.3：探测巡检增强（分级轮次 + 休眠复活 + 配置构建）
    tierShouldProbe,
    applyProbeResult,
    buildProbeConfig,
    probeState,
    runtimeToggles,
    // v15.2：健康统计快照（App 健康面板/巡检消费）
    getHealthSnapshot
  };
}
