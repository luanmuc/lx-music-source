# 临时优化决策（对 TEMP_OPTIMIZATION_REVIEW.md 的审查结论）

> 用途：供执行方按本文件逐条落地。**原清单 10 条不要全做**，本文件已给出做/不做结论与原因。
> 审查人：另一豆包账号｜审查时间：2026-11-06（基于 v8.9.1 `27c9399` 代码核实）
> 状态：临时文档，落地完成、CI 绿后删除。

---

## 一、结论总表

| # | 原清单项 | 结论 | 批次 |
|---|---|---|---|
| 1 | 跨档 12s 总预算 | **做**（严重度被原清单低估，见二.1） | A |
| 4 | 冷启动源探测超时 | **做**（严重度被原清单低估，见二.2） | A |
| 2 | 短路 6h 探路窗口 | 做（参数层，便宜） | B |
| 3 | 高音质缓存 TTL | 做（行为描述被原清单写错，见二.3） | B |
| 7 | 历史快照 60 条 | 做（一个常量） | B |
| 5 | probe-history 无清理 | **不做** | — |
| 6 | half-open 降后批 | **不做** | — |
| 8 | UA 池扩容 | **不做** | — |
| 9 | gdWy batch:2 | 不动（同意原清单） | — |
| 10 | 版本串三处同步 | 不动（同意原清单） | — |

分批理由：1/4 改的是竞速核心与探针判定，2/3/7 是参数与缓存策略。混在一起出问题无法定位，且额度有限。

---

## 二、原清单三处事实错误（必须按本节理解，否则方案会做偏）

### 1. 第 1 条：预算耗尽 = 整次取链失败，不是"交付时延变长"
代码事实（`lx-source.js` L2041 `fallbackRace`，调用点 L2235）：
```js
if (deadline && Date.now() >= deadline) throw NETWORK_TIMEOUT: 竞速预算耗尽
```
外层 `getUrlWithFallback` 的 `for (const q of qualityChain)` 里 `catch → continue`，但**下一档进函数第一行同样 `Date.now() >= deadline` → 立即再抛**。

即：flac 档把 12s 吃满后，320k / 128k **连一次请求都发不出去**，整次 musicUrl 返回失败——用户点歌是无声，不是等得久。

### 2. 第 4 条：冷启动源探针会把源**真摘掉**，不是"面板显示假死"
代码事实：

| 位置 | 事实 |
|---|---|
| `applyProbeResult` L417 失败分支 | `if (failCount >= PROBE_FAIL_REQUIRED /*=2*/) runtimeToggles[id] = false`（自动关闭） |
| `PROBE_FAIL_REQUIRED` L181 | = 2，即两轮探测失败即关闭 |
| 探针轮间隔 L29 `healthCheckIntervalMs` | 600000 = 10min → 20 分钟内被关 |
| **运行时探针超时** | `HEALTH_CHECK_TIMEOUT = 6000`（L179，v1.0 由 4000→6000「减少误摘」），在 `probeSingleSource` L380 传给 `httpRequest`；随后的 `isAudioPlayable` Range 校验另有超时 |
| CI 巡检脚本 | `scripts/probe.js` 是另一条链路：`probeUrl` = **4s**，`payloadFetch` = **5s** |

原清单写的"探测超时默认 8s"不准确：8s 是**播放链**的 `coldStartTimeoutMs`，运行时探针是 6s，CI 脚本探针是 4~5s。huibq onrender 冷态 30s → 三条链路全超时 → 运行时探针两轮（20min）后 `runtimeToggles=false`，kw/wy 链尾一个真实可用的源消失。

### 3. 第 3 条：缓存命中不校验有效性，"410"不会在取链时暴露
`setCachedUrl`（L1037）存的是 URL 原串；命中缓存直接返回 `{url, quality, source}`，**音源侧不做 Range/HEAD 校验**。所以原清单描述的"先试缓存→410→再换源"不会发生——真实后果是**App 拿到死链、播放报错**，用户重试后走 1min 失败缓存才重新取链。

---

## 三、批次 A（先做，bug 级）

### A1 分档预算 + 保底降档

**目标**：flac 吃满也不饿死低档；总时长上限仍守住 12s（v8.8 防三级降档 90s+ 的初衷不能破）。

**代码位置**
- 配置：`USER_CONFIG` L33 `raceBudgetMs`
- 使用：`getUrlWithFallback` L2214 `const raceDeadline = Date.now() + cfg('raceBudgetMs', 12000);`
- 消费：`fallbackRace(chain, platform, songInfo, quality, raceDeadline)`

