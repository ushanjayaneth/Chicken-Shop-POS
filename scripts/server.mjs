import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import dataHandler from '../api/data.js';
import sessionHandler from '../api/session.js';
import statusHandler from '../api/status.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
export function createPOSServer({api = dataHandler} = {}) {
  return createServer(async(request,response)=>{
    try {
      const url=new URL(request.url,'http://localhost');
      const path=decodeURIComponent(url.pathname);
      if(path === '/api/status' || path === '/api/session' || path === '/api/data' || path.startsWith('/api/data/')) {
        request.query={...Object.fromEntries(url.searchParams),path:path.slice('/api/data/'.length)};
        const chunks=[];let size=0;
        for await(const chunk of request){size+=chunk.length;if(size>4500000){response.writeHead(413);response.end();return;}chunks.push(chunk);}
        if(chunks.length)request.body=JSON.parse(Buffer.concat(chunks).toString());
        response.status=code=>{response.statusCode=code;return response;};
        response.json=value=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));};
        const handler = path === '/api/session' ? sessionHandler : path === '/api/status' ? statusHandler : api;
        await handler(request,response);return;
      }
      if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
      let file=resolve(root,'.'+(path==='/'?'/index.html':path));
      const within=relative(root,file);
      const hiddenOrPrivate = path.split('/').some(part => part.startsWith('.') || /^(node_modules|artifacts)$/i.test(part));
      if (within.startsWith('..') || isAbsolute(within) || hiddenOrPrivate) {
        response.writeHead(403);
        response.end();
        return;
      }
      if(!existsSync(file)||!statSync(file).isFile()){response.writeHead(404);response.end();return;}
      response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      if(request.method==='HEAD')response.end();else createReadStream(file).pipe(response);
    }catch(error){if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'Request could not be completed.'}));}
  });
}