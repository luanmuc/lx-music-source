# 聚合音源开发文档（DEV_GUIDE）

> 适用仓库：`luanmuc/lx-music-source` · 基线文件：`lx-source.js`（当前 **v11.12 防错歌加固版**）
> 本文件 = 代码深度分析 + 官方协议合规对照 + 实证驱动的升级路线图 + 发布 SOP。**改音源前先读此文件。**

---

## 一、仓库定位与集成关系

- **唯一权威音源**：App（`luanmuc/lx-music-mobile`）每次云编译时，CI 用 GitHub Contents API 拉取本仓库根目录 `lx-source.js`，覆盖 App 内 `assets/builtin_source.js`（App 仓库里那份是旧快照，**勿改它**，以本仓库为准）。
- **发布节奏**：音源版本独立于 App 的 bN 构建号。音源发布 → （需要时）触发 App 构建 → App release。
- **架构一句话**：一个遵循「洛雪自定义音源协议」（`on/request + musicUrl action + send inited`）的**多子源聚合器**，内置 5 平台 × 多子源 × 音质降级 × 健康自愈。
- **生态背景（已实证）**：2023-10-18 因腾讯投诉，LX Music v2.6.0 移除所有内置自定义源，官方本体不再提供在线播放/下载（官方 FAQ）。**自定义源生态是用户可听歌的唯一路径**——本仓库的存在前提。

## 二、代码结构（8 大部分）

| 部分 | 行段 | 职责 |
|---|---|---|
| ① 常量配置 | 1~77 | 缓存/熔断/超时参数、错误码、API 端点（GD/溯音/星海/酷我官方/ikun/长青/念心）、音质映射表 |
| ② 音源开关 + 健康探测 | 78~273 | `SOURCE_TOGGLES` 静态默认；`runtimeToggles` 运行时随探测自愈；`probeSingleSource` 并发探测 + Range 二次校验 |
| ③ 日志 + LRU 双层缓存 + 断路器 | 300~387 | `successCache`(6h/500) / `failCache`(5min/300)；熔断 3 次/3min + 半开试探 + 成功率/均时统计 |
| ④ HTTP 封装 | 389~491 | `httpRequest`（超时/状态码→错误码）、`httpRequestWithRetry`（指数退避，4xx/429 不重试）、`isAudioPlayable` Range 探测 |
| ⑤ 歌曲信息与匹配工具 | 492~657 | `normalizeKeyword`（删括号/去空白/去符号）、`titleMatch`/`durationMatch`、`buildSearchKeywords`（歌名+专辑/歌手 strict、纯歌名非 strict）、`songInfoMatch`、`buildCacheKey`（id+名称+音质） |
| ⑥ 音源实现 | 658~1065 | 14 个子源（注册表 SOURCE_HANDLERS 14 项）：gdWy / wyOuter / kuwoOfficial / ikun / xinghaiBackup / xinghaiBackend / huibq / lingchuan / suyinQQ / suyin163 / suyinKuwo / suyinMigu / changqingVip / nianxinVip |
| ⑦ 注册表 + 调度 | 1066~1277 | `SOURCE_HANDLERS`（每源标注 `maxQuality` 真实能力）、`buildSourceChain`（平台+音质过滤）、`sortChainByHealth`（成功率/均时排序）、`fallbackRace`（前三源竞速 + 6s 整体超时 + 剩余串行）、`buildQualityChain`（请求音质→降级≤3 级）、`getUrlWithFallback` 总入口（缓存→降级链→过期兜底→失败缓存） |
| ⑧ 上报 + 事件监听 | 1278~1315 | `sourceConfig`（5 平台 × qualitys 按真实能力裁剪）、`on(request)` 入口、`send(inited)`、启动健康探测 |

## 三、核心机制详解

### 3.1 请求处理全流程（getUrlWithFallback）

```
on(request musicUrl)
  → getUrlWithFallback(platform, songInfo, quality)
    1. 成功缓存命中（key = platform_id_name_singer_album_quality，值含实际音质）
    2. 失败缓存命中（5 分钟内已知失败 → 直接抛错）
    3. 音质降级链：buildQualityChain(quality) → [请求音质, 下一级, 再下一级]（≤3 级，QUALITY_FIRST）
       每级：selectQuality → buildSourceChain（按源 maxQuality 过滤）→ sortChainByHealth → fallbackRace
    4. 全部失败 → 过期成功缓存兜底（**音质校验**：过期缓存音质 ≥ 请求音质才返回，防 128k 冒充 flac）
    5. 仍失败 → 写失败缓存，抛 NOT_FOUND（错误摘要含各源失败原因）
```

