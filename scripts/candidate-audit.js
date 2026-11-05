#!/usr/bin/env node
/**
 * scripts/candidate-audit.js —— v8.1 候选实证半自动化
 *
 * 对新候选音源脚本自动生成实证报告草案：
 *   1) 抓取候选脚本源码（输入 URL）
 *   2) mock 宿主加载（复用冒烟测试 mock 框架）——验证脚本能正常加载 + 上报 actions
 *   3) 静态提取：API_BASE / 音质表 / actions 列表 / 鉴权方式 / 可读性评分
 *   4) 生成 Markdown 实证报告草案（混淆源自动标注"需人工"）
 *
 * L2 真实取链仍人工（mock 只能验证加载层，不能验证端到端取链）。
 *
 * 用法：
 *   node scripts/candidate-audit.js <脚本URL>     # 生成实证报告草案
 *   node scripts/candidate-audit.js <脚本URL> --json  # 仅输出 JSON
 *
 * 示例：
 *   node scripts/candidate-audit.js https://raw.githubusercontent.com/pdone/backend-api/master/fish.js
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---- 工具函数 ----
function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'backend-api-candidate-audit' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} 抓取失败: ${url}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`抓取超时(${timeoutMs}ms): ${url}`)); });
  });
}

// ---- mock 宿主（复用冒烟测试框架）----
function mockLoadScript(scriptCode, timeoutMs = 3000) {
  const sentEvents = [];
  let requestHandler = null;

  // 注入 globalThis.lx（洛雪移动端宿主全局对象）
  globalThis.lx = {
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
    version: '1.2.0',
    env: {},
    utils: {
      buffer: {
        from: (data, enc) => Buffer.from(data, enc),
        bufToString: (buf, enc) => buf.toString(enc),
      },
    },
    request(url, opts, cb) {
      // mock 请求：直接返回空 200
      setTimeout(() => cb(null, { statusCode: 200, headers: {}, body: '', url: String(url) }), 2);
    },
    on(name, handler) { if (name === 'request') requestHandler = handler; },
    send(name, payload) { sentEvents.push({ name, payload }); },
  };

  // 执行脚本（side-effect 加载，无返回值）
  let loadError = null;
  try {
    const fn = new Function(scriptCode);
    fn();
  } catch (e) {
    loadError = e.message;
  }

  // 等待 timeoutMs，让 inited 事件和健康探测启动完
  // （健康探测是异步的，我们不需要等它跑完，只要 inited 上报了就算加载成功）
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // busy wait 等异步事件触发
    // 注意：这里不能用 setTimeout，因为我们在同步代码里
    // 实际上 inited 事件是同步上报的，所以不需要等
    break;
  }

  // 清理全局对象
  delete globalThis.lx;

  if (loadError) {
    return { ok: false, error: loadError, sentEvents: [] };
  }

  return { ok: true, sentEvents, requestHandler: !!requestHandler };
}

// ---- 静态提取 ----
function staticExtract(scriptCode) {
  const result = {
    name: null,
    version: null,
    platforms: [],      // 上报的平台列表
    actions: [],        // 上报的 actions
    apiBases: [],       // 提取到的 API 域名
    qualitys: [],        // 提取到的音质表
    hasAuth: false,      // 是否有鉴权（卡密/token）
    readability: 'high', // high / medium / low / obfuscated
    lineCount: scriptCode.split('\n').length,
  };

  // 提取 @name
  const nameMatch = scriptCode.match(/@name\s+(.+)/);
  if (nameMatch) result.name = nameMatch[1].trim();

  // 提取 @version
  const verMatch = scriptCode.match(/@version\s+(\S+)/);
  if (verMatch) result.version = verMatch[1];

  // 提取平台列表（从 send 事件或源码里的平台字符串）
  const platformMatches = scriptCode.match(/["'](kw|wy|tx|mg|kg)["']/g);
  if (platformMatches) {
    result.platforms = [...new Set(platformMatches.map(s => s.replace(/["']/g, '')))];
  }

  // 提取 actions（从源码里的 action === 或 actions.push）
  const actionMatches = scriptCode.match(/action\s*===?\s*["'](\w+)["']/g);
  if (actionMatches) {
    result.actions = [...new Set(actionMatches.map(s => s.match(/["'](\w+)["']/)[1]))];
  }
  const pushMatches = scriptCode.match(/actions\.push\(["'](\w+)["']/g);
  if (pushMatches) {
    for (const m of pushMatches) {
      const action = m.match(/["'](\w+)["']/)[1];
      if (!result.actions.includes(action)) result.actions.push(action);
    }
  }

  // 提取 API 域名（http/https URL）
  const urlMatches = scriptCode.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (urlMatches) {
    result.apiBases = [...new Set(urlMatches.map(u => new URL(u).hostname))];
  }

  // 提取音质表（flac/320k/128k 等）
  const qualityMatches = scriptCode.match(/["'](flac|320k|128k|flac24bit|high|medium|low)["']/g);
  if (qualityMatches) {
    result.qualitys = [...new Set(qualityMatches.map(s => s.replace(/["']/g, '')))];
  }

  // 检测鉴权（卡密/token/apikey 等关键词）
  const authKeywords = ['token', 'apikey', 'api_key', '卡密', 'secret', 'auth'];
  for (const kw of authKeywords) {
    if (scriptCode.toLowerCase().includes(kw)) {
      result.hasAuth = true;
      break;
    }
  }

  // 可读性评分
  const lineCount = result.lineCount;
  const avgLineLen = scriptCode.length / lineCount;
  if (lineCount < 20 && avgLineLen > 500) {
    result.readability = 'obfuscated'; // 混淆源码（few lines, very long lines）
  } else if (lineCount < 100 && avgLineLen > 200) {
    result.readability = 'low';
  } else if (lineCount < 300 && avgLineLen > 100) {
    result.readability = 'medium';
  } else {
    result.readability = 'high';
  }

  return result;
}

// ---- 生成报告 ----
function generateReport(scriptUrl, loadResult, staticResult) {
  const isObfuscated = staticResult.readability === 'obfuscated';
  const status = isObfuscated ? '⚠️ 需人工（混淆源码）' : '✅ 草案可参考';

  let report = `# 候选实证报告草案\n\n`;
  report += `> 自动生成（v8.1 候选实证半自动化）\n`;
  report += `> 脚本地址：${scriptUrl}\n`;
  report += `> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;

  report += `## 状态\n\n`;
  report += `${status}\n\n`;

  if (isObfuscated) {
    report += `> ⚠️ 该脚本为混淆源码（${staticResult.lineCount} 行，平均行长度 ${Math.round(staticResult.scriptLength / staticResult.lineCount)} 字符），静态提取信息有限，需人工深入分析。\n\n`;
  }

  report += `## 基本信息\n\n`;
  report += `| 项目 | 值 |\n`;
  report += `|---|---|\n`;
  report += `| 名称 | ${staticResult.name || '未知'} |\n`;
  report += `| 版本 | ${staticResult.version || '未知'} |\n`;
  report += `| 行数 | ${staticResult.lineCount} 行 |\n`;
  report += `| 可读性 | ${staticResult.readability} |\n\n`;

  report += `## 加载验证（mock 宿主）\n\n`;
  report += `| 项目 | 结果 |\n`;
  report += `|---|---|\n`;
  report += `| 加载成功 | ${loadResult.ok ? '✅ 是' : '❌ 否'} |\n`;
  if (!loadResult.ok) {
    report += `| 错误信息 | ${loadResult.error} |\n`;
  }
  report += `| 上报事件数 | ${loadResult.sentEvents.length} |\n\n`;

  if (loadResult.sentEvents.length > 0) {
    report += `### 上报事件列表\n\n`;
    for (const ev of loadResult.sentEvents) {
      report += `- **${ev.name}**\n`;
      if (ev.payload) {
        report += `  - 平台：${ev.payload.platforms?.join(', ') || '未知'}\n`;
        report += `  - actions：${ev.payload.actions?.join(', ') || '未知'}\n`;
      }
    }
    report += `\n`;
  }

  report += `## 静态提取\n\n`;
  report += `| 项目 | 值 |\n`;
  report += `|---|---|\n`;
  report += `| 支持平台 | ${staticResult.platforms.join(', ') || '未知'} |\n`;
  report += `| actions | ${staticResult.actions.join(', ') || '未知'} |\n`;
  report += `| API 域名 | ${staticResult.apiBases.join(', ') || '未知'} |\n`;
  report += `| 音质表 | ${staticResult.qualitys.join(', ') || '未知'} |\n`;
  report += `| 需鉴权 | ${staticResult.hasAuth ? '是（卡密/token）' : '否（无）'} |\n\n`;

  report += `## 下一步（人工）\n\n`;
  report += `1. **L2 真实取链验证**：mock 只能验证加载层，端到端取链需人工实测\n`;
  report += `   - 搜索接口返回格式\n`;
  report += `   - 取链接口返回 URL 可播（Range 206 + 魔数校验）\n`;
  report += `   - 音质档位匹配\n`;
  report += `2. **混淆源码深度分析**：${isObfuscated ? '需要' : '可选'}\n`;
  report += `3. **接入决策**：通过实测后才接入 kw 链\n\n`;

  return report;
}

// ---- 主流程 ----
async function main() {
  const scriptUrl = process.argv[2];
  if (!scriptUrl) {
    console.error('用法: node scripts/candidate-audit.js <脚本URL> [--json]');
    process.exit(1);
  }

  const asJson = process.argv.includes('--json');

  console.error(`正在抓取候选脚本: ${scriptUrl}`);
  const scriptCode = await fetchUrl(scriptUrl);

  console.error('正在 mock 加载验证...');
  const loadResult = mockLoadScript(scriptCode);

  console.error('正在静态提取...');
  const staticResult = staticExtract(scriptCode);
  staticResult.scriptLength = scriptCode.length;

  if (asJson) {
    process.stdout.write(JSON.stringify({
      scriptUrl,
      loadResult,
      staticResult,
    }, null, 2) + '\n');
    return;
  }

  const report = generateReport(scriptUrl, loadResult, staticResult);
  process.stdout.write(report);
}

main().catch((e) => {
  process.stderr.write(`候选实证失败: ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
});
