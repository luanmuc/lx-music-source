# 音源仓库审计报告 · 2026-11-07

> 基线：`f8b4789`（v8.10.2）· `lx-source.js` 2545 行 · 冒烟 49 组已实跑通过
> 计划：`docs/AUDIT_PLAN.md` v9.0（96 维：保留 40 + 新增 56）
> 状态：**只读审计，未改任何运行时代码**。工作树仅有 `docs/AUDIT_PLAN.md` 改写与本报告新增。
> 环境限制：沙箱出口 IP 被三平台风控，L4（真网络取链 + Range 可播）不可达；无真机，播放器侧不可做。

---

## 0. 结论摘要

初查 14 项（高 2 / 中 5 / 低 6 / 建议 1）。**二次复核新增 1 项（F-15，高危）、修正 2 项口径、升级 1 项级别**，合计 **15 项：高 3 / 中 6 / 低 5 / 建议 1**。每条的复核结论见 §9。

| ID | 级别 | 一句话 | 锚点 | 复核 |
|---|---|---|---|---|
| F-01 | **高** | 半开试探遇上 429，状态永远停在 `half-open`，该源**再也不会被调用** | `recordRateLimit` 661 / `canExecute` 671 / `wrapExecute` 2066 | ✅ L2 实证 |
| F-02 | **高** | `raceOverallTimeoutMs` 是**死键**：面板可改但完全无效；真正生效的 `raceBudgetMs` 又不在白名单 | 31 / 2423 / 2437；2263 | ✅ L2 实证 |
| **F-15** | **高** | **huibq 探针 100% 失败**：`probeSingleSource(id, cfg)` 的形参遮蔽全局 `cfg()`，冷启动分支 `cfg('coldStartProbeTimeoutMs')` 直接 TypeError→被吞成"探测失败"。唯一 `coldStart` 源就是这个五平台兜底源 | `probeSingleSource` 形参 vs 49 行 `cfg()`；382 行；1811 | ✅ L2 实证（正常响应也不发请求） |
| F-03 | 中 | 降档交付（求 flac 实给 128k）写进 **flac 的缓存槽** → 6h 内再点 flac 直接吃 128k | 1072 / 2291、2261 | ✅ L2 实证 |
| F-04 | 中 | **错误码在路径上丢两层**：message 恒以 `NOT_FOUND` 开头（哪怕 code 是 `NETWORK_TIMEOUT`）；失败缓存命中时连 `err.code` 字段都没有 → App 只能读到"不存在" | 2243–2246、2326、2332 | ✅ L2 实证（口径修正） |
| F-05 | 中 | 429 计入 `byQuality.fail` 与成功率分母 → **3 次纯限流就把该档短路** | 661–669、2197 | ✅ L2 实证 |
| F-06 | 中 | huibq 探针缺 msg 失败词判据（假成功只修了取链路径） | 311–317 vs 1469–1471 | ⚠️ 静态成立，**被 F-15 掩盖、L2 无法复现** |
| F-07 | 中 | `PLATFORM_GROUPS` 手写清单与竞速链漂移 → 平台"全挂"误报 | 1766–1773 vs 1869 | ✅ L2 实证（degraded=true 而链里有源） |
| F-08 | 低 | 探测通过不解除熔断；也救不回 F-01 的卡死 | 424–442 | ✅ L2 实证 |
| F-09 | 低 | 末档保底不看剩余总预算 → 名义 12s 实际 13.0s | 2285–2287 | ✅ L2 实证 |
| F-10 | 低 | 半开分支 `return` 跳过 `playDeadStreak` 累加，与注释语义不符 | 705–722 | ⚠️ 仅 L0（需 5min 冷却，做不了动态） |
| F-11 | 低 | `validateUrl` 用 `trim()` 后校验、返回**未 trim 原串** | 1036–1040 | ✅ L2 实证 |
| F-12 | **中**（原低·待决策） | 320k/128k 档预算 4s < 单源超时 5s → **5s 内本可成功的源被判失败**（实测 4006ms 失败），失败还会累计熔断 | TIMEOUT 5000 / 2264 | ✅ L2 实证，**级别上调** |
| F-13 | 建议 | `lingchuan` 无平台能力过滤，开启后在 tx/mg/kg 白耗预算 | 1882 | ✅ L2 实证（进 tx 链） |
| F-14 | 低·文档 | 计划 A19 旧备注写"快照上限 20 条"（实为 144） | 478 | ✅ L0 |

