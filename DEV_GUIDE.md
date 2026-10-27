# 聚合音源开发文档（DEV_GUIDE）

> 适用仓库：`luanmuc/lx-music-source` · 基线文件：`lx-source.js`（当前 **v11.11 接口满编版**）
> 本文件 = 代码深度分析 + 升级优化路线图 + 发布 SOP。**改音源前先读此文件。**

---

## 一、仓库定位与集成关系

- **唯一权威音源**：App（`luanmuc/lx-music-mobile`）每次云编译时，CI 用 GitHub Contents API 拉取本仓库根目录 `lx-source.js`，覆盖 App 内 `assets/builtin_source.js`（App 仓库里那份是旧快照，**勿改它**，以本仓库为准）。
- **发布节奏**：音源版本独立于 App 的 bN 构建号。音源发布 → （需要时）触发 App 构建 → App release。
- **架构一句话**：一个遵循「洛雪自定义音源协议」（`on/request + musicUrl action + send inited`）的**多子源聚合器**，内置 5 平台 × 多子源 × 音质降级 × 健康自愈。

## 二、代码结构（8 大部分）

| 部分 | 行段 | 职责 |
|---|---|---|
| ① 常量配置 | 1~77 | 缓存/熔断/超时参数、错误码、API 端点（GD/溯音/星海/酷我官方/ikun/长青/念心）、音质映射表 |
| ② 音源开关 + 健康探测 | 78~273 | `SOURCE_TOGGLES` 静态默认；`runtimeToggles` 运行时随探测自愈；`probeSingleSource` 并发探测 + Range 二次校验 |
| ③ 日志 + LRU 双层缓存 + 断路器 | 300~387 | `successCache`(6h/500) / `failCache`(5min/300)；熔断 3 次/3min + 半开试探 + 成功率/均时统计 |
| ④ HTTP 封装 | 389~491 | `httpRequest`（超时/状态码→错误码）、`httpRequestWithRetry`（指数退避，4xx/429 不重试）、`isAudioPlayable` Range 探测 |
| ⑤ 歌曲信息与匹配工具 | 492~657 | `normalizeKeyword`（删括号/去空白/去符号）、`titleMatch`/`durationMatch`、`buildSearchKeywords`（歌名+专辑/歌手 strict、纯歌名非 strict）、`songInfoMatch`、`buildCacheKey`（id+名称+音质） |
| ⑥ 音源实现 | 658~1065 | 13 个子源函数：wyOuter / kuwoOfficial / ikun / gdWy / xinghaiBackup / xinghaiBackend / huibq / lingchuan / suyinQQ / suyin163 / suyinKuwo / suyinMigu / changqing / nianxin |
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
- `songInfoMatch` 校验：歌名包含匹配 + 歌手/专辑辅助；`durationMatch` 已定义但**未接入兜底校验**（见已知缺陷）；
- **已知缺陷**：`normalizeKeyword` 会删除括号内容 → 「难却(15秒0.8x片段)」与「难却(DJ细霖版)」归一化后相同，纯歌名档会误放片段版。

## 四、子源实测状态总表（2026-10-15 实测基线）

| 子源 | 平台 | 音质 | 状态 | 备注 |
|---|---|---|---|---|
| suyinKuwo | kw+全平台兜底 | flac/320k/128k | ✅ | 核心源；flac 与 128k 均已恢复；CDN 链需 Range 校验防 410 |
| wyOuter | wy | 128k | ✅ | 官方 outer 直连，免费歌 302 直链；VIP 自动 404 跳过 |
| kuwoOfficial | kw | 128k | ✅ | 自研：搜索 r.s→rid→convert_url，无第三方 |
| suyin163 | wy | 128k | ✅ | 免费歌真实直链；VIP 返回 url:null 自动跳过 |
| gdWy | wy | flac/320k | ✅ | 仅高音质链；5min 50 次限流，不进 128k 兜底 |
| xinghaiBackend | kw | 128k | ✅ | 需动态 X-Token；wy 签名 403 未接入 |
| changqingVip / nianxinVip | kw | 128k | ✅ | 302→car-er.kuwo.cn 新鲜 mp3；其余平台 403/404 |
| suyinQQ | tx | — | ❌ 关闭 | -403 维护中 |
| suyinMigu | mg | — | ❌ 关闭 | 502 IP 限制 |
| xinghaiBackup | 多平台 | — | ❌ 关闭 | 域名不可解析 |
| huibq | 多平台 | — | ❌ 关闭 | 仅酷我真用 |
| lingchuan / ikun | 多平台 | — | ❌ 关闭 | 需配置/卡密 |

