// 守卫测试：防止再次引入「收起状态跨模式/跨重启泄漏」类 bug
// 根因见全局技能 dsh-cross-boundary-css 与航才项目 LESSONS.md（同源问题 v3.2.8→v3.2.9）。
// 原理：:has() 等结构选择器匹配 DOM 结构、不匹配可见性；宿主切日常模式 = 给
// .dshWbBusiness 设 hidden（不移除）。凡引用 .dshWbBusiness 的 :has() 链必须带
// :not([hidden]) 守卫；状态类只挂自己的 .pb-root；收起状态不得持久化到 localStorage。
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/panel.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../src/panel.js',import.meta.url),'utf8');

// 括号计数提取所有 :has(...) 参数（不用正则：参数内嵌套 :not([hidden]) 会让正则回溯丢条）
function extractHasArgs(s){
 const out=[];let i=0;
 while((i=s.indexOf(':has(',i))!==-1){
  let d=1,k=i+5;
  while(k<s.length&&d>0){if(s[k]==='(')d++;else if(s[k]===')')d--;k++}
  out.push(s.slice(i,k-1));i=k;
 }
 return out;
}

test('守卫：引用 .dshWbBusiness 的 :has() 必须带 :not([hidden]) 可见性守卫',()=>{
 const crossing=extractHasArgs(css).filter(a=>a.includes('.dshWbBusiness'));
 assert.ok(crossing.length>=2,`跨边界 :has() 规则数量异常（${crossing.length} < 2），收起布局规则疑似被删除`);
 for(const a of crossing){
  assert.ok(a.includes('.dshWbBusiness:not([hidden])'),
   `缺少宿主可见性守卫：:has(${a})\n:has() 匹配结构不匹配 hidden——宿主切日常模式是给 aside 设 hidden 而非移除，无守卫的规则会把对话区在日常模式继续压没。修复：.dshWbBusiness 改为 .dshWbBusiness:not([hidden])。详见 dsh-cross-boundary-css 技能`);
 }
 assert.ok(crossing.some(a=>a.includes('pb-chat-collapsed')),'缺少「收起对话」相关 :has() 规则');
});

test('守卫：状态类只挂自己的 .pb-root，禁止改宿主元素 class',()=>{
 assert.doesNotMatch(js,/body\.classList\.toggle/,
  '不得在宿主 .dshWbBody 上 toggle 状态类：宿主元素归宿主所有，插件挂的 class 可能在重挂/多工作台场景下残留。仅允许 body.classList.remove 做旧版本残留清理。');
 const toggles=[...js.matchAll(/classList\.toggle\('([a-z-]+)'/g)].map(m=>m[1]);
 assert.ok(toggles.every(t=>t.startsWith('pb-')),'状态类必须以 pb- 前缀挂自己组件');
});

test('守卫：收起状态不得持久化到 localStorage（Bug A 同源）',()=>{
 assert.ok(!js.includes("'llm-perf-chat-open'"),
  "检测到 'llm-perf-chat-open' localStorage 键：收起状态持久化会让工作台每次打开都收起对话（v3.2.8 航才台同源 bug），必须移除。模式切换类状态绝不持久化。");
});

test('守卫：兜底 MutationObserver 必须同时感知 .dshWbBody 与 .dshWbBusiness',()=>{
 assert.ok(js.includes('MutationObserver'),'缺少兜底 MutationObserver（宿主模式切换时自动恢复对话展开）');
 assert.ok(js.includes("closest('.dshWbBusiness')"),
  '兜底观察目标缺少 .dshWbBusiness：宿主切日常模式时实际变更的是 aside 的 hidden，只盯 .dshWbBody 接不住。');
 assert.ok(js.includes("closest('.dshWbBody')"),'兜底观察目标缺少 .dshWbBody');
});
