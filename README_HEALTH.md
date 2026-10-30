# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-10-30T11:57:33.433Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 17 个端点，可用 8 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-10-30 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ❌ 失败 | 403 | 96 | 33% (1/3天) | HTTP 403 |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 91 | 0% (0/3天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ❌ 失败 | 403 | 1732 | 0% (0/3天) | HTTP 403 |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 2137 | 100% (3/3天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 2451 | 100% (3/3天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 200 | 2183 | 100% (3/3天) | OK |
| `https://lxmusicapi.onrender.com` | ❌ 失败 | 503 | 992 | 0% (0/3天) | HTTP 503 |
| `https://api.music.lerd.dpdns.org` | ❌ 失败 | 429 | 1111 | 0% (0/3天) | HTTP 429 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 1312 | 0% (0/3天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ✅ 可用 | 200 | 2063 | 100% (3/3天) | OK |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 2379 | 100% (3/3天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 2382 | 100% (3/3天) | OK |
| `http://search.kuwo.cn/r.s` | ✅ 可用 | 206 | 2496 | 100% (3/3天) | OK |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 2445 | 100% (3/3天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 2069 | 0% (0/3天) | ENOTFOUND |
| `http://nmobi.kuwo.cn/mobi.s` | ❌ 失败 | 404 | 3085 | 0% (0/2天) | HTTP 404 |
| `https://musicserver.haitangw.cc/v1/music/resolve-url` | ❌ 失败 | 404 | 3805 | 0% (0/2天) | HTTP 404 |

## ⚠️ 死源建议（连续 3 天以上失败，供迭代时摘除/留档）

- `https://music-dl.sayqz.com/api/`：连续 3 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://oiapi.net/api/QQ_Music`：连续 3 天失败（近7日成功率 0%），当前仍失败 · HTTP 403
- `https://lxmusicapi.onrender.com`：连续 3 天失败（近7日成功率 0%），当前仍失败 · HTTP 503
- `https://api.lingchuan.com/v1`：连续 3 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.ikunshare.com`：连续 3 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.music.lerd.dpdns.org`：连续 3 天失败（近7日成功率 0%），当前仍失败 · HTTP 429