**方案**
1. 新增配置键 `raceBudgetPerQuality`，默认 `{ flac: 6000, "320k": 4000, "128k": 4000, "24bit": 6000 }`，缺省回退 `raceBudgetMs`。
2. 新增 `raceBudgetFloorMs`（默认 3000）：**最后一档**（`qualityChain` 末位）保底。
3. `getUrlWithFallback` 内每档单独算 deadline：
   ```
   档 deadline = now + min( 该档预算, 剩余总预算 )，但若为最后一档则 min 结果不得低于 floor
   ```
   即：
   ```js
   const totalDeadline = Date.now() + cfg('raceBudgetMs', 12000);
   for (const q of qualityChain) {
     const isLast = q === qualityChain[qualityChain.length - 1];
     const perQ = cfg('raceBudgetPerQuality', {})?.[q] || cfg('raceBudgetMs', 12000);
     let budget = Math.min(perQ, Math.max(totalDeadline - Date.now(), 0));
     if (isLast) budget = Math.max(budget, cfg('raceBudgetFloorMs', 3000));
     const raceDeadline = Date.now() + budget;
     ...
   }
   ```
4. `fallbackRace` 的预算耗尽错误消息保留 `${budget}ms`（当前读 `cfg('raceBudgetMs')` 打印的是总预算，改为传入的实际档预算，避免日志误导）。

**回归用例 T46**
- 场景：`__lxSourceConfig` 注入 `raceBudgetPerQuality:{flac:1000,'320k':1000,'128k':1000}`、`raceBudgetFloorMs:3000`，flac 档全部源 mock 慢 600ms×多批；
- 断言：flac 预算耗尽后，320k / 128k 仍发生真实请求且最终交付（不得整次失败）；
- 断言：末档获得 ≥3s 预算（用 mock 计时或请求计数间接断言）。
- 注意：用例必须独立模块实例 + 保存/复原 `globalThis.__lxSourceConfig`（同 T43 写法），避免污染后续用例。

### A4 冷启动源探针：放宽超时 + 豁免自动关

**目标**：冷态源不再被 20 分钟摘掉。

**代码位置**
- 探针发起：`probeSingleSource` L358（内部按 `probeUrl` 4s / `payloadFetch` 5s 发起）；轮次调度 L470~483
- 判定：`applyProbeResult` L417 起失败分支（`PROBE_FAIL_REQUIRED` 关闭逻辑）
- 请求超时：`scripts/probe.js` 的 `probeUrl`(4s) / `payloadFetch`(5s)

**方案**
1. 新增配置键 `coldStartProbeTimeoutMs`（默认 30000）；`probeSingleSource` L358 内 `timeout: HEALTH_CHECK_TIMEOUT`（L380）改为按 `SOURCE_HANDLERS[id].coldStart` 分支取值，并同步给 `isAudioPlayable` 的可播校验超时（否则取链 30s 成功、校验仍 4s 超时）。
2. 说明：CI 侧 `scripts/probe.js`（`probeUrl`/`payloadFetch`）是独立链路，若也要放过冷态，需同样按 `coldStart` 放宽；但 CI 每日只跑一次，影响面小于 App 内 10min 一轮的运行时探针，可放在同一提交里一并处理。
3. `applyProbeResult` 失败分支：若 `SOURCE_HANDLERS[id] && SOURCE_HANDLERS[id].coldStart`，则 `failCount` 达标时**不置 `runtimeToggles[id]=false`**，只累计 `deadCount` / 健康分，日志打 `[冷启动豁免] ${id} 探测失败但保留启用（冷态可能未唤醒）`。
4. 说明：豁免只针对"自动关闭"，手动关闭（`manualOff=true`）与用户 toggle 不受影响；真死源仍由 `deadCount/睡眠 + 播放摘除` 处理，不会永久白打请求。

**回归用例 T47**
- 注入 `SOURCE_HANDLERS.huibq.coldStart` 场景：连续调用 `applyProbeResult('huibq', false)` 两次（或经 `runProbeRound` 模拟），断言 `getHealth` 快照里 huibq 的 toggle 仍为 true、`runtimeToggles` 未被关；
- 对照断言：非 coldStart 源（如 `suyinQQ`）同样两次失败 → 应被自动关闭，证明豁免只对冷启动源生效。

---

