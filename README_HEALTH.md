# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-11-04T13:52:05.733Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 17 个端点，可用 13 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-11-04 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ✅ 可用 | 200 | 1361 | 29% (2/7天) | OK |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 15 | 0% (0/7天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ✅ 可用 | 403 | 103 | 14% (1/7天) | OK |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 140 | 100% (7/7天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 150 | 100% (7/7天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 206 | 171 | 86% (6/7天) | OK |
| `https://lxmusicapi.onrender.com` | ✅ 可用 | 200 | 857 | 14% (1/7天) | OK |
| `https://api.music.lerd.dpdns.org` | ✅ 可用 | 429 | 1784 | 14% (1/7天) | OK |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 27 | 0% (0/7天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ❌ 失败 | - | 4161 | 71% (5/7天) | TIMEOUT |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 144 | 100% (7/7天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 173 | 100% (7/7天) | OK |
| `http://search.kuwo.cn/r.s` | ✅ 可用 | 206 | 95 | 100% (7/7天) | OK |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 92 | 100% (7/7天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 65 | 0% (0/7天) | ENOTFOUND |
| `http://nmobi.kuwo.cn/mobi.s` | ✅ 可用 | 404 | 138 | 14% (1/7天) | OK |
| `https://musicserver.haitangw.cc/v1/music/resolve-url` | ✅ 可用 | 404 | 346 | 14% (1/7天) | OK |

## ⚠️ 死源建议（连续 3 天以上失败，供迭代时摘除/留档）

- `https://music-dl.sayqz.com/api/`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.lingchuan.com/v1`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.ikunshare.com`：连续 7 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