---

## 1. 方法与证据

- **四元锚点**：每条都落到 `定义 → 调用方 → 被调用方 → 消费方`；跨层项额外核对 App fork 侧类型（`lx-music-mobile/src/screens/Home/Views/Setting/settings/Health.tsx`）。
- **证据级别**：L0 静态 / L1 加载 / L2 mock 行为（含反向） / L3 官方冒烟 / L4 真网络。本轮 F-01 拿到 **L2 动态实证**，其余为 L0 静态 + L3 基线（49 组实跑通过）。
- **反证步骤**：每条发现都检查了"附近是否已有守卫"。例如 F-05 先确认 `recordRateLimit` 确实**有意不计熔断**（注释 v4.0），再确认 `q.fail++` 仍写进了档位判据使用的同一字段——矛盾才成立。

### 1.1 F-01 的动态实证（两条命令，脚本在 `/tmp`，不污染仓库）

```bash
# 1) 半开 + 429：把 kuwoOfficial 手动置为 open 且冷却已满，再发一次 musicUrl（mock 全 429）
node /tmp/src_probe_check.js
# 实际输出：
# {"第一次429后state":"half-open","rateLimited":false,"第二次请求后state":"half-open","canExecute":false}
```

结论：`canExecute` 在 `half-open` 恒返回 `false`（671–687 无 half-open 分支）；`recordRateLimit`（661）只加计数和退避，**不改 state**。而 v8.10.2 已经给「业务失败」和「本地节流」各补了一条 `half-open → open` 的收口（725–735、2047–2056）——**同一个函数里三条出口修了两条，漏了 429 这一条**。

```bash
# 2) 预算外慢源记账观察（首批即胜、慢源仍在飞）
node /tmp/src_budget_check.js
# 实际输出：用户已成功拿到链接（635ms），慢源 failureCount 仍 0（该请求里慢源未被启动）
```

这条同时印证了 L3 维度：**分批错峰一旦首批首胜，后续批次永不启动**（`launchBatch` 里 `if (settled) return`，1975–1980）。这是速度上的正确取舍，但意味着健康排序一旦偏了，链尾源在自己"变好"之前几乎没有被重新评估的机会——记为观察项，不作为缺陷。

### 1.2 基线

```bash
node test/lx-source-smoke-test.js   # 49 组用例全绿（含"半开业务失败收口"一例）
```

**注意**：49 组里已有"半开业务失败收口"和"半开本地节流收口"，**唯独没有"半开 429"**——这正是 F-01 能活到今天的原因（P3 维度：同类分支未各覆盖一例）。

---

## 2. 高危

### F-01 半开 + 429 → 源永久停用

- **触发路径**：源连续 3 次网络失败进入 `open` → 冷却 180s 后 `canExecute` 置 `half-open` 放行一次 → 上游此时恰好回 429（风控/限流很常见，尤其 huibq、ikun、juhe 这类第三方）→ `wrapExecute` 走 `recordRateLimit`（2066–2068）→ 状态**留在 half-open**。
- **后果**：`canExecute` 对 half-open 恒 false；探测不解除熔断（F-08）；`recordSuccess` 永远等不到。该源直到 App 重启或被手动 toggle 才会回来。对默认开启的 kw 主力源（suyinKuwo / xinghaiBackend / huibq），等于一次风控就把链路降一档且不自愈。
- **反证**：确认 `rateLimitUntil` 到期只清 `rateLimited` 标记，不动 `state`；确认 `recordBusinessFail`、`isThrottleSkip` 两条已有收口，故这是遗漏而非设计。
- **建议修法**：与另外两条出口对齐——`recordRateLimit` 里判 `state === "half-open"` 时置 `open` 并刷新 `lastFailureTime`；补 T50：半开 + 429 → 收口回 open，且下一轮冷却满了还能再放行一次。

### F-02 死键 `raceOverallTimeoutMs` + 真键 `raceBudgetMs` 不可调

