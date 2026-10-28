# lx-music-source — 豆包定制[聚合音源]

> 与 [`luanmuc/lx-music-mobile`](https://github.com/luanmuc/lx-music-mobile)（落雪音乐定制版）配套的内置聚合音源仓库。
> **App 每次云编译（CI）会自动拉取本仓库根目录 `lx-source.js` 覆盖内置音源**，因此：
> - 本仓库是唯一权威音源入口，改音源只改这里；
> - 每次发布到 Release 页的版本 = 用户 App 实际内置的版本。

> **免责声明**：本音源仅供学习交流与技术研究，请支持正版音乐。音源仅做接口聚合，不存储任何音乐文件；第三方接口的可用性与版权责任归相应服务方。使用即代表同意仅限个人学习用途，禁止商用。

## 快速开始

| 事项 | 说明 |
|---|---|
| 当前版本 | **v16.2 数据驱动版**（`lx-source.js` 内 `@version 16.2`） |
| 支持平台 | 网易云(wy) / QQ(tx) / 酷我(kw) / 酷狗(kg) / 咪咕(mg) |
| 音质能力 | flac / 320k / 128k（按真实来源能力裁剪上报） |
| 集成方式 | App CI 用 GitHub Contents API 拉 `luanmuc/lx-music-source/contents/lx-source.js` |
| 发布入口 | 本仓库 **Releases 页**：每次迭代出 tag + 附 `lx-source.js` 产物 |
| 迭代机制 | 任何豆包账号说「**迭代**」即按 [docs/ITERATION_ROADMAP.md](./docs/ITERATION_ROADMAP.md) 自动推进下一版本；规则见 [AGENTS.md](./AGENTS.md) |

## 在线导入（自定义源）

> 面向其他洛雪音乐用户：设置 → 基本设置 → 自定义源 → 自定义源管理 → 在线导入。

```
https://raw.githubusercontent.com/luanmuc/lx-music-source/master/lx-source.js
```

加速链接（GitHub 受限时使用）：

```
https://ghproxy.net/raw.githubusercontent.com/luanmuc/lx-music-source/master/lx-source.js
```

## 音源可用性（2026-10-27 核验）

> 本表 = 本仓库实测（2026-10-15）+ 生态交叉验证（pdone/lx-music-source 健康巡检，2026-10-27）。
> 口径：pdone 探测来自 CI 服务器 IP，与本仓库 IP 维度不同，分歧 ≠ 某一方错误（典型：溯音咪咕上游可用但本机 IP 被封）。

| 平台 | 可用音质 | 主路子源 | 交叉验证 |
|---|---|---|---|
| 网易云 wy | 128k / 320k / flac | 溯音163 / wyOuter / gdWy | oiapi.net ✅ / gdstudio.xyz ✅ |
| 酷我 kw | 128k / 320k / flac | 溯音酷我 + 星海后端（双源 v12.0） | oiapi.net ✅；zddyr.top ✅；酷我官方 CDN ⚠️ 不稳 |
| QQ tx | 128k（走溯音酷我兜底） | 溯音QQ 关闭 | 上游 oiapi.net ✅，接口 -403 待恢复 |
| 酷狗 kg | 128k（走溯音酷我兜底） | — | — |
| 咪咕 mg | 128k（走溯音酷我兜底） | 溯音咪咕关闭（IP 封禁） | 上游 api.xcvts.cn ✅（2026-10-28 实测域名 200 但接口 502=出口 IP 被限，保持关闭待上游恢复） |

> 端点级实时健康状态见 [README_HEALTH.md](./README_HEALTH.md)（`scripts/probe.js` 每日自动刷新）；详细对照表、缺陷与路线图见 [DEV_GUIDE.md](./DEV_GUIDE.md)。

## 版本历史

| 版本 | 说明 |
|---|---|
| **v16.2**（当前） | 数据驱动版：发布后监控/回滚决策（Release 自动巡检基线 + 核心源连续失败≥3 天回滚）；死源建议（连续 3 天失败自动标记）；仓库级成功率统计（probe-history 近 7 日） |
| **v15.2** | 统计快照版：`getHealthSnapshot()` 导出各源成功率/均时/熔断状态/健康分（供 App 健康面板/巡检消费）；失败原因透出（v14.0 已覆盖音源侧） |
| **v15.0** | 歌词/封面透出版：App fork 已支持 lyric/pic action——wy 歌词+封面（网易云公开接口实测可用）、kw 封面（搜索 hts_MVPIC 实测可用），失败 App 自动走内置源兜底 |
| **v14.3** | 探测巡检增强版：分级探测（核心源每轮 / 次要源每 3 轮一探）+ 失效源休眠复活（连续 3 轮失败休眠、每 10 轮复活试探、探测通过自动回归） |
| **v14.2** | 竞速匹配校验版：verified 源（内部 songInfoMatch 校验）结果优先，未校验源首个成功等 600ms 窗口防"快但错歌"抢答 |
| **v14.1** | 健康权重自学习版：健康评分 = 真实样本成功率（置信度收缩）+ 均时惩罚 + 连续失败惩罚；探测样本独立计数低权重参考，真实请求主导排序 |
| **v14.0** | 失败原因结构化版：聚合错误携带 `code`（代表码）+ `detail` 数组（每项 `{source, quality, code, reason}`），message 文本保持兼容，供 App 端展示/统计 |
| **v13.4** | 迭代就绪版：配置化（ikun 卡密 / 聆川密钥入 `USER_CONFIG`，开配置即用、默认关闭）；音质映射表收敛（`QUALITY_TO_X` 统一 magic number，官方"源内映射"模型）；健康探测结果并入竞速统计；决策日志开关（`LOG_DEBUG`） |
| v13.0~13.3 | 工程化：`test/lx-source-smoke-test.js` 冒烟固化（mock lx 宿主 8 组用例）+ CI 自动 `node --check`+冒烟（push 触发）；`scripts/probe.js` 端点巡检 + 每日 CI 写回健康表；协作规范进 AGENTS.md（迭代协议）；updateAlert 发版通知（**v16.5.1 起停用**：每次加载/导入自动弹更新提示过于打扰，已按用户要求关闭） |
| v12.1~12.3 | 可用性：失败缓存差异化（404→1h / 410→1min / 网络错误不缓存）+ 失败码统一提取；mg/tx 恢复评估（2026-10-28 实测 mg 上游域名 200 但接口 502=出口 IP 被咪咕限、溯音QQ 仍 -403，均保持关闭）；debug 级源级决策日志 |
| **v12.0** | 星海高音质版：xinghaiBackend 解除 128k 限制接入 kw flac/320k（E10 实测：四档 code 200、URL 均 Range 206、魔数正确、码率吻合、ID3 歌名对应 songmid）+ URL http→https 升级（实测 https 206 可播）；kw 高音质实现双源冗余（D3 修复） |
| v11.13 | 日志宿主防御版（D11）：`safeConsole` 兼容无 console 移动端宿主（官方移动版宿主 API 仅 setTimeout/clearTimeout）。vm 无 console 沙箱实证：修复前加载即抛 TypeError 复现，修复后加载/请求/健康探测/熔断全路径通过 |
| v11.12 | 防错歌加固版：片段/试听特征词拒绝（D1）+ 兜底档歌名/时长校验 + durationMatch 接入（D4），杜绝"能播但播错歌"；kw CDN 链 http→https 升级（D2）；断路器仅对网络类错误熔断（D8）；探测一致性加固（gdWy/溯音163 补 Range 可播性校验 + 溯音163 歌曲池轮换）；清理级：死代码移除 / 长青念心模板工厂化 / 双降级统一（D10） |
| v11.11 | 接口满编版：溯音酷我 128k 恢复（10-15 实测 Range 206 可播）；kw 128k 五路兜底满编（溯音酷我/星海后端/酷我官方/长青/念心）；探测歌曲池轮换（晴天/海阔天空/稻香）防风控误判；v11.10 双音质分域探测/音质校验/音质优先保持 |
| v11.10 | 双音质分域探测（flac + 128k 任一可播即存活，防 410 死链误摘高音质源）；音质校验（缓存音质不低于请求音质才兜底）；音质优先保持（解析从请求音质开始） |
| v11.9 | 音频可播性二次校验（Range 取 1KB，206/200 音频判定）；长青/念心 kw 302 直链恢复；溯音酷我签名 URL Range 校验 |
| v11.8 | 音源健康探测并发化（一轮 ~6s）；源级 `maxQuality` 音质过滤；`fallbackRace` 竞速 + 6s 整体超时；缓存 key 加 songId 维度；音质等级数值化 |

> 完整深度分析、模块地图、已知缺陷与升级规划见 **[DEV_GUIDE.md](./DEV_GUIDE.md)**。

## 发布规范

> 完整发布 SOP（改 `@version` → 实测 → 提交 → Release → 联动 App）见 [DEV_GUIDE.md 第九节](./DEV_GUIDE.md#九发布-sop每次迭代必须走完)，本表只列红线。

1. 每次迭代**必须**更新 `lx-source.js` 文件头 `@version` 与 `@description`（写明本轮变更与实测结论）；
2. 发布前必须跑完 [DEV_GUIDE.md 测试清单](./DEV_GUIDE.md#八测试清单发布前必做)；
3. 需要 App 换新音源时，用 `workflow_dispatch` 触发 `lx-music-mobile` 的 release.yml 构建（push 空提交亦可）。

## 已知失效/关闭源（保留函数便于恢复）

| 源 | 状态 | 说明 |
|---|---|---|
| 溯音QQ | 关闭 | 实测 -403 维护中 |
| 溯音咪咕 | 关闭 | 实测 502（上游 IP 被封） |
| 星海备 | 关闭 | 域名不可解析 |
| Huibq | 关闭 | 仅酷我真用，其他平台假兜底 |
| 聆川 | 关闭 | 未配置密钥（`USER_CONFIG.lingchuanApiKey`）；v13.1 巡检：域名 api.lingchuan.com 不可解析 |
| ikun | 关闭 | 需卡密（`USER_CONFIG.ikunApiKey` 填入后开开关）；v13.1 巡检：域名 api.ikunshare.com 不可解析 |

> 健康探测会自动启用/停用可用源，以上为静态默认值。
