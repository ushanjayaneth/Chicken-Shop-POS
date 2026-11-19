import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,extname,isAbsolute} from 'node:path';

// A small local production preview. It never loads build tools or Firebase.
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const host='127.0.0.1',port=Number(process.env.RETAIL_PREVIEW_PORT||4175);
if(!existsSync(resolve(root,'index.html'))){console.error('Run npm run build first.');process.exit(1);}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=createServer((request,response)=>{
 if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{Allow:'GET, HEAD'});response.end();return;}
 let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch{response.writeHead(400);response.end();return;}
 if(pathname.startsWith('/api/')){response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:'The local device workspace is available. A hosted API is required for cloud access.',code:'CLOUD_NOT_CONFIGURED'}));return;}
 let file=resolve(root,'.'+pathname);const within=relative(root,file);
 if(within.startsWith('..')||isAbsolute(within)){response.writeHead(403);response.end();return;}
 if(pathname==='/')file=resolve(root,'index.html');
 if(!existsSync(file)||!statSync(file).isFile()){if((request.headers.accept||'').includes('text/html'))file=resolve(root,'index.html');else{response.writeHead(404);response.end();return;}}
 const stats=statSync(file);response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':stats.size,'Cache-Control':file.endsWith('index.html')||file.endsWith('sw.js')?'no-store':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'});
 if(request.method==='HEAD')response.end();else createReadStream(file).on('error',()=>response.destroy()).pipe(response);
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Open http://localhost:${port}/ or set RETAIL_PREVIEW_PORT.`:error.message);process.exitCode=1;});
server.listen(port,host,()=>console.log(`Mr. Chicken House - Retail and wholesale POS\nOpen http://localhost:${port}/\nKeep this process running while using the local site.`));