- **事实**：全仓 `raceOverallTimeoutMs` 仅 3 处——`USER_CONFIG` 默认值（31）、`ALLOWED_KEYS`（2423）、`PARAM_LIMITS`（2437），**零运行时消费点**；实际预算来自 `cfg('raceBudgetMs', 12000)`（2263、1908、2093）。
- **后果双向**：① 用户在 App 参数面板调「竞速总超时」→ 一点效果没有，且调完会以为生效；② 真正要调的总预算 `raceBudgetMs` 不在 `ALLOWED_KEYS`，用户根本改不到。
- **建议修法**（需用户拍板）：要么把 `raceOverallTimeoutMs` 接进 `getUrlWithFallback` 作为总预算、并把 `raceBudgetMs` 也加进白名单；要么从面板和白名单里删掉死键，只暴露 `raceBudgetMs`。**倾向后者**：一个键一个语义，别留两个"总超时"。

## 3. 中危

### F-03 降档交付污染请求音质的缓存槽

- 2261 用**请求音质**建 key；2291 用**实交付音质**写值。请求 flac、降档拿到 128k → `{url, quality:'128k'}` 存进 `..._flac` 槽；`getCachedUrl` 按 `entry.quality` 选 TTL（1063–1065）→ 128k 走 6h。
- 后果：**6 小时内再点同一首的 flac，直接拿 128k 且不再尝试高音质源**；而 v8.10 加高音质短 TTL 的初衷正相反（高音质链接会死，所以要早过期）。这里是"低音质占了高音质的坑"，方向刚好反了。
- 建议：命中时校验 `qualityRank(entry.quality) < qualityRank(请求quality)` 则视为 miss（或写入时改用实际音质的 key、并保留请求 key 的"已降档"标记，TTL 用短档）。

### F-04 失败缓存命中一律抛 `NOT_FOUND`

- 2243–2246 命中就 `throw NOT_FOUND: 该请求已知失败，跳过`；但写入时（2326）保留的是 `lastFailCode`，网络类走 30s 短缓存、410 走 60s。
- 后果：全链 30 秒网络故障窗口内，用户重试同一首会看到"不存在"类结论；App 侧据此做的文案/重试策略会走错分支（跨层 H5 维度）。
- 建议：抛出时用 `entry.code`（`getFailCached` 目前只回 boolean，需要顺带返回 entry）。

### F-05 429 污染成功率分母与档位短路

- 661–669：`b.totalRequests++`、`q.req++; q.fail++`，但熔断**有意不计**（注释 v4.0："限流不是源坏了"）。
- 而 `isQualityHopeless`（2197）用 `q.fail + linkExpired ≥ 3` 判"该档历史 0 成功"→ **纯限流 3 次即可把该档短路 1 小时**；同时 `getSourceStats` 的成功率分母含这些请求，面板成功率被拉低。
- 建议：429 只记 `rateLimitCount/rateLimitUntil`，不进 `q.fail` 与成功率分母；或引入独立 `rateLimit` 字段供诊断。

### F-06 huibq 探针缺 msg 判据（假成功在探活路径复现）

- 取链路径 1469–1471 有 `无法获取|获取失败|失败|错误…` 判据（v8.7）；探针 311–317 只校验 `code===0 && url非空 && Range可播`。
- 后果：上游返回「无法获取播放链接！」+ 一条可播错链时，探针判"健康"→ 源在健康排序里被抬高、自动开关不会关它，而真实请求一遇 tx/mg 类请求就失败。这正是 v8.7 的同一类缺陷，**修了一条路径没修另一条**。
- 建议：探针 check 里补同一条 msg 失败词判据（抽成公共 `isHuibqFakeSuccess(body)`）。

### F-07 平台聚合分组与竞速链漂移

- `buildSourceChain` 1869：`if (t.suyinKuwo && platform !== "kw") push(...)` —— wy/tx/mg/kg 都有它；`PLATFORM_GROUPS`（1766–1773）wy/tx/mg/kg 都没列 suyinKuwo。
- 后果：这些平台只剩 suyinKuwo 活着时，`_platformSummary` 会算成"无活跃源/全挂"，App 的降级提示与 `_fallbackPlatform` 建议随之误报。
- 建议：分组从 `buildSourceChain(platform, '128k')` 派生（像 huibq 用 `platforms` 声明那样收敛成单一真相），不要手写第二份清单。

## 4. 低危 / 建议

