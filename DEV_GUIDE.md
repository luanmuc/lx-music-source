# 聚合音源开发文档（DEV_GUIDE）

> 适用仓库：`luanmuc/lx-music-source` · 基线文件：`lx-source.js`（当前 **v26.3 生态扫描制度化版**）
> 本文件 = 代码深度分析 + 官方协议合规对照 + 实证驱动的升级路线图 + 发布 SOP。**改音源前先读此文件。**

---

## 一、仓库定位与集成关系

- **唯一权威音源**：App（`luanmuc/lx-music-mobile`）每次云编译（CI）时，用 GitHub Contents API 拉取本仓库根目录 `lx-source.js`，生成 App 内 `assets/builtin_source.js`（**App 仓库已不再内置音源副本**，该文件由每次构建自动创建；以本仓库为准）。
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
| xinghaiBackend | kw | 128k/320k/flac | ✅ 三档 | zddyr.top = 可用 | ✅（v12.0 已接入：E10 实测四档 code 200/206 可播/ID3 对应；URL http→https 升级） |
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
| D3 | **kw 高音质单点**：flac/320k 仅溯音酷我一路 | kw 高音质可用性脆弱（叠加酷我 CDN 不稳，见第四节） | ✅ v12.0 已修复（星海后端接入 kw flac/320k 双源，E10 实测；断溯音后星海可独立 Range 206） |
| D4 | durationMatch 未接入 | 时长维度错歌防线缺失 | ✅ v11.12 已接入 |
| D5 | 健康探测开销：一轮 ~7 源 + Range，每 10 分钟 | 上行流量/风控轻度风险 | 待 v12.1（探测并入竞速） |
| D6 | 非 strict 档校验、gdWy 无歌名校验 | 兜底源可能放错歌 | ✅ 兜底档已修；gdWy 按 id 直链保持已知限制 |
| D7 | 探测状态多运行时各自独立 | 不共享，可接受 | 保持 |
| D8 | 断路器把业务失败计熔断 | 健康源被误熔断 | ✅ v11.12 已修复 |
| D9 | gdWy/suyin163 探测缺 Range、不轮换 | 假存活/单曲风控误判 | ✅ v11.12 已修复 |
| D10 | 双降级逻辑并存 + 死函数 + 重复实现 | 维护成本 | ✅ v11.12 已清理 |
| D11 | **console 依赖风险**：`LOG_ENABLED=true` 且 `logInfo/logWarn/logError` 直接调用 `console.*`（健康探测/断路器/请求主路径均有调用）；但官方移动版文档「可用宿主环境 API」仅列 `setTimeout/clearTimeout`，fork `user-api-preload.js` 亦未注入 console | 移动端真机若 console 未定义：请求主路径的 logWarn（如熔断触发）直接抛 ReferenceError → **本应成功的请求变失败**；加载日志（第 1281 行）抛错会阻断健康探测启动 | ✅ v11.13 已修复（safeConsole 宿主防御；vm 无 console 沙箱验证：修复前加载抛 TypeError 复现，修复后加载/请求/探测/熔断全路径通过；**真机装包待验证**） |

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
| `updateAlert` | 源 v1.2.0+：`{log≤1024, updateUrl≤1024}`，每次运行仅一次 | 支持；**fork 实现：第二次调用 `reject(new Error('The update alert can only be called once.'))`** | ✅ 已使用（v12.3 起发版通知，仅调一次，宿主无事件自动跳过） | 合规 |

**合规结论**：本仓库与官方协议（移动版 v2.0.0）**完全对齐，无分叉**；fork 的扩展点（`binary`）不影响脚本侧。协议层无需返工，唯一待补的是 `updateAlert` 发版通知。

## 七、升级优化规划（2026-10-29 实证重订）

> 原则：**播放正确性 > 可用性 > 性能/体验**。每轮迭代一个小版本，改动集中、实测后发布到 Release 页。
> 本版规划基于截至 v26.3（2026-10-29）的实证：v12~v26 系列规划已全部落地（并入 v12.0~v26.3 版本史），
> 剩余未完成项收敛为 **v27 系列（新候选实证接入）→ v28（自动健康日报）→ v29 系列（App 配合项）**（无服务器主线）；多项候选经实证判否（见下）。

### 实证结论（截至 2026-10-29）

