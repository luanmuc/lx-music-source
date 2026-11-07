# backend-api

> 与 [`luanmuc/mobile-app`](https://github.com/luanmuc/mobile-app) 配套的内置数据源仓库。
> **App 每次云编译（CI）会自动拉取本仓库根目录 `lx-source.js` 覆盖内置数据源**，因此：
> - 本仓库是唯一权威数据源入口，改数据源只改这里；
> - 每次发布到 Release 页的版本 = 用户 App 实际内置的版本。

> **免责声明**：本项目仅供学习交流与技术研究。仅做接口聚合，不存储任何媒体文件；第三方接口的可用性与版权责任归相应服务方。使用即代表同意仅限个人学习用途，禁止商用。

## 快速开始

| 事项 | 说明 |
|---|---|
| 当前版本 | **v8.10.3**（全覆盖审计 15 项隐性缺陷全修；v8.10.2 记账顺序修复 + 半开收口；v8.10.1 缓存 LRU delete 补修 + 用例真化；v8.0 全量审计修复 + ikun/huibq 复活与默认开启 + 全源巡检修复 + 巡检工具升级 + 竞速引擎改造 + huibq 收窄 + **分档预算/冷启动豁免/缓存分级**；`lx-source.js` 内 `@version 8.10.3`） |
| 支持平台 | 网易云(wy) / QQ(tx) / 酷我(kw) / 酷狗(kg) / 咪咕(mg) |
| 音质能力 | flac / 320k / 128k（按真实来源能力裁剪上报） |
| 集成方式 | App CI 用 GitHub Contents API 拉 `luanmuc/backend-api/contents/lx-source.js` |
| 发布入口 | 本仓库 **Releases 页**：每次迭代出 tag + 附 `lx-source.js` 产物 |
| 迭代机制 | 任何豆包账号说「**迭代**」即按 [docs/ITERATION_ROADMAP.md](./docs/ITERATION_ROADMAP.md) 自动推进下一版本；规则见 [docs/AGENTS.md](./docs/AGENTS.md) |

## 在线导入（自定义源）

> 面向其他洛雪音乐用户：设置 → 基本设置 → 自定义源 → 自定义源管理 → 在线导入。

```
https://raw.githubusercontent.com/luanmuc/backend-api/master/lx-source.js
```

加速链接（GitHub 受限时使用）：

```
https://ghproxy.net/raw.githubusercontent.com/luanmuc/backend-api/master/lx-source.js
```

## 音源可用性（2026-11-06 核验）

> 本表 = 本仓库实测基线 + 生态交叉验证；端点级实时健康状态见 [README_HEALTH.md](./README_HEALTH.md)（`scripts/probe.js` 每日自动刷新）；源级取链基线见 [SOURCE_AUDIT.md](./docs/SOURCE_AUDIT.md)（`scripts/source-audit.js` 巡检对照）。
> 口径：pdone 探测来自 CI 服务器 IP，与本仓库 IP 维度不同，分歧 ≠ 某一方错误（典型：溯音咪咕上游域名可用但本机 IP 被封）。

| 平台 | 可用音质 | 主路子源 | 交叉验证 |
|---|---|---|---|
| 网易云 wy | 128k / 320k / flac | 溯音163 / wyOuter / gdWy | oiapi.net ✅；music.163.com ✅；music-api.gdstudio.xyz ✅ |
| 酷我 kw | 128k / 320k / flac | 溯音酷我 + 星海后端（双源 v1.0） | oiapi.net ✅；yy.zddyr.top ✅；search.kuwo.cn ✅；antiserver.kuwo.cn ✅；nmobi.kuwo.cn ❌ HTTP 404 |
| QQ tx | 128k（走溯音酷我兜底） | 溯音QQ 关闭 | oiapi.net ❌ 403 被封 |
| 酷狗 kg | 128k（走溯音酷我兜底） | — | —（无独立源，走 kw 兜底） |
| 咪咕 mg | 128k（走溯音酷我兜底） | 溯音咪咕关闭 | api.xcvts.cn ✅ |

> 详细对照表、缺陷与**各版本当前状态（以 docs/ITERATION_ROADMAP.md 与 DEV_GUIDE 为准）**见 [DEV_GUIDE.md](./docs/DEV_GUIDE.md)。
## 版本历史

> 2026-11-05 版本重新整理：将原 53 个小版本（v11.11 ~ v29.9）按功能模块合并为 8 个大版本。
> 旧版本详细历史归档见 [docs/ARCHIVE_OLD_TAGS.md](./docs/ARCHIVE_OLD_TAGS.md)。
> 2026-11-07 全覆盖审计（96 维矩阵 + 15 项隐性缺陷 + 二次复核 + v8.10.3 修复）的数据资产：计划 [docs/AUDIT_PLAN.md](./docs/AUDIT_PLAN.md)、报告（含 §9 复核 / §10 修复落点与前后指标对比）[docs/AUDIT_REPORT-2026-11-07.md](./docs/AUDIT_REPORT-2026-11-07.md)、执行轨迹 [docs/AUDIT_PROGRESS-2026-11-07.md](./docs/AUDIT_PROGRESS-2026-11-07.md)。

| 版本 | 核心功能 |
|---|---|
| **v8.10.3**（当前） | 全覆盖审计修复（2026-11-07）：15 项隐性缺陷全修——①`probeSingleSource` 形参 `cfg` 遮蔽全局 `cfg()`（huibq 唯一冷启动源探针 100% TypeError、请求从未发出）；②429 不再计入 `byQuality.fail`/成功率分母 + 半开遇 429 收口；③降档按**实交付音质**入缓存槽；④失败缓存命中还原代表性 `code`；⑤平台分组改由竞速链生成（消除手写清单漂移）；⑥探针通过一并复位断路器/限流；⑦末档预算上界显式钳制；⑧`validateUrl` 返回 `trim` 后 URL；⑨320k/128k 单档预算 4s→5s 对齐单源超时；⑩删死键 `raceOverallTimeoutMs`、暴露 `raceBudgetMs`；⑪huibq 假成功判据单点化并补进探针；⑫lingchuan 补 `platforms` 声明；⑬A19 备注 20→144；⑭冒烟新增 T50–T55（回退必红）共 55 组 |
| **v8.10.2** | 记账顺序修复 + 半开收口（2026-11-06）：①`wrapExecute` 改为**先 validateUrl 后 recordSuccess**——旧顺序把"URL 非法"的请求既记成功又记业务失败，成功率/健康分双记账失真；②`recordBusinessFail` 与本地节流分支补**半开收口**：half-open 试探的业务失败/节流跳过一律 `half-open → open` 并刷新 `lastFailureTime`，否则源会永久停在 half-open（`canExecute` 恒 false）；③冒烟新增 T49 断言收口，T46 放宽限流干扰；`recordBusinessFail` 加入测试导出块 |
| **v8.10.1** | 缓存 LRU delete 补修 + 用例真化（v8.10.1，2026-11-06）：`getCachedUrl` 分级 TTL 过期分支调用 `successCache.delete()` 而 LRU 无该方法 → 高音质缓存超 30min 重播必抛 TypeError（实测复现）；补 `delete(key)`；注释/DEV_GUIDE 同步；冒烟 T46/T47/T48 由空壳断言改为真行为验证（T48 先在旧实现复现崩溃再修实现转绿） |
| **v8.10** | 分档预算 + 冷启动豁免 + 缓存分级（2026-11-06）：①分档预算 flac 6s/320k 4s/128k 4s + 末档保底 3s（防高音质吃满总预算饿死低档致点歌无声）；②冷启动源探针超时放宽到 30s + 豁免自动关闭（onrender 冷态 30s 不再被 20min 误摘）；③短路探路窗口 6h→1h（源临时波动后用户不用等 6h 才恢复高音质）；④高音质缓存分级 TTL——flac/320k 30min（原 6h 链接已死仍返回死链），128k 保持 6h；⑤历史快照 60→144（10h→24h，趋势图跨天不断）；新增 5 配置键 + 冒烟 T46/T47/T48 |
| **v8.9** | huibq 平台能力收窄 + 收尾修复（2026-11-06）：实测 tx/mg/kg 必败（"无法获取播放链接"），从三平台链尾移除，仅保留 kw/wy 进链（省 1~1.5s 白耗）；source-audit.js 跑完自动退出（防进程常驻）；hyw 候选状态修正为"已判否（自动复检）" |
| **v8.8** | 竞速引擎改造（2026-11-06）：6 条全做——全链分批错峰并发（消灭"竞速3+串行 rest"）、跨音质档共享 12s 总预算、档位短路（历史 0 成功的档跳过 + 6h 探路）、冷启动源预热与超时放宽（huibq 8s）、gdWy 配额源降后批、verified 精确等待；新增 7 配置键 + 冒烟 T40/T41/T42/T43 |
| **v8.7** | huibq 假成功治理（2026-11-06）：实测上游"无法获取播放链接！"仍返回 `code:0` + 一条可播但不属于该平台的兜底链（酷我 panspace 206）= 静默播错歌；改为按 msg 失败词判失败 |
| **v8.6** | huibq 默认开启（2026-11-06）：全源巡检实测 kw/wy/tx/mg/kg 全平台 flac/320k/128k 均出链可播，纳入 A 方案——五平台链尾兜底 + 探针自动托管（onrender 免费实例冷启动慢，仅前面源全失败时打到） |
| **v8.5** | 巡检工具与监控口径升级（2026-11-06）：新增 `scripts/source-audit.js` 全源取链巡检工具 + `docs/SOURCE_AUDIT.md` 基线（每次巡检对照打勾）；`scripts/probe.js` 对取链型端点加真实取链 + Range 可播二次校验（治理"端点✅但源 410 死链"假阳性，如 xcvts 由假✅转真❌）；huibq 探针补齐；真死域名排除清单更新（移除已复活的 ikunshare） |
| **v8.4** | 全源全接口深度巡检修复（2026-11-06）：逐源真实调用 35 组 → 溯音酷我 128k br 修正（br=7→9，实测唯一可播、flac/320k 为 VIP 死链）；星海后端去无效 X-Token 匿名适配（上游 403"请使用官方版本"）；可用源 15→21/35。剩余失败：xinghaiBackup/lingchuan 域名死（归档）、juheWy/Kg 服务端受限、suyinQQ 403、suyinMigu 上游 IP 被咪咕封（均已默认关闭） |
| **v8.3** | ikun 默认开启（A 方案，2026-11-06）：公益版免卡密，默认进 kw 链尾兜底 + 每 30 分钟自动探测（tier=secondary）+ 探测失败 2 次自动关/恢复自动开自愈闭环；健康面板 kw 平台分组补 ikun |
| **v8.2** | ikun 探针接入 + POST 探测修复（2026-11-06）：默认关闭源补齐健康探针（用户手动开启后自动监控健康：POST `/music/url` 固定歌 + code200/url非空 + Range 可播二次校验，tier=secondary 每3轮一探）；修复 `probeSingleSource` 漏透传 `method`/`body`（juhe 五源/ikun 等 POST 协议型源旧实现实际发 GET → 404/405 误判失败） |
| **v8.1** | 候选实证半自动化：`scripts/candidate-audit.js` 输入候选 URL → 自动 mock 加载 + 静态提取 + 实证报告草案；`scripts/recheck-candidates.js` 判否候选恢复探测（触发式待办自动监控，2026-11-05）<br>ikun 源复活（2026-11-06）：域名 `api.ikunshare.com`→`c.wwwweb.top`、接口 GET `/url`→POST `/music/url`、公益版免卡密（实测 rid=228908 出真实128k链） |
| **v8.0** | 全量审计修复 + 自动健康日报 + App 配合功能（趋势图/配置热更新/平台降级） |
| **v7.0** | 候选源生态：helloworld（kw 高音质竞速）实证接入，fish/hyw/qdy/jiexiang/lx 等候选逐层实证判否 + 自动摘死源（播放连续失败摘除）+ 健康分 10 分制 |
| **v6.0** | 音质协商链 + 全链路审计 + 子源透出（播放页显示「平台·子源名」） |
| **v5.0** | 配置化全参数 + 发布前自检门 |
| **v4.0** | 智能调度：仓库级统计 + 死源建议/自动标记 + 失败归因 + Juhe 源族 + 并发限速 + 自适应探测 |
| **v3.0** | 健康系统雏形：失败原因结构化 + 健康权重 + 竞速校验 + 歌词封面透出 + 健康快照 |
| **v2.0** | 工程化：CI 冒烟 + 巡检 + 协作规范 + 配置化可选源 |
| **v1.0** | 基础四源（kw/wy/tx/mg）+ 高音质双源冗余 + 失败缓存 |

> 完整深度分析、模块地图、已知缺陷与升级规划见 **[DEV_GUIDE.md](./docs/DEV_GUIDE.md)**。
> 后续版本规划（**终极版本三层目标**：第一层"够用了"✅ 已完成；第二层"省心了"✅ 核心功能已达成；第三层"完美了"🔮 价值都不大，暂时不用做）见 [ITERATION_ROADMAP.md](./docs/ITERATION_ROADMAP.md)。

## 发布规范

> 完整发布 SOP（改 `@version` → 实测 → 提交 → Release → 联动 App）见 [DEV_GUIDE.md 第九节](./docs/DEV_GUIDE.md#九发布-sop每次迭代必须走完)，本表只列红线。

1. 每次迭代**必须**更新 `lx-source.js` 文件头 `@version` 与 `@description`（写明本轮变更与实测结论）；
2. 发布前必须跑完 [DEV_GUIDE.md 测试清单](./docs/DEV_GUIDE.md#八测试清单发布前必做)；
3. 需要 App 换新音源时，用 `workflow_dispatch` 触发 `mobile-app` 的 release.yml 构建（push 空提交亦可）。

## 已知失效/关闭源（保留函数便于恢复）

| 源 | 状态 | 说明 |
|---|---|---|
| 溯音QQ | 关闭 | 实测 -403 维护中；上游 oiapi.net 可用，修复即解禁（跟踪中） |
| 溯音咪咕 | 关闭 | 上游 api.xcvts.cn 域名 200 可用（每日巡检确认）；播放接口业务层 502（IP 封禁未解除，2026-10-29 实测）；mg 真源恢复已判否 |
| 星海备 | 关闭 | 域名不可解析 |
| Huibq | **开启**（v8.6，v8.9 收窄） | 仅 kw/wy 实测可播（tx/mg/kg 必败已移出链），链尾兜底；免费实例冷启动慢 |
| 聆川 | 关闭 | 未配置密钥（`USER_CONFIG.lingchuanApiKey`）；v13.1 巡检：域名 api.lingchuan.com 不可解析 |
| ikun | **开启**（v8.3 起，`SOURCE_TOGGLES.ikun = true`） | 公益版免卡密，kw/wy 链尾兜底 + 自动探测自愈；域名已迁至 `c.wwwweb.top`（`api.ikunshare.com` 停用）。填 `USER_CONFIG.ikunApiKey` 可切付费版 |

> 健康探测会自动启用/停用可用源，以上为静态默认值。