- **F-08**：`applyProbeResult` 通过时只清 `sleeping/playDead/passCount`（424–442），不动 breaker；面板会出现"探针通过 + 熔断中"。建议探测通过且 state=open 且冷却已满时顺带清熔断，同时给 F-01 一个兜底自愈通道。
- **F-09**：2287 末档 `max(qBudget, floor 3000)` 不看 `totalDeadline` 余量 → 名义 12s 可达 15s。要么改注释口径，要么 `min(..., totalDeadline-now)`。
- **F-10**：`recordFailure` 705–722 半开分支 `return` 后不再累加 `playDeadStreak`。若"半开失败也应算一次真实播放失败"，这里少算；若有意（半开失败已在 open 计数），把注释改准。
- **F-11**：1036–1040 校验 `url.trim()`、返回原 `url`。带 `\n`/空格的上游 URL 会一路进播放器。改成 `return url.trim()` 即可（或先 `const u = url.trim()` 再全程用 `u`）。
- **F-12（待决策）**：`TIMEOUT_CONFIG.parse = 5000` 而 320k/128k 档预算 4000（2264）→ 慢源必然在预算之后才超时，仍走 `recordFailure`；配合"首胜后不取消"（raceFirst 无 abort），用户已拿到链接之后仍会给慢源记失败，3 次熔断/摘除。两种取向：① 预算对齐单源超时（4000→5000）；② settle 后给在飞请求打 `aborted` 标记、不记账。前者省事但慢 1s，后者更准但要改 wrapExecute 与 raceFirst 的契约。
- **F-13**：1882 `if (t.lingchuan) push(...)` 无平台过滤；默认关闭所以现在无害，一旦配置卡密开启，tx/mg/kg 会白耗预算。
- **F-14**：`AUDIT_PLAN` A19 备注"上限 20 条"与 478 行 `HEALTH_HISTORY_MAX = 144` 矛盾——文档镜像维度 Q2 的反例，本轮已在新计划里改掉。

## 5. 覆盖情况（诚实口径）

| 区域 | 覆盖 | 证据级 |
|---|---|---|
| 熔断/半开/限流/摘除状态机 | 全量逐出口 | L0 + L2（F-01 实证） |
| 缓存（成功/失败/过期兜底/LRU） | 全量 | L0 |
| 竞速/预算/短路/排序 | 全量 | L0 + L2 观察 |
| 探测/自愈/自动开关 | 全量 | L0 + L3 |
| 配置面（31 键 + 白名单 + 边界） | 全量逐键查消费点 | L0 |
| 健康快照/趋势/平台聚合 | 全量 + 跨层对照 App 类型 | L0 |
| 20 个源的取链实现 | L0 抽查 9 源（gdWy/wyOuter/suyin163/suyinKuwo/kuwoOfficial/helloworldKw/xinghaiBackend/huibq/ikun/lingchuan） | L0 |
| 真网络取链 / Range 可播 / 真机播放 | 🚫 沙箱出口 IP 被风控 + 无真机 | blocked |
| B–G 组脚本与 CI | 沿用 v8.1 结论，本轮未重跑 | — |

**未审完并已披露的**：`suyinQQ`/`suyinMigu`/`xinghaiBackup`/`juhe` 五源 的 handler 细节（默认关闭，L0 未逐行读）；`iterate` 竞速在极端并发下的 inflight 竞态（A13 只做了静态论证）；`health-daily`/`ecosystem-scan` 脚本逻辑（B 组沿用）。

## 6. 为什么 40/40 全绿还是漏了这些

v8.1 的判据是"有没有"：有没有 try/catch、有没有上限、有没有 action、有没有守卫。这 14 条**全部**在"有"的那一侧——守卫在、上限在、注释在。缺陷全部落在"有了之后的语义"：

1. **状态机的出口不全**（三条出口修两条）——靠通读函数级"有没有处理异常"永远看不出来，只能做 4×6 迁移矩阵。
2. **字段被两套机制共用**（`q.fail` 同时喂成功率与短路判据）——只能逐字段追"谁写、谁读"。
3. **同一类保护只挂了一条路径**（huibq 的 msg 守卫只在取链、不在探活）——只能按"路径 × 判据"做二维表。
4. **键与消费点脱钩**（死键）——只能逐键 grep 消费点，不能看"白名单有 14 个"就判过。
5. **镜像文档各自过期**（A19 写 20 条）——只能拿代码常量反查文档数字。