## 四、批次 B（参数与缓存，后做）

### B2 短路探路窗口 6h → 1h
- 位置：`USER_CONFIG` L41 `qualityShortCircuitProbeMs` 默认 `21600000` → `3600000`。
- 同步：`@description` / `@version` / `logInfo` 三处版本串 + DEV_GUIDE 参数表 + mobile `MUSIC_SOURCE_GUIDE`。
- 回归：现有 T41 覆盖短路本身；新增断言可只校验默认值读数（`cfg('qualityShortCircuitProbeMs') === 3600000`），不必 mock 时间。

### B3 高音质缓存分级 TTL
- 位置：`successCache = createLRUCache(CACHE_MAX_SIZE, cfg('cacheTtlMs'))` L609、`setCachedUrl` L1037、缓存读取处（`successCache.get(cacheKey)`）。
- 新增配置 `cacheTtlHighQualityMs`（默认 `1800000` = 30min），适用 `flac` / `320k` / `24bit`；128k 仍用 `cacheTtlMs`（6h）。
- 实现要点：LRU 自身是全局 TTL，**不能在 set 时按 entry 分配**。改为 `setCachedUrl` 存 `{url, quality, source, ts}`，读取处判断 `Date.now() - entry.ts > (高音质 ? highQualityTtl : cacheTtlMs)` 则视为 miss 并删除。同时保留 `cacheTtlMs` 作为 LRU 总过期上限（取两者较大值，避免 LRU 先过期把 6h 的 128k 也清掉）。
- 回归用例 T48：注入 `flac` entry `ts = now - 40min` → 断言 miss（重新取链）；`128k` 同 ts → 断言 hit。用缓存读写函数直接构造，不经网络。

### B7 历史快照 60 → 144
- 位置：`HEALTH_HISTORY_MAX = 60`（L466）→ `144`（10min/条 ≈ 24h）。
- 同步：DEV_GUIDE 参数表 + mobile 侧 `MUSIC_SOURCE_GUIDE`/健康面板说明（快照体积增大，App 渲染需确认无卡顿）。

---

## 五、明确不做（附理由，勿再论证）

**5. probe-history 自动清理 30 天** —— 现状 `docs/probe-history.jsonl` 约 15 行/天，一年 ≈ 5k 行、几百 KB，不构成体积问题；清理会破坏跨月回溯与 `health-daily` 的长期基线能力。收益≈0、风险非 0，不做。

**6. half-open 成功先降后批** —— 要引入"半开→半开降批→全开"新状态机，改动熔断核心；而震荡已被 `PROBE_FAIL_REQUIRED=2`、`PLAY_DEAD_STREAK`、`PLAY_DEAD_REVIVE` 三道门抑制，无实测证据表明当前会反复横跳。不做。

**8. UA 池 4 → 8~10** —— 凑字符串容易，凑**上游真实在用**的移动端 UA 难；堆假 UA 反而提高被风控识别概率。无实测风控压力前不做。

**9. gdWy batch:2** —— 同意原清单，配额源省配额优先，不动。

**10. 版本串三处** —— 同意不动。补充：v8.9 那次 CI 红（`42167461871`）不是"忘了跑脚本"，而是 CI 内 self-check 门按设计拦住了发布，属门禁正常工作。

---

## 六、版本与验收

- 建议版本：**v8.10**（行为变更，非纯修复）。批次 A 与批次 B 可各占一个提交，版本串在最后一批统一改三处（`@description` 首行 / `@version` / `logInfo`），避免中间状态不一致。
- 冒烟：现有 45 组 + T46/T47/T48 → **48 组全绿**。
- `node scripts/self-check.js` 通过；`node scripts/docs-audit.js` 后按 doc-sync 清单同步 README / ITERATION_ROADMAP / DEV_GUIDE / AGENTS。
- 跨仓库：mobile `docs/MUSIC_SOURCE_GUIDE.md` 同步本轮参数变更（分档预算、冷启动探针、缓存分级 TTL、快照 144）。
- 推送前 `git fetch origin && git rebase origin/master`，禁 force push；CI（`test` job，含 L2 自检）须绿。
- 真机验证项（只能人工）：①高音质失败后低音质能出声（A1）②冷态首次播 huibq 不再等到超时（A4 + v8.8 预热）③缓存 30min 内重复播放不报错（B3）。

完成并 CI 绿后，删除本文件与 `docs/TEMP_OPTIMIZATION_REVIEW.md`。
