# 音源可用性基线（SOURCE_AUDIT）

> 本文件是**源级取链巡检**的对照基线，与 `README_HEALTH.md`（端点连通巡检）互补。
> 每次巡检后对照"上次状态 → 本次状态"，判断某源是"新坏"还是"本来就好/本来就没救"。
> 最近一次巡检：**2026-11-06**（v8.4 修复后）

## 一、巡检方法

```bash
node scripts/source-audit.js            # 表格输出（35 组：20 源 × 5 平台）
node scripts/source-audit.js --only=kw  # 只测单平台
node scripts/source-audit.js --json     # 机器可读，供对比基线
```

原理：mock 宿主加载 `lx-source.js`（真实网络转发、支持 302 跟随）→ 临时全开 `runtimeToggles` → 对每个平台 `buildSourceChain()` 取全部 handler → 逐个调用 `fn(platform, songId, '128k', songInfo)`（固定歌：晴天 rid=228908 / wy id=2652820720 / tx songmid=004Z8Ihr0JIu5s）→ 直链做 Range 可播校验。
**与 probe.js 的区别**：probe.js 探"端点是否活着"；本脚本探"源能否真的出可播链接"。

## 二、当前基线：21/35 可用（2026-11-06，v8.4 修复后）

### 可用源（21/35）

| 源 | kw | wy | tx | mg | kg | 备注 |
|---|---|---|---|---|---|---|
| suyinKuwo 溯音酷我 | ✅ | ✅ | ✅ | ✅ | ✅ | v8.4 修复：128k br=7→9（唯一可播 mp3）；flac/320k 为 VIP 死链会失败降级 |
| xinghaiBackend 星海后端 | ✅ | — | — | — | — | v8.4 修复：去无效 X-Token 改匿名调用（受总 QPS 限，429 需退避） |
| juheKw / juheTx / juheMg | ✅ | — | ✅ | ✅ | — | 服务端可用；wy/kg 受限（见不可修清单） |
| suyin163 溯音163 | — | ✅ | — | — | — | 稳定 |
| ikun | ✅ | ✅ | — | — | — | v8.3 默认开启；实测 kw/wy 全音质（flac/320k/128k 均 206） |
| helloworldKw | ✅ | — | — | — | — | convert_url_with_sign 主通道 |
| kuwoOfficial 酷我官方 | ✅ | — | — | — | — | 自研搜索→convert_url |
| changqingVip 长青 / nianxinVip 念心 | ✅ | — | — | — | — | kw 128k |
| wyOuter 网易云官方 | — | ✅ | — | — | — | 本地 mock 不跟随 302 会假阴性；curl 跟随实测 206 可播 |
| huibq | ✅ | ✅ | ✅ | ✅ | ✅ | **默认关闭（待决策开启）**；实测全平台全音质（flac/320k/128k）出链可播；onrender 免费实例有冷启动/限速风险 |

### 不可用（14/35，均为上游问题，非本仓库可修）

| 源 | 平台 | 原因 | 处置 |
|---|---|---|---|
| xinghaiBackup 星海备 | kw/wy/tx/mg | `music-dl.sayqz.com` 域名不可解析（服务方放弃；星海主域 `yy.zddyr.top` 活着） | 归档排除：默认关闭 + `EXCLUDE_DOMAINS` + 候选监控 `recheck-candidates.js` |
| lingchuan 聆川 | kw/wy/tx/mg/kg | `api.lingchuan.com` 域名不可解析，全网无新地址 | 归档排除（同上） |
| suyinQQ 溯音QQ | tx | `oiapi.net/api/QQ_Music` 连续 7 天 HTTP 403（oiapi 服务端限制） | 默认关闭；恢复由端点巡检感知 |
| suyinMigu 溯音咪咕 | mg | `api.xcvts.cn` 返回 502"咪咕搜索接口均不可用（服务器 IP 被咪咕限制）"——上游服务端 IP 被封 | 默认关闭；恢复由 probe payload 校验感知 |
| juheWy / juheKg | wy / kg | Juhe 服务端对 wy（网易云 1027 风控）、kg 取链受限 | 默认关闭；juheTx/juheKw/juheMg 正常 |

## 三、本次巡检发现并修复（v8.4，2026-11-06）

| 问题 | 根因 | 修复 |
|---|---|---|
| suyinKuwo 5 平台全 LINK_EXPIRED(CDN 410) | 128k 用 br=7，实测 br=9 才是唯一可播 mp3；flac/320k 返回 VIP 链（loginUid 空）→ 410 | `QUALITY_TO_X.kuwo` 128k 7→9；探针 128k 路同步 br=9 |
| xinghaiBackend kw HTTP 403 | 上游升级 token 校验：自定义 X-Token 判"无效或已过期，请使用官方版本"；匿名第三方调用放行（200，受总 QPS 限） | fn + 探针去掉 X-Token，改匿名调用（保留 X-Client 标注） |

**效果：15/35 → 21/35 可用。**

## 四、监控口径（重要）

- `README_HEALTH.md`（probe.js 每日 CI）：**端点级**健康。v8.5 起对取链型端点（oiapi Kuwo/163、ikun、星海后端、溯音咪咕、huibq 待开）增加**真实取链 + 直链 Range 可播**二次校验，失败标 `PAYLOAD_*`；429/503 退避重试≈限流不判死（`PAYLOAD_THROTTLED`）。
- **端点可用 ≠ 音源可用**：以 App 健康面板（源内探针，带 Range 校验 + 自动摘死/自愈）为最终判据。
- 已知历史假阳性案例：oiapi Kuwo 端点连续 7 天 100% 可用，但源实际 410 死链（2026-11-06 实锤）；yy.zddyr.top 端点 200 但真实取链曾因无效 token 403。

## 五、待决策

- **huibq 是否默认开启**：实测全平台全音质可用，探针已补齐（v8.5）。开启收益：wy/tx/mg/kg 各多一个兜底源；风险：onrender 免费实例冷启动慢（可 30s+）、可能限速。等用户拍板。