### 3.2 音质降级链（v11.8 起）

- `QUALITY_PRIORITY = [flac24bit, flac, 320k, 128k]`；`QUALITY_FIRST = true` → 解析从**请求音质**开始，逐级向下，最多 3 级。
- `QUALITY_RANK` 数值化音质，用于：① 源能力过滤（`maxQuality >= 请求` 才入链）；② 过期缓存兜底校验。
- 上报的 `qualitys` 按真实能力裁剪（`REPORT_QUALITIES`）：wy/tx/kw/kg/mg 均 `[128k, 320k, flac]`，**不再上报无人能交付的 flac24bit**（避免 App 选到无法满足的音质）。

### 3.3 竞速回退（fallbackRace）

- 前 3 源并发竞速（`raceFirst` 先胜先得）；整体 6s 超时（`RACE_OVERALL_TIMEOUT_MS`）；
- 竞速失败/超时 → 剩余源**串行**逐试；全部失败 → 抛聚合错误；
- `sortChainByHealth` 用断路器统计（成功率相差 >5% 按成功率排，否则按均时）把健康源放前，减少竞速打到死源的概率。

### 3.4 健康自愈（健康探测）

- 每 10 分钟一轮（首轮延迟 1 分钟）；**并发**探测全部源，一轮 ~6s；
- 判定规则：连续 **2** 次通过才启用 / 连续 **2** 次失败才停用（防抖动）；`runtimeToggles` 覆盖静态开关，`buildSourceChain` 以运行时为准；
- 单源多路探测（`probes`）：溯音酷我同时探测 flac(br=1) 与 128k(br=7)，**任一可播即存活**——防"flac 恢复但 128k 死链"时误摘高音质源；
- 探测歌曲池轮换（晴天/海阔天空/稻香）防单曲被风控导致误判；
- 探测通过后若可提取 URL，**再做 Range 可播性二次校验**（`isAudioPlayable`），识破"网关 200 + CDN 签名过期 410"假存活。

### 3.5 缓存与防死链

- 双层 LRU：成功 6h / 失败 5min；key 含 songId+名称+歌手+专辑+音质（v11.8 加 songId，防同名不同版本冲突）；
- 溯源酷我成功前必过 `isAudioPlayable`（Range 1KB），死链不计成功、不缓存 → 防止坏 URL 被 6h 缓存锁死；
- 过期缓存兜底带音质校验（见 3.1 第 4 步）。

### 3.6 歌曲匹配

- 搜索型源（溯音酷我/咪咕）用 `buildSearchKeywords` 生成三档关键词：歌名+专辑(strict) → 歌名+歌手(strict) → 纯歌名(非 strict)；
- `songInfoMatch` 校验：歌名包含匹配 + 歌手/专辑辅助；`durationMatch` 已接入（v11.12）；
- 已知限制：`normalizeKeyword` 会删除括号内容 → 「难却(15秒0.8x片段)」与「难却(DJ细霖版)」归一化后相同，v11.12 已用 FRAGMENT_RE + 兜底档校验封堵（见缺陷表）。

## 四、子源实测状态总表（2026-10-15 实测基线 + 2026-10-27 生态交叉验证）

> 交叉验证来源：`pdone/lx-music-source`（GitHub，★10,312）的 `.health-state.json`（GitHub Actions 每日探测，2026-10-27 抓取）。
> **口径注意**：pdone 探测来自 CI 服务器 IP，本仓库实测来自本机/沙箱 IP——**IP 维度不同**，出现分歧时不代表某一方错误，而是"上游对不同 IP 策略不同"（典型：溯音咪咕）。

