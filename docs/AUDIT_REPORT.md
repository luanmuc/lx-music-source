# 音源 + App 全量代码审计报告

> **审计日期：** 2026-11-05
> **审计范围：** backend-api（音源）+ mobile-app（App）两个仓库
> **审计轮次：** 5 步递进式全量审计
> **发现问题：** 13 个（2 个中优先级，11 个低优先级）
> **状态：** 审计完成，待统一修复

---

## 一、审计目标

确保音源仓库和 App 仓库的定制功能：
1. **核心架构稳定** — 播放链路、缓存、熔断无严重 bug
2. **健康系统可靠** — 失败归因、平台降级、探针检测准确
3. **各源族完善** — 参数校验、缓存、兜底、CDN 防御到位
4. **App 定制功能正常** — 更新音源、健康面板、配置热更新无异常
5. **CI + 发布流程顺畅** — 自检门、版本同步、文档一致

---

## 二、审计维度总览（5 步 × 13 个问题）

| 大类 | 包含步骤 | 问题数 |
|---|---|---|
| A. 核心架构 | 第 1 步 | 3 个（全低） |
| B. 健康系统 | 第 2 步 | 3 个（1 中 + 2 低） |
| C. 各源族 | 第 3 步 | 2 个（1 中 + 1 低） |
| D. App 定制功能 | 第 4 步 | 3 个（全低） |
| E. CI + 发布流程 | 第 5 步 | 2 个（全低） |

---

## 三、详细审计项

### A. 核心架构（3 个问题，全低优先级）

**审计对象：** raceFirst / wrapExecute / LRU 缓存 / 熔断状态机

| # | 问题 | 严重度 | 位置 |
|---|---|---|---|
| A1 | reqTimestamps 初始化依赖 throttleCheck（调用顺序耦合） | 🟢 低 | wrapExecute 第 1907 行 |
| A2 | raceFirst 空 promises 数组会永远 pending（实际不会触发） | 🟢 低 | raceFirst 函数 |
| A3 | isPreviewFragmentUrl 注释不准确（说"双重判断"但只做了 URL 检测） | 🟢 低 | isPreviewFragmentUrl |

**结论：** 核心架构没有严重 bug。

---

### B. 健康系统（3 个问题，1 中 + 2 低）

**审计对象：** getHealthSnapshot / toggle / probe action / 失败归因 / 平台级降级

| # | 问题 | 严重度 | 位置 |
|---|---|---|---|
| B1 | **toggle 开启时没清 failCache** | 🟡 中 | toggle action（第 2170 行附近） |
| B2 | PLATFORM_GROUPS 硬编码（新增源要改两处） | 🟢 低 | getHealthSnapshot |
| B3 | config action 写模式没有日志记录 | 🟢 低 | config action |

**结论：** 健康系统没有严重 bug。1 个中等问题（toggle 开启没清失败缓存）。

---

### C. 各源族（2 个问题，1 中 + 1 低）

**审计对象：** kw/wy/tx/mg/kg 各源参数校验 / 缓存 / 兜底 / CDN 防御

| # | 问题 | 严重度 | 位置 |
|---|---|---|---|
| C1 | **helloworld 通道②（haitangw）没加试听片段检测** | 🟡 中 | helloworldKwGetUrl 通道② |
| C2 | 试听片段检测只加在 helloworld 通道①（其他源没加） | 🟢 低 | 全局 |

**结论：** 各源族没有严重 bug。参数校验 / 缓存 / 兜底 / CDN 防御都完善。

---

### D. App 定制功能（3 个问题，全低优先级）

**审计对象：** 更新音源按钮 / 健康面板 / 配置热更新 / 提前预警 / 平台降级提示条

| # | 问题 | 严重度 | 位置 |
|---|---|---|---|
| D1 | 更新音源按钮没有显式超时控制 | 🟢 低 | Source.tsx handleUpdateSource |
| D2 | 配置白名单两份重复（音源侧 + App 侧） | 🟢 低 | config action + init/index.ts |
| D3 | 更新音源按钮没有"已是最新"判断 | 🟢 低 | Source.tsx（用户说先不改） |

**结论：** App 定制功能没有严重 bug。

---

### E. CI + 发布流程（2 个问题，全低优先级）

**审计对象：** App CI 工作流 / 音源 self-check 脚本 / 文档版本同步 / 巡检脚本退出码

| # | 问题 | 严重度 | 位置 |
|---|---|---|---|
| E1 | self-check 没检查 config / trend action | 🟢 低 | scripts/self-check.js |
| E2 | self-check 没检查 App 侧 CUSTOM_CHANGELOG | 🟢 低 | 跨仓库，音源侧没法检查 |

**结论：** CI + 发布流程没有严重 bug。版本同步 / 自检门 / 文档一致性都很完善。

---

## 四、问题汇总与修复计划

### 待修复问题（共 13 个）

**中优先级（2 个）：**
1. B1 — toggle 开启时清 failCache
2. C1 — helloworld 通道②加试听片段检测

**低优先级（11 个）：**
1. A1 — reqTimestamps 初始化防御（不依赖调用顺序）
2. A2 — raceFirst 空 promises 防御
3. A3 — isPreviewFragmentUrl 注释修正
4. B2 — PLATFORM_GROUPS 从 SOURCE_HANDLERS 动态提取
5. B3 — config action 写模式加日志
6. D1 — 更新音源按钮加超时控制
7. D2 — 配置白名单统一（从音源侧导出）
8. C2 — 试听片段检测统一加到所有源（可选）
9. D3 — 更新音源按钮版本比对（用户说先不改）
10. E1 — self-check 加 config / trend action 检查
11. E2 — self-check 加 CUSTOM_CHANGELOG 检查（跨仓库，可选）

### 发布计划

- 音源仓库：当前 v29.8，修复后发 v29.9
- App 仓库：当前 v1.9.2-b31，修复后编译新版本

---

## 五、关键文件位置

**音源仓库：** `/home/user/Doubao/chats/38449158442340354/lx-music-source/`
- lx-source.js（主文件，@version 29.8）
- scripts/self-check.js（发布前自检）
- scripts/health-daily.js（自动健康日报）
- docs/ITERATION_ROADMAP.md
- README.md

**App 仓库：** `/home/user/Doubao/chats/38449158442340354/lx-music-mobile/`
- src/screens/Home/Views/Setting/settings/Basic/Source.tsx（更新音源按钮）
- src/screens/Home/Views/Setting/settings/Health.tsx（健康面板）
- src/core/init/index.ts（启动注入配置）
- .github/workflows/release.yml（CI 配置）
- docs/CUSTOM_CHANGELOG.md
