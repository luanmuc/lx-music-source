# 音源仓库审计计划（活文档）

> 基线版本：v8.1（commit a97c057）
> 最近更新：2026-11-05（v8.1 审计修复完成）
> 维护规则：每次版本迭代时同步更新维度状态；新增功能加新维度，修复问题关问题维度。

---

## 状态说明

| 标记 | 含义 |
|---|---|
| ✅ | 已深入审计，无问题 |
| ⚠️ | 已深入审计，发现问题（已修/待修） |
| ⏳ | 进行中 |
| 📝 | 待审计 |

---

## A 组：核心运行时（lx-source.js 2183 行）

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| A1 | 语法/运行时正确性 | node --check + mock 宿主全路径加载 | ✅ | |
| A2 | 错误处理完整性 | async 函数 try/catch 全覆盖，错误码结构化 | ✅ | 30 个 async 函数（2026-11-05 复核）：入口 wrapExecute/handler 全有 try/catch 兜底；6 个辅助函数（getLyricForPlatform/getPicForPlatform/kuwoOfficialGetUrl/suyin 系）为「校验 throw + 转发」型，抛错由外层统一捕获，架构合理；错误码结构化 |
| A3 | 安全审计 | HTTP 明文/敏感信息硬编码/URL 注入 | ✅ | API 端点 http 正常（返回链有 upgradeToHttps） |
| A4 | 沙箱兼容性 | VM 限制 API（setInterval/console/全局变量） | ✅ | v6.0 setInterval→setTimeout；safeConsole 宿主防御 |
| A5 | 性能与内存 | 全局 Map 边界/LRU 上限/reqTimestamps 窗口/inflightCount 清理 | ✅ | LRU 500+300 有界；全局 Map 按 sourceId key 固定 20 个 |
| A6 | 架构一致性 | 模块职责边界/依赖方向/注册表模式 | ✅ | 调度→实现单向依赖；SOURCE_HANDLERS 注册表 |
| A7 | 命名与注释质量 | 命名一致性/注释与实际开关/实测日期 | ✅ | 统一 xxxGetUrl；注释与开关状态一致 |
| A8 | 代码重复 | HTTP/缓存/校验逻辑是否复用公共函数 | ✅ | 20 源零重复 fetch，全走公共封装 |
| A9 | 20 个子源端到端 | 参数校验→缓存→请求→校验→Range→缓存→返回 | ✅ | 抽查 gdWy/helloworldKw/juhe 三个典型源 |
| A10 | 健康系统 | 探测/熔断/自愈/摘死/复活全链路 | ✅ | 11 个核心函数职责明确，v6.0 多轮审计修复 |
| A11 | 缓存系统 | TTL/键策略/失败缓存差异化/过期兜底 | ✅ | 成功 6h + 失败按错误码差异化 TTL |
| A12 | 降级链与竞速回退 | raceFirst/fallbackRace/6s超时/音质优先 | ✅ | 前三源竞速 + 剩余串行 + 过期兜底 |
| A13 | 并发安全 | 多请求同时操作同一 sourceId Map 有无竞态；熔断状态切换原子性 | ✅ | JS 单线程同步操作；half-open 只放行一个试探请求；inflightCount finally 统一释放 |
| A14 | 日志系统 | logDebug/logInfo/logWarn/logError 开关逻辑/输出去向/safeConsole 边界 | ✅ | safeConsole 三级兜底完善；LOG_DEBUG 可配置；LOG_ENABLED 已改可配置（__lxSourceConfig.logEnabled，缺省 true） |
| A15 | URL 清洗与安全 | 返回 URL 是否清洗恶意参数/防注入/HTTPS 升级覆盖 | ✅ | validateUrl 格式校验 + upgradeToHttps 协议升级；无注入风险（播放器只发 HTTP 请求） |
| A16 | 新增 action 完整性 | config/trend/toggle/probe 的 action 声明 + push 注册 + 读返回结构全链路 | ✅ | v8.0 新增，已审：4 个 action 都有 handler，返回结构合理 |
| A17 | 平台级降级聚合 | _platformSummary 五平台分组逻辑 + _fallbackPlatform 兜底选择正确性 | ✅ | v8.0 新增，已审：PLATFORM_GROUPS 五平台分组，deadCount 判断含 state==="open"（熔断），兜底选第一个健康平台 |
| A18 | 配置热更新校验 | 读模式脱敏返回/写模式白名单/类型校验/范围校验/内存热更新 | ✅ | v8.0 新增，已审：读模式脱敏 3 个卡密字段，写模式白名单 14 参数 + typeof number + >0 校验 |
| A19 | 健康趋势历史 | healthHistory 数组增长上限/保留策略/快照结构/趋势 action 返回 | ✅ | v8.0 新增，已审：数组最多 20 条，超出 shift 删除最早，不会无限增长 |