## 五、已知缺陷与风险（升级前必读）

| # | 缺陷 | 影响 | 位置 |
|---|---|---|---|
| D1 | **匹配错歌**：`normalizeKeyword` 删括号 → 片段版（"难却(15秒0.8x片段)"）与完整版归一化相同；纯歌名兜底档（strict=false）**不做任何歌名校验** | 播放"能播但播错歌"（实测：溯音酷我《难却》→ 15 秒 0.8x 片段） | `normalizeKeyword` / `suyinKuwoGetUrl` 调用处 |
| D2 | **明文 http 链**：溯音酷我/长青/念心的 kw CDN 链为 `http://car-er.kuwo.cn`，部分网络/播放器对 http 音频处理异常 | 高音质（flac/320k）偶发播不了，切 128k 反而能播（实测 https 升级后 206 可播） | 子源 URL 返回处 |
| D3 | **kw 高音质单点**：kw 的 flac/320k 仅溯音酷我一路；该源一旦停用，kw 高音质全挂 | kw 高音质可用性脆弱 | `buildSourceChain` kw 分支 |
| D4 | `durationMatch` 已定义未接入 | 缺失时长维度的错歌防线 | `songInfoMatch` 周边 |
| D5 | 健康探测一轮打 ~7 个源 + Range 二次校验，每 10 分钟一次 | 上行流量/被上游风控的轻度风险 | `runHealthCheck` |
| D6 | `suyinKuwoGetUrl` 非 strict 档不校验、`gdWy` 无歌名校验 | 高音质源与兜底源都可能放错歌 | 各子源函数 |
| D7 | 探测歌曲池轮换仅在启动后第 N 轮生效，探测 url 由 `__probeRound` 全局变量控制，多运行时（多用户 App 实例）各自独立探测 | 探测状态不共享，属可接受范围 | `buildProbeConfig` |

## 六、升级优化规划（路线图）

> 原则：**播放正确性 > 可用性 > 性能/体验**。每轮迭代一个小版本，改动集中、实测后发布到 Release 页。

### P0 — 必修（下一版 v11.12，目标：杜绝播错歌 + 高音质可播）

| # | 任务 | 方案要点 | 验收标准 |
|---|---|---|---|
| 1 | 片段/试听特征词拒绝 | `songInfoMatch` 增加 `FRAGMENT_RE = /(15\s*秒\|0\.?\s*8x\|片段\|试听\|demo\|preview\|teaser)/i`：目标歌名不含特征词而返回歌名含 → 判 MISMATCH | 《难却》不再匹配到 15 秒 0.8x 片段 |
| 2 | 兜底档也做歌名校验 | `suyinKuwoSearch` 的 strict=false 分支传 `{name}`（轻量歌名校验，歌手可放宽）；咪咕同 | 纯歌名兜底不再放错歌 |
| 3 | kw 音频链 https 升级 | 子源返回 URL 统一 `upgradeToHttps()`（http→https，已实测 206 可播） | 高音质 http 链在部分网络可播 |
| 4 | `durationMatch` 接入 | 已知 duration 的歌曲，搜索结果时长差 >5s 判 MISMATCH（片段版时长明显短于完整版） | 时长严重不符的歌被拒 |

### P1 — 增强（v12.x 系列）

