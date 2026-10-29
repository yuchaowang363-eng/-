import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const UPSTREAM='https://bztxclbwarifoctfwznu.supabase.co/functions/v1/museum-api';
const PAGE_ORIGIN='https://yuchaowang363-eng.github.io';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const API_PATH=new RegExp(`^/api/(?:state|settings|import|(?:photos|memories|anniversaries)(?:/${UUID})?)$`,'i');
const MEDIA_PATH=new RegExp(`^/media/(${UUID})/(${UUID})$`,'i');
const ROOM_ID=new RegExp(`^${UUID}$`,'i');
const KEY=/^[0-9a-f]{64}$/i;
const MAX_BODY=8*1024*1024;

function readBody(req){return new Promise((resolve,reject)=>{let size=0,tooLarge=false;const chunks=[];req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){tooLarge=true;chunks.length=0}else if(!tooLarge)chunks.push(chunk)});req.on('end',()=>tooLarge?reject(Object.assign(new Error('Request too large'),{status:413})):resolve(Buffer.concat(chunks)));req.on('error',reject)})}
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))}
function photoReference(url,storageOrigin){const parsed=new URL(url);const match=parsed.pathname.match(new RegExp(`^/storage/v1/object/sign/love-museum/(${UUID})/(${UUID})$`,'i'));if(parsed.origin!==storageOrigin||!match||!parsed.searchParams.get('token'))throw new Error('Unexpected photo location');return {room:match[1],photo:match[2],token:parsed.searchParams.get('token')}}

// Dependency injection is only for the local test fixture; requests cannot choose upstreams.
export function createRelay({upstream=UPSTREAM,publicOrigin=process.env.RENDER_EXTERNAL_URL||'',pageOrigin=PAGE_ORIGIN}={}){
  const target=new URL(upstream),storageOrigin=target.origin;
  return createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(origin===pageOrigin||origin===publicOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
    res.setHeader('Access-Control-Allow-Headers','content-type,x-museum-id,x-museum-key,x-museum-revision');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Max-Age','3600');
    if(origin&&origin!==pageOrigin&&origin!==publicOrigin){json(res,403,{error:'请从博物馆网页访问。'});return}
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
    const url=new URL(req.url,'http://relay.local');
    if(url.pathname==='/health'&&req.method==='GET'){json(res,200,{ok:true,message:'博物馆连接服务正常'});return}
    try{
      const media=url.pathname.match(MEDIA_PATH);
      if(media&&req.method==='GET'){
        const token=url.searchParams.get('token')||'';
        if(!/^[A-Za-z0-9._-]{1,4096}$/.test(token)){json(res,401,{error:'照片访问凭证不正确。'});return}
        // The original storage service verifies the signed token and exact object path.
        // No service-role key or museum invitation key is used for picture downloads.
        const source=new URL(`/storage/v1/object/sign/love-museum/${media[1]}/${media[2]}`,storageOrigin);source.searchParams.set('token',token);
        const response=await fetch(source,{redirect:'error'});
        if(!response.ok){json(res,response.status,{error:'照片暂时无法读取，请重新打开博物馆。'});return}
        const type=response.headers.get('Content-Type')?.split(';')[0];
        if(!['image/jpeg','image/png','image/webp'].includes(type))throw new Error('Unexpected photo type');
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();return;
      }
      if(!API_PATH.test(url.pathname)||!['GET','POST','PUT','PATCH','DELETE'].includes(req.method)){json(res,404,{error:'没有找到这个页面。'});return}
      const room=req.headers['x-museum-id']||'',key=req.headers['x-museum-key']||'';
      if(!ROOM_ID.test(room)||!KEY.test(key)){json(res,401,{error:'请使用专属邀请链接进入博物馆。'});return}
      if(Number(req.headers['content-length'])>MAX_BODY){json(res,413,{error:'这次提交的内容过大。'});req.resume();return}
      const headers={'X-Museum-Id':room,'X-Museum-Key':key};
      if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
      if(req.headers['x-museum-revision'])headers['X-Museum-Revision']=req.headers['x-museum-revision'];
      const body=['GET','HEAD'].includes(req.method)?undefined:await readBody(req);
      const response=await fetch(upstream+url.pathname.slice('/api'.length),{method:req.method,headers,body,redirect:'error'});
      const result=await response.json();
      if(result.photoUrls&&response.ok){
        if(!publicOrigin)throw new Error('Public relay URL is not configured');
        const rewritten={};for(const [id,location] of Object.entries(result.photoUrls)){
          const ref=photoReference(location,storageOrigin);
          if(ref.room!==room||ref.photo!==id)throw new Error('Unexpected photo reference');
          rewritten[id]=`${publicOrigin}/media/${ref.room}/${ref.photo}?token=${encodeURIComponent(ref.token)}`;
        }result.photoUrls=rewritten;
      }
      json(res,response.status,result);
    }catch(error){
      // Never log request headers, private links, tokens, or upstream response bodies.
      console.error('Museum connection failed:',error.status||error.code||error.name||'unknown');
      if(!res.headersSent)json(res,error.status||502,{error:error.status===413?'这次提交的内容过大。':'云端连接暂时未完成，请保留编辑内容并稍后重试。'});else res.destroy();
    }
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||10000);
  createRelay().listen(port,'0.0.0.0',()=>console.log(`Museum connection listening on port ${port}`));
}