| # | 实证 | 结论/落地 |
|---|---|---|
| E1+E3+E10 | 星海后端 `yy.zddyr.top` 实测 kw 四档高音质 code 200/206 可播/ID3 对应；酷我 CDN 系不稳 | ✅ 已落地：v12.0 xinghaiBackend 接入 kw flac/320k，高音质双源冗余（D3 闭环） |
| E2 | `api.xcvts.cn`（溯音咪咕上游）pdone 可用；本仓库历史 502 = 出口 IP 维度封禁 | ✅ **2026-10-29 实测判否**：接口业务层 502（IP 封禁未解除）、Juhe mg 400（上游不可用）→ mg 真源恢复待上游解封，mg 平台走溯音酷我搜索兜底不受损 |
| E4 | 长青系/ikun/聆川/Huibq 异常或失效 | ✅ 维持关闭；这些方向不再投入（v25.7 探测清单已过滤手动关闭/默认关闭源） |
| E5 | pdone 观测层/协作层模板 | ✅ 已落地：v13.x 冒烟+CI+每日巡检健康表；AGENTS.md 协作规范 |
| E6 | updateAlert（官方源协议） | ✅ 已实施后停用（v16.5.1 按用户要求关闭发版弹窗） |
| E7 | 生态大源 333KB 混淆 | ✅ 差异化：可读性+可协作性为本仓库护城河，不追大源 |
| E8 | 第三方评测：接口端点突然失效是公认风险 | ✅ 接口生命周期管理（增/活/衰/替）已制度化；自动摘死源 v26.1 已交付（播放连续失败即摘除，探测/半开试探自动复活） |
| E9 | 本仓库定位 = App 内置为主的私有源 | ✅ README 已明确；对标 pdone 生态 |
| E11 | App 日志系统重建完成（b63~b71：4 类日志 error/source/diagnose/debug，双通道公共+私有） | ✅ 消费端就绪 → v26.0 音源侧日志增强有承载 |
| E12 | 子源透出链路两轮修复（App b72 preload 透传 subSource + b73 index.ts 透传 onSource）——历史多轮修复均未达此层 | 🟡 端到端已通（诊断日志「子源=溯音酷我」）；**回归用例待补** → v26.3 |

### 已实施路线图（v12~v25 全量，供回归定位）

| 系列 | 已实施版本（Release tag） |
|---|---|
| v12 | v12.0（kw 高音质双源）/ v12.1~12.3 并入 v13.4（失败缓存差异化/决策日志/updateAlert） |
| v13 | v13.4（配置化；v13.0~13.3 工程化并入） |
| v14 | v14.0（失败原因结构化）/ v14.1（健康权重）/ v14.2（竞速匹配校验）/ v14.3（分级探测+休眠复活） |
| v15 | v15.0（歌词/封面透出）/ v15.2（统计快照） |
| v16 | v16.2~v16.5.1（数据驱动：死源建议/健康面板联动/管理能力/发版弹窗停用） |
| v17 | v17.0（失败归因分离）/ v17.1（音质分档）/ v17.2（429 退避） |
| v18 | v18.0~v18.1（Juhe 源族扩充） |
| v19 | v19.0（健康排序）/ v19.1（调度限速）/ v19.2（探测自适应） |
| v22 | v22.0（配置化治理） |
| v23 | v23.1（发布前自检门） |
| v24 | v24.0（音质协商链可观测） |
| v25 | v25.0~v25.11（Juhe 治理/健康审计/子源透出/沙箱兼容） |

### v26 系列 — 收尾未完成项（无服务器，实证驱动）

