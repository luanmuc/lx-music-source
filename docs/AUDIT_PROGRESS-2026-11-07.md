# 音源仓库全覆盖审计 · 执行记录（2026-11-07）

> 本文件是 2026-11-07 全覆盖审计（96 维）+ 二次复核（15 项）+ v8.10.3 修复的完整执行轨迹，从会话工作目录归档入库，作为下一轮的续跑锚点。产物索引：计划 `docs/AUDIT_PLAN.md`、报告 `docs/AUDIT_REPORT-2026-11-07.md`。

## 0. 基本信息

- 仓库：`/home/user/Doubao/chats/38450522296699906/lx-music-source/`
- 基线：`f8b4789`（v8.10.2），`lx-source.js` 2545 行 / `test/lx-source-smoke-test.js` 1155 行（49 用例）
- 旧审计：`docs/AUDIT_PLAN.md` v8.1（40 维 40 ✅）、`docs/SOURCE_AUDIT.md`（源级取链基线 21/35）
- 本轮产物：`docs/AUDIT_PLAN.md` **v9.0（96 维：保留 40 + 新增 56）**、`docs/AUDIT_REPORT-2026-11-07.md`（F-01…F-14）
- 证据分级：L0 静态 / L1 加载 / L2 mock 行为（含反向）/ L3 官方冒烟 / L4 真网络真机

## 1. 为什么重审（动机证据）

v8.1 的 40 维全绿，但 v8.2–v8.10.2 仍连续出运行期缺陷，全部是「读代码确认功能在」看不出来的类型：

| 修复提交 | 缺陷类型（v1 维度未覆盖） |
|---|---|
| v8.10.2 | 记账顺序错（先 `recordSuccess` 后 `validateUrl`）→ 双记账；half-open 在业务失败/节流后不复位 |
| v8.10.1 | LRU 缺 `delete` → 高音质缓存过期后重播 TypeError；T46–T48 是**空壳用例** |
| v8.9.1 / v8.9 | 档位短路把 `businessFail` 误伤；P0–P3 一批 |
| v8.7 | huibq **假成功**：code=0 +「无法获取播放链接」+ 可播错链 → 静默播错歌 |
| v8.4 | suyinKuwo `br=7→9` 参数错；无效 X-Token 403 |
| v8.2 | `probeSingleSource` 漏透传 `method/body` → POST 源探测实发 GET |
| probe | README 模板旧文案覆盖人工更新 |

→ 新维度落在「状态机收口、记账口径、缓存身份、假成功、探测保真、跨层契约、用例有效性」。

## 2. 执行清单

| 步 | 内容 | 状态 |
|---|---|---|
| 1 | 读 v8.1 计划、接口规范、git 历史 | ✅ |
| 2 | 重写 `docs/AUDIT_PLAN.md` → v9.0（96 维矩阵） | ✅ 2026-11-07 |
| 3 | L0/L1 静态与契约取证（配置面/契约/镜像） | ✅ |
| 4 | L2 逐子系统审（状态机 / 缓存 / 竞速 / 探测 / 健康 / 配置 / action） | ✅ |
| 5 | L3 实跑：`node test/lx-source-smoke-test.js` 49 组全绿；两处定向 mock 实证 | ✅ |
| 6 | 报告 `docs/AUDIT_REPORT-2026-11-07.md`（F-01…F-14） | ✅ 2026-11-07 |
| 6b | **二次复核：15 个运行场景逐条重验（§9 追加）** | ✅ 2026-11-07（新增 F-15、F-12 升级、F-04 口径修正） |
| 7 | **修复落地（v8.10.3，用户授权「按最优方式全修」）** | ✅ 2026-11-07 |
| 7a | F-01/F-05（`recordRateLimit` 不记账 + 半开 429 收口）、F-10（`bumpPlayDead` 单点）、F-11（`validateUrl` trim）、F-04（`getFailCachedEntry` 还原 code）、F-02（删死键/暴露 `raceBudgetMs`）、F-12（单档预算 4s→5s）、F-03（按实交付音质写缓存槽）、F-09（末档上界显式钳制）、F-08（探针通过复位断路器）、F-06（huibq 失败词单点化 + 探针补判据）、F-15（`probeSingleSource` 形参 `cfg`→`pc` 解除遮蔽） | ✅ |
| 7b | F-07（`PLATFORM_GROUPS` 改由 `buildSourceChain` 并集生成）、F-13（lingchuan 补 `platforms` 显式声明）、F-14（A19 备注 20→144）、顺带修 `raceFirst` deadline falsy 回退 | ✅ |
| 7c | 版本串升 8.10.3（`@version` / `@description` 首行 / `logInfo` 三段同步），`node scripts/self-check.js` 通过 | ✅ |
| 7d | 冒烟扩到 **55 组**（新增 T50–T55：半开429收口 / huibq 探针真发请求 / 降档缓存槽 / 429 不记账 / 平台分组 / URL trim），`node test/lx-source-smoke-test.js` 全绿 exit=0 | ✅ |
| 7e | 文档镜像：README（当前版本+版本历史）、`docs/AGENTS.md`（55 组）、`docs/AUDIT_PLAN.md`（基线+修复后 + A19 修正）、`docs/DEV_GUIDE.md`（版本行 + §3.4 七条纪律 + 版本表）、`docs/ITERATION_ROADMAP.md`（版本行+表）、`docs/AUDIT_REPORT-2026-11-07.md`（新增 §10 修复落点 + §10.1 顺带修正 + §10.2 未做项） | ✅ |
| 7f | **推送** | ✅ 2026-11-07：`47f527a` → `luanmuc/backend-api` master（推送前 rebase 吸收远端 4 个提交 `2daaf52`/`d3044a1`/`aa0fd5f`/`9504719`，变基后重跑 `--check`/`self-check`/冒烟 55 组全绿） |
| 7g | CI | 待自动触发：`ci.yml`（L1 加载 + L2 冒烟）与 `docs-audit.yml`；远端新策略 `purge-cdn` 仅在 `lx-source.js` 变更时刷 jsDelivr（本次命中） |

