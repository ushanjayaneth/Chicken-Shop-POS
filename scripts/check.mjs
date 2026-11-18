import {readFileSync, readdirSync} from 'node:fs';
import vm from 'node:vm';
const files = readdirSync('.').filter(file => file.endsWith('.js') && !file.includes('qrcode'));
for (const file of files) new vm.Script(readFileSync(file, 'utf8'), {filename: file});
const html = readFileSync('index.html', 'utf8');
let count = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  new vm.Script(match[2], {filename: `index.html script ${++count}`});
}
console.log(`Checked ${files.length} JavaScript files and ${count} inline scripts.`);