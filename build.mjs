import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const css=readFileSync(new URL('./src/panel.css',import.meta.url),'utf8');
const js=readFileSync(new URL('./src/panel.js',import.meta.url),'utf8');
if(!js.includes('__CSS__')) throw new Error('src/panel.js is missing the __CSS__ placeholder');
mkdirSync(new URL('./lib',import.meta.url),{recursive:true});
writeFileSync(new URL('./lib/client.js',import.meta.url),js.replace('__CSS__',JSON.stringify(css)));
console.log('Built self-contained client bundle (lib/client.js)');
