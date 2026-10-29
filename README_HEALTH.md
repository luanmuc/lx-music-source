# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-10-29T21:01:00.416Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 17 个端点，可用 9 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-10-29 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ✅ 可用 | 200 | 1110 | 50% (1/2天) | OK |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 53 | 0% (0/2天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ❌ 失败 | 403 | 235 | 0% (0/2天) | HTTP 403 |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 214 | 100% (2/2天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 215 | 100% (2/2天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 200 | 217 | 100% (2/2天) | OK |
| `https://lxmusicapi.onrender.com` | ❌ 失败 | 503 | 2924 | 0% (0/2天) | HTTP 503 |
| `https://api.music.lerd.dpdns.org` | ❌ 失败 | 429 | 1168 | 0% (0/2天) | HTTP 429 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 1013 | 0% (0/2天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ✅ 可用 | 200 | 1206 | 100% (2/2天) | OK |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 1137 | 100% (2/2天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 1140 | 100% (2/2天) | OK |
| `http://search.kuwo.cn/r.s` | ✅ 可用 | 206 | 1081 | 100% (2/2天) | OK |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 1103 | 100% (2/2天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 1382 | 0% (0/2天) | ENOTFOUND |
| `http://nmobi.kuwo.cn/mobi.s` | ❌ 失败 | 404 | 1420 | 0% (0/1天) | HTTP 404 |
| `https://musicserver.haitangw.cc/v1/music/resolve-url` | ❌ 失败 | 404 | 1746 | 0% (0/1天) | HTTP 404 |
