# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-11-04T13:36:26.534Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 17 个端点，可用 6 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-11-04 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ❌ 失败 | 403 | 106 | 14% (1/7天) | HTTP 403 |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 118 | 0% (0/7天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ❌ 失败 | 403 | 2383 | 0% (0/7天) | HTTP 403 |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 2508 | 100% (7/7天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 1685 | 100% (7/7天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 206 | 2716 | 86% (6/7天) | OK |
| `https://lxmusicapi.onrender.com` | ✅ 可用 | 200 | 1332 | 14% (1/7天) | OK |
| `https://api.music.lerd.dpdns.org` | ❌ 失败 | 429 | 965 | 0% (0/7天) | HTTP 429 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 1183 | 0% (0/7天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ❌ 失败 | - | 5818 | 71% (5/7天) | TIMEOUT |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 2362 | 100% (7/7天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 2399 | 100% (7/7天) | OK |
| `http://search.kuwo.cn/r.s` | ❌ 失败 | - | 2382 | 86% (6/7天) | ETIMEDOUT |
| `http://antiserver.kuwo.cn/anti.s` | ❌ 失败 | - | 2586 | 86% (6/7天) | ETIMEDOUT |
| `https://api.ikunshare.com` | ❌ 失败 | - | 1918 | 0% (0/7天) | ENOTFOUND |
| `http://nmobi.kuwo.cn/mobi.s` | ❌ 失败 | - | 2888 | 0% (0/7天) | ETIMEDOUT |
| `https://musicserver.haitangw.cc/v1/music/resolve-url` | ❌ 失败 | - | 6729 | 0% (0/7天) | TIMEOUT |

## ⚠️ 死源建议（连续 3 天以上失败，供迭代时摘除/留档）

- `https://music-dl.sayqz.com/api/`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://oiapi.net/api/QQ_Music`：连续 7 天失败（近7日成功率 0%），当前仍失败 · HTTP 403
- `https://api.music.lerd.dpdns.org`：连续 7 天失败（近7日成功率 0%），当前仍失败 · HTTP 429
- `https://api.lingchuan.com/v1`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.ikunshare.com`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `http://nmobi.kuwo.cn/mobi.s`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ETIMEDOUT
- `https://musicserver.haitangw.cc/v1/music/resolve-url`：连续 7 天失败（近7日成功率 0%），当前仍失败 · TIMEOUT
- `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light`：连续 6 天失败（近7日成功率 14%），当前仍失败 · HTTP 403
