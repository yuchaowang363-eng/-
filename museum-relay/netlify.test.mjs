import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHandler} from './netlify/edge-functions/museum.js';

test('Netlify handler forwards authenticated records, full-size photo uploads, and signed photo downloads',async()=>{
  const room='11111111-1111-4111-8111-111111111111',photo='22222222-2222-4222-8222-222222222222',key='a'.repeat(64);
  const token='test.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
  let sourceOrigin='',lastHeaders,bodyBytes=0,writes=0;
  const source=createServer(async(req,res)=>{
    lastHeaders=req.headers;const url=new URL(req.url,sourceOrigin);
    if(url.pathname.startsWith('/storage/')){
      if(url.searchParams.get('token')!==token){res.writeHead(403);res.end();return}
      res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(Buffer.from([255,216,255,217]));return;
    }
    res.setHeader('Content-Type','application/json');
    if(req.headers['x-museum-key']!==key){res.writeHead(401);res.end('{"error":"denied"}');return}
    if(req.url.endsWith('/state')){res.end(JSON.stringify({photoUrls:{[photo]:`${sourceOrigin}/storage/v1/object/sign/love-museum/${room}/${photo}?token=${token}`}}));return}
    writes++;bodyBytes=0;for await(const chunk of req)bodyBytes+=chunk.length;res.end('{"ok":true}');
  });
  await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));sourceOrigin=`http://127.0.0.1:${source.address().port}`;
  const handler=createHandler({upstream:sourceOrigin+'/functions/v1/museum-api'}),base='https://museum.netlify.app';
  const headers={'X-Museum-Id':room,'X-Museum-Key':key,Origin:'https://yuchaowang363-eng.github.io'};
  const call=(path,options={})=>handler(new Request(base+path,options));
  try{
    assert.equal((await call('/health')).status,200);
    assert.equal((await call('/api/state')).status,401);
    assert.equal((await call('/api/state',{headers:{...headers,'X-Museum-Key':'b'.repeat(64)}})).status,401);
    assert.equal((await call('/api/state',{headers:{...headers,Origin:'https://unrelated.example'}})).status,403);
    let r=await call('/api/state',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),headers.Origin);assert.equal(lastHeaders.origin,undefined);
    const data=await r.json(),url=data.photoUrls[photo];assert.ok(url.startsWith(base+'/media/'));
    r=await handler(new Request(url));assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, max-age=900');assert.equal(r.headers.get('Vary'),'Origin');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([255,216,255,217]));assert.equal(lastHeaders['x-museum-key'],undefined);
    r=await handler(new Request(url,{headers:{Origin:headers.Origin}}));assert.equal(r.headers.get('Access-Control-Allow-Origin'),headers.Origin);assert.equal(r.headers.get('Vary'),'Origin');
    const denied=await handler(new Request(url.replace('token=','token=invalid')));assert.equal(denied.status,403);assert.equal(denied.headers.get('Cache-Control'),'private, no-store');
    const payload=new Uint8Array(5*1024*1024+300);
    r=await call('/api/photos',{method:'POST',headers:{...headers,'Content-Type':'multipart/form-data; boundary=test'},body:payload});assert.equal(r.status,200);assert.equal(bodyBytes,payload.byteLength);assert.equal(writes,1);assert.equal(lastHeaders['content-type'],'multipart/form-data; boundary=test');
    assert.equal((await call('/api/photos',{method:'POST',headers,body:new Uint8Array(8*1024*1024+1)})).status,413);assert.equal(writes,1);
    assert.equal((await call('/api/state',{method:'OPTIONS',headers:{Origin:headers.Origin}})).status,204);
    assert.equal((await call('/media/https://unrelated.example/file')).status,404);
  }finally{await new Promise(resolve=>source.close(resolve))}
});
