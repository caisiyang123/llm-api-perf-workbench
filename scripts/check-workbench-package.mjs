// 官方工作台包静态校验（本地开发用，不替代真实安装与 UI 自测）
// 对照：https://dshdesktop.com/workbench/docs/development.md（2026-10-09）
// 用法：node scripts/check-workbench-package.mjs [项目目录]
import {readFileSync,existsSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';

const root=resolve(process.argv[2]||'.');
const failures=[];
const oks=[];
const ok=(name,detail='')=>{oks.push(name);console.log(`✅ ${name}${detail?'：'+detail:''}`)};
const bad=(name,detail)=>{failures.push(name);console.error(`❌ ${name}：${detail}`)};
const must=(cond,name,detail)=>{if(cond)ok(name,detail);else bad(name,detail)};
const read=(p)=>{try{return readFileSync(join(root,p),'utf8')}catch{return null}};
const exists=(p)=>existsSync(join(root,p))&&statSync(join(root,p)).isFile();
const pkg=JSON.parse(read('package.json')||'{}');

console.log(`检查目录：${root}\n`);
// 3.2 package.json
must(typeof pkg.name==='string'&&/^[a-z0-9-]+$/.test(pkg.name),'package.json name',pkg.name||'missing');
must(typeof pkg.version==='string'&&/^\d+\.\d+\.\d+$/.test(pkg.version),'package.json 完整 SemVer',pkg.version||'missing');
must(pkg.type==='module','"type":"module" 建议项',pkg.type||'missing');
must(typeof pkg.main==='string'&&exists(pkg.main),'main 指向存在的服务端入口',pkg.main||'missing');
must(pkg.exports?.['.']&&exists(pkg.exports['.']),'exports["."] 指向服务端入口',pkg.exports?.['.']||'missing');
must(pkg.dsh?.bundle?.patch&&exists(pkg.dsh.bundle.patch),'dsh.bundle.patch 存在',pkg.dsh?.bundle?.patch||'missing');
must(pkg.dsh?.client?.platform==='web','dsh.client.platform 为 web',pkg.dsh?.client?.platform||'missing');
const inject=pkg.dsh?.client?.inject;
must(Array.isArray(inject)&&inject.includes('dsh-desktop-workbenches'),'dsh.client.inject 含 dsh-desktop-workbenches',Array.isArray(inject)?inject.join(', '):'missing');
must(pkg.exports?.['./client']&&exists(pkg.exports['./client']),'exports["./client"] 指向已构建客户端',pkg.exports?.['./client']||'missing');
must(pkg.exports?.['./package.json']==='./package.json','exports["./package.json"] 建议项',pkg.exports?.['./package.json']||'missing');
must(pkg.exports?.['./cordis.patch.yml']==='./cordis.patch.yml','exports["./cordis.patch.yml"] 建议项',pkg.exports?.['./cordis.patch.yml']||'missing');
const files=pkg.files||[];
for(const need of ['dsh','lib','docs','cordis.patch.yml','README.md']){
  must(files.some(f=>f===need||f.startsWith(need+'/')),`files 包含 ${need}`);
}
must(pkg.license&&exists('LICENSE'),'license 字段与 LICENSE 文件',pkg.license||'missing');
const peers=pkg.peerDependencies||{};
must(Object.keys(peers).some(k=>k.startsWith('@deepseek-ai/')),'官方 @deepseek-ai/* 在 peerDependencies');
must(!Object.keys(pkg.dependencies||{}).some(k=>k.startsWith('@deepseek-ai/')),'官方宿主包未写入 dependencies');
for(const k of Object.keys(peers).filter(k=>k.startsWith('@deepseek-ai/'))){
  must(/[<>]|rc|\^|~/.test(peers[k]),`peer 范围非裸精确版本：${k}`,peers[k]);
}

// 3.3 cordis.patch.yml
const patch=read('cordis.patch.yml')||'';
must(patch.trim().length>0,'cordis.patch.yml 非空');
must(patch.includes('insert:'),'cordis.patch.yml 使用 insert');
must(patch.includes(`name: ${pkg.name}`),'patch name 指向 npm 包名',pkg.name);
must(/id:\s*[a-z][a-z0-9-]+/.test(patch),'patch 插件条目 id 合法');

// 3.4 服务端入口
const server=read(pkg.exports?.['.']||'dsh/index.js')||'';
must(/export\s+const\s+name\s*=/.test(server),'服务端导出 name');
must(/export\s+const\s+inject\s*=/.test(server),'服务端导出 inject');
must(/export\s+const\s+Config\s*=\s*Schema\./.test(server),'Config 是 Schemastery schema');
must(server.includes('desktopWorkbenchOwnership'),'使用 desktopWorkbenchOwnership 校验归属');
must(server.includes('/api/llm-api-perf/'),'业务路由使用自有前缀');

// 3.5 客户端入口
const clientFile=pkg.exports?.['./client'];
const client=read(clientFile)||'';
const loader=new RegExp("__ModuleLoader__\\.load\\(\\{id:'"+pkg.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"'");
must(loader.test(client),'客户端 loader id 与包名一致',pkg.name);
must(client.includes('desktopWorkbenches.register'),'调用 desktopWorkbenches.register');
must(!/register\(\{[^}]*\bid\s*:/.test(client),'register 未填写旧 id');
must(!client.includes('workbenchId'),'register 未填写旧 workbenchId');
const repo=/\brepository\s*:\s*'(https:\/\/github\.com\/[^']+)'/.exec(client)?.[1];
must(!!repo,'register repository 为规范 GitHub URL',repo||'missing');
const title=/\btitle\s*:\s*'([^']+)'/.exec(client)?.[1];
must(!!title,'register 提供 title',title||'missing');
const width=/businessWidth\s*:\s*([0-9.]+)/.exec(client)?.[1];
must(width===undefined||(Number(width)>=0.25&&Number(width)<=0.7),'layout.businessWidth 在 0.25–0.7',width||'未设置');
must(/ctx\.effect\(\(\)\s*=>\s*ctx\.desktopWorkbenches\.register/.test(client),'register 放入 ctx.effect 管理注销');
must(/return\s*\{\s*apply\s*,\s*inject\s*:\s*\[[^\]]*desktopWorkbenches/.test(client),'客户端 apply 注入 desktopWorkbenches');
must(client.startsWith('window.__ModuleLoader__.load('),'客户端为自包含单文件');

console.log(`\n${failures.length?`FAIL：${failures.length} 项`:'PASS：全部必检/建议项通过'}（${oks.length} 项通过）`);
process.exit(failures.length?1:0);
