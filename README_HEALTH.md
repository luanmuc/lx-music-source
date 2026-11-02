# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-11-02T14:26:58.142Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 17 个端点，可用 7 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-11-02 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ❌ 失败 | 403 | 106 | 17% (1/6天) | HTTP 403 |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 69 | 0% (0/6天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ❌ 失败 | 403 | 2065 | 0% (0/6天) | HTTP 403 |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 1117 | 100% (6/6天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 1309 | 100% (6/6天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ❌ 失败 | - | 6897 | 83% (5/6天) | TIMEOUT |
| `https://lxmusicapi.onrender.com` | ❌ 失败 | - | 4605 | 0% (0/6天) | TIMEOUT |
| `https://api.music.lerd.dpdns.org` | ❌ 失败 | 429 | 676 | 0% (0/6天) | HTTP 429 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 813 | 0% (0/6天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ✅ 可用 | 200 | 1641 | 100% (6/6天) | OK |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 1620 | 100% (6/6天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 1673 | 100% (6/6天) | OK |
| `http://search.kuwo.cn/r.s` | ✅ 可用 | 206 | 1763 | 100% (6/6天) | OK |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 3376 | 100% (6/6天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 1519 | 0% (0/6天) | ENOTFOUND |
| `http://nmobi.kuwo.cn/mobi.s` | ❌ 失败 | 404 | 2218 | 0% (0/5天) | HTTP 404 |
| `https://musicserver.haitangw.cc/v1/music/resolve-url` | ❌ 失败 | 404 | 4644 | 0% (0/5天) | HTTP 404 |

## ⚠️ 死源建议（连续 3 天以上失败，供迭代时摘除/留档）

- `https://music-dl.sayqz.com/api/`：连续 6 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://oiapi.net/api/QQ_Music`：连续 6 天失败（近7日成功率 0%），当前仍失败 · HTTP 403
- `https://lxmusicapi.onrender.com`：连续 6 天失败（近7日成功率 0%），当前仍失败 · TIMEOUT
- `https://api.lingchuan.com/v1`：连续 6 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.ikunshare.com`：连续 6 天失败（近7日成功率 0%），当前仍失败 · ENOTFOUND
- `https://api.music.lerd.dpdns.org`：连续 6 天失败（近7日成功率 0%），当前仍失败 · HTTP 429
- `http://nmobi.kuwo.cn/mobi.s`：连续 5 天失败（近7日成功率 0%），当前仍失败 · HTTP 404
- `https://musicserver.haitangw.cc/v1/music/resolve-url`：连续 5 天失败（近7日成功率 0%），当前仍失败 · HTTP 404
- `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light`：连续 4 天失败（近7日成功率 17%），当前仍失败 · HTTP 403
