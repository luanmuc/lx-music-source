# AGENTS.md — 多账号/多智能体协作规范

> 本仓库由**多个豆包账号共同开发**。此文件供 GitHub Copilot / 豆包 / 任何智能体读取，避免互相踩踏。
> **核心原则：master 只接受已验证的改动；所有新功能先分支，验证后合入。**

## 项目一句话

洛雪音乐（`luanmuc/mobile-app` 定制版）的内置聚合音源。根目录单文件 `lx-source.js` 是**唯一权威产物**，App 云编译时 CI 自动拉取它生成 `assets/builtin_source.js`（**App 仓库不内置音源副本**，每次构建由 CI 创建）。

## 目录结构

```
lx-source.js        # 唯一权威音源（多子源聚合器，勿拆目录，勿改其他文件）
README.md           # 用户视角：版本历史 + 在线导入 + 可用性表
DEV_GUIDE.md        # 开发者视角：代码地图 + 协议合规 + 路线图 + 发布 SOP（改代码前先读）
AGENTS.md           # 本文件：协作规范
```

## 迭代触发协议（任一账号说「迭代」即按此执行）

1. 读 [docs/ITERATION_ROADMAP.md](./docs/ITERATION_ROADMAP.md)：找到第一个状态 `[ ]` 且依赖已满足的版本 = 本次迭代目标；
2. 按「实证开发流程」实现（实证 → 改码 → L0~L4 验证链）；
3. 通过后：改 `lx-source.js` 头部 `@version`/`@description`、README 版本历史、并把该版本 `[ ]` → `[x]`；
4. 走 DEV_GUIDE 发布 SOP 出 tag + Release（附 `lx-source.js` 产物）；
5. 一次迭代 = 一个版本 = 一个提交；用户说"迭代到 X"则连续执行，每版单独提交；
6. 标注「外部依赖」的版本（v3.0+ 需服务器/App 扩展/长期数据）：条件不具备时跳过并说明，禁止强行实现；
7. **例行生态扫描**（v7.0 起脚本化）：`node scripts/ecosystem-scan.js` 抓取 pdone 每日健康表交叉对比，自动产出新候选（可用未接入）/失效清单；新候选（v7.0 系列）按实证规则逐个取链+Range 实测后才接入，不凭状态直接接入。

## 命令

```bash
# 语法检查（每次改动后必跑）
node --check lx-source.js

# 冒烟测试（固化在 test/，35 组用例）
node test/lx-source-smoke-test.js

# 发布自检（版本/actions/README/ROADMAP 三向同步，推送前必跑）
node scripts/self-check.js

# 生态扫描（v7.0 起：pdone 健康表交叉，产出新候选/失效清单）
node scripts/ecosystem-scan.js

# 提交 + 推送（push 前必须先 fetch 检查远端，见「协作规则」第 7 条）
git add lx-source.js && git commit -m "feat(vX.Y): <变更摘要>" && git push origin master
```

## 协作规则（防"多账号直推 master 相互覆盖"）

1. **小改动**（≤1 个缺陷、风险低）：可直接 master 提交，但必须过语法 + 冒烟 + 对应平台实测。
2. **功能改动**（新增源/接口/降级逻辑/探测策略）：先本地验证走实证验证链，确认无回归再直推 master（仓库无 PR 流程，靠验证链 + 发布后验证兜底）。
3. **每次改动必须更新**：`lx-source.js` 头部 `@version`/`@description`（写明变更+实测结论）+ `DEV_GUIDE.md` 相应小节 + 缺陷表状态。
4. **实测结论写进代码**：新增/改动子源后，在注释里留 `@contribution <日期> <账号>：<实测平台/音质/结果>`，禁止只写"应该能用"。
5. **关闭的源不删代码**：只关开关 + README 标注原因（恢复成本最低）。
6. **禁止**：未经验证把"猜测可用的接口"接入正式链；直接覆盖他人正在编辑的文档段落。
7. **推送前强制检查远端（多账号防覆盖）**：本仓库由多个豆包账号共用同一令牌开发，额度有限时可能中断或只推送了一部分。**每次 `git push` 前必须先 `git fetch origin` 并对比 `origin/master` 与本地 HEAD**：
   - 若远端领先（有其他账号的新提交），**必须先 `git pull --rebase origin master`**，以最新代码为基线；
   - rebase 后重跑自检门（L0 语法 + L1 冒烟 + L2 self-check），确认自己与对方的改动都存活；
   - 有冲突必须读对方实现再解决，**禁止整块覆盖**他人已实测的功能；冲突裁决优先级：协议合规 / 实证结论 > 个人偏好；
   - 推送被拒绝（non-fast-forward）时，立即 rebase 再推，**禁止 force push（`-f`）**；
   - 若其他账号已完成同一主题（如候选实证判否、版本号规划），直接复用其结论、合并到自己的文档行，不重复劳动；
   - **额度中断恢复时**：先 fetch 看远端状态，确认上次中断在哪一步（代码已改未推 / 文档未同步 / 自检未跑），从断点继续，不从头重做。

