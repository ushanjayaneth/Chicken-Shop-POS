import './check.mjs';
import {copyFileSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

const serviceWorker = readFileSync('sw.js', 'utf8');
const entries = serviceWorker.match(/^const STATIC\s*=\s*\[(.*)]\s*;/m)?.[1];
if (!entries) throw new Error('The offline asset list is missing.');
const files = [...entries.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]);
for (const file of [...new Set([...files, 'index.html', 'sw.js'])]) {
  const destination = resolve('public', file);
  mkdirSync(dirname(destination), {recursive:true});
  copyFileSync(file, destination);
}
console.log('Prepared ' + (new Set([...files,'index.html','sw.js'])).size + ' browser assets in public/.');