| # | 任务 | 方案要点 | 实证依据 | 验收标准 |
|---|---|---|---|---|
| v26.0 | **音源日志增强** | 解析决策/竞速过程/音质降档原因/失败归因更多可观测点进 source.log；配合 App「音源日志」「运行诊断」按钮自查 | E11（App 日志系统已就位） | 一次失败可从音源日志定位到具体子源与原因 |
| v26.1 | **自动摘死源** ✅ 已交付（2026-10-29） | 真实播放连续失败≥3 次 → 自动摘除出竞速链（不等探测周期）+ 快照 playDead 状态 + 三路复活（播放成功即时解除 / 探测通过解除 / 冷却期满半开试探）；与 manualOff 分层；USER_CONFIG.playDeadReviveMs 可调冷却（默认 5min） | 主链路验证 9/9 + 半开试探专项 5/5；T31 固化，冒烟 31 组全绿 | 死源自动不参与竞速（链过滤打点可见）；探测源探测通过复活；非探测源（128k 兜底）半开试探复活 |
| ~~v26.2~~ | ~~yunmge kw 备胎实测~~ ❌ 已判否（2026-10-29） | yunmge 实体为 Gitee 组织「云萌阁」，仅 1 个 PHP 短视频解析仓库（非音乐 API、需服务器）；GitHub 无此项目、相关域名不可达 → 不存在可实测 kw 上游 | 实体定位 + 多平台核实（Gitee/GitHub/域名） | 无音乐上游可接入，从规划移除 |
| v26.3 | **生态扫描制度化 + 子源透出回归** ✅ 已交付（2026-10-29） | `scripts/ecosystem-scan.js`（控制台/--json）抓 pdone 健康表交叉对比，自动产出新候选（pdone 可用未接入）/失效清单，纳入 AGENTS 迭代协议与测试清单；子源透出链音源侧冒烟已覆盖（成功/缓存/verified/兜底/Juhe/降档/tx 共 10+ 处 subSource 断言） | 真实抓取 pdone health-state.json（health-status 分支）跑通；子源冒烟覆盖确认 | 扫描自动产出候选清单（本轮实测产出 6 候选：fish/helloworld/hyw/jiexiang/lx/qdy）；子源透出回归全绿 |

> **mg 真源恢复**：2026-10-29 实测判否（溯音咪咕 502 IP 封禁未解除 + Juhe mg 400 上游不可用），已从 v26 系列移除；mg 平台走溯音酷我搜索兜底（128k）不受损，待上游解封/恢复后再评估。

> **tx 恢复**：持续跟踪上游（oiapi.net 可用、接口 -403），修复即解禁——触发条件驱动，不占固定版本号。

### v27 系列 — 新候选实证接入（2026-10-29 定稿，源自 v26.3 生态扫描）

> 背景：v26.3 生态扫描真实跑通（2026-10-29 数据），pdone 每日 CI 健康表产出 **6 个新候选**（可用、本仓库未接入）：fish / helloworld / hyw / jiexiang / lx / qdy。
> **接入规则（实证铁律）**：每个候选先抓 `latest.js` 分析上游 → 真实取链 → CDN Range 206 + 魔数/码率校验 → 通过才接入 kw 链（注册 SOURCE_HANDLERS + 探测配置 + 音质映射 + 冒烟用例）；不可用/无音乐上游即实证判否删除，继续下一个。**禁止凭 pdone 状态直接接入。**

| # | 任务 | 方案要点 | 验收标准 |
|---|---|---|---|
| ~~v27.1~~ | ~~候选 fish 实证~~ | ~~抓 pdone fish/latest.js → 分析上游 → 取链实测~~ | ❌ **已判否**（2026-10-29，见"已判否的候选"）：fish v1.9.0 混淆源码运行时加载成功（五平台上报），但取链与后端 haitangw 协议脱节——后端给可用直链脚本不用，官方接口被 -462 风控，kw 内部音质校验失败；端到端不可用 |
| ~~v27.2~~ | ~~候选 helloworld 实证~~ | ✅ **已交付**（2026-10-29）：kw 全链端到端实证通过——mock 宿主加载成功上报五平台；kw flac/320k 真实返回 car-er.kuwo.cn 直链（Range 206 + `audio/x-flac` + 魔数 fLaC 校验通过）；接入 kw 链与星海后端并列高音质竞速（convert_url_with_sign + haitangw v1 双通道，128k/320k/flac 三档，flac24bit 按服务器实际降级交付），探测/开关/健康全链路注册。详见"候选接入记录"节 |
| ~~v27.3~~ | ~~候选 hyw 实证~~ | ✅ **改为全面审计修复版已交付**（2026-10-30）：S1 三源+helloworldKw 内部缓存返回类型统一为裸 URL（旧包装对象被 validateUrl 拦截，缓存后跨平台取链 0ms 秒失败——含 v27.2 新源同源缺陷）；S4 wy 封面取 `songs[0].album.picUrl/blurPicUrl` 回退+补移动 UA；S5 probe.js 正则悬空 `|` 恒真修复 + ecosystem-scan.js 源表动态提取防漂移（probe 正则补 kuwo 关键词，保 helloworldKw 主通道纳入巡检） | 冒烟 32 组全绿 + L2 自检 + 真实网络复验（S1 缓存命中 0ms 返回裸 URL / S4 封面 107ms 拿到） |
| v27.4 | 候选 hyw 实证 | 同上 | 同上 |
| v27.5 | 候选 jiexiang 实证 | 同上 | 同上 |
| v27.6 | 候选 lx 实证 | 同上 | 同上 |
| v27.7 | 候选 qdy 实证 | 同上 | 同上 |

