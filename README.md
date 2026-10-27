# lx-music-source — 豆包定制[聚合音源]

> 与 [`luanmuc/lx-music-mobile`](https://github.com/luanmuc/lx-music-mobile)（落雪音乐定制版）配套的内置聚合音源仓库。
> **App 每次云编译（CI）会自动拉取本仓库根目录 `lx-source.js` 覆盖内置音源**，因此：
> - 本仓库是唯一权威音源入口，改音源只改这里；
> - 每次发布到 Release 页的版本 = 用户 App 实际内置的版本。

## 快速开始

| 事项 | 说明 |
|---|---|
| 当前版本 | **v11.11 接口满编版**（`lx-source.js` 内 `@version 11.11`） |
| 支持平台 | 网易云(wy) / QQ(tx) / 酷我(kw) / 酷狗(kg) / 咪咕(mg) |
| 音质能力 | flac / 320k / 128k（按真实来源能力裁剪上报） |
| 集成方式 | App CI 用 GitHub Contents API 拉 `luanmuc/lx-music-source/contents/lx-source.js` |
| 发布入口 | 本仓库 **Releases 页**：每次迭代出 tag + 附 `lx-source.js` 产物 |

## 版本历史

| 版本 | 说明 |
|---|---|
| **v11.11**（当前） | 接口满编版：溯音酷我 128k 恢复（10-15 实测 Range 206 可播）；kw 128k 五路兜底满编（溯音酷我/星海后端/酷我官方/长青/念心）；探测歌曲池轮换（晴天/海阔天空/稻香）防风控误判；v11.10 双音质分域探测/音质校验/音质优先保持 |
| v11.10 | 双音质分域探测（flac + 128k 任一可播即存活，防 410 死链误摘高音质源）；音质校验（缓存音质不低于请求音质才兜底）；音质优先保持（解析从请求音质开始） |
| v11.9 | 音频可播性二次校验（Range 取 1KB，206/200 音频判定）；长青/念心 kw 302 直链恢复；溯音酷我签名 URL Range 校验 |
| v11.8 | 音源健康探测并发化（一轮 ~6s）；源级 `maxQuality` 音质过滤；`fallbackRace` 竞速 + 6s 整体超时；缓存 key 加 songId 维度；音质等级数值化 |

> 完整深度分析、模块地图、已知缺陷与升级规划见 **[DEV_GUIDE.md](./DEV_GUIDE.md)**。

## 发布规范（每次迭代必读）

1. 修改 `lx-source.js`，更新文件头 `@version` 与 `@description`（写明本轮变更与实测结论）；
2. 本地验证：node 语法检查 + 按 [DEV_GUIDE.md 测试清单](./DEV_GUIDE.md#测试清单发布前必做) 实测；
3. commit + push 到 master（改动集中，避免频繁触发 App 构建）；
4. **创建 Release**：tag = `vX.Y.Z`，标题 = `聚合音源 vX.Y.Z …`，正文 = 变更说明，附件 = 当前 `lx-source.js`；
5. （可选）需要 App 换新音源时，用 `workflow_dispatch` 触发 `lx-music-mobile` 的 release.yml 构建（push 空提交亦可）。

## 已知失效/关闭源（保留函数便于恢复）

| 源 | 状态 | 说明 |
|---|---|---|
| 溯音QQ | 关闭 | 实测 -403 维护中 |
| 溯音咪咕 | 关闭 | 实测 502（上游 IP 被封） |
| 星海备 | 关闭 | 域名不可解析 |
| Huibq | 关闭 | 仅酷我真用，其他平台假兜底 |
| 聆川 | 关闭 | 未配置 |
| ikun | 关闭 | 需卡密（填入 `IKUN_API_KEY` 并开开关） |

> 健康探测会自动启用/停用可用源，以上为静态默认值。