## 文档同步 Hook（提交时自动提示，新账号必装）

> 保证"任意账号任意提交，第一时间知道该更新哪些文档，并同提交更新"。机制：入库 git hook（`scripts/hooks/`）+ 映射脚本（`scripts/doc-sync-map.js`，改动文件 → 必同步文档清单）。

1. **新账号 clone 后安装一次**：`sh scripts/install-hooks.sh`（等价 `git config core.hooksPath scripts/hooks`）；
2. **prepare-commit-msg**：每次 `git commit` 自动打印「📋 本次改动触发的必同步文档清单」——照单在同提交内更新文档；
3. **commit-msg 强制校验**：改动含代码/脚本（lx-source.js、test/、scripts/）但提交不含任何文档更新 → 拒绝提交（确认无需文档时 `git commit --no-verify` 绕过）；
4. 清单中的「跨仓库 action」提示（如音源能力变更 → mobile 按 SYNC_POINTS 核对）同样要处理：通知 mobile 侧账号或自己到对方仓库同步；
5. 规则表维护：新增映射在 `scripts/doc-sync-map.js` 的 `RULES` 加一行即可（活文档原则）。

## 文档同步规范（强制，无需提醒）


> 任何功能/修复/版本改动落地后，**必须主动同步更新本仓库全部相关文档**，不等用户提醒。与 App 仓库（mobile-app AGENTS.md「文档同步规范」）同标准。

### 触发场景 → 必同步文档

| 改动类型 | 必同步文档 |
|---|---|
| 版本迭代（@version 升版） | `lx-source.js` 头部 `@version`/`@description`/运行时 `logInfo` 版本串 + `README.md`「当前版本」行与版本历史表 + `docs/ITERATION_ROADMAP.md` 该版本 `[ ]`→`[x]`（候选顺延） |
| 子源新增/关闭/开关默认值 | `lx-source.js` 开关注释 + `README.md`「已知失效/关闭源」表 + `DEV_GUIDE.md` 实测状态表 |
| 健康口径/评分/输出格式 | `lx-source.js` 公式与字段注释 + `README.md` 版本历史行 + ROADMAP |
| 工程脚本（probe/ecosystem-scan/self-check） | `README.md` 版本历史 + `DEV_GUIDE.md` 相应小节 + `AGENTS.md` 命令段（如涉及） |
| 上游依赖/协议变更 | `DEV_GUIDE.md` 协议合规小节 + README 版本历史 + ROADMAP 依赖列 |
| AGENTS.md / 协作规则变更 | `AGENTS.md` 自身（协作规则/命令段/流程改动）+ 紧随提交的 docs 说明 |

### 三条铁律

1. **同提交或紧随提交**：文档更新与代码改动在同一提交内，或紧随其后的独立 docs 提交，禁止"代码入库、文档欠账"；
2. **文档即代码**：改 `@version`/默认开关/公式口径/脚本行为时，与代码同步改文档，任何一处遗漏视为改动未完成；
3. **历史归档不改写**：已交付版本的 README 版本历史/ROADMAP 行只补不删改（修正笔误除外）；新变更一律追加新版本条目。

### 推送前必跑（文档一致性闸门）

```bash
git fetch origin && git log HEAD..origin/master --oneline  # 检查远端是否有其他账号新提交，有则先 pull --rebase
node --check lx-source.js       # L0 语法
node test/lx-source-smoke-test.js  # L1 冒烟 35 组
node scripts/self-check.js      # 发布自检：@version 与 @description/logInfo/README/ROADMAP 同步，任一失败阻断发布
```

`self-check.js` 即本仓库的文档一致性检查（版本串/README 版本条目/ROADMAP 交付标记三向校验），推送前必须清零；新增文档字段需同步扩展自检项。