这五条已固化成计划里的 I / J / M+N / O / Q 五组，共 30 维。

## 7. 建议的处理顺序（等你拍板，我不动代码）

1. **先修 F-01 + F-02**（各配一个反向用例，回退后必须变红）。
2. 再修 F-05 + F-06 + F-07（都是"判据/清单"类的收敛，风险低、收益直接）。
3. F-03 / F-04 涉及缓存语义与 App 展示，先定口径再改。
4. F-11 / F-09 / F-10 / F-14 一批打包，不改行为。
5. F-12 需要你选：预算对齐超时（简单、慢 1s）还是 settle 后不记账（准、要动契约）。

**需要你决策的两点**：
- `raceOverallTimeoutMs`：删（只留 `raceBudgetMs` 并把它加进面板）还是接进运行时？
- F-12：预算对齐 vs settle 后不记账？

## 8. 复现

```bash
cd lx-music-source
node --check lx-source.js
node /tmp/src_probe_check.js     # F-01：半开+429 卡死（期望修后 state=open）
node /tmp/src_budget_check.js    # L3/L1 观察：首胜后续批次不启动
node test/lx-source-smoke-test.js # 49 组基线
```

---

## 9. 二次复核（2026-11-07 追加，逐条重验）

方法：**不采信上一轮表述**，对每条回到代码定位 + 构造运行场景（mock 宿主 + 仓库导出的真实函数），能动态的必须动态；证据分级 L0 静态 / L2 mock 行为。脚本：`/tmp/verify_findings.js`（9 场景）、`/tmp/verify_findings2.js`（6 场景）、`/tmp/v3.js`、`/tmp/v4.js`，均在仓库外。

### 9.1 结果汇总

| 结论 | 条目 |
|---|---|
| 动态实证成立 | F-01、F-02、F-03、F-05、F-07、F-08、F-09、F-11、F-13 |
| 实证且**升级** | F-12（低→中） |
| 实证但**口径修正** | F-04 |
| **新增** | **F-15（高）** |
| 静态成立但被其它缺陷掩盖 | F-06 |
| 只能静态 | F-10、F-14 |

原 14 项**没有一项被推翻**，但有 1 项级别偏低（F-12）、1 项描述不准（F-04）、1 项在实测中被更底层缺陷挡住（F-06）。

### 9.2 关键实测（原始输出）

**F-01 + F-08（半开 429，且探针救不回）**
`/tmp/verify_findings.js halfopen429` → `{第一次429后:"half-open", 第二次请求后:"half-open", 探针通过后:"half-open", 用户结果:"失败"}`
→ 三条复位路径（再请求 / 探针通过 / 冷却到期）都无效，用户侧表现为该源彻底消失。

**F-02（死键）**
`node /tmp/verify_findings.js deadkey` → 写入回显 `{raceOverallTimeoutMs: 1000}`，随后一次请求耗时 **4006ms 且失败**。
→ 1s 的"总超时"没有约束任何东西；真正截断它的是 `raceBudgetPerQuality=4000`。**这条同时把 F-12 实证了**：mock 里 5s 给结果的源，在 4s 预算下被判"全失败"。

**F-15（新，huibq 探针永久失败）**
`node /tmp/v4.js`（上游返回**完全正常**的 `code:0 + 可播 URL`，round=3）→ `{huibq请求是否发出:false, 探测次数:1, 探测成功:0, failCount:1, deadCount:1, score:-1}`
→ 探针**连请求都没发**就记了失败。链条：`async function probeSingleSource(id, cfg)`（形参）遮蔽了 49 行的 `function cfg(key, def)`；382 行 `cfg('coldStartProbeTimeoutMs', 30000)` 只有在 `h.coldStart` 为真时才执行 → **全仓唯一 `coldStart: true` 的源就是 huibq（1811 行）** → TypeError 被内层 `catch` 吞成 `usable:false`。
后果：huibq 健康分恒为负、排序垫底、3 轮进休眠、面板长期显示"探测失败"；v8.10 加的"冷启动豁免自动关闭"恰好掩盖了它（否则这个五平台兜底源早被自己关掉）。

