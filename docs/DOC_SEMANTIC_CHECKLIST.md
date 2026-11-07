# 文档语义一致性清单（机器判不了，靠人）

> 定位：`scripts/docs-audit.js` 只能验「能算出唯一真值」的项（行数/冒烟组数/开关布尔/源数/跨仓版本）。
> 本清单是人类必须核对的部分。**发布前、以及任何改动下列内容时，逐项过一遍。**

## 一、改动类型 → 必须人工核对的断言

| 改动类型 | 必须核对 | 典型翻车 |
|---|---|---|
| 子源开关默认值变化 | README「已知失效/关闭源」表、DEV_GUIDE 实测状态表、`SOURCE_TOGGLES` 注释三方是否一致 | ikun 早已默认开启，README 表仍写「关闭·需卡密」 |
| 新增/移除子源 | 「N 个子源」「N 个登记源」这类枚举是否完整（机器只校验总数，不校验名单） | 总数对但名单漏项 |
| 协议/上游端点变化 | DEV_GUIDE 协议合规小节、候选状态说明 | 端点已换域名，文档仍写旧域名 |
| 链路结构变化（加/删源、改排序） | DEV_GUIDE §11 机制说明、SOURCE_AUDIT 的「链结构」表 | 链长度/顺序描述与实测不符 |
| 审计/巡检结论 | README 版本历史行、AUDIT_REPORT、candidate-status | 结论写了但没落进版本历史 |
| 跨仓（App） | App 仓 `docs/MUSIC_SOURCE_GUIDE.md` 的版本与特性行 | 音源升版 App 文档不跟（已加跨仓校验兜底） |

## 二、机器已覆盖的项（不必人肉重查）

`scripts/docs-audit.js` 14 条规则：冒烟组数（全文档 4 处）、`lx-source.js` 总行数、行段表末段边界、setTimeout 处数、子源总数、ikun/huibq 开关真值、`@version` 串、pdone URL、health/candidate 新鲜度、跨仓 App 文档版本、写死增长量检测。

## 三、持续增长量（不要写死）

Release tag 数、`probe-history.jsonl` 行数、提交数、下载量——**一律写命令引用**（`git tag | wc -l`），不写具体数字。规则 11 会报出写死的位置。

## 红绿自检（机制自身改动后必须跑，否则等于没装）

```bash
# 1. 红：把某文档里的一个数字改错 1 位
node scripts/docs-audit.js --dry-run    # 必须报出 🟡/🔴 且指对文件与旧值
# 2. 绿：自动修回真值
node scripts/docs-audit.js
# 3. 确认只改回该数字，没误伤别处
git diff
```

> 只用「跑完打印一堆绿字」当作机制生效，等于自欺——绿字可能是规则根本没命中。
