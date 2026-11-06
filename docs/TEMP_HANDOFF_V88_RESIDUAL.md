# 临时交接：v8.8 竞速改造收尾遗留事项

> **本文件是临时交接文档**，供另一个账号推进。全部完成后请删除本文件，并把结论回写进 `docs/SOURCE_AUDIT.md` 与 `docs/ITERATION_ROADMAP.md`。
> 基线：`backend-api` master `6c073aa`（v8.8），CI `42163636827` success；`mobile-app` master `b2adb49a`。

## 一、已完成（不要重做）

| 项 | 状态 |
|---|---|
| v8.8 六条竞速方案代码落地（分批错峰并发 / 跨档 12s 预算 / 档位短路 / 冷启动预热 / gdWy 降批 / verified 精确等待） | ✅ 已推送 `6c073aa` |
| 冒烟回归 43 组（T40 后批并发接管 620ms、T41 档位短路不请求 br=1、T43 预算 801ms 快速失败） | ✅ 全绿 |
| 文档正文同步（DEV_GUIDE 竞速小节、AUDIT_PLAN A12、README / ROADMAP / SOURCE_AUDIT 版本行） | ✅ 已推送 |
| 真实网络巡检：kw 9/11、wy 5/8、tx 3/6、mg 2/6、kg 1/4（合计 20/35，v8.5 基线 21/35） | ✅ 已跑完，结论见下 |

巡检原始输出在本机临时文件（`/tmp/audit-kw.log`、`/tmp/audit-wy.log`、`/tmp/audit-rest.log`），换账号后如需复核请重跑：

```bash
node scripts/source-audit.js --only=kw   # 其余平台替换 --only=wy/tx/mg/kg
```

## 二、遗留事项（按优先级）

### 1.【高】huibq 实际只支持 kw / wy，却挂在五平台链尾 —— 必败兜底 + 白耗 1~1.5s

实测（2026-11-06，真实网络，128k 固定歌）：

| 平台 | huibq 返回 | 判定 |
|---|---|---|
| kw | `code:0 msg:success` + `bd-er.kuwo.cn` 可播链（206 audio） | ✅ 可用 |
| wy | `code:0 msg:success` + `m701.music.126.net` 可播链（206 audio） | ✅ 可用 |
| tx | `msg:"无法获取播放链接！"` + panspace 酷我错链 | ❌ v8.7 已判失败 |
| mg | `NOT_FOUND: Huibq未取到该平台链接(无法获取播放链接！)` | ❌ |
| kg | 同上 | ❌ |

现状：`PLATFORM_GROUPS` 的五组（wy/kw/tx/mg/kg）都挂了 `huibq`，所以 tx/mg/kg 每次走到链尾都要白等一次必败请求（实测 mg 1484ms、kg 976ms），并且会让"链路看起来还有兜底"。

要做的事（按仓库开发规范，改完必须跑冒烟 + self-check）：
1. 推荐在 `SOURCE_HANDLERS.huibq` 上加能力声明 `platforms: ["kw", "wy"]`，并在 `buildSourceChain` 里按 `h.platforms` 过滤（能力集中在 handler，链构建自然生效）；也可直接把 `huibq` 从 `PLATFORM_GROUPS` 的 tx/mg/kg 三组移除。
2. `scripts/probe.js` 的 huibq 探针继续固定用 `kw`，不要为 tx/mg/kg 建 huibq 探针。
3. 新增冒烟 T44：断言 `buildSourceChain('tx'|'mg'|'kg','128k')` 均不含 `huibq`，且 `buildSourceChain('kw'|'wy','128k')` 均含 `huibq`。
4. 同步文档：`docs/SOURCE_AUDIT.md` huibq 行改"仅 kw/wy"、README 特性行、`mobile-app/docs/MUSIC_SOURCE_GUIDE.md`。

验收：冒烟全绿；`node scripts/source-audit.js --only=tx` 输出里不再出现 huibq 行。

### 2.【中】`scripts/source-audit.js` 跑完不自动退出，必须 timeout 包裹

现象：已打印"统计：x/y 可用"后进程仍常驻（`pgrep -af source-audit` 可见残留），连续跑多平台会堆进程。本次靠 `timeout 100 node scripts/source-audit.js --only=xx` 逐个跑绕过。

要做的事：打印统计后显式 `process.exit(...)`（或在 mock 宿主注册后 `unref` 定时器 / 关闭 HTTP keep-alive agent），并加注释说明原因。

验收：`node scripts/source-audit.js --only=kw` 不加 timeout 也能自行退出。

### 3.【中】真机上验证 v8.8 的两处行为收益（mock 覆盖不到）

- **huibq 预热收益**：冷态首次播放是否从"必败"变为"可用"；预热是否影响首播时延。观察方式：真机播放时抓日志里的 `[预热]` 行。
- **档位短路误伤面**：`byQuality.businessFail` 里包含 404（歌不存在 / 无版权）。若连续 3 首**不同**热门版权歌 404，会给"某源某档"打上短路口，可能误跳本来可用的源。验证方式：连续播 3 首无版权歌，观察该源该档是否被跳过（日志搜 `档位短路`）。若确认误伤，把判据从 `(fail + businessFail)` 收窄为只看 `fail`（410/超时），配置键 `qualityShortCircuitSamples` 已留好。

### 4.【低】仓库记录清理

- `docs/ITERATION_ROADMAP.md` 候选表里 `hyw` 仍标"进行中"，实际早已判否、现由 `scripts/recheck-candidates.js` 自动复检 → 改标"已判否（自动复检）"。
- 本文件完成后删除。

## 三、不要做的事

- 不要把 `raceOverallTimeoutMs` / `RACE_OVERALL_TIMEOUT_MS` 再当主超时用：v8.8 起实际生效的是 `raceBudgetMs`（跨音质档共享 12s），旧键仅兼容保留。
- 不要去掉 `gdWy` 的 `batch: 2`（配额 5min/50 次，只有前批全败才该打）。
- 不要手改 `docs/AGENTS.md` 的用例数：`scripts/docs-audit.js` 会自动改，手改会被覆盖回去。
- 不要用 `pkill -f source-audit.js` 清理残留进程——该 pattern 会连正在执行的命令自身一起杀掉（本次踩过），用 `pkill -f "node scripts/source-audit"` 或按 PID。