**F-03（缓存污染）**
`cachepoison` → `{首次请求flac得到:"128k", 二次请求flac得到:"128k", 二次耗时ms:0, 二次新增网络请求:0}`
→ 不只是"6h 内不再试高音质"，而是这些请求**根本不出网**。

**F-04（口径修正）**
`failcache` + `f04b` → 首次 `code:"NETWORK_TIMEOUT"` 而 `message:"NOT_FOUND: 所有源均失败…"`；命中缓存后 `code:undefined(字段缺失)`、`message:"NOT_FOUND: 该请求已知失败，跳过"`。
→ 原写法"一律抛 NOT_FOUND"不够准：**码和文案本来就是两套东西**（`finalErr` 的文案恒 NOT_FOUND，码另外挂在 `err.code` 上；缓存命中路径干脆没挂 code）。App 若按文案判类型，网络故障一律变成"不存在"。

**F-05（短路成立，注意复现顺序）**
第一次按"同歌 3 次"复现失败——因为**失败缓存先把第 2、3 次请求挡在链外**（这本身是 F-04 的现场）。改成每次换歌（换 cacheKey）后：`{三次后byQuality_128k:{req:3,success:0,fail:3}, 第四次该源是否被调用:false}` → 成立。

**F-06（被 F-15 掩盖）**
`f06c`/`probemsg` 三轮探测后：`{huibq探测次数:1, 成功:0, huibq相关命中:[]}`。取链路径的 msg 判据是事实（1469–1471），探针 check 里确实没有同款判据（311–317），但**当前它根本跑不到 check**。所以这条要排在 F-15 之后修，修完再补一个"上游 code=0 + 失败文案"的红用例。

**F-07（平台误报）**
`chain` → `tx链:["suyinKuwo"]`（其余默认关），构造 suyinQQ/juheTx 熔断后 `平台聚合tx:{degraded:true, activeCount:2, deadCount:2, avgScore:0}`，而链里 suyinKuwo 仍可用。
→ 默认配置下 tx **完全依赖 suyinKuwo 单点**，一旦它被计数成 dead，平台就被判"全挂"并触发兜底切换。

**F-09 / F-11 / F-13**
`budgetoverflow` → 总耗时 **13003ms**（名义 12000ms）；`validateurl` → 返回 `" https://a.example.com/x.mp3\n"`（首空格 + 尾换行原样透出）；`chain` → 开启聆川后 tx 链变 `["suyinKuwo","lingchuan"]`。

### 9.3 没能做到的

- **F-10** 需要真实的 5 分钟半开冷却，且 `playDeadStreak` 未导出 → 只保留 L0 判断，不声称"已验证"。
- **L4 全线不可达**（沙箱 IP 被三平台风控）：以上全部是 mock 行为级证据，**不能替代真网络下"上游真的会这么返回"**。特别是 F-06 的前提（huibq 真的返回 code=0 + 失败文案 + 可播错链）来自 v8.7 的历史修复记录，本轮无法现场复现。

### 9.4 复核后的处理顺序（等你拍板）

1. **F-15 + F-01**（高危两条，都是"源被静默废掉"）——各配一个回退必红的用例。
2. **F-02**（死键，改一处：删键或接进运行时并入白名单）。
3. **F-12**（级别已上调：预算 4s vs 超时 5s 让可成功的源被判死）——与你原来的两个选项同一个决策点。
4. **F-05 / F-07**（判据与清单收敛）。
5. **F-06**（在 F-15 修完之后补 msg 判据 + 红用例）。
6. **F-03 / F-04**（缓存身份 + 错误码，涉及 App 展示口径）。
7. F-08 / F-09 / F-11 / F-13 / F-14 打包。

## 10. 修复落点（v8.10.3，2026-11-07）

> 用户授权「按最优方式全修、顺序自定」，**已推送**（修复提交 `47f527a` + 文档吸收 `5e0c7fe`/`79ffb01`，master）。15 项全部落代码，`node --check lx-source.js` 通过，冒烟由 49 组扩到 **55 组**（T50–T55 为回退必红的新增反向用例）。