### v28 — 自动健康日报（重编号：原 v23.0）

> 背景：`docs/probe-history.jsonl` 已积累 77 行（每日巡检持续写入，2026-10-28 起），v16.0 近 7 日聚合口径 + v17.0 失败归因口径均已就绪——自动化条件成熟。

| 版本 | 任务 | 方案要点 | 验收标准 |
|---|---|---|---|
| v28 | 自动健康日报 | CI 每日汇总各源 7 日成功率/均时/健康分（v17 归因口径）写入 `docs/health-daily/`；连续 3 天真故障率超阈值的源自动生成"摘除建议" | 日报自动生成可读；摘除建议与 v26.1 摘死源机制互为补充 |

### v29 系列 — App 配合的音源能力（按需推进，需 App 配合）

> 背景：以下四项均需 fork App（`lx-music-mobile`）配合。音源侧先做数据/接口准备，App 侧随 bN 编译落地；统一收敛本系列避免版本号碎片化。

| # | 任务 | 音源侧 | App 侧 |
|---|---|---|---|
| v29.1 | 逐字歌词透出（原 v21.2） | wy 返回 ylrc（逐字歌词）字段 | App 逐字渲染 |
| v29.2 | 平台级降级状态（原 v24.1） | 音源快照加平台级状态（全子源失效标记） | 健康面板显示"平台级降级" |
| v29.3 | 配置热更新（原 v22.1） | 音源配置 action（读/改运行时配置） | App 内改配置即时生效 |
| v29.4 | 健康趋势图（原 v20.1） | 音源历史快照导出接口 | App 健康面板历史曲线 |

### 已判否的候选（2026-10-29 三层实证，不再投入）

| 候选 | 判否依据 |
|---|---|
| **xm（汽水音乐）平台扩展** | ① 上游实测：music.douyin.com 搜索接口 404/Not Found，无公开稳定接口；② App 端 `xm.js` 为官方空壳（55 行占位，搜索/榜单/播放全 reject，官方原版同为空壳从未实现）；③ 业务闭环：自定义音源协议无搜索 action，App 无任何渠道产生 source=xm 的歌 → 上报即死代码 |
| **mg 真源恢复** | 2026-10-29 实测双路线失败：① 溯音咪咕 `api.xcvts.cn/api/music/migu` HTTP 200 但业务层 `code:502`（IP 封禁未解除）；② Juhe mg `api.music.lerd.dpdns.org/mg` HTTP 400（上游不可用）。待上游恢复后再评估 |
| **自建 API 网关（v14.0 方向）** | 需一台服务器，违反"无服务器"定位；触发条件维持：第三方源月度失效 ≥2 次 或 用户确认可长期维护服务器 |
| **fish（鱼源，fish_music v1.9.0，v27.1 候选）** | 2026-10-29 三层实证判否：① 加载层 OK——完全混淆源码（131KB/7 行，字符串全加密，静态零可读），mock lx 宿主运行时加载成功，上报 kw/wy/kg/tx/mg 五平台（musicUrl only，kw/tx 含 flac24bit）；② wy 链路脱节——后端 haitangw（`music.haitangw.cc/.net`）接口活着且返回**真实可用 FLAC 直链**（本机直测：HTTP 206、`audio/x-flac`、魔数 `fLaC` 校验通过），但 fish 脚本拿到后**不采用**，继续请求网易官方 `player/url`（2026-10-29 被 -462 验证码风控拦截，`url:null`）→ 酷我搜索跨源匹配失败（`strict cross-source match failed: no match`），wy 晴天/演员均如此；③ kw 链路校验失败——`convert_url_with_sign` 接口 16 连发（4 source×4 音质档）全部真实返回 url（2000kflac→flac、320kmp3→mp3），但 fish 内部判定 `kw nuoweida failed: no url`（请求 flac24bit 被服务器降级 128k，音质校验不匹配）。结论：**脚本取链逻辑与其后端协议脱节**（后端响应格式/音质期望不符），端到端不可用；pdone 健康表"可用"= 服务器 IP 直测后端接口，不等于脚本可用。**判否删除，不接入** |

