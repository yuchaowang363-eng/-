const UPSTREAM='https://bztxclbwarifoctfwznu.supabase.co/functions/v1/museum-api';
const PAGE_ORIGIN='https://yuchaowang363-eng.github.io';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const API_PATH=new RegExp(`^/api/(?:state|settings|import|(?:photos|memories|anniversaries)(?:/${UUID})?)$`,'i');
const MEDIA_PATH=new RegExp(`^/media/(${UUID})/(${UUID})$`,'i');
const ROOM_ID=new RegExp(`^${UUID}$`,'i');
const MAX_BODY=8*1024*1024;

// Options are supplied only by the local test fixture, never by HTTP callers.
export function createHandler({upstream=UPSTREAM,pageOrigin=PAGE_ORIGIN}={}){
  const storageOrigin=new URL(upstream).origin;
  return async function handler(request){
    const url=new URL(request.url),origin=request.headers.get('Origin');
    const cors=new Headers({'Access-Control-Allow-Headers':'content-type,x-museum-id,x-museum-key,x-museum-revision','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Max-Age':'3600','Cache-Control':'private, no-store'});
    if(origin===pageOrigin||origin===url.origin){cors.set('Access-Control-Allow-Origin',origin);cors.set('Vary','Origin')}
    const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:new Headers([...cors,['Content-Type','application/json; charset=utf-8']])});
    if(origin&&origin!==pageOrigin&&origin!==url.origin)return json(403,{error:'请从博物馆网页访问。'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(url.pathname==='/health'&&request.method==='GET')return json(200,{ok:true,message:'博物馆连接服务正常'});
    try{
      const media=url.pathname.match(MEDIA_PATH);
      if(media&&request.method==='GET'){
        const token=url.searchParams.get('token')||'';
        if(!/^[A-Za-z0-9._-]{1,4096}$/.test(token))return json(401,{error:'照片访问凭证不正确。'});
        const source=new URL(`/storage/v1/object/sign/love-museum/${media[1]}/${media[2]}`,storageOrigin);source.searchParams.set('token',token);
        // Storage validates the signature, object path, and expiry. No admin key is used.
        const response=await fetch(source,{redirect:'error'});
        if(!response.ok)return json(response.status,{error:'照片暂时无法读取，请重新打开博物馆。'});
        const type=response.headers.get('Content-Type')?.split(';')[0];
        if(!['image/jpeg','image/png','image/webp'].includes(type))throw new Error('Unexpected photo type');
        const headers=new Headers(cors);headers.set('Content-Type',type);headers.set('X-Content-Type-Options','nosniff');
        // Cache only in this visitor's browser and never beyond the signed URL's expiry.
        let maxAge=0;try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const payload=JSON.parse(atob(part));maxAge=Math.max(0,Math.min(900,Math.floor(Number(payload.exp)-Date.now()/1000-30)))||0}catch{}
        headers.set('Cache-Control',`private, max-age=${maxAge}`);
        return new Response(response.body,{headers});
      }
      if(!API_PATH.test(url.pathname)||!['GET','POST','PUT','PATCH','DELETE'].includes(request.method))return json(404,{error:'没有找到这个页面。'});
      const room=request.headers.get('X-Museum-Id')||'',key=request.headers.get('X-Museum-Key')||'';
      if(!ROOM_ID.test(room)||!/^[0-9a-f]{64}$/i.test(key))return json(401,{error:'请使用专属邀请链接进入博物馆。'});
      if(Number(request.headers.get('Content-Length'))>MAX_BODY)return json(413,{error:'这次提交的内容过大。'});
      const headers=new Headers({'X-Museum-Id':room,'X-Museum-Key':key});
      for(const name of ['Content-Type','X-Museum-Revision'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
      let body;
      if(request.method!=='GET'){
        const reader=request.body?.getReader(),chunks=[];let size=0;
        if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return json(413,{error:'这次提交的内容过大。'})}chunks.push(value)}
        body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength}
      }
      const response=await fetch(upstream+url.pathname.slice('/api'.length),{method:request.method,headers,body,redirect:'error'});
      const result=await response.json();
      if(result.photoUrls&&response.ok){
        const rewritten={};
        for(const [id,location] of Object.entries(result.photoUrls)){
          const photo=new URL(location),match=photo.pathname.match(new RegExp(`^/storage/v1/object/sign/love-museum/(${UUID})/(${UUID})$`,'i')),token=photo.searchParams.get('token');
          if(photo.origin!==storageOrigin||!match||match[1]!==room||match[2]!==id||!token)throw new Error('Unexpected photo location');
          rewritten[id]=`${url.origin}/media/${match[1]}/${match[2]}?token=${encodeURIComponent(token)}`;
        }result.photoUrls=rewritten;
      }
      return json(response.status,result);
    }catch(error){
      // Do not log headers, photo tokens, invitation links, or upstream response bodies.
      console.error('Museum connection failed:',error.name||'unknown');
      return json(502,{error:'云端连接暂时未完成，请保留编辑内容并稍后重试。'});
    }
  };
}

export default createHandler();