| 项 | 改法 | 位置 | 验证 |
| --- | --- | --- | --- |
| F-01 | `recordRateLimit` 补 `half-open → open` 收口并刷新 `lastFailureTime`；日志改用 `cfg('rateLimitBackoffMs')` 实际值 | `recordRateLimit` | **T50**（半开 + 429 后 `state==='open'` 且时间戳已刷新） |
| F-02 | 删死键 `raceOverallTimeoutMs`（默认值 / `ALLOWED_KEYS` / `PARAM_LIMITS` 三处），把真正生效的 `raceBudgetMs` 暴露进白名单与上限 15s | 配置面三处 | 自检 + 面板写值可回读 |
| F-03 | 缓存写入改按**实交付音质**选 key：`writeKey = deliverQ === reqQ ? cacheKey : buildCacheKey(platform, songInfo, selectedQuality)`；降档日志补「按交付音质入槽，下次仍会重试高音质」 | `getUrlWithFallback` | **T52**（降档 128k 后二次请求 flac 必须重新取链） |
| F-04 | 新增 `getFailCachedEntry()` 返回整条记录；命中路径抛 `${cachedCode}: …` 并挂 `hitErr.code`；聚合错误前缀由固定 `NOT_FOUND` 改为 `lastFailCode` | 失败缓存三处 + `finalErr` | 冒烟 T6/T7（差异化 TTL 不变）+ 文案与 code 一致 |
| F-05 | `recordRateLimit` 删掉 `b.totalRequests++` 与 `q.req++; q.fail++`——429 不再进分子分母、不再喂 `isQualityHopeless` | `recordRateLimit` | **T53**（纯 429 后 `byQuality['128k'].fail === 0`，`rateLimitCount === 1`） |
| F-06 | 抽出 `HUIBQ_FAIL_MSG_REGEX` + `isHuibqFailMsg(msg)` 单点函数；取链路径与探针 `check` 共用 | huibq 两处 + 单点函数 | **T51**（上游正常返回时探针发出请求并记成功） |
| F-07 | `PLATFORM_GROUPS` 由手写清单改为「按 4 档音质取 `buildSourceChain` 并集」——分组与竞速链单一真相 | `getHealthSnapshot` | **T54**（只开 `suyinKuwo` 时 tx 分组 `activeCount ≥ 1`、不误报降级） |
| F-08 | `applyProbeResult` 通过分支一并复位断路器（`state='closed'`、`failureCount=0`、`lastFailureTime=0`、`rateLimitUntil=0`、`rateLimited=false`、`rateLimitCount=0`） | `applyProbeResult` | 面板不再出现「探针正常 + 熔断中」 |
| F-09 | 末档预算上界显式钳在 `总预算 + 保底`（默认 12s+3s=15s，与 `PARAM_LIMITS` 一致），日志标注可溢出至 N 秒——口径诚实化而非砍掉防无声保底 | `getUrlWithFallback` | 冒烟 T46（末档保底仍交付 128k） |
| F-10 | 抽出 `bumpPlayDead(sourceId)` 单点函数（累加 + 达阈值设 `playDeadDeadline` + 摘除日志）；`recordFailure` 开头先调它，半开 `return` 分支也能累加；删除尾部重复代码 | `bumpPlayDead` / `recordFailure` | 冒烟 T31（自动摘死源） |
| F-11 | `validateUrl` 加 `!url.trim()` 判空，返回 `url.trim()`（旧实现校验用 trim 值、返回原串，首尾空白直达播放器） | `validateUrl` | **T55**（带 `\n` 的上游 URL 交付时已 trim） |
| F-12 | `raceBudgetPerQuality` 的 `320k`/`128k` 由 4000 提到 **5000**，对齐 `TIMEOUT_CONFIG.parse`——旧值比单源超时还短，5s 内本可成功的源被判死并累计熔断 | 默认值 + `perQBudget` 兜底两处 | 冒烟 T46 改显式分档预算后仍绿 |
| F-13 | `lingchuan` handler 补 `platforms: ["kw","wy","tx","mg","kg"]` 显式声明（协议为 `source=平台` 由服务端路由，属通用源，不按平台硬砍）；将来实测某平台必败只改这一处 | `SOURCE_HANDLERS.lingchuan` | 行为不变，声明显式化 |
| F-14 | `AUDIT_PLAN` A19 备注「20 条」更正为 144，状态 ⚠️→✅ | `docs/AUDIT_PLAN.md` | 文档一致性 |
| F-15 | `probeSingleSource(id, cfg)` 形参改名 **`pc`**，函数内 8 处 `cfg.*` 全改 `pc.*`；`cfg('coldStartProbeTimeoutMs', 30000)` 恢复为全局配置调用 | `probeSingleSource` | **T51**（huibq 探针真实发出请求，`probeSuccess ≥ 1`） |

