# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-11-03T13:25:17.693Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 17 个端点，可用 7 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-11-03 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ❌ 失败 | 403 | 143 | 14% (1/7天) | HTTP 403 |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 116 | 0% (0/7天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ❌ 失败 | 403 | 2559 | 0% (0/7天) | HTTP 403 |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 2077 | 100% (7/7天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 1304 | 100% (7/7天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 206 | 2078 | 86% (6/7天) | OK |
| `https://lxmusicapi.onrender.com` | ❌ 失败 | - | 4635 | 0% (0/7天) | TIMEOUT |
| `https://api.music.lerd.dpdns.org` | ❌ 失败 | 429 | 721 | 0% (0/7天) | HTTP 429 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 772 | 0% (0/7天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ❌ 失败 | 503 | 1519 | 86% (6/7天) | HTTP 503 |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 1951 | 100% (7/7天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 1954 | 100% (7/7天) | OK |
| `http://search.kuwo.cn/r.s` | ✅ 可用 | 206 | 1822 | 100% (7/7天) | OK |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 2013 | 100% (7/7天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 1396 | 0% (0/7天) | ENOTFOUND |
| `http://nmobi.kuwo.cn/mobi.s` | ❌ 失败 | - | 2177 | 0% (0/6天) | ETIMEDOUT |
| `https://musicserver.haitangw.cc/v1/music/resolve-url` | ❌ 失败 | 404 | 3487 | 0% (0/6天) | HTTP 404 |

## ⚠️ 死源建议（连续 3 天以上失败，供迭代时摘除/留档）

- `https://music-dl.sayqz.com/api/`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://oiapi.net/api/QQ_Music`：连续 7 天失败（近7日成功率 0%），当前仍失败 · HTTP 403
- `https://lxmusicapi.onrender.com`：连续 7 天失败（近7日成功率 0%），当前仍失败 · TIMEOUT
- `https://api.lingchuan.com/v1`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.ikunshare.com`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.music.lerd.dpdns.org`：连续 7 天失败（近7日成功率 0%），当前仍失败 · HTTP 429
- `http://nmobi.kuwo.cn/mobi.s`：连续 6 天失败（近7日成功率 0%），当前仍失败 · ETIMEDOUT
- `https://musicserver.haitangw.cc/v1/music/resolve-url`：连续 6 天失败（近7日成功率 0%），当前仍失败 · HTTP 404
- `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light`：连续 5 天失败（近7日成功率 14%），当前仍失败 · HTTP 403