## 3. 本轮结论（复核后 15 项：高 3 / 中 6 / 低 5 / 建议 1）

- **F-01 高**：半开 + 429 未收口 → `state` 永停 `half-open`，源永久不被调用（**已 L2 实证**：`/tmp/src_probe_check.js` 输出 `state=half-open, canExecute=false`）
- **F-02 高**：`raceOverallTimeoutMs` 死键（仅 3 处：默认值/白名单/上限），真键 `raceBudgetMs` 未进白名单
- **F-03 中**：降档交付写进请求音质槽 → flac 请求 6h 内直接吃 128k
- **F-04 中**：失败缓存命中一律抛 `NOT_FOUND`，网络故障被当成"不存在"
- **F-05 中**：429 进 `q.fail` 与成功率分母 → 3 次限流短路该档 1h
- **F-06 中**：huibq 探针缺 msg 失败词判据（v8.7 只修取链路径）
- **F-07 中**：`PLATFORM_GROUPS` 手写清单缺 suyinKuwo（chain 对非 kw 平台都推送）→ 平台全挂误报
- **F-15 高（复核新增）**：`probeSingleSource(id, cfg)` 形参遮蔽全局 `cfg()` → 唯一 coldStart 源 huibq 的探针在 `cfg('coldStartProbeTimeoutMs')` 处 TypeError，被 catch 吞成"探测失败"；实测正常响应也不发请求、score=-1
- **F-08…F-14 低/建议**：探针不解除熔断、末档超总预算、半开 return 跳过 playDead 累加、`validateUrl` 返回未 trim 原串、预算 4s<超时 5s（待决策）、lingchuan 无平台过滤、A19 旧备注 20 条（实 144）

## 4. 环境限制（先声明，避免误判）

- 沙箱出口 IP 被音源端风控：三平台取链端点历史实测全失败 → **L4 不可达**，只做 L0–L3
- 无真机：Range 可播、App 端播放验证不可做
- `node scripts/source-audit.js` 需真实网络，本环境大面积失败不能当「源坏了」的证据

## 5. 待用户决策

1. `raceOverallTimeoutMs`：删除（只留 `raceBudgetMs` 并进面板）还是接进运行时总预算？
2. F-12：预算对齐单源超时（简单，慢 1s）还是 settle 后给在飞请求打 aborted 标记、不记账（准，改契约）？

## 6. 变更边界

- 本轮**未改任何运行时代码**；工作树仅 `docs/AUDIT_PLAN.md`（M）+ `docs/AUDIT_REPORT-2026-11-07.md`（新增）
- 诊断脚本在 `/tmp`（`src_probe_check.js`、`src_budget_check.js`），未写入仓库
- 未 commit、未 push

## 7. 二次复核记录（2026-11-07）

- 方法：不采信上一轮表述；逐条回代码定位 + mock 宿主构造运行场景；脚本在 `/tmp`（`verify_findings.js`、`verify_findings2.js`、`v3.js`、`v4.js`）
- 结论：原 14 项**无一被推翻**；F-12 低→中（实证 5s 可成功源被 4s 预算判死）；F-04 口径修正（message 恒 NOT_FOUND、命中缓存丢 err.code）；F-06 被 F-15 掩盖无法 L2 复现；**新增 F-15（高）**
- 未能动态：F-10（需 5min 冷却，playDeadStreak 未导出）；F-06 的前提依赖 v8.7 历史记录，L4 不可达无法现场复现
