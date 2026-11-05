import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const port=Number(process.env.RESONANCE_PORT||8796),host=process.env.RESONANCE_HOST||'127.0.0.1';
createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(path!==root.slice(0,-1)&&!path.startsWith(root))throw Error('path');
  const file=path.endsWith(sep)||path===root.slice(0,-1)?resolve(path,'index.html'):path;
  const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wav':'audio/wav','.md':'text/plain'}[extname(file)]||'application/octet-stream'),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,host,()=>console.log(`Resonance server listening on port ${port}; bind ${host}`));
