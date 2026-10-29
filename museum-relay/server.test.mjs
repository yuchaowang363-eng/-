import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRelay } from './server.mjs';

const ROOM='11111111-1111-4111-8111-111111111111',PHOTO='22222222-2222-4222-8222-222222222222',KEY='a'.repeat(64);
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>server.close(resolve));

test('API and private photo relay preserve access checks and never turn into an arbitrary proxy',async()=>{
  let sourceOrigin='',writes=0,lastHeaders;
  const source=createServer(async(req,res)=>{
    const url=new URL(req.url,sourceOrigin);lastHeaders=req.headers;
    if(url.pathname.startsWith('/storage/')){
      if(url.pathname!==`/storage/v1/object/sign/love-museum/${ROOM}/${PHOTO}`||url.searchParams.get('token')!=='valid.signed.token'){res.writeHead(403);res.end();return}
      res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(Buffer.from([255,216,255,217]));return;
    }
    if(req.headers['x-museum-key']!==KEY){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"denied"}');return}
    if(req.method!=='GET')writes++;
    if(url.pathname.endsWith('/state')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({start:'2025-05-22',memories:[],photoUrls:{[PHOTO]:`${sourceOrigin}/storage/v1/object/sign/love-museum/${ROOM}/${PHOTO}?token=valid.signed.token`}}));return}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,method:req.method,body:Buffer.concat(chunks).toString()}));
  });
  sourceOrigin=await listen(source);
  const relay=createRelay({upstream:sourceOrigin+'/functions/v1/museum-api',publicOrigin:'https://museum.example',pageOrigin:'https://pages.example'});
  const base=await listen(relay),headers={'X-Museum-Id':ROOM,'X-Museum-Key':KEY,'Origin':'https://pages.example'};
  try{
    let r=await fetch(base+'/health');assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
    r=await fetch(base+'/api/state');assert.equal(r.status,401);
    r=await fetch(base+'/api/state',{headers:{...headers,'X-Museum-Key':'b'.repeat(64)}});assert.equal(r.status,401);
    r=await fetch(base+'/api/state',{headers:{...headers,Origin:'https://unrelated.example'}});assert.equal(r.status,403);
    r=await fetch(base+'/api/state',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://pages.example');
    const data=await r.json();assert.equal(data.start,'2025-05-22');assert.equal(data.photoUrls[PHOTO],`https://museum.example/media/${ROOM}/${PHOTO}?token=valid.signed.token`);assert.equal(lastHeaders.origin,undefined);
    r=await fetch(base+'/api/settings',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:'{"start":"2025-05-22"}'});assert.equal((await r.json()).body,'{"start":"2025-05-22"}');assert.equal(writes,1);
    r=await fetch(base+`/media/${ROOM}/${PHOTO}?token=valid.signed.token`);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([255,216,255,217]));assert.equal(lastHeaders['x-museum-key'],undefined);
    r=await fetch(base+`/media/${ROOM}/${PHOTO}?token=invalid`);assert.equal(r.status,403);
    r=await fetch(base+'/media/https://unrelated.example/anything?token=valid.signed.token');assert.equal(r.status,404);
    r=await fetch(base+'/api/state',{method:'OPTIONS',headers:{Origin:'https://pages.example'}});assert.equal(r.status,204);
  }finally{await close(relay);await close(source)}
});
