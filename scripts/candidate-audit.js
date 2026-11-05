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
 *   node scripts/candidate-audit.js https://raw.githubusercontent.com/luanmuc/backend-api/master/lx-source.js
 *
 * ⚠️ 安全提示（R1）：本脚本用 `new Function` 执行任意远程脚本，仅审计信任来源的候选源。
 *    恶意脚本可访问 Node 全局 process，请勿传入不信任的 URL。
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---- 工具函数 ----
const http = require('http');

function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    // B4 修复：按协议选择 http/https 模块
    const client = u.protocol === 'http:' ? http : https;
    const req = client.get({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
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
function mockLoadScript(scriptCode) {
  const sentEvents = [];
  let requestHandler = null;

  // 保存原始定时器，加载完后恢复
  const origSetInterval = global.setInterval;
  const origSetTimeout = global.setTimeout;
  const origClearInterval = global.clearInterval;
  const origClearTimeout = global.clearTimeout;

  // mock 定时器：全部变成空操作（防止健康探测 setInterval 导致进程不退出）
  global.setInterval = () => 0;
  global.setTimeout = (fn, ms) => {
    // 只执行一次，不真正延迟
    if (typeof fn === 'function') fn();
    return 0;
  };
  global.clearInterval = () => {};
  global.clearTimeout = () => {};

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
      // mock 请求：直接回调（因为 setTimeout 被覆盖了，会同步执行）
      cb(null, { statusCode: 200, headers: {}, body: '', url: String(url) });
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

  // 清理：恢复定时器 + 删除全局对象
  global.setInterval = origSetInterval;
  global.setTimeout = origSetTimeout;
  global.clearInterval = origClearInterval;
  global.clearTimeout = origClearTimeout;
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

  // 提取 actions（从源码里的 action === 或 actions.push 或 switch-case）
  const actionMatches = scriptCode.match(/action\s*===?\s*["'](\w+)["']/g);
  if (actionMatches) {
    result.actions = [...new Set(actionMatches.map(s => s.match(/["'](\w+)["']/)[1]))];
  }
  // B3 修复：补 switch-case 写法（case "x":），但过滤掉平台名（kw/wy/tx/mg/kg）
  const platformNames = new Set(['kw', 'wy', 'tx', 'mg', 'kg']);
  const caseMatches = scriptCode.match(/case\s*["'](\w+)["']\s*:/g);
  if (caseMatches) {
    for (const m of caseMatches) {
      const action = m.match(/["'](\w+)["']/)[1];
      // 跳过平台名，只保留真正的 action 名
      if (!platformNames.has(action) && !result.actions.includes(action)) {
        result.actions.push(action);
      }
    }
  }
  const pushMatches = scriptCode.match(/actions\.push\(["'](\w+)["']/g);
  if (pushMatches) {
    for (const m of pushMatches) {
      const action = m.match(/["'](\w+)["']/)[1];
      if (!result.actions.includes(action)) result.actions.push(action);
    }
  }
  // B5 修复：补 unshift 和展开运算符写法
  const unshiftMatches = scriptCode.match(/actions\.unshift\(["'](\w+)["']/g);
  if (unshiftMatches) {
    for (const m of unshiftMatches) {
      const action = m.match(/["'](\w+)["']/)[1];
      if (!result.actions.includes(action)) result.actions.push(action);
    }
  }
  const spreadMatches = scriptCode.match(/\[\.\.\.actions,\s*["'](\w+)["']\]/g);
  if (spreadMatches) {
    for (const m of spreadMatches) {
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
  // B1 修复：用词边界正则，避免 @author 注释里的 "auth" 子串误命中
  const authRegex = /\b(token|apikey|api_key|secret)\b|卡密/i;
  result.hasAuth = authRegex.test(scriptCode);

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
        // B2 修复：洛雪协议 inited 事件字段是 sources（对象），不是 platforms/actions
        if (ev.payload.sources) {
          const sourceIds = Object.keys(ev.payload.sources);
          report += `  - 源数量：${sourceIds.length}\n`;
          report += `  - 源列表：${sourceIds.join(', ')}\n`;
          // 从 sources 里提取 actions 汇总
          const allActions = new Set();
          for (const src of Object.values(ev.payload.sources)) {
            if (src.actions) src.actions.forEach(a => allActions.add(a));
          }
          if (allActions.size > 0) {
            report += `  - 合计 actions：${[...allActions].join(', ')}\n`;
          }
        } else {
          report += `  - 字段：${Object.keys(ev.payload).join(', ')}\n`;
        }
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

  // 强制退出（mock 加载可能启动了健康探测 setInterval，导致进程不退出）
  process.exit(0);
}

// 直接运行时执行 main()；被 require 时导出函数供测试调用
if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`候选实证失败: ${e && e.message ? e.message : String(e)}\n`);
    process.exit(1);
  });
} else {
  module.exports = { fetchUrl, mockLoadScript, staticExtract, generateReport };
}