| 子源 | 平台 | 音质 | 本仓库实测 | pdone 交叉验证（对应域名） | 结论 |
|---|---|---|---|---|---|
| suyinKuwo | kw+全平台兜底 | flac/320k/128k | ✅ 核心源 | oiapi.net = 可用 | ✅ 双源独立验证，核心地位稳固 |
| wyOuter | wy | 128k | ✅ 官方 outer 直连 | （官方接口，无第三方域名） | ✅ |
| kuwoOfficial | kw | 128k | ✅ 自研 | img1.kwcdn.kuwo.cn 失效 / nmobi.kuwo.cn 异常 | ⚠️ 酷我 CDN 系不稳 → 强化 D3 双源 |
| suyin163 | wy | 128k | ✅ | oiapi.net = 可用 | ✅ |
| gdWy | wy | flac/320k | ✅ 高音质链 | music-api.gdstudio.xyz = 可用 | ✅ |
| xinghaiBackend | kw | 128k | ✅ | zddyr.top = 可用 | ✅（星海生态里支持全平台 FLAC，见路线图 P1-1） |
| changqingVip / nianxinVip | kw | 128k | ✅ 302 直链 | music.nxinxz.com(念心) = 可用；musicapi.haitangw.net / 175.27.166.236 / music.haitangw.cc(长青) = 异常 | ⚠️ 念心独立验证可用；长青系整体"异常"，与"长青仅 kw 可用"吻合 |
| suyinQQ | tx | — | ❌ 关闭 | oiapi.net 可用（源 API 活着） | ⚠️ 上游活着，是接口级 -403 → 有机会恢复 |
| suyinMigu | mg | — | ❌ 关闭 | **api.xcvts.cn = 可用** | 🔴 **关键分歧**：上游活着，本仓库 502 是 IP 封禁 → 值得测备用域名/换 IP |
| xinghaiBackup | 多平台 | — | ❌ 关闭 | （zrcdy.dpdns.org 未单列；music-dl.sayqz.com 失效） | ✅ 维持关闭 |
| huibq | 多平台 | — | ❌ 关闭 | lxmusicapi.onrender.com = 异常 | ✅ 维持关闭 |
| lingchuan / ikun | 多平台 | — | ❌ 关闭 | api.lingchuan.com / api.ikunshare.com / gc.kxwa.top = 失效 | ✅ 需卡密/配置源，不做主力 |

**交叉验证的三个规划含义**：
1. **溯音咪咕（mg）有机会**：pdone 的 CI 显示 `api.xcvts.cn` 可用，本仓库 502 是 IP 维度封禁 → v12 值得测"备用域名/代理"路线恢复 mg。
2. **溯音QQ（tx）有机会**：源 API（oiapi.net）活着，-403 是接口级 → 可跟踪上游修复。
3. **酷我 CDN 系不稳**（kwcdn/mobi.kuwo.cn 异常/失效）→ `kuwoOfficial` 有单点风险，**kw 高音质第二来源（D3）比预想更紧迫**。

## 五、已知缺陷与风险（升级前必读）

| # | 缺陷 | 影响 | 位置 |
|---|---|---|---|
| D1 | **匹配错歌**：`normalizeKeyword` 删括号 → 片段版与完整版归一化相同 | 播放"能播但播错歌" | ✅ v11.12 已修复（FRAGMENT_RE + 兜底档校验） |
| D2 | **明文 http 链**：kw CDN 链为 http | 部分网络播不了高音质 | ✅ v11.12 已修复（upgradeToHttps） |
| D3 | **kw 高音质单点**：flac/320k 仅溯音酷我一路 | kw 高音质可用性脆弱（叠加酷我 CDN 不稳，见第四节） | 待 v12.0（星海高音质路线实证候选） |
| D4 | durationMatch 未接入 | 时长维度错歌防线缺失 | ✅ v11.12 已接入 |
| D5 | 健康探测开销：一轮 ~7 源 + Range，每 10 分钟 | 上行流量/风控轻度风险 | 待 v12.1（探测并入竞速） |
| D6 | 非 strict 档校验、gdWy 无歌名校验 | 兜底源可能放错歌 | ✅ 兜底档已修；gdWy 按 id 直链保持已知限制 |
| D7 | 探测状态多运行时各自独立 | 不共享，可接受 | 保持 |
| D8 | 断路器把业务失败计熔断 | 健康源被误熔断 | ✅ v11.12 已修复 |
| D9 | gdWy/suyin163 探测缺 Range、不轮换 | 假存活/单曲风控误判 | ✅ v11.12 已修复 |
| D10 | 双降级逻辑并存 + 死函数 + 重复实现 | 维护成本 | ✅ v11.12 已清理 |
| D11 | **console 依赖风险**：`LOG_ENABLED=true` 且 `logInfo/logWarn/logError` 直接调用 `console.*`（健康探测/断路器/请求主路径均有调用）；但官方移动版文档「可用宿主环境 API」仅列 `setTimeout/clearTimeout`，fork `user-api-preload.js` 亦未注入 console | 移动端真机若 console 未定义：请求主路径的 logWarn（如熔断触发）直接抛 ReferenceError → **本应成功的请求变失败**；加载日志（第 1281 行）抛错会阻断健康探测启动 | ⚠️ 待修复（需真机验证 + 日志防御，优先级 **P0 应急，先于 v12 系列**） |