| # | 任务 | 方案要点 |
|---|---|---|
| 1 | kw 高音质第二来源 | 评估并接入 yunmge/妖狐酷我等候选作 kw flac 备胎；以 Range 实测为准，坏则继续关闭 |
| 2 | 失败缓存差异化 | 区分 410（签名过期，短缓存 1min）/ 404（无版权，长缓存 1h）/ 网络错误（不缓存），减少死链重试放大 |
| 3 | 探测开销收敛 | 探测并入竞速统计（复用真实请求结果），降低每 10 分钟独立探测开销 |
| 4 | 决策日志分级 | 增加 debug 级日志（源级决策链），App 端开调试输出即可定位到具体子源 |
| 5 | 竞速结果学习 | 竞速 winner 记入源健康统计（成功即加分），加速健康排序收敛 |

### P2 — 长期（规划，按需实施）

| # | 任务 | 方案要点 |
|---|---|---|
| 1 | 统一音质-接口映射 | 消除 magic number（br=1/5/7/740/999…），收敛为 `QUALITY_TO_X` 表 + 源能力声明 |
| 2 | 远端配置热更新 | 音源开关/端点从仓库配置文件拉取，改配置不升级音源本体 |
| 3 | 多账号协作规范 | 分支工作流 + PR 评审；master 只接受已验证改动（避免再出现"多账号直推 master 相互覆盖"） |
| 4 | 自动化测试 | 将 DEV_GUIDE 测试清单固化为 `test/` 冒烟脚本（node 可直接跑，mock `globalThis.lx`） |

## 七、测试清单（发布前必做）

1. **语法**：`node --check lx-source.js`；
2. **加载**：mock `globalThis.lx` 跑一次 `send(inited)`，确认 `sources` 上报 5 平台、qualitys 正确；
3. **平台抽查**（用 curl 复现各子源逻辑或直接装包实测）：
   - wy：《晴天》flac（走 gdWy）+ 免费歌 128k（走 suyin163/wyOuter）+ VIP 歌 128k（应失败不误报）；
   - kw：《难却(DJ细霖版)》flac/320k/128k 三档（重点：不匹配到片段版、URL 可 206 播放）；
   - tx/kg/mg：至少 128k 兜底可用；
4. **防错歌抽查**：带括号版本名（DJ/现场/Live/片段）、同名不同歌手场景；
5. **音质降级**：断掉高音质源（临时关开关）→ 请求 flac 应逐级降到 320k/128k 且 URL 可播；
6. **缓存行为**：同一首歌二次请求命中缓存；换音质 key 不同不串；
7. **健康探测**：启动后首轮 ~1min 内完成，自动启用/停用行为正确。

## 八、发布 SOP（每次迭代必须走完）

1. **改**：修改 `lx-source.js`，文件头 `@version` +1（v11.11 → v11.12），`@description` 写明本轮变更与实测结论；
2. **验**：跑完第七节测试清单；
3. **提交**：`git add lx-source.js && git commit -m "feat(v11.12): <变更摘要>" && git push origin master`（**push 前先 pull --rebase**，防远端冲突）；
4. **发**：GitHub Releases 创建 `v11.12`：标题 `聚合音源 v11.12 …`、正文 = 变更说明 + 实测结论、附件 = 当前 `lx-source.js`；
5. **联动**（需要 App 内置新音源时）：触发 `lx-music-mobile` 的 release.yml（`workflow_dispatch` 或 push 空提交）；
6. **留档**：`versions/` 目录归档带版本号副本，防误删回滚。

## 九、版本规划备忘（2026-10-27 定稿）

| 版本 | 内容 | 状态 |
|---|---|---|
| v11.11 | 接口满编版（当前基线） | ✅ 已发布 |
| v11.12 | P0：片段特征词拒绝 + 兜底歌名校验 + kw https 升级 + duration 校验 | ⬜ 待实施 |
| v12.0 | P1：kw 高音质第二来源 + 失败缓存差异化 + 探测收敛 + 决策日志 | ⬜ 待规划 |
| v13.0 | P2：音质映射统一 + 远端配置热更新 + 自动化测试 | ⬜ 远期 |
