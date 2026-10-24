// 浏览器回归：收起对话 → 宿主切日常模式（aside 设 hidden、Frame 保留）→ 聊天区必须恢复可见。
// 规则直接取真实 src/panel.css，用无头 Chrome 计算布局，避免在错误 DOM 模型上假绿。
// 用法：node browser-tests/mode-switch-repro.mjs（可用 CHROME_PATH 覆盖浏览器路径）
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const chrome=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if(!existsSync(chrome)){console.error('SKIP: 未找到 Chrome，设置 CHROME_PATH 后重跑');process.exit(2)}
const css=readFileSync(new URL('../src/panel.css',import.meta.url),'utf8');
const html=`<!doctype html><meta charset="utf-8"><style>${css}
body{margin:0}.dshWbBody{display:flex;width:1200px}.dshWbConversation{flex:1 1 60%;min-width:0;height:320px;background:#eef}
.dshWbBusiness{width:40%;height:320px;background:#ddd}.pb-root{height:100%}
</style><div id="root" class="dshWbBody">
  <section id="conversation" class="dshWbConversation"><div id="chat">聊天框内容</div></section>
  <aside id="business" class="dshWbBusiness"><div id="panel" class="pb-root pb-chat-collapsed">工作台面板</div></aside>
</div><script>
const conv=document.getElementById('conversation'),biz=document.getElementById('business'),panel=document.getElementById('panel');
const read=()=>{const r=conv.getBoundingClientRect(),s=getComputedStyle(conv);return{width:Math.round(r.width),opacity:Number(s.opacity),display:s.display,overflow:s.overflow,pointer:s.pointerEvents}};
const out=[];
const check=(name,expectVisible)=>{const r=read();const visible=r.width>100&&r.opacity>0.5&&r.display!=='none';const ok=visible===expectVisible;out.push({name,expectVisible,visible,ok,r})};
// 1 工作台模式下收起：对话区归零
check('收起对话（工作台）',false);
// 2 收到日常模式（aside hidden，Frame 与对话区仍挂载）：必须恢复可见
biz.hidden=true;check('收起后切日常（★bug 场景）',true);
// 3 切回工作台：守卫重新命中，保持收起
biz.hidden=false;check('切回工作台',false);
// 4 展开对话：可见
panel.classList.remove('pb-chat-collapsed');check('展开对话（工作台）',true);
// 5 展开状态下切日常：仍可见
biz.hidden=true;check('展开后切日常',true);
document.title='PB_RESULT:'+JSON.stringify(out);
</script>`;
const dir=mkdtempSync(join(tmpdir(),'pb-mode-switch-'));
const file=join(dir,'repro.html');writeFileSync(file,html);
let dom;
try{
 dom=execFileSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-crashpad',`--user-data-dir=${join(dir,'chrome')}`,'--virtual-time-budget=3000','--dump-dom','file://'+file],{encoding:'utf8',maxBuffer:20*1024*1024});
}finally{rmSync(dir,{recursive:true,force:true})}
const m=/<title>PB_RESULT:(.*?)<\/title>/s.exec(dom);
if(!m){console.error('未取到浏览器测量结果（Chrome 未执行脚本？）');process.exit(2)}
const results=JSON.parse(m[1]);
let failed=0;
for(const item of results){
 console.log(`${item.ok?'✅':'❌'} ${item.name}：${JSON.stringify(item.r)}${item.ok?'':'（期望可见='+item.expectVisible+'）'}`);
 if(!item.ok)failed++;
}
console.log(failed===0?`PASS: ${results.length} 项跨模式场景全部符合预期`:`FAIL: ${failed} 项不符合预期`);
process.exit(failed===0?0:1);