## 实证开发流程（强制 · 2026-10-28 起）

> **铁律：没有实证依据的改动不进代码；没有走完验证链的改动不进 master。**

### 铁律
1. 每个代码改动必须有实证依据（接口实测 / 官方协议文档原文 / 已有代码事实），写入提交说明与代码注释；
2. 依据不足 → 先做「调研/实测任务」取证，取证完成前禁止实现；
3. 所有改动走完验证链（L0→L4）才允许合入；
4. 验证结论留档（`@contribution` + 文档），禁止"口说无凭"。

### 验证链（从轻到重，逐级通过）
| 层级 | 验证内容 | 方法 | 能发现 | 盲区（不能发现） |
|---|---|---|---|---|
| L0 静态 | 语法/结构 | `node --check`、grep 死代码/魔法数 | 语法错误、死代码 | 逻辑/运行时问题 |
| L1 模拟 | 协议行为/逻辑 | mock `globalThis.lx` 跑冒烟（test/ 用例） | 上报结构、降级链、匹配逻辑 | **宿主差异**（console 缺失、内置冻结——D11 教训） |
| L2 接口实测 | 接口死活 | curl 复现：状态码 + Range 206 | 接口可用性、签名/302 行为 | App 内集成问题 |
| L3 真机 | 端到端 | 装包 fork App：播放/探测/日志 | 宿主约束、集成 | 全量回归 |
| L4 回归 | 全量 | DEV_GUIDE 测试清单 + 冒烟全量 | 回归破坏 | — |

### 闸门（可失败标准，全部可观测、可反驳）
- **L1 通过** = 冒烟全用例绿（含新增用例）；有红即失败
- **L2 通过** = 目标接口 Range 206 + 状态码符合预期；失败必须记录类型（410/404/403/502/超时）
- **L3 通过** = 真机可播 + 无 ReferenceError + 健康探测正常
- **L4 通过** = 测试清单全绿

### 任务类型分流
- **依据不足** → 标记「调研/实测」，先取证（curl / 抓文档 / 读代码），结论留档后再转实现；
- **依据充足** → 「实现」，走验证链。

### 禁止项
- 凭"接口看着标准 / 别人说能用"接入——必须自己 Range 实测；
- 把"上次的经验"当"这次的依据"——接口会死（实证：pdone 健康表 14 域名异常/失效）；
- 验证失败后带病合入、或静默降级交付标准；
- 宿主约束未确认前使用宿主 API（console 教训：官方移动版宿主 API 仅 setTimeout/clearTimeout）。

### L1 模拟环境盲区自查（每次冒烟前过一遍）
- `console`：Node 有、移动端无（D11）→ 日志类改动必须加宿主防御；
- `setTimeout/clearTimeout`：移动端可用（本仓库已用 6 处）；
- 内置属性冻结：`Array.prototype.push = ...` 无效，但可扩展新属性；
- `lx.utils` 部分能力：zlib 未实现、buffer 仅 base64/hex/utf8、aes 仅 cbc/ecb。

### 证据链留档格式（提交说明 + 代码注释）
- **依据**：实测日期 / 接口 / 状态码，或官方文档链接 / 条款；
- **验证**：跑过 L0-L4 哪些层、结果；
- **结论**：可用 / 不可用 / 降级 / 关闭 + 原因。

## 新增/关闭音源流程

### 新增
1. 在 `lx-source.js` ①常量配置加端点 + ②音源开关（默认状态按实证结论：可用且质量达标默认开，待观察/备用默认关）+ ⑥实现子源函数 + ⑦注册表注册（标 `maxQuality` 真实能力）；
2. 实测：目标平台 × 目标音质，Range 206 可播才通过；坏则保持关闭；
3. 更新 README「已知失效/关闭源」表 + DEV_GUIDE 实测表 + 版本历史；
4. 按「协作规则」提交/推送。

### 关闭
1. `SOURCE_TOGGLES` 默认关 + 注释写明关闭原因与日期；
2. README「已知失效/关闭源」表加一行。

## 参考实证（2026-10-27 调研）

- 官方协议文档：https://lxmusic.toside.cn/desktop/custom-source 、/mobile/custom-source
- 生态对照仓库：https://github.com/pdone/lx-music-source （原 backend-api，2026-11 改名，★10k+，健康检查 CI + AGENTS.md 模板）
- 详细论证见 DEV_GUIDE.md「六、升级优化规划」前的实证小节。