## 六、官方协议合规对照（2026-10-27 实证核验）

> 依据：洛雪官方文档原文抓取（桌面版/移动版 custom-source 页）+ fork App 引擎源码（`luanmuc/lx-music-mobile` 的 `user-api-preload.js`，21.8KB）。

| 协议面 | 官方文档定义 | fork App（lx-music-mobile）实现 | 本仓库现状 | 结论 |
|---|---|---|---|---|
| 脚本头注释 | `@name/@description/@version/@author/@homepage`（name≤24 字，desc≤36） | 解析后注入 `currentScriptInfo` | ✅ 头部齐全，含 @contribution 实测注释 | 合规 |
| `globalThis.lx.version` | API 版本号 | `'2.0.0'` | （脚本侧无需校验） | — |
| `env` | desktop / mobile | `'mobile'` | （脚本侧未依赖） | — |
| `EVENT_NAMES` | inited / request / updateAlert | 同官方三事件 | ✅ 用 inited + request | 合规；**updateAlert 未使用（见路线图 P1-5）** |
| `send(inited)` | `{sources}`；sources 键 kw/kg/tx/wy/mg/local；type 固定 `music`；非 local 的 actions 固定 `['musicUrl']`；local 可 `['musicUrl','lyric','pic']`；qualitys 有效值 `['128k','320k','flac','flac24bit']` | 按 `supportSources/supportQualitys` 白名单过滤上报 | ✅ 5 平台 × 按真实能力裁剪的 qualitys | 合规 |
| `on(request)` | 回调 `({source, action, info})` 必须返回 Promise；musicUrl 返回 HTTP URL | 事件桥接 + Promise 链 | ✅ `getUrlWithFallback` 全链 Promise | 合规 |
| `info.type` 语义 | 标准音质名 128k/320k/flac/flac24bit；源内部再映射到接口参数（官方示例：`qualitys = { kw: { '128k': '128', ... } }`） | 透传标准名 | ✅ 本仓库 `QUALITY_TO_X` 表即此模型 | 合规（也是 P2-1 收敛 magic number 的官方依据） |
| `lyric/pic` action | 仅 local 源 | 仅 local | 非 local 不涉及 | — |
| `lx.request()` | `(url, {method, headers, body, form, formData, timeout}, cb) → cancel` | 同官方 + **扩展 `binary` 选项** | ✅ httpRequest 语义一致 | 合规；binary 未用到 |
| `lx.utils` | buffer / crypto(md5, randomBytes, aesEncrypt, rsaEncrypt) / zlib | 官方移动版子集：**zlib 未实现**；buffer 仅 base64/hex/utf8；aes 仅 cbc/ecb | 仅用 md5 → 无依赖风险 | 合规 |
| 移动版宿主 API | **仅 `setTimeout/clearTimeout`**；内置属性冻结（可扩展新属性，不可改写） | 同官方；**preload 未注入 console** | ⚠️ **代码依赖 `console.log/warn/error`（LOG_ENABLED=true，主路径调用）→ 移动端真机可能抛 ReferenceError** | **风险，见缺陷 D11** |
| 移动版 `inited` | 无 `openDevTools` | 无 | 未传 | 合规 |
| `updateAlert` | 源 v1.2.0+：`{log≤1024, updateUrl≤1024}`，每次运行仅一次 | 支持；**fork 实现：第二次调用 `reject(new Error('The update alert can only be called once.'))`** | **未使用** | 待开发（v12.3，fork 行为已实证） |

