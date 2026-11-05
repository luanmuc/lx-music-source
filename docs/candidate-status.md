# 判否候选恢复状态（自动探测）

> 由 `scripts/recheck-candidates.js` 自动生成 · 2026-11-05 09:33:58Z · 探测到「已恢复」即提示启动候选实证重评流程（判否记录见 DEV_GUIDE）。

| 候选 | 状态 | 探测证据 |
|---|---|---|
| hyw（HYWmusic v1.2.0） | 🔴 仍失效 | 后端 http 103.79.184.97=EHOSTUNREACH；后端 https 103.79.184.97=EHOSTUNREACH |
| huanyin（幻音 v3） | 🟡 需人工核查 | DNS music-dl.sayqz.com=ENOTFOUND；业务 api.xcvts.cn 咪咕=HTTP 200/400 |
