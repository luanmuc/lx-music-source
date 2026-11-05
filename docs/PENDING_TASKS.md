# PENDING_TASKS — L4 定时文档巡检（临时交接，验收后删除）

> 交接人：豆包账号 A（当前） · 执行：豆包账号 B（另一账号） · 验收：账号 A
> 创建：2026-11-05 · 状态：待执行
> 完成后账号 A 验收通过即删除本文档（勿保留）。

---

## 任务：创建"两仓库 L4 文档巡检"定时任务

### 背景（已完成的前置，不要重做）

两个仓库的 L4 文档一致性巡检脚本 **已就绪并推送**，只需创建定时任务每天自动执行：

- source 仓库（`https://github.com/luanmuc/backend-api.git`，本地路径 `/home/user/Doubao/chats/38450522296699906/lx-music-source`）：
  - `scripts/docs-audit.js`（提交 f49dad9）：低风险自动修复——冒烟用例数 ↔ AGENTS「N 组用例」、lx-source.js `@version` 子串 ↔ README、pdone 仓库 URL（防回退旧名 `backend-api`）；报告项——README_HEALTH 更新时间戳新鲜度（>28h 告警）、`docs/candidate-status.md` 新鲜度。
- mobile 仓库（`https://github.com/luanmuc/mobile-app.git`，本地路径 `/home/user/Doubao/chats/38450522296699906/lx-music-mobile`）：
  - `scripts/docs-audit.js`（提交 ca8dcc85 + 9f5264aa 补 AGENTS 命令段）：低风险自动修复——TS/TSX 文件数 ↔ RELEASE_SOP「N 个 TS/TSX」/ DEV_SETUP「全量 TS/TSX 语法检查（N 个文件）」、README「当前底座 vX.Y 至 bN」↔ `publish/build-state.json`、`docs/UPSTREAM_LIFECYCLE.md` 中 track-player 锁定 commit ↔ `package.json`；报告项——三语言键数一致（zh-cn/zh-tw/en-us，当前 618）。
- 两仓库均已安装 doc-sync Hook（`scripts/hooks/`，AGENTS.md 有说明）：提交代码不带文档会被 commit-msg 拒绝；脚本类改动会提示同步 AGENTS 命令段/README。

### 需要执行的动作

1. **用豆包定时任务能力创建一个周期任务**（每天执行一次），任务内容（query）必须包含：
   - 本次请求由定时任务「两仓库 L4 文档巡检」到时触发；
   - 工作区：`/home/user/Doubao/chats/38450522296699906/`，两个仓库 `lx-music-source` 与 `lx-music-mobile`；
   - 每个仓库先 `git fetch origin` + `git rebase origin/master`（**禁止 force push**；令牌从仓库 `docs/AGENTS.md` 或最近 push 命令取，未写明则从账号 A 交接处取）；
   - 分别运行 `node scripts/docs-audit.js`（低风险项自动修复）；
   - 有自动修复时按 doc-sync Hook 规则在同提交内更新相应文档，`git commit` + `git push`；
   - 执行完毕输出汇总报告：每仓库修复了哪些（before → after）、哪些项待人工（如三语言键数不一致）、健康表/候选状态新鲜度是否异常（>28h 需提醒检查 probe/recheck CI）。
2. **创建后立即手动触发一次**（或按任务最早可执行时间触发），验证脚本真实跑通、能正常 fetch/rebase/push、报告格式正确。
3. 时间选择建议：每天上午 10:30 左右（避开 7:30-10:00 高峰期），非整点更佳；具体由账号 B 按豆包定时任务规范确定并写明执行时间。

### 验收标准（账号 A 检查）

- [ ] 定时任务真实存在且启用（能查到任务与下次触发时间），不是口头承诺；
- [ ] 手动/首次触发验证通过：两仓库 docs-audit 跑通，输出含修复项与待人工项；
- [ ] 若触发了文档修复：提交遵守 rebase 规则、未 force push、Hook 无红字报错；
- [ ] 汇总报告反馈给账号 A（通过仓库文档或消息）。

### 注意事项

- 不要修改 `scripts/docs-audit.js` 本身的规则逻辑（如需扩展规则，在 `RULES` 处加行，并在 AGENTS 命令段同步）；
- 不要动历史归档文档（CUSTOM_CHANGELOG/CHANGELOG/ARCHIVE_OLD_TAGS）；
- 若账号 B 环境无豆包定时任务能力，请在本文档追加说明并推回，账号 A 再评估替代方案；
- 完成任务后**不要删除本文档**，由账号 A 验收后删除。
