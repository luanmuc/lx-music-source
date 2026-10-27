# AGENTS.md — 多账号/多智能体协作规范

> 本仓库由**多个豆包账号共同开发**。此文件供 GitHub Copilot / 豆包 / 任何智能体读取，避免互相踩踏。
> **核心原则：master 只接受已验证的改动；所有新功能先分支，验证后合入。**

## 项目一句话

洛雪音乐（`luanmuc/lx-music-mobile` 定制版）的内置聚合音源。根目录单文件 `lx-source.js` 是**唯一权威产物**，App 云编译时 CI 自动拉取它覆盖 `assets/builtin_source.js`。

## 目录结构

```
lx-source.js        # 唯一权威音源（多子源聚合器，勿拆目录，勿改其他文件）
README.md           # 用户视角：版本历史 + 在线导入 + 可用性表
DEV_GUIDE.md        # 开发者视角：代码地图 + 协议合规 + 路线图 + 发布 SOP（改代码前先读）
AGENTS.md           # 本文件：协作规范
versions/           # （规划中）带版本号归档，防误删回滚
```

## 命令

```bash
# 语法检查（每次改动后必跑）
node --check lx-source.js

# 冒烟测试（v13.0 前用参考脚本，后续固化到 test/）
node /tmp/lx-source-smoke-test.js   # mock globalThis.lx，8 组用例

# 提交 + 推送（push 前先 pull --rebase）
git add lx-source.js && git commit -m "feat(vX.Y): <变更摘要>" && git push origin master
```

## 协作规则（防"多账号直推 master 相互覆盖"）

1. **小改动**（≤1 个缺陷、风险低）：可直接 master 提交，但必须过语法 + 冒烟 + 对应平台实测。
2. **功能改动**（新增源/接口/降级逻辑/探测策略）：**必须开分支** `feat/<短描述>` → 本地验证 → PR 到 master，PR 描述写清实测证据。
3. **每次改动必须更新**：`lx-source.js` 头部 `@version`/`@description`（写明变更+实测结论）+ `DEV_GUIDE.md` 相应小节 + 缺陷表状态。
4. **实测结论写进代码**：新增/改动子源后，在注释里留 `@contribution <日期> <账号>：<实测平台/音质/结果>`，禁止只写"应该能用"。
5. **关闭的源不删代码**：只关开关 + README 标注原因（恢复成本最低）。
6. **禁止**：未经验证把"猜测可用的接口"接入正式链；直接覆盖他人正在编辑的文档段落。

## 新增/关闭音源流程

### 新增
1. 在 `lx-source.js` ①常量配置加端点 + ②音源开关（默认关）+ ⑥实现子源函数 + ⑦注册表注册（标 `maxQuality` 真实能力）；
2. 实测：目标平台 × 目标音质，Range 206 可播才通过；坏则保持关闭；
3. 更新 README「已知失效/关闭源」表 + DEV_GUIDE 实测表 + 版本历史；
4. 按「协作规则」提交/PR。

### 关闭
1. `SOURCE_TOGGLES` 默认关 + 注释写明关闭原因与日期；
2. README「已知失效/关闭源」表加一行。

## 参考实证（2026-10-27 调研）

- 官方协议文档：https://lxmusic.toside.cn/desktop/custom-source 、/mobile/custom-source
- 生态对照仓库：https://github.com/pdone/lx-music-source （★10k+，健康检查 CI + AGENTS.md 模板）
- 详细论证见 DEV_GUIDE.md「六、升级优化规划」前的实证小节。
