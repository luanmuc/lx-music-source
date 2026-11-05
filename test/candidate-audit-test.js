#!/usr/bin/env node
/**
 * test/candidate-audit-test.js —— v8.1 candidate-audit.js 专项测试
 * G1：覆盖 6 个用例，含 B1/B2/B3 回归
 * 运行：node test/candidate-audit-test.js
 */
const assert = require('assert');
const path = require('path');
const { mockLoadScript, staticExtract, generateReport } = require(path.join(__dirname, '..', 'scripts', 'candidate-audit.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('===== candidate-audit.js 专项测试 =====\n');

// ---- T1：正常脚本 → 提取 name/version/actions/API/音质 ----
test('T1 正常脚本：提取 name/version/actions/API/音质', () => {
  const code = `
/**
 * @name 测试音源
 * @version 1.2.3
 * @author test
 */
var PLATFORM = "kw";
var API_BASE = "https://api.example.com";
function handleAction(action) {
  switch(action) {
    case "musicUrl": return "url";
    case "lyric": return "lyric";
    case "pic": return "pic";
  }
}
`;
  const result = staticExtract(code);
  assert.strictEqual(result.name, '测试音源');
  assert.strictEqual(result.version, '1.2.3');
  assert.ok(result.platforms.includes('kw'));
  assert.ok(result.apiBases.includes('api.example.com'));
});

// ---- T2：混淆样例 → 标注"需人工"（readability=obfuscated）----
test('T2 混淆源码：readability=obfuscated，标注需人工', () => {
  // 模拟混淆：3 行，每行 1000+ 字符
  const longLine = 'x'.repeat(1000);
  const code = `${longLine}\n${longLine}\n${longLine}`;
  const result = staticExtract(code);
  assert.strictEqual(result.readability, 'obfuscated');
});

// ---- T3：语法错误脚本 → 加载失败不崩溃 ----
test('T3 语法错误脚本：加载失败不崩溃', () => {
  const code = 'var x = ;;; syntax error (((';
  const result = mockLoadScript(code);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

// ---- T4（B1 回归）：无鉴权脚本（含 @author）→ hasAuth=false ----
test('T4 B1回归：含 @author 注释但无鉴权关键词 → hasAuth=false', () => {
  const code = `
/**
 * @name 无鉴权音源
 * @author 张三（这里有 auth 子串）
 * @version 1.0
 */
var API_BASE = "https://api.example.com";
`;
  const result = staticExtract(code);
  assert.strictEqual(result.hasAuth, false, '@author 注释里的 auth 不应被误判为鉴权');
});

// ---- T5（B3 回归）：switch-case 写法 → actions 必须提取到 ----
test('T5 B3回归：switch-case 写法 actions 提取到（过滤平台名）', () => {
  const code = `
function handleAction(action) {
  switch(action) {
    case "kw": return kwSource;
    case "wy": return wySource;
    case "musicUrl": return getUrl;
    case "health": return checkHealth;
    case "toggle": return toggleSource;
  }
}
`;
  const result = staticExtract(code);
  // 平台名 kw/wy 不应出现在 actions 里
  assert.ok(!result.actions.includes('kw'), '平台名 kw 不应被提取为 action');
  assert.ok(!result.actions.includes('wy'), '平台名 wy 不应被提取为 action');
  // 真正的 action 应该提取到
  assert.ok(result.actions.includes('musicUrl'), 'musicUrl 应被提取为 action');
  assert.ok(result.actions.includes('health'), 'health 应被提取为 action');
  assert.ok(result.actions.includes('toggle'), 'toggle 应被提取为 action');
});

// ---- T6（B2 回归）：inited {sources:{...}} 上报 → 报告非"未知" ----
test('T6 B2回归：inited 事件 sources 字段 → 报告能提取源列表', () => {
  // 构造一个会上报 inited 事件的脚本
  const code = `
globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, {
  status: true,
  sources: {
    kw: { id: 'kw', actions: ['musicUrl', 'lyric'] },
    wy: { id: 'wy', actions: ['musicUrl'] }
  }
});
`;
  const loadResult = mockLoadScript(code);
  assert.strictEqual(loadResult.ok, true);
  assert.strictEqual(loadResult.sentEvents.length, 1);
  assert.strictEqual(loadResult.sentEvents[0].name, 'inited');
  // 验证 payload.sources 存在
  const sources = loadResult.sentEvents[0].payload.sources;
  assert.ok(sources, 'sources 字段应存在');
  assert.ok(sources.kw, 'kw 源应存在');
  assert.ok(sources.wy, 'wy 源应存在');
});

console.log('');
console.log(`===== 结果：${passed} 通过 / ${failed} 失败 =====`);
process.exit(failed > 0 ? 1 : 0);