### 候选接入记录（实证通过，已接入）

| 候选 | 实证过程 | 接入方式 |
|---|---|---|
| **helloworld（v27.2，2026-10-29）** | ① 静态层：`helloworld/latest.js`（544 行，**未混淆**可读），kw 上游 = 酷我官方 `convert_url_with_sign`（rid 直取）+ haitangw v1 `resolve-url` 双通道；② mock 宿主层：vm sandbox 加载成功，上报 kw/wy/kg/tx/mg 五平台（kw 含 atmos/atmos_plus/master/hires 高档位，实际交付降级）；③ 端到端层：kw 晴天(rid=228908)——`musicUrl` 请求 flac 档返回 car-er.kuwo.cn FLAC 直链、320k 档返回 mp3 直链；CDN 校验 **Range 206 + `audio/x-flac` + 魔数 `fLaC` + Content-Range 全量 55MB** 通过；flac24bit 档被服务器降级 128k mp3（与 fish 同况，不影响接入——按实际交付音质）；wy 链路上游失败（网易官方 url=null + haitangw wy 503）属上游问题非脚本问题。结论：**kw 端到端可用，pdone"可用"标记属实** | 新增 `helloworldKw` 子源：kw 链与星海后端并列高音质竞速（128k/320k/flac 三档），convert_url_with_sign 主通道 + haitangw v1 备用通道；SOURCE_HANDLERS 注册（maxQuality=flac）、SOURCE_TOGGLES 默认开启、探测（convert_url 2000kflac code=200+url 非空）、健康统计、失败明细全链路接入 |

### 接口生命周期管理（横切主线）

> 核心思想：接口从出生到死亡全程被管理——**增有闸门、活有监控、衰有动作、替有路线**。

| 阶段 | 机制 | 现状 | 落地版本 |
|---|---|---|---|
| 增 | 接入闸门（默认关 → Range 206 → 两轮探测 → 真实播放才开） | ✅ 制度化（AGENTS.md + 测试清单） | — |
| 增 | 候选观察池（见下） | ✅ 已建立 | — |
| 增 | 例行生态扫描 | ✅ v26.3 已脚本化（scripts/ecosystem-scan.js，纳入迭代协议） | v26.3 ✅ |
| 活 | 运行时防护（断路器/Range 二次校验/失败缓存差异化） | ✅ 已有 | v12.1 ✅ |
| 活 | 分级响应（IP 封禁→换域/代理；接口 -403→跟踪；签名 410→短缓存；域名死→摘除标注） | ✅ 已有 | v12.1/v12.2 ✅ |
| 活 | 每日自动巡检健康表 | ✅ scripts/probe.js + CI 写回 README_HEALTH.md | v13.1 ✅ |
| 衰 | 健康排序降权（sortChainByHealth） | ✅ 已有 | — |
| 衰 | **自动摘死源**（播放连续失败→摘除，复活三路径） | ✅ v26.1 已交付（2026-10-29） | v26.1 ✅ |
| 衰 | 死源档案（函数保留 + 原因注释 + README 标注） | ✅ 已有 | 制度化 |
| 替 | 单点替换（双源并行 → 逐步切换） | ✅ v12.0（kw 高音质双源） | v12.0 ✅ |
| 替 | 平台降级（全死 → 跨平台兜底） | ✅ 已有 | — |
| 替 | 架构根治（自建网关） | ❌ 已判否（需服务器） | — |

**候选观察池（2026-10-29 更新）**