## B 组：脚本（5 个，841 行）

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| B1 | self-check.js（74行） | 4 项检查覆盖度/CI L2 阻断 | ✅ | 版本串/actions声明/README/ROADMAP |
| B2 | ecosystem-scan.js（131行） | 动态提取源列表/超时/错误处理 | ✅ | 从 SOURCE_HANDLERS 动态提取防漂移；2026-11-05 审计发现 pdone 仓库改名 backend-api→lx-music-source，健康表 URL 已同步修复，复跑验证通过 |
| B3 | probe.js（167行） | 端点提取/历史聚合/死源建议 | ✅ | 7 日成功率聚合 + 3 天死源阈值 |
| B4 | health-daily.js（174行） | 聚合逻辑/日报格式/摘除建议阈值 | ✅ | 已修 3 bug（前缀匹配/排序/空函数） |
| B5 | candidate-audit.js（292行，v8.1 新增） | mock 宿主加载/静态提取/混淆标注/报告生成；B1~B6 修复回归 | ✅ | 2026-11-05 审计修复完成（B1 鉴权误报/B2 payload.sources/B3 switch-case/B4 http 支持/B5 提取写法/B6 示例），6 用例专项测试全绿，端到端实测 5 平台 8 actions 正确 |

## C 组：测试（779 行）

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| C1 | smoke-test 32 组用例覆盖度 | 核心路径覆盖/缺口识别 | ⚠️ | 缺 action 类(health/toggle/probe) + 降级链 + 竞速回退 + 摘死源；已记 DEV_GUIDE D12 |

## D 组：文档

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| D1 | DEV_GUIDE 模块地图 | 行段/子源数/职责描述 vs 实际代码 | ✅ | v8.0 已校准（8 大部分行段 + 子源数 20） |
| D2 | README 版本历史 | 版本号/可用性表/下载链接 | ✅ | 2026-11-05 审计发现 v8.1 已交付但 README 未同步，已补 v8.1 当前版本条目 |
| D3 | ROADMAP 状态 | 待开发/已交付标记准确性 | ✅ | |
| D4 | AGENTS.md 协作规范 | 与实际流程一致 | ✅ | |
| D5 | ITERATION_ROADMAP 完整性 | 版本规划/验收标准/依赖关系 | ✅ | 65 个版本，四列结构（任务/验收/依赖/状态），迭代协议明确 |
| D6 | KNOWN_ISSUES 准确性 | 已知问题是否仍存在/已修是否清理 | ✅ | DEV_GUIDE D1~D12 状态准确，已修✅/待修明确，无过时条目 |
| D7 | AGENTS vs DEV_GUIDE 重复/矛盾 | 内容是否一致 | ✅ | 职责分明（AGENTS=协作规范 158行，DEV_GUIDE=技术文档 366行），无重复无矛盾 |

## E 组：CI 与工程

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| E1 | ci.yml 流程 | 触发条件/job 依赖/写回逻辑 | ✅ | v8.0 已接入 health-daily + ecosystem job |
| E2 | 多账号防覆盖 | fetch/rebase/禁止 force push | ✅ | AGENTS.md 已明确 |

## F 组：数据与资产

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| F1 | probe-history.jsonl 增长 | 历史文件会不会无限增长？清理策略？ | ✅ | v8.0 已加 30 天滚动清理（appendHistory 后过滤旧行重写文件） |
| F2 | health-daily 输出目录 | 日报文件会不会无限堆积？保留策略？ | ✅ | v8.0 已加 90 天保留清理（生成日报后删除旧文件） |
| F3 | README_HEALTH.md 格式 | 表格格式/列宽/特殊字符转义 | ✅ | 6列一致，长URL截断，emoji/反引号正常显示 |
| F4 | license/版权合规 | 20 个子源 API 是否有版权风险 | ✅ | 非官方项目无LICENSE（合理）；只是API工具不存储音乐，版权风险低 |

## G 组：兼容性

| # | 维度 | 深度要求 | 状态 | 备注 |
|---|---|---|---|---|
| G1 | 洛雪版本兼容 | 不同洛雪 App 版本的 fork API/action 声明兼容 | ✅ | 基础协议全版本稳定；高级action(health/toggle/probe)是fork扩展，官方版不调用不报错 |
| G2 | Node 版本兼容 | 脚本在 Node 18/20/22 下是否都能跑 | ✅ | 2026-11-05 审计：5 脚本+测试零 Node 18+/20+ 专属 API（无全局 fetch/structuredClone/Object.hasOwn/findLast/toSorted），依赖面仅 fs/http/https/path+new Function（Node12+ 通用）；Node 20 CI 实测 + Node 22 本机实测全绿；Node 18 静态论证兼容 |

---

## 统计

- 总维度数：40
- ✅ 已审：39
- ⚠️ 有问题：1（C1 smoke 缺口，已大部分覆盖低风险无排期）
- 📝 待审：0

## 版本迭代更新规则

1. 新增功能 → 在对应组新增维度，标记 📝
2. 修复问题 → 更新对应维度状态为 ✅，关闭问题备注
3. 代码重构 → 标记该维度为 ⏳ 需重审
4. 发版前 → 更新顶部基线版本号 + commit hash
