# v8.1 审计修复任务（临时文档 — 修完即删）

> 用途：v8.1（candidate-audit.js）审计发现的问题清单，交给接手账号修复。
> 审计基线：`b89f074`。修完全部问题 + 验证通过后，**删除本文件**再推送。

## 待修文件

- `scripts/candidate-audit.js`（主修）
- `docs/DEV_GUIDE.md`（删除 L349「已知不修项」标注）
- `.github/workflows/ci.yml`（补 v8.1 测试步骤）
- `docs/AGENTS.md`（命令段补 candidate-audit 用法，如涉及）

## 修复清单（按严重度）

### B1 · 鉴权检测 100% 误报【必须修】
- 位置：`candidate-audit.js` L163~165
- 问题：`authKeywords` 含 `'auth'` 子串，`includes(kw)` 会命中所有脚本必有的 `@author` 头注释 → 无鉴权脚本也报"需鉴权：是"（实测复现）
- 修复：`hasAuth` 检测排除 `author` 误命中——用词边界正则（如 `/\bauth\b|token|apikey|api_key|卡密|secret/i`）或先剔除 `@author` 注释再检测

### B2 · 上报事件字段名错【必须修】
- 位置：`candidate-audit.js` L226
- 问题：读 `ev.payload.platforms`，但洛雪协议 inited 事件字段是 **`payload.sources`**（DEV_GUIDE 六章合规表原文：`send(inited) = {sources}`）→ 平台/actions 恒"未知"
- 修复：遍历 `ev.payload.sources` 提取 `{id, actions, qualitys}`；sources 是标准协议字段，生态候选源均遵守
- 附带：修复后**删除** DEV_GUIDE L349「已知不修项」标注（该标注论证错误——协议是统一的，不是"结构不统一"）

### B3 · actions 提取不支持 switch-case【必须修】
- 位置：`candidate-audit.js` L137~148
- 问题：仅匹配 `action === "x"` 与 `actions.push("x")`，switch-case 写法（本仓库 lx-source.js L2218/2292 即此写法）提取为空（实测复现）
- 修复：补充 `case "x":` 匹配（`/case\s*["'](\w+)["']\s*:/g`），并合并去重

### B4 · fetchUrl 不支持 http://【建议修】
- 位置：`candidate-audit.js` L30
- 问题：硬编码 `https.get`，http:// URL 会连 443 被拒（实测 `ECONNREFUSED ...:443`）；候选源在 http 仓库或本地测试全挂
- 修复：按 URL 协议选择 `http`/`https` 模块

### B5 · actions 提取漏写法【建议修】
- 位置：`candidate-audit.js` L137~148
- 问题：`actions.push` 仅匹配字面量 push，`actions = [...actions,'x']` / `unshift` 等写法漏提取
- 修复：B3 的正则增强一并覆盖常见赋值写法（低优先，B3 修完再看）

### B6 · 文档示例 URL 失效【必改】
- 位置：`candidate-audit.js` L18
- 问题：示例 `fish.js` 实测 404（pdone 仓库无此文件）
- 修复：换成真实可用的示例 URL，或标注"示例路径需按候选源仓库核实"

### G1 · 缺专项测试 + CI 无覆盖【必须补】
- 问题：v8.1 无任何测试文件，ci.yml 无 candidate-audit 步骤——后续改动无回归保护，违反 AGENTS.md「L1 通过 = 冒烟全用例绿（含新增用例）」
- 修复：新增 `test/candidate-audit-test.js`，覆盖：
  1. 正常脚本 → mock 加载成功 + 提取 name/version/actions/API/音质
  2. 混淆样例（压缩/极长行）→ 标注"需人工"
  3. 语法错误脚本 → 加载失败不崩溃
  4. **B1 回归**：无鉴权脚本（含 @author 注释）hasAuth 必须 false
  5. **B3 回归**：switch-case 写法 actions 必须提取到
  6. **B2 回归**：inited `{sources:[...]}` 上报 → 报告平台/actions 非"未知"
- 测试方案建议：用本地临时文件 + 本地 mock 协议，或给 candidate-audit.js 增加可导出（`module.exports`）供测试 require，避免依赖网络
- ci.yml：`test` job 加一步 `node test/candidate-audit-test.js`

### R1 · 安全风险标注【文档级】
- `candidate-audit.js` 文件头补充：**`new Function` 执行任意远程脚本，仅审计信任来源候选**（恶意脚本可访问 Node 全局 process）

### G2 · @version 是否升 8.1【按惯例定】
- v8.1 是新增独立脚本（非 lx-source.js 音源本体），@version 未升。若仓库惯例是"每次迭代升版"则升 8.1；若是"仅音源本体升版"则保持 8.0——按 AGENTS.md 版本规则定，README/ROADMAP 同步即可

## 验收标准

1. B1/B2/B3/B4/B6/G1 全部修复（B5/R1/G2 按建议处理）
2. 新增测试全绿 + 冒烟 32 组全绿 + `node --check` 全过 + `node scripts/self-check.js` 通过
3. DEV_GUIDE L349「已知不修项」标注已删除（B2 修复后不再是不修项）
4. 推送前 `git fetch origin` 检查远端（防多账号覆盖）
5. **全部完成后删除本文件**，提交信息注明"docs: v8.1 审计修复完成，删除临时任务文档"