| 候选 | 用途 | 状态 | 依据 |
|---|---|---|---|
| mg 真源恢复（溯音咪咕/Juhe mg） | mg 真源 | ❌ **已判否**（2026-10-29 实测：溯音 502 IP 封禁未解除、Juhe mg 400）；mg 平台走溯音酷我搜索兜底 | 见"已判否的候选" |
| yunmge（云萌阁） | kw 备胎 | ❌ 已判否（2026-10-29）：Gitee 组织仅 PHP 短视频解析仓库，无音乐上游、需服务器 | 旧 P1-1 候选，已实证移除 |
| 溯音QQ 上游修复 | tx 恢复 | ⏳ 跟踪中（触发驱动） | oiapi.net 可用，接口 -403 |
| 酷我官方 CDN 稳定化 | kuwoOfficial 加固 | 🟡 监测中 | kwcdn/nmobi 异常；已有多路兜底稀释风险 |
| xm（汽水音乐） | 新平台扩展 | ❌ **已判否**（2026-10-29 三层实证：无接口/App 空壳/无歌源渠道） | 见"已判否的候选" |
| fish（鱼源） | kw/wy 备胎（v27.1 候选） | ❌ **已判否**（2026-10-29 三层实证：后端给可用直链脚本不用/官方接口 -462 风控/kw 音质校验失败，端到端不可用） | 见"已判否的候选" |

## 八、测试清单（发布前必做）

> **前置**：所有改动先走 `AGENTS.md`「实证开发流程（强制）」验证链（L0 静态 → L1 模拟 → L2 接口实测 → L3 真机 → L4 回归）。本清单 = L4 回归的具体内容。

1. **语法**：`node --check lx-source.js`；
2. **冒烟（L1 模拟）**：`node test/lx-source-smoke-test.js` 全用例绿（32 组：加载防御/上报/请求链路/缓存/熔断分类/失败结构化/健康权重/竞速匹配/源族/音质降档/日志增强/摘死源/helloworld 双通道等）；CI 已在 push 时自动执行；
3. **平台抽查**（用 curl 复现各子源逻辑或直接装包实测）：
   - wy：《晴天》flac（走 gdWy）+ 免费歌 128k（走 suyin163/wyOuter）+ VIP 歌 128k（应失败不误报）；
   - kw：《难却(DJ细霖版)》flac/320k/128k 三档（重点：不匹配到片段版、URL 可 206 播放）；
   - tx/kg/mg：至少 128k 兜底可用；
4. **防错歌抽查**：带括号版本名（DJ/现场/Live/片段）、同名不同歌手场景；
5. **音质降级**：断掉高音质源（临时关开关）→ 请求 flac 应逐级降到 320k/128k 且 URL 可播；
6. **缓存行为**：同一首歌二次请求命中缓存；换音质 key 不同不串；失败缓存差异化（404→1h 不重试 / 410→1min / 网络错误→立即重试）；
7. **健康探测**：启动后首轮 ~1min 内完成，自动启用/停用行为正确；
8. **移动端真机日志验证**（D11 专项）：装包后确认无 `ReferenceError: console is not defined`；健康探测正常启动、请求路径无异常——**此条在修复 D11 后转为抽查项**；
9. **例行生态扫描**（v26.3 起脚本化）：`node scripts/ecosystem-scan.js`（可加 `--json` 供 CI）抓 pdone 每日健康表交叉对比，产出新候选（pdone 可用、本仓库未接入）与失效清单；新候选按 L2 真实取链 + Range 206 + 魔数/码率实测后才接入，不凭 pdone 状态直接接入。建议每轮迭代前或发现源异常时跑。

## 九、发布 SOP（每次迭代必须走完）

1. **改**：修改 `lx-source.js`，文件头 `@version` +1，`@description` 写明本轮变更与实测结论；头部注释须含 `@license 仅供学习交流，请支持正版`（生态惯例，星海/六音均有；mrkeyoor 评测亦提示内容权利）；README 保留免责声明；协作规范见 `AGENTS.md`；
2. **验**：跑完第八节测试清单；
3. **提交**：`git add lx-source.js && git commit -m "feat(vX.Y): <变更摘要>" && git push origin master`（**push 前先 pull --rebase**，防远端冲突；功能级改动走分支 + PR，见 AGENTS.md）；
4. **发**：GitHub Releases 创建 `vX.Y`：标题 `聚合音源 vX.Y …`、正文 = 变更说明 + 实测结论、附件 = 当前 `lx-source.js`；
5. **通知**（v12.3 起）：`updateAlert` 事件随版本发送，用户 App 内可见更新弹窗；
6. **联动**（需要 App 内置新音源时）：触发 `lx-music-mobile` 的 release.yml（`workflow_dispatch` 或 push 空提交）；
7. **留档**：`versions/` 目录归档带版本号副本，防误删回滚。
8. **发布后监控**（v16.2 起）：Release 发布触发 CI 端点巡检（`release: published`），生成发布后基线健康表（含近 7 日成功率与「死源建议」清单）；发版后 3 天内关注健康表核心源（gdWy/xinghaiBackend/suyinKuwo/suyin163/wyOuter）成功率——若核心源连续失败（连续 ≥3 天）说明新版本引入回归，应回滚上一版并排查；死源建议清单是下一轮迭代「摘除/留档」的输入。