**合规结论**：本仓库与官方协议（移动版 v2.0.0）**完全对齐，无分叉**；fork 的扩展点（`binary`）不影响脚本侧。协议层无需返工，唯一待补的是 `updateAlert` 发版通知。

## 七、升级优化规划（实证驱动重订，2026-10-27）

> 原则：**播放正确性 > 可用性 > 性能/体验**。每轮迭代一个小版本，改动集中、实测后发布到 Release 页。
> **与旧规划的区别**：本版每一项都来自第四节交叉验证 / 第六节协议对照 / 生态仓库实证，不再依赖拍脑袋。

### 实证结论先行

| # | 实证 | 对规划的直接影响 |
|---|---|---|
| E1 | pdone 健康数据：星海（zddyr.top）可用，且星海生态源（xinghai v3.2.15）实证支持"全平台 24bit FLAC + 酷我高音质解密（KW_DECRYPT_PROXY/KW_LOCAL_CONFIG）" | kw flac 第二来源的**首要候选 = 扩展本仓库 xinghaiBackend 至高音质**，而非另找陌生源 |
| E2 | pdone 健康数据：`api.xcvts.cn`（溯音咪咕上游）可用；本仓库 502 = IP 封禁 | mg 恢复路线 = 备用域名/换 IP，值得 v12 试 |
| E3 | pdone 健康数据：酷我 CDN 系（kwcdn/nmobi/mobi.kuwo.cn）异常/失效 | `kuwoOfficial` 单点风险实锤 → D3 优先级上调 |
| E4 | pdone 健康数据：长青系（haitangw）整体异常、ikun/聆川失效、Huibq 异常 | 维持关闭是对的；这些方向不再投入 |
| E5 | pdone 仓库实证：自动化健康检查 CI（probe.py 静态提取域名、连续 2 次才判失效、每日 UTC17 自动提交健康表）+ AGENTS.md 协作规范 + latest.js 版本管理 | 本仓库缺的"观测层"与"协作层"有现成模板，工程化从"远期"提级 |
| E6 | 官方文档实证：updateAlert（源 v1.2.0）本仓库未用；qualitys 源内映射是官方模型 | 新增发版通知能力；P2-1 有官方依据 |
| E7 | 六音源（生态最知名大源）333KB 混淆代码 | 可读性/可协作性是本仓库差异化资产，**不追求抄大源** |
| E8 | mrkeyoor 第三方评测（2026-09-11）：pdone 的 8 个适配器"没有测试目标、是不可验证的链接架"，并警告"接口端点突然失效" | **测试+可读性=本仓库的差异化护城河**；接口突然死亡是公认风险（支撑接口生命周期管理） |
| E9 | lxmusic.ijinshan.com 汇总站（2026-09-28 实测）：生态主流源（六音/LX官方/Flower/Huibq/JuheApi）全部收录自 pdone 仓库 | 本仓库未被收录 = 以 App 内置为主的私有定位（README 已明确）；生态对标对象就是 pdone |

### v12 系列 — 可用性（依据 E1~E4）

| # | 任务 | 方案要点 | 实证依据 | 验收标准 |
|---|---|---|---|---|
| v12.0 | **kw 高音质双源冗余**（D3） | 扩展 `xinghaiBackend` 支持 kw flac/320k（参考 xinghai 生态源的 KW 高音质实现）；`suyinKuwo` 保持主力；坏则保持现状 | E1 + E3 | 断掉溯音酷我后，kw flac 仍可 Range 206 播放 |
| v12.1 | 失败缓存差异化 + 探测收敛 | 410→1min / 404→1h / 网络错误→不缓存；探测结果并入竞速统计复用 | 第四节 + 原 P1-2/P1-3 | 死链不放大重试；一轮探测开销下降 |
| v12.2 | **mg/tx 恢复评估** + 决策日志 | mg 测备用域名/换 IP（pdone 显示上游活着）；tx 跟踪上游修复；加 debug 级源级决策日志（**前置依赖：先修复 D11 console 可用性**，否则日志本身会炸） | E2 + E6 协议面 + D11 | mg 至少 128k 可用（若域名仍被全封则记录结论并保持关闭）；一次失败可定位到具体子源 |
| v12.3 | updateAlert 发版通知 | 发版时 `send(updateAlert, {log, updateUrl})`，让用户 App 内看到更新提示 | E6 | 导入新版本后 App 弹出更新弹窗 |