### 10.1 顺带修正

- `raceFirst` 的 `deadline` 取值由 `Number(opts.deadline || Date.now()+budget)` 改为显式判定——`0` 是 falsy 会被误当「未传」而回退到总预算（预算耗尽却继续跑）。
- `recordFailure` 的半开分支此前 `return` 会跳过 `playDead` 累加，已由 `bumpPlayDead` 前置修正。

### 10.2 仍未做 / 需装机或真网络

- **L4 真网络取链**：沙箱出口 IP 被三平台风控，F-06 的「上游真的返回 code=0 + 失败文案」仍来自 v8.7 历史记录，本轮无法现场复现。
- **F-12 的第二选项**（预算到期不累计熔断）未采纳：`aborted` 契约改动面大，先以「预算对齐单源超时」消掉主因。
- **面板口径**：`raceBudgetMs` 现可配（默认 12s，上限 15s），需 App 侧健康面板补这一项说明（「最坏 12s+3s 末档保底」）。

### 10.3 修复前后指标对比（实测数据）

> 「改前」= 二次复核时 `mock 宿主 + 仓库真实导出函数` 跑出的原始输出；「改后」= v8.10.3 代码在当前冒烟里的实测断言（`test/lx-source-smoke-test.js` T50–T55）。

| 项 | 改前实测 | 改后实测 | 证据 |
| --- | --- | --- | --- |
| F-01 | `{第一次429后:"half-open", 第二次请求后:"half-open", 探针通过后:"half-open", 用户结果:"失败"}` | 状态收敛为 `open`，`lastFailureTime` 刷新 | T50：日志 `半开试探失败(128k 限流429)，重新熔断` + 断言 |
| F-15 | `{huibq请求是否发出:false, 探测次数:1, 成功:0, failCount:1, deadCount:1, score:-1}` | 探针真实发请求且记成功；第 3 轮探测后 huibq 保持自动启用 | T51：`counts['.../url/kw/228908/128k'] ≥ 1`、`probeSuccess ≥ 1` |
| F-03 | `{首次请求flac得到:"128k", 二次请求flac得到:"128k", 二次耗时ms:0, 二次新增网络请求:0}` | 二次请求 flac 仍交付 128k，但**重新取链**（请求计数增长） | T52：`totalCounts()` 前后对比 |
| F-05 | 累计 `{byQuality_128k:{req:3, success:0, fail:3}, 第四次该源是否被调用:false}`（该档被短路 1h） | 纯 429 后 `fail=0`、`rateLimitCount=1`（不再喂短路判据） | T53：断言 `byQuality['128k'].fail === 0` |
| F-07 | `{tx:{degraded:true, activeCount:2, deadCount:2, avgScore:0}}`，而链里 `suyinKuwo` 仍可用 | 只开 `suyinKuwo` 时 `tx.activeCount ≥ 1`、`degraded === false` | T54：分组由 `buildSourceChain` 并集生成 |
| F-09 | 总耗时 **13003ms**（名义预算 12000ms） | 上界显式钳在 `raceBudgetMs + raceBudgetFloorMs` = 15000ms，日志标注「可溢出至 15s」 | 代码路径 + `logDebug` 文案 |
| F-12 | 5s 可成功的源在 4s 预算下 **4006ms 判全失败**并累计熔断 | 单档预算 5000ms = `TIMEOUT_CONFIG.parse` 5000ms | T46 改显式分档预算后仍绿 |
| F-11 | 返回 `" https://a.example.com/x.mp3\n"`（首空格 + 尾换行原样透出） | 交付 `"https://example.com/trim.mp3"` | T55：`assert.strictEqual(r.url, 'https://example.com/trim.mp3')` |

口径说明：以上全部是 **L2 行为级**（mock 上游）证据。L4（真实取链 + Range 可播 + 真机播放）本轮未做，不能替代。

