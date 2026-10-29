# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-10-29T12:04:13.971Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 15 个端点，可用 7 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-10-29 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ❌ 失败 | 403 | 138 | 0% (0/2天) | HTTP 403 |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 452 | 0% (0/2天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ❌ 失败 | 403 | 1111 | 0% (0/2天) | HTTP 403 |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 1294 | 100% (2/2天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 2132 | 100% (2/2天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 200 | 3490 | 100% (2/2天) | OK |
| `https://lxmusicapi.onrender.com` | ❌ 失败 | 503 | 895 | 0% (0/2天) | HTTP 503 |
| `https://api.music.lerd.dpdns.org` | ❌ 失败 | 429 | 756 | 0% (0/2天) | HTTP 429 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 1150 | 0% (0/2天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ✅ 可用 | 200 | 1908 | 100% (2/2天) | OK |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 2263 | 100% (2/2天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 2312 | 100% (2/2天) | OK |
| `http://search.kuwo.cn/r.s` | ❌ 失败 | - | 2413 | 50% (1/2天) | ETIMEDOUT |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 2493 | 100% (2/2天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 2003 | 0% (0/2天) | ENOTFOUND |