### v13 系列 — 工程化与协作（依据 E5/E6/E7）

| # | 任务 | 方案要点 | 实证依据 | 验收标准 |
|---|---|---|---|---|
| v13.0 | **自动化测试 + CI** | 冒烟脚本固化 `test/`（mock lx，现 /tmp 原型转正）+ GitHub Actions：push 自动 `node --check` + 冒烟 | E5 | master 每次 push 自动验证，红则阻断 |
| v13.1 | **可观测巡检（观测层）** | 仿 pdone `probe.py`：静态提取本仓库端点 → 每日 CI 探测 → 健康表写回 README（连续 2 次才判失效，防抖动） | E5 | 每天自动更新一份"音源可用性表"，人工零成本 |
| v13.2 | 协作规范落地 | 已建 `AGENTS.md`；分支/PR 流程进 CI 检查（PR 必须过 v13.0 检查才可合入） | E5 + 历史教训（多账号直推覆盖） | 多账号并行开发互不覆盖 |
| v13.3 | 音质映射官方模型对齐 | `QUALITY_TO_X` 表收敛 magic number（br=1/5/7/740/999），按官方"源内映射"模型组织 | E6 | 新增音质只改一张表 |
| v13.4 | 配置化（可选源） | ikun/聆川/星海解密代理等"需配置"源从配置文件读取，默认关闭 | E4（维持关闭）+ 星海用户配置区模式 | 开配置即用，默认不暴露 |

### v14 系列 — 架构可持续性（方向已定，任务随数据细化）

> 依据（实证）：第三方免费 API 的系统性死亡风险——溯音QQ -403、溯音咪咕 IP 封禁、长青系整体异常、酷我 CDN 系异常、pdone 健康表中 14 个域名"异常/失效"。**对第三方接口的单点依赖是最大系统性风险**。
> **决策点**：是否自建服务层 = 成本决策（需一台服务器），不由技术单方面决定。

| # | 任务 | 方案要点 | 验收标准 |
|---|---|---|---|
| v14.0 | 自建 API 网关（lx-music-api-server 模式 / 轻量反代） | 多子源请求收敛到自控服务器：统一缓存 + 规避 IP 封禁；源侧只留一个网关入口 | 任一平台请求经网关返回，源侧可播性 ≥ 现状 |
| v14.1 | 多域名/多 IP 容灾 | 域名池 + 失败自动切换（mg IP 封禁的直接教训）；探测并入域名级 | 单个域名被封不影响平台可用 |
| v14.2 | 签名代理化 | 需签名的接口（星海 X-Token 等）收敛到服务端，客户端免签名 | 客户端零签名依赖，签名更新不发版 |

> 触发条件：第三方源月度失效 ≥2 次 或 用户确认可长期维护一台服务器。

### v15 系列 — 体验层（依托 fork App 能力）

> 依据（实证）：官方协议仅 local 源支持 `lyric/pic`（非 local 只 musicUrl）；fork 已有 `binary` 扩展先例 → 需评估 fork 是否扩展非 local 歌词/封面。
> **决策点**：歌词/封面是否值得做 = 由 fork App 的扩展能力决定。

| # | 任务 | 方案要点 | 验收标准 |
|---|---|---|---|
| v15.0 | 歌词/封面透出 | 评估 fork 扩展非 local `lyric/pic`；若支持则聚合源补歌词/封面接口 | App 内歌词/封面正常显示（非 local 源） |
| v15.1 | 失败原因透出 | 源级失败原因（NOT_FOUND/IP 封禁/签名过期）结构化返回，App 端展示"为什么播不了" | 用户能看懂失败原因，不再"无声失败" |
| v15.2 | 播放统计/健康面板 | App 内可视化各源成功率/延迟（喂 v13.1 数据 + v16 自动优化） | 面板数据 = v13.1 巡检数据同源 |

### v16 系列 — 数据驱动自优化

> 依据（实证）：断路器已有成功率/均时统计（代码 ③）；v13.1 巡检将积累仓库级数据。v16 = 把"观测"变成"决策"。
> **决策点**：自动摘除/回滚的阈值需先积累 1-2 月真实数据再定，避免误杀。

