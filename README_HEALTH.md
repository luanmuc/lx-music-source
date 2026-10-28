# 端点健康表（自动巡检）

> 由 `scripts/probe.js` 自动生成 · 更新于 2026-10-28T05:47:10.839Z · 判定规则：2xx/3xx 或 Range 206 为可用（4xx/5xx/超时/域名不可解析为失败）

共提取 16 个端点，可用 12 个；近 7 日成功率基于 `docs/probe-history.jsonl` 历史（2026-10-28 追加）。

| 端点 | 状态 | HTTP | 耗时(ms) | 近7日成功率 | 说明 |
|---|---|---|---|---|---|
| `https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=f…` | ✅ 可用 | 200 | 967 | 100% (1/1天) | OK |
| `https://music-dl.sayqz.com/api/` | ❌ 失败 | - | 10 | 0% (0/1天) | ENOTFOUND |
| `https://oiapi.net/api/QQ_Music` | ✅ 可用 | 403 | 100 | 100% (1/1天) | OK |
| `https://oiapi.net/api/Music_163` | ✅ 可用 | 200 | 178 | 100% (1/1天) | OK |
| `https://oiapi.net/api/Kuwo` | ✅ 可用 | 200 | 179 | 100% (1/1天) | OK |
| `https://api.xcvts.cn/api/music/migu` | ✅ 可用 | 200 | 151 | 100% (1/1天) | OK |
| `https://lxmusicapi.onrender.com` | ❌ 失败 | 503 | 824 | 0% (0/1天) | HTTP 503 |
| `https://api.lingchuan.com/v1` | ❌ 失败 | - | 17 | 0% (0/1天) | ENOTFOUND |
| `https://yy.zddyr.top/lx/api/` | ✅ 可用 | 200 | 284 | 100% (1/1天) | OK |
| `https://music.163.com/api/song/lyric` | ✅ 可用 | 200 | 113 | 100% (1/1天) | OK |
| `https://music.163.com/api/song/detail` | ✅ 可用 | 200 | 151 | 100% (1/1天) | OK |
| `http://search.kuwo.cn/r.s` | ✅ 可用 | 206 | 62 | 100% (1/1天) | OK |
| `http://antiserver.kuwo.cn/anti.s` | ✅ 可用 | 206 | 83 | 100% (1/1天) | OK |
| `https://api.ikunshare.com` | ❌ 失败 | - | 347 | 0% (0/1天) | ENOTFOUND |
| `https://img2.kuwo.cn/${item.MVPIC}` | ✅ 可用 | 404 | 409 | 100% (1/1天) | OK |
| `https://github.com/luanmuc/lx-music-source/releases` | ✅ 可用 | 206 | 1063 | 100% (1/1天) | OK |