## 十、版本规划备忘（2026-10-29 实证重订）

| 版本 | 内容 | 状态 |
|---|---|---|
| v11.11~v25.11 | 历史版本全量（见 README 版本历史表） | ✅ 已发布（37 个 Release tag） |
| v14.0 自建 API 网关 | 架构根治（需服务器） | ❌ **已判否**（违反无服务器定位；触发条件：第三方源月度失效 ≥2 次 或 用户确认维护服务器） |
| v26.0 | 音源日志增强（配合 App 4 类日志系统） | ✅ 已交付（2026-10-29） |
| v26.1 | 自动摘死源（播放连续失败 → 摘除 + 三路复活） | ✅ 已交付（2026-10-29） |
| v26.2 | yunmge kw 备胎实测 | ❌ 已判否（2026-10-29 实证，无音乐上游） |
| v26.3 | 生态扫描制度化 + 子源透出回归 | ✅ 已交付（2026-10-29：ecosystem-scan.js 脚本化 + 子源透出冒烟覆盖确认） |
| v27.1 | 候选 fish 实证接入 | ❌ **已判否**（2026-10-29 三层实证：后端给可用直链脚本不用/官方接口 -462 风控/kw 音质校验失败） |
| v27.2 | 候选 helloworld 实证接入 | ✅ **已交付**（2026-10-29：kw 全链端到端实证通过，接入 kw 链高音质竞速，详见"候选接入记录"） |
| v27.3 | 全面审计修复（S1 缓存类型/S4 封面/S5 脚本） | ✅ **已交付**（2026-10-30：非候选迭代，插队为修复版；含 v27.2 helloworldKw 同源缺陷一并修复） |
| v27.4~v27.7 | 新候选实证接入（hyw/jiexiang/lx/qdy） | ⬜ 待开发（按实证规则逐个推进） |
| v28 | 自动健康日报（原 v23.0 重编号） | ⬜ 待开发（数据积累已够） |
| v29.1~v29.4 | App 配合的音源能力（逐字歌词/平台降级/配置热更新/健康趋势图） | ⬜ 待开发（需 App 配合） |
| mg 恢复评估 | **已判否**（2026-10-29 实测：溯音咪咕 502 IP 封禁未解除、Juhe mg 400 上游不可用） | ❌ 从规划移除 |
| tx 恢复 | 跟踪上游（oiapi.net 可用、接口 -403），修复即解禁 | ⏳ 触发条件驱动 |
| xm 平台扩展 | 已判否（2026-10-29：上游无接口实测 404 + App 端官方空壳 + 自定义源协议无搜索 action） | ❌ 不再投入 |

> 执行结果（2026-10-29）：v26.0 ✅ → v26.1 ✅ → v26.2 ❌ 判否 → v26.3 ✅。**v26 系列收尾**。v27.1 fish ❌ 判否 → **v27.2 helloworld ✅ 接入** → **v27.3 全面审计修复 ✅ 已交付（2026-10-30，插队）**（v27 系列推进中）。
> 推进序列（进行中）：**v27 系列（候选实证接入 + 审计修复，v27.1 fish ❌ 判否、v27.2 helloworld ✅ 已接入、v27.3 审计修复 ✅ 已交付，继续 v27.4 hyw）→ v28（自动健康日报）→ v29 系列（App 配合项，按需）**；触发式待办（tx 恢复等外部条件驱动）+ 生态扫描持续产出新候选（按实证规则逐个推进）。