| # | 任务 | 方案要点 | 验收标准 |
|---|---|---|---|
| v16.0 | 仓库级成功率统计 | 汇总各源真实播放成功率，自动调整健康排序权重（从单机运行时升级为仓库级） | 成功率数据每日入库，排序权重随数据更新 |
| v16.1 | 自动摘死源 | 连续 N 天成功率低于阈值 → 自动降级/摘除 + README 健康表更新（pdone 模式升级为自动执行） | 死源无需人工介入即被摘除 |
| v16.2 | 版本灰度/自动回滚 | 发版后按失败率监控，超阈值自动回滚上一 Release | 坏版本自动回滚，用户可听性不受损 |

> 远期（v16+ 方向级）：社区化（第三方 PR 音源评审接入）、多运行时探测状态共享、向上游官方提 issue 扩展非 local 歌词/封面。

### 接口生命周期管理（横切主线，贯穿 v12-v16）

> 核心思想：接口不是"接了就不管"，而是从出生到死亡全程被管理——**增有闸门、活有监控、衰有动作、替有路线**。
> 实证前提：第三方免费 API 必然死亡（pdone 健康表 14 域名异常/失效），接口管理是长期战。

| 阶段 | 机制 | 现状 | 落地版本 |
|---|---|---|---|
| 增 | 接入闸门（默认关 → Range 206 → 两轮探测 → 真实播放才开） | ✅ AGENTS.md + 测试清单 | 制度化 |
| 增 | 候选观察池（带状态跟踪的待测清单，见下） | ❌ 本次新增 | 已写入 |
| 增 | 例行生态扫描（每次迭代扫 pdone 健康表/索引站/GitHub） | ⚠️ 手动 | v13.1 巡检化 |
| 活 | 运行时防护（断路器/Range 二次校验/失败缓存差异化） | ✅ 已有 | v12.1 增强 |
| 活 | 分级响应：IP 封禁→换域/代理；接口 -403→跟踪上游；签名 410→短缓存+重签；域名死亡→摘除+README 标注 | ⚠️ 雏形 | v12.1/v12.2 细化 |
| 活 | 每日自动巡检健康表（仿 pdone probe.py，连续 2 次滞后判定） | ❌ | v13.1 |
| 衰 | 健康排序降权（sortChainByHealth） | ✅ 已有 | — |
| 衰 | 自动摘死源（连续 N 天失败 → 自动摘除） | ❌ | v16.1 |
| 衰 | 死源档案（保留函数 + 原因注释 + README 标注） | ✅ 已有 | 制度化 |
| 替 | 单点替换（双源并行 → 逐步切换，D3 模式） | ⚠️ v12.0 | v12.0 |
| 替 | 平台降级（全死 → 跨平台兜底，tx/kg/mg 现状） | ✅ 已有 | — |
| 替 | 架构根治（自建网关，从"接口随机死"到"自己控制"） | ❌ | v14.0（决策点） |

**候选观察池（初始清单，2026-10-27，全部有实证依据）**

| 候选 | 用途 | 状态 | 依据 |
|---|---|---|---|
| 星海高音质（扩展 xinghaiBackend） | kw flac 第二来源 | 待实施 v12.0 | zddyr.top 可用 + 生态实证全平台 FLAC |
| api.xcvts.cn 备用域名/代理 | mg 恢复 | 待测 | pdone 实证可用，本机 IP 封禁 |
| 溯音QQ 上游修复 | tx 恢复 | 跟踪中 | oiapi.net 可用，接口 -403 |
| yunmge | kw 备胎 | 待测 | 旧 P1-1 候选 |
| 酷我官方 CDN 稳定化 | kuwoOfficial | 监测中 | kwcdn/nmobi 异常实证 |
| xm（汽水音乐）平台上报 | 新平台扩展 | 待确认 | fork `supportActions` 含 `xm`（但 `supportQualitys` 无 xm，fork 支持程度待验证） |

## 八、测试清单（发布前必做）

> **前置**：所有改动先走 `AGENTS.md`「实证开发流程（强制）」验证链（L0 静态 → L1 模拟 → L2 接口实测 → L3 真机 → L4 回归）。本清单 = L4 回归的具体内容。

1. **语法**：`node --check lx-source.js`；
2. **加载**：mock `globalThis.lx` 跑一次 `send(inited)`，确认 `sources` 上报 5 平台、qualitys 正确；
3. **平台抽查**（用 curl 复现各子源逻辑或直接装包实测）：
   - wy：《晴天》flac（走 gdWy）+ 免费歌 128k（走 suyin163/wyOuter）+ VIP 歌 128k（应失败不误报）；
   - kw：《难却(DJ细霖版)》flac/320k/128k 三档（重点：不匹配到片段版、URL 可 206 播放）；
   - tx/kg/mg：至少 128k 兜底可用；
4. **防错歌抽查**：带括号版本名（DJ/现场/Live/片段）、同名不同歌手场景；
5. **音质降级**：断掉高音质源（临时关开关）→ 请求 flac 应逐级降到 320k/128k 且 URL 可播；
6. **缓存行为**：同一首歌二次请求命中缓存；换音质 key 不同不串；
7. **健康探测**：启动后首轮 ~1min 内完成，自动启用/停用行为正确；
8. **移动端真机日志验证**（D11 专项）：装包后确认无 `ReferenceError: console is not defined`；健康探测正常启动、请求路径无异常——**此条在修复 D11 前为必测项**。

## 九、发布 SOP（每次迭代必须走完）

1. **改**：修改 `lx-source.js`，文件头 `@version` +1，`@description` 写明本轮变更与实测结论；头部注释须含 `@license 仅供学习交流，请支持正版`（生态惯例，星海/六音均有；mrkeyoor 评测亦提示内容权利）；README 保留免责声明；协作规范见 `AGENTS.md`；
2. **验**：跑完第八节测试清单；
3. **提交**：`git add lx-source.js && git commit -m "feat(vX.Y): <变更摘要>" && git push origin master`（**push 前先 pull --rebase**，防远端冲突；功能级改动走分支 + PR，见 AGENTS.md）；
4. **发**：GitHub Releases 创建 `vX.Y`：标题 `聚合音源 vX.Y …`、正文 = 变更说明 + 实测结论、附件 = 当前 `lx-source.js`；
5. **通知**（v12.3 起）：`updateAlert` 事件随版本发送，用户 App 内可见更新弹窗；
6. **联动**（需要 App 内置新音源时）：触发 `lx-music-mobile` 的 release.yml（`workflow_dispatch` 或 push 空提交）；
7. **留档**：`versions/` 目录归档带版本号副本，防误删回滚。

## 十、版本规划备忘（2026-10-27 实证重订）

| 版本 | 内容 | 状态 |
|---|---|---|
| v11.11 | 接口满编版 | ✅ 已发布 |
| v11.12 | P0 全项（防错歌）+ D8/D9/D10（防错歌加固版） | ✅ 已实施（c19b167 + Release） |
| v12.0 | kw 高音质双源冗余（星海高音质路线，E1/E3） | ⬜ 待实施 |
| v12.1 | 失败缓存差异化 + 探测收敛 | ⬜ 待实施 |
| v12.2 | mg/tx 恢复评估 + 决策日志 | ⬜ 待实施 |
| v12.3 | updateAlert 发版通知 | ⬜ 待实施 |
| v13.0 | 自动化测试 + CI | ⬜ 待实施 |
| v13.1 | 可观测巡检（probe CI + 健康表） | ⬜ 待实施 |
| v13.2 | 协作规范落地（AGENTS.md 已建，流程待 CI 化） | 🟡 文档已建 |
| v13.3 | 音质映射官方模型对齐 | ⬜ 待实施 |
| v13.4 | 配置化（可选源） | ⬜ 待实施 |
| v14.0 | 自建 API 网关（架构可持续性，决策点：需服务器） | ⬜ 方向已定 |
| v14.1 | 多域名/多 IP 容灾 | ⬜ 方向已定 |
| v14.2 | 签名代理化 | ⬜ 方向已定 |
| v15.0 | 歌词/封面透出（决策点：fork 扩展能力） | ⬜ 方向已定 |
| v15.1 | 失败原因透出 | ⬜ 方向已定 |
| v15.2 | 播放统计/健康面板 | ⬜ 方向已定 |
| v16.0 | 仓库级成功率统计 | ⬜ 方向已定 |
| v16.1 | 自动摘死源 | ⬜ 方向已定 |
| v16.2 | 版本灰度/自动回滚 | ⬜ 方向已定 |
