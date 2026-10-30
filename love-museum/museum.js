'use strict';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

const TYPES=['日常','约会','旅行','书信'];
const VIEWS=['home','timeline','album','events','letters'];
let state={start:'',covers:[],memories:[],anniversaries:[]};
let loaded=false,saving=false,view='home',filter='all',query='',lastCalendarDay='';
let editingId=null,detailId=null,eventId=null,deleteEventId=null;
let pendingPhotos=[],coverIndex=0,pendingCover=null,backup=null,lightbox=[],lightboxIndex=0;
let draft=null,processingPhotos=false;
let stateVersion=0;
const uploadedPreviews=new Map();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function node(tag,cls,content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=content;return el}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function day(value){const [y,m,d]=value.split('-').map(Number);return Date.UTC(y,m-1,d)}
function dateText(value){return value.replaceAll('-',' / ')}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}
function photoUrl(id){return uploadedPreviews.get(id)?.url||state.photoUrls?.[id]||''}
function setPhoto(img,id){img.dataset.photoId=id;const source=photoUrl(id);if(source&&img.getAttribute('src')!==source)img.src=source}
function releasePreview(url){if(url&&![...uploadedPreviews.values()].some(p=>p.url===url))URL.revokeObjectURL(url)}
function settlePreviews(){for(const [id,preview] of uploadedPreviews){const used=state.covers.includes(id)||state.memories.some(m=>m.photos.includes(id));if(!used&&!$$('dialog[open]').length){uploadedPreviews.delete(id);URL.revokeObjectURL(preview.url);continue}const remote=state.photoUrls?.[id];if(!remote||preview.loading)continue;preview.loading=true;const image=new Image();image.src=remote;image.decode().then(()=>{if(uploadedPreviews.get(id)!==preview)return;uploadedPreviews.delete(id);for(const img of $$('img[data-photo-id]'))if(img.dataset.photoId===id)img.src=remote;URL.revokeObjectURL(preview.url)}).catch(()=>{preview.loading=false})}}
function toast(message){$('#toast').textContent=message;$('#toast').classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.add('hidden'),3300)}
function status(text,kind='saved'){$('#save-state').textContent=text;$('#save-state').dataset.state=kind}
async function api(path,options={}){return window.museumStorage.api(path,options)}
const send=(path,body,method='POST')=>api(path,{method,body:JSON.stringify(body)});
async function loadState(initial=false){
  const version=stateVersion;
  try{
    const fresh=await api('state');if(version!==stateVersion)return;if(fresh===state&&loaded&&lastCalendarDay===today()){status('云端已同步');return}state=fresh;loaded=true;document.body.classList.remove('is-loading','needs-invite');$('#entry-gate').classList.add('hidden');$('#load-banner').classList.add('hidden');
    render();settlePreviews();lastCalendarDay=today();status('云端已同步');if(initial)checkDraft();
  }catch(error){
    if(version!==stateVersion)return;if(!initial)throw error;if(error.code==='NEEDS_INVITE'){document.body.classList.add('needs-invite');$('#entry-gate').classList.remove('hidden');$('#entry-error').textContent=error.message;status('等待专属邀请');return}
    const banner=$('#load-banner');banner.classList.remove('hidden');banner.dataset.loading='false';banner.classList.add('error-banner');banner.replaceChildren();
    banner.append(node('span','',error.message));
    const retry=node('button','','重新打开');retry.onclick=()=>loadState(true);banner.append(retry);status('尚未连接','error');
  }
}
async function saveAction(dialog,button,errorSelector,work,message){
  if(saving)return; saving=true;stateVersion++;status('正在保存…','saving');const oldLabel=button.textContent;button.disabled=true;button.textContent='正在保存…';
  if(dialog)dialog.classList.add('modal-busy');if(errorSelector)$(errorSelector).textContent='';
  const controls=dialog?[...dialog.querySelectorAll('input,select,textarea,button')].filter(el=>el!==button).map(el=>({el,disabled:el.disabled})):[];for(const c of controls)c.el.disabled=true;
  let wrote=false;
  try{const commit=await work();wrote=true;if(typeof commit==='function'){commit();stateVersion++;render()}else await loadState();if(dialog)dialog.close();status('云端已同步');toast(message||'已经好好收藏。');return true}
  catch(error){const message=wrote?'内容已保存，但暂时无法刷新页面。请重新打开检查。':error.message;if(errorSelector)$(errorSelector).textContent=message;else toast(message);status(wrote?'已保存，等待刷新':'暂未保存','error');return false}
  finally{saving=false;button.disabled=false;button.textContent=oldLabel;for(const c of controls)c.el.disabled=c.disabled;if(dialog)dialog.classList.remove('modal-busy');if(errorSelector==='#memory-error')$('#memory-progress').textContent=''}
}
function showDialog(selector){if(!loaded){toast('请先连接博物馆。');return false}const d=$(selector);if(!d.open)d.showModal();return true}
function fitMemoryViewport(){if(!window.visualViewport)return;document.documentElement.style.setProperty('--dialog-height',window.visualViewport.height+'px');document.documentElement.style.setProperty('--dialog-top',window.visualViewport.offsetTop+'px')}
fitMemoryViewport();window.visualViewport?.addEventListener('resize',fitMemoryViewport);window.visualViewport?.addEventListener('scroll',fitMemoryViewport);
function setView(next){if(!VIEWS.includes(next))next='home';view=next;filter=next==='letters'?'书信':'all';query='';$('#search').value='';render();window.scrollTo({top:0,behavior:'instant'})}
function countPhotos(){return new Set([...state.covers,...state.memories.flatMap(m=>m.photos)].filter(Boolean)).size}
function render(){
  $('#home-hero').classList.toggle('hidden',view!=='home');$('#home-summary').classList.toggle('hidden',view!=='home');
  $('#collection-view').classList.toggle('hidden',!['home','timeline','letters'].includes(view));
  $('#collection-view').classList.toggle('timeline',view==='timeline');$('#album-view').classList.toggle('hidden',view!=='album');$('#events-view').classList.toggle('hidden',view!=='events');
  $('#letters-teaser').classList.toggle('hidden',view!=='home');
  $$('.app-header nav [data-view]').forEach(a=>{if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  $('#days-title').textContent=state.start?`相爱的第 ${Math.floor((day(today())-day(state.start))/86400000)+1} 天`:'我们的故事，从哪一天开始？';
  $('#days-caption').textContent=state.start?`从 ${dateText(state.start)} 开始，往后每一天都有你。`:'记下相恋的日期，让每一天都有名字。';
  $('#set-date').textContent=state.start?'修改相恋日':'设置相恋日';
  $('#total-memories').textContent=state.memories.length;$('#total-photos').textContent=countPhotos();$('#total-letters').textContent=state.memories.filter(m=>m.category==='书信').length;
  $('.backup-note').textContent='照片与回忆保存在你们的私有云端，通过邀请链接在两台手机间自动同步。备份含私人照片和专属邀请链接，请妥善保存。';
  $('#home-hero .primary').innerHTML='<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  $('#home-hero .primary').append(document.createTextNode(state.memories.length?'收藏新的回忆':'收藏第一段回忆'));
  $$('.polaroid[data-cover]').forEach(frame=>{const index=Number(frame.dataset.cover),id=state.covers[index],scene=frame.querySelector('.landscape');scene.classList.toggle('has-photo',!!id);if(id){let img=scene.querySelector('img');if(!img){img=node('img');img.alt=`王宇超和卓如怡的第${index+1}张封面照片`;scene.prepend(img)}setPhoto(img,id)}else scene.querySelector('img')?.remove();frame.querySelector('.scene-label').textContent=id?'更换这张合照':'放入我们的照片'});
  renderCollection();renderAlbum();renderEvents();
}
function renderCollection(){
  const letters=view==='letters';$('#collection-title').textContent=letters?'写给彼此的信':view==='timeline'?'我们的时光轴':'值得珍藏的瞬间';
  $('#collection-heading').classList.toggle('page-heading',view!=='home');
  const add=$('#collection-heading [data-add]');add.dataset.add=letters?'书信':'日常';add.textContent=letters?'＋ 写一封信':'＋ 添加回忆';
  const base=state.memories.filter(m=>!letters||m.category==='书信');
  const list=base.filter(m=>(filter==='all'||m.category===filter)&&(!query||`${m.title}\n${m.story}\n${m.place}\n${m.date}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date)||(b.updatedAt||'').localeCompare(a.updatedAt||''));
  $('#memory-count').textContent=base.length?`已珍藏 ${base.length} ${letters?'封书信':'段回忆'}`:letters?'把藏在心里的话，慢慢写给对方。':'第一件藏品，等你亲手放进来';
  $$('.filter').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.filter===filter));b.classList.toggle('hidden',letters)});
  const grid=$('#memory-grid');grid.replaceChildren();
  for(const item of list){
    const card=node('button','memory-card'+(item.photos.length?'':' no-photo'));card.type='button';card.setAttribute('aria-label',`查看回忆：${item.title}`);
    if(item.photos.length){const img=node('img','memory-image');setPhoto(img,item.photos[0]);img.alt=item.title;img.loading='lazy';card.append(img);if(item.photos.length>1)card.append(node('span','photo-count',`${item.photos.length} 张照片`))}
    const copy=node('div','memory-copy'),top=node('div','memory-topline');top.append(node('small','',dateText(item.date)),node('span','memory-tag',item.category));
    copy.append(top,node('h3','',item.title));if(item.story)copy.append(node('p','',item.story));if(item.place)copy.append(node('div','memory-place','地点：'+item.place));card.append(copy);card.onclick=()=>openDetail(item.id);grid.append(card);
  }
  const originalEmpty=loaded&&state.memories.length===0&&view==='home'&&!query&&filter==='all';
  $('#empty-grid').classList.toggle('hidden',!originalEmpty);$('#no-results').classList.toggle('hidden',!loaded||list.length>0||originalEmpty);
  $('#no-results-title').textContent=letters&&!base.length?'有些话，只想说给你听。':'这里还没有找到回忆';
  $('#no-results-text').textContent=letters&&!base.length?'写给此刻的你，也写给很久以后的我们。':'换个分类或关键词，或亲手收藏一段新故事。';
  $('#no-results [data-add]').dataset.add=letters?'书信':'日常';$('#no-results [data-add]').textContent=letters?'写第一封信':'收藏一段回忆';
  $('#collection-note').classList.toggle('hidden',!originalEmpty);
}
function allPhotos(){const result=[],seen=new Set();for(const m of [...state.memories].sort((a,b)=>b.date.localeCompare(a.date)))for(const id of m.photos){if(!seen.has(id)){result.push({id,title:m.title,date:m.date,memoryId:m.id});seen.add(id)}}for(const id of state.covers.filter(Boolean))if(!seen.has(id)){result.push({id,title:'我们的首页合照',date:state.start||'',memoryId:null});seen.add(id)}return result}
function renderAlbum(){const photos=allPhotos(),grid=$('#album-grid');grid.replaceChildren();$('#album-count').textContent=photos.length?`共 ${photos.length} 张照片，每一张都和你有关。`:'把一起看过的世界，装进相册。';$('#album-empty').classList.toggle('hidden',photos.length>0);photos.forEach((photo,i)=>{const card=node('button','album-photo'),img=node('img');setPhoto(img,photo.id);img.alt=photo.title;img.loading='lazy';card.append(img,node('p','',photo.title),node('small','',photo.date?dateText(photo.date):'我们的合照'));card.onclick=()=>openLightbox(photos,i);grid.append(card)})}
function occurrence(item){
  if(!item.annual)return item.date;
  const now=today(),year=Number(now.slice(0,4)),month=Number(item.date.slice(5,7)),originalDay=Number(item.date.slice(8,10));
  const at=y=>`${y}-${String(month).padStart(2,'0')}-${String(Math.min(originalDay,new Date(y,month,0).getDate())).padStart(2,'0')}`;
  const date=at(year);return date<now?at(year+1):date;
}
function eventItems(){const events=[...state.anniversaries];if(state.start)events.push({id:'relationship',title:'我们的相恋纪念日',date:state.start,annual:true});return events.map(e=>({...e,next:occurrence(e),remaining:Math.round((day(occurrence(e))-day(today()))/86400000)})).sort((a,b)=>(a.remaining<0)-(b.remaining<0)||a.remaining-b.remaining)}
function eventCard(item,compact=false){
  const card=node('article','anniversary-card');card.append(node('div','event-label',item.id==='relationship'?'属于我们的日子':item.annual?'每年都要记住':'一起期待的日子'),node('h3','',item.title));
  const count=node('span','countdown',item.remaining===0?'今天':String(Math.abs(item.remaining)));if(item.remaining!==0)count.append(node('small','',item.remaining>0?'天后':'天前'));card.append(count);
  card.append(node('p','',`${dateText(item.next)}${item.annual?' · 每年重复':''}`));
  if(!compact){const edit=node('button','',item.id==='relationship'?'修改相恋日':'编辑');edit.onclick=()=>item.id==='relationship'?openDate():openEvent(item.id);card.append(edit);if(item.id!=='relationship'){const remove=node('button','','删除');remove.onclick=()=>{deleteEventId=item.id;$('#confirm-text').textContent=`“${item.title}”将从纪念日中移除，此操作无法撤销。`;$('#confirm-error').textContent='';showDialog('#confirm-dialog')};card.append(remove)}}
  return card;
}
function renderEvents(){const events=eventItems(),grid=$('#events-list');grid.replaceChildren();events.forEach(e=>grid.append(eventCard(e)));$('#events-empty').classList.toggle('hidden',events.length>0);const upcoming=events.filter(e=>e.remaining>=0).slice(0,3);$('#upcoming').classList.toggle('hidden',view!=='home'||!upcoming.length);$('#upcoming-list').replaceChildren();upcoming.forEach(e=>$('#upcoming-list').append(eventCard(e,true)))}
function resetPhotos(){for(const p of pendingPhotos)releasePreview(p.localUrl);pendingPhotos=[]}
function openMemory(category='日常',item=null){
  if(!showDialog('#memory-dialog'))return;resetPhotos();editingId=item?.id||crypto.randomUUID();const f=$('#memory-form');f.reset();
  f.elements.title.value=item?.title||'';f.elements.date.value=item?.date||today();f.elements.date.max=today();f.elements.category.value=item?.category||category;f.elements.story.value=item?.story||'';f.elements.place.value=item?.place||'';
  pendingPhotos=(item?.photos||[]).map(id=>({id}));$('#memory-dialog-title').textContent=item?'把这段回忆写得更完整':category==='书信'?'有些话，只想说给你听。':'收藏一段我们的故事';$('#memory-error').textContent='';$('#memory-progress').textContent='';$('#memory-dialog .memory-fields').scrollTop=0;renderPending();
}
function renderPending(){const total=pendingPhotos.reduce((sum,p)=>sum+(p.blob?.size||0),0);$('#memory-photo-summary').textContent=pendingPhotos.length?`已选 ${pendingPhotos.length}/6 张${total?' · 优化后约 '+Math.ceil(total/1024)+' KB':''}`:'最多 6 张。照片会先优化大小，再保存到你们的云端。';const grid=$('#photo-previews');grid.replaceChildren();pendingPhotos.forEach((photo,i)=>{const wrap=node('div','photo-preview'),img=node('img');if(photo.id)setPhoto(img,photo.id);else img.src=photo.localUrl;img.alt=`待保存照片 ${i+1}`;const remove=node('button','remove-photo','×');remove.type='button';remove.setAttribute('aria-label',`移除第 ${i+1} 张照片`);remove.onclick=()=>{if(photo.localUrl)releasePreview(photo.localUrl);pendingPhotos.splice(i,1);renderPending()};wrap.append(img,remove);grid.append(wrap)});$('#pick-photos').disabled=pendingPhotos.length>=6||processingPhotos}
async function compress(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 照片。');
  if(file.size>25*1024*1024)throw new Error('这张照片大于 25MB，请先调整大小。');
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();if(file.type==='image/jpeg'&&file.size<450*1024&&Math.max(image.width,image.height)<=1600)return file;const scale=Math.min(1,1600/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));if(blob?.size>700*1024)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.64));if(!blob||blob.size>5*1024*1024)throw new Error('照片处理后仍然过大，请选择较小的照片。');return blob}
  catch(error){throw new Error(error.message==='The source image cannot be decoded.'?'这张照片暂时无法打开，请换成 JPG 或 PNG。':error.message)}
  finally{URL.revokeObjectURL(url)}
}
async function upload(photo){if(photo.id)return photo.id;const form=new FormData();form.append('photo',photo.blob,'our-memory.jpg');const result=await api('photos',{method:'POST',body:form});photo.id=result.id;if(photo.localUrl)uploadedPreviews.set(result.id,{url:photo.localUrl});return result.id}
async function uploadPhotos(photos){const ids=new Array(photos.length);let next=0,done=0;const work=async()=>{while(next<photos.length){const index=next++;ids[index]=await upload(photos[index]);done++;$('#memory-progress').textContent=`照片已上传 ${done}/${photos.length} 张…`}};$('#memory-progress').textContent=photos.length?`正在上传 ${photos.length} 张照片…`:'';const results=await Promise.allSettled(Array.from({length:Math.min(2,photos.length)},work));const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;$('#memory-progress').textContent='正在收藏故事…';return ids}
function openDate(){if(!loaded)return;$('#settings-dialog').close();if(!showDialog('#date-dialog'))return;const f=$('#date-form');f.elements.start.value=state.start;f.elements.start.max=today();$('#date-error').textContent=''}
function openDetail(id){const item=state.memories.find(m=>m.id===id);if(!item)return;detailId=id;$('#detail-title').textContent=item.title;$('#detail-date').textContent=`${dateText(item.date)} / ${item.category}`;$('#detail-story').textContent=item.story;$('#detail-place').textContent=item.place?'地点：'+item.place:'';$('#delete-confirm').classList.add('hidden');$('#delete-memory').textContent='删除这段记录';$('#detail-error').textContent='';const grid=$('#detail-photos');grid.replaceChildren();const photos=item.photos.map(id=>({id,title:item.title,date:item.date}));photos.forEach((photo,i)=>{const button=node('button'),img=node('img');setPhoto(img,photo.id);img.alt=item.title;button.append(img);button.onclick=()=>openLightbox(photos,i);grid.append(button)});showDialog('#detail-dialog')}
function openEvent(id=null){if(!showDialog('#event-dialog'))return;const item=state.anniversaries.find(e=>e.id===id);eventId=item?.id||crypto.randomUUID();const f=$('#event-form');f.reset();f.elements.title.value=item?.title||'';f.elements.date.value=item?.date||today();f.elements.annual.checked=item?.annual??true;$('#event-error').textContent='';$('#event-dialog-title').textContent=item?'把这个日子记得更准确':'收藏一个特别的日子'}
function openCover(index){if(!showDialog('#cover-dialog'))return;coverIndex=index;releasePreview(pendingCover?.localUrl);pendingCover=state.covers[index]?{id:state.covers[index]}:null;$('#cover-error').textContent='';renderCover()}
function renderCover(){const grid=$('#cover-preview');grid.replaceChildren();if(pendingCover){const img=node('img');if(pendingCover.id)setPhoto(img,pendingCover.id);else img.src=pendingCover.localUrl;img.alt='首页照片预览';grid.append(img)}else grid.append(node('p','muted','这里还没有照片，选一张你们喜欢的合照吧。'));$('#remove-cover').disabled=!pendingCover}
function openLightbox(photos,index){lightbox=photos;lightboxIndex=index;renderLightbox();showDialog('#image-dialog')}
function renderLightbox(){const p=lightbox[lightboxIndex];setPhoto($('#lightbox-image'),p.id);$('#lightbox-image').alt=p.title;$('#image-title').textContent=p.title;$('#image-number').textContent=`${lightboxIndex+1} / ${lightbox.length}`;$('#previous-photo').disabled=lightboxIndex===0;$('#next-photo').disabled=lightboxIndex===lightbox.length-1}
function checkDraft(){try{const raw=localStorage.getItem('wuy-zry-love-museum-draft-v1');if(!raw)return;const value=JSON.parse(raw);if(!Array.isArray(value.memories))return;draft=value;const ids=new Set(state.memories.map(m=>m.id));const count=value.memories.filter(m=>!ids.has(m.id)).length;if(count||value.start&&!state.start){$('#migration-message').textContent=`找到之前初稿里的 ${count} 段未收藏回忆${value.start&&!state.start?'和相恋日':''}，要带进正式展馆吗？`;$('#migration-banner').classList.remove('hidden')}else $('#migration-banner').classList.add('hidden')}catch{}}
function validateBackup(value){
  if(!value||!Array.isArray(value.memories)||value.memories.length>5000)throw new Error('这不是本馆支持的备份文件。');
  const memories=value.memories.map(m=>{
    if(!m||!uuid.test(m.id)||typeof m.title!=='string'||!m.title.trim()||m.title.length>120||!validDate(m.date)||m.date>today()||!TYPES.includes(m.category)||typeof m.story!=='string'||m.story.length>20000||typeof(m.place??'')!=='string'||(m.place||'').length>120)throw new Error('备份中的回忆格式不完整，未导入任何内容。');
    const photos=m.photos??[];if(!Array.isArray(photos)||photos.length>6||photos.some(x=>typeof x!=='string'||!uuid.test(x))||(!m.story.trim()&&!photos.length))throw new Error('备份中的回忆或照片编号不正确。');
    return {id:m.id,title:m.title,date:m.date,category:m.category,story:m.story,place:m.place||'',photos};
  });
  const events=value.anniversaries??[];
  if(!Array.isArray(events)||events.length+memories.length>5000)throw new Error('备份中的纪念日格式不正确。');
  const anniversaries=events.map(e=>{if(!e||!uuid.test(e.id)||typeof e.title!=='string'||!e.title.trim()||e.title.length>100||!validDate(e.date)||typeof e.annual!=='boolean')throw new Error('备份中的纪念日格式不完整。');return {id:e.id,title:e.title,date:e.date,annual:e.annual}});
  const start=value.start||'';if(start&&(!validDate(start)||start>today()))throw new Error('备份中的相恋日不正确。');
  const covers=value.covers??[];if(!Array.isArray(covers)||![0,2].includes(covers.length)||covers.some(x=>x!==null&&(typeof x!=='string'||!uuid.test(x))))throw new Error('备份中的封面格式不正确。');
  const assets=value.assets??{};if(!assets||typeof assets!=='object'||Array.isArray(assets))throw new Error('备份照片数据不正确。');
  const ids=new Set([...covers,...memories.flatMap(m=>m.photos)].filter(Boolean));
  for(const id of ids)if(typeof assets[id]!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(assets[id]))throw new Error('备份缺少照片内容，请使用“导出完整备份”生成的文件。');
  return {version:1,start,covers,memories,anniversaries,assets};
}
function previewImport(value){backup=validateBackup(value);$('#import-summary').replaceChildren(node('div','',`${backup.memories.length} 段回忆`),node('div','',`${backup.anniversaries.length} 个纪念日`),node('div','',`${Object.keys(backup.assets).length} 张照片`),node('div','',backup.start?'相恋日：'+dateText(backup.start):'未包含相恋日'));$('#import-error').textContent='';$('#settings-dialog').close();showDialog('#import-dialog')}
async function importBackup(){
  const ids=[...new Set([...backup.covers,...backup.memories.flatMap(m=>m.photos)].filter(Boolean))],mapping=new Map();
  for(let i=0;i<ids.length;i++){$('#confirm-import').textContent=`正在收藏照片 ${i+1}/${ids.length}…`;const response=await fetch(backup.assets[ids[i]]);const blob=await response.blob();mapping.set(ids[i],await upload({blob}))}
  const body={start:backup.start,covers:backup.covers.map(x=>x?mapping.get(x):null),memories:backup.memories.map(m=>({...m,photos:m.photos.map(x=>mapping.get(x))})),anniversaries:backup.anniversaries};
  await send('import',body);$('#migration-banner').classList.add('hidden');
}
async function exportBackup(){
  const button=$('#export');if(button.disabled)return;button.disabled=true;$('#settings-error').textContent='';
  try{const current=await api('state');const ids=[...new Set([...current.covers,...current.memories.flatMap(m=>m.photos)].filter(Boolean))],assets={};
    for(let i=0;i<ids.length;i++){button.textContent=`正在打包照片 ${i+1}/${ids.length}…`;const r=await fetch(photoUrl(ids[i]));if(!r.ok)throw new Error('有照片暂时无法读取，完整备份尚未生成，请稍后重试。');const blob=await r.blob();assets[ids[i]]=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('照片读取失败。'));reader.readAsDataURL(blob)})}
    const blob=new Blob([JSON.stringify({version:1,couple:['王宇超','卓如怡'],exportedAt:new Date().toISOString(),...current,assets,inviteUrl:window.museumStorage.inviteUrl()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=`王宇超与卓如怡的恋爱博物馆-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('照片与故事，已经完整打包。');
  }catch(error){$('#settings-error').textContent=error.message}finally{button.disabled=false;button.textContent='导出完整备份'}
}
document.addEventListener('click',e=>{
  const viewLink=e.target.closest('[data-view]');if(viewLink){e.preventDefault();const next=viewLink.dataset.view;if(location.hash==='#'+next)setView(next);else location.hash=next;return}
  const add=e.target.closest('[data-add]');if(add){openMemory(add.dataset.add);return}
  if(e.target.closest('[data-date]')){e.preventDefault();openDate();return}
  if(e.target.closest('[data-event]')){openEvent();return}
  if(e.target.closest('[data-settings]')){$('#settings-error').textContent='';showDialog('#settings-dialog');return}
  const close=e.target.closest('[data-close]');if(close&&!saving){close.closest('dialog').close();return}
  const cover=e.target.closest('[data-cover]');if(cover){openCover(Number(cover.dataset.cover));return}
  const category=e.target.closest('[data-filter]');if(category){filter=category.dataset.filter;renderCollection()}
});
$$('[data-cover]').forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCover(Number(el.dataset.cover))}}));
window.addEventListener('hashchange',()=>setView(location.hash.slice(1)));
$('#search').addEventListener('input',e=>{query=e.target.value;renderCollection()});
$$('dialog').forEach(d=>{d.addEventListener('cancel',e=>{if(saving)e.preventDefault()});d.addEventListener('click',e=>{if(e.target===d&&!saving){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}})});
$('#pick-photos').onclick=()=>$('#photo-input').click();
$('#photo-input').onchange=async e=>{const files=[...e.target.files];e.target.value='';if(files.length+pendingPhotos.length>6){$('#memory-error').textContent='每段回忆最多收藏 6 张照片，请少选几张。';return}processingPhotos=true;renderPending();const submit=$('#memory-form [type=submit]');submit.disabled=true;$('#memory-progress').textContent='正在整理照片…';$('#memory-error').textContent='';try{for(const file of files){const blob=await compress(file);pendingPhotos.push({blob,localUrl:URL.createObjectURL(blob)})}$('#memory-error').textContent=''}catch(error){$('#memory-error').textContent=error.message}finally{processingPhotos=false;submit.disabled=false;$('#memory-progress').textContent='';renderPending()}};
$('#memory-form').onsubmit=async e=>{e.preventDefault();if(processingPhotos)return;const f=e.currentTarget,title=f.elements.title.value.trim(),story=f.elements.story.value.trim(),date=f.elements.date.value;if(!story&&!pendingPhotos.length){$('#memory-error').textContent='写一点故事，或者放一张照片，就能好好收藏。';return}if(date>today()){$('#memory-error').textContent='回忆日期不能晚于今天。';return}const item={id:editingId,title,story,date,category:f.elements.category.value,place:f.elements.place.value.trim(),photos:[]};await saveAction($('#memory-dialog'),f.querySelector('[type=submit]'),'#memory-error',async()=>{item.photos=await uploadPhotos(pendingPhotos);await send('memories/'+item.id,item,'PUT');return ()=>{state={...state,memories:[...state.memories.filter(m=>m.id!==item.id),{...item,updatedAt:new Date().toISOString()}]}}},'这段回忆，已经好好收藏。')};
$('#date-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,start=f.elements.start.value;if(start>today()){$('#date-error').textContent='相恋日不能晚于今天。';return}await saveAction($('#date-dialog'),f.querySelector('[type=submit]'),'#date-error',async()=>{await send('settings',{start},'PATCH');return ()=>{state={...state,start}}},'从这一天起，每一天都算数。')};
$('#edit-memory').onclick=()=>{const item=state.memories.find(m=>m.id===detailId);$('#detail-dialog').close();openMemory(item.category,item)};
$('#delete-memory').onclick=async()=>{if($('#delete-confirm').classList.contains('hidden')){$('#delete-confirm').classList.remove('hidden');$('#delete-memory').textContent='确认删除';return}const id=detailId;await saveAction($('#detail-dialog'),$('#delete-memory'),'#detail-error',async()=>{await api('memories/'+id,{method:'DELETE'});return ()=>{state={...state,memories:state.memories.filter(m=>m.id!==id)}}},'这段记录已删除。')};
$('#event-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;const item={id:eventId,title:f.elements.title.value.trim(),date:f.elements.date.value,annual:f.elements.annual.checked};await saveAction($('#event-dialog'),f.querySelector('[type=submit]'),'#event-error',async()=>{await send('anniversaries/'+item.id,item,'PUT');return ()=>{state={...state,anniversaries:[...state.anniversaries.filter(a=>a.id!==item.id),item]}}},'这个日子，已经记在心上。')};
$('#confirm-delete').onclick=()=>{const id=deleteEventId;return saveAction($('#confirm-dialog'),$('#confirm-delete'),'#confirm-error',async()=>{await api('anniversaries/'+id,{method:'DELETE'});return ()=>{state={...state,anniversaries:state.anniversaries.filter(a=>a.id!==id)}}},'纪念日已移除。')};
$('#pick-cover').onclick=()=>$('#cover-input').click();
$('#cover-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;$('#save-cover').disabled=true;$('#cover-error').textContent='正在整理照片…';try{const blob=await compress(file);releasePreview(pendingCover?.localUrl);pendingCover={blob,localUrl:URL.createObjectURL(blob)};renderCover();$('#cover-error').textContent=''}catch(error){$('#cover-error').textContent=error.message}finally{$('#save-cover').disabled=false}};
$('#remove-cover').onclick=()=>{releasePreview(pendingCover?.localUrl);pendingCover=null;renderCover()};
$('#save-cover').onclick=()=>saveAction($('#cover-dialog'),$('#save-cover'),'#cover-error',async()=>{const covers=[state.covers[0]||null,state.covers[1]||null];covers[coverIndex]=pendingCover?await upload(pendingCover):null;await send('settings',{covers},'PATCH');return ()=>{state={...state,covers}}},'首页的合照，已经放好。');
$('#previous-photo').onclick=()=>{if(lightboxIndex>0){lightboxIndex--;renderLightbox()}};$('#next-photo').onclick=()=>{if(lightboxIndex<lightbox.length-1){lightboxIndex++;renderLightbox()}};
$('#image-dialog').addEventListener('keydown',e=>{if(e.key==='ArrowLeft')$('#previous-photo').click();if(e.key==='ArrowRight')$('#next-photo').click()});
$('#export').onclick=exportBackup;$('#pick-import').onclick=()=>$('#import-input').click();
$('#import-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;$('#settings-error').textContent='';try{if(file.size>150*1024*1024)throw new Error('备份超过 150MB，暂时无法一次导入。');previewImport(JSON.parse(await file.text()))}catch(error){$('#settings-error').textContent=error instanceof SyntaxError?'文件不是有效的 JSON 备份。':error.message}};
$('#confirm-import').onclick=()=>saveAction($('#import-dialog'),$('#confirm-import'),'#import-error',importBackup,'旧回忆，已经好好放回来了。');
$('#migrate').onclick=()=>{if(draft)try{previewImport({...draft,anniversaries:[],covers:[],assets:{}})}catch(error){toast(error.message)}};

$('#entry-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;$('#entry-error').textContent='正在打开…';try{await window.museumStorage.join($('#entry-link').value);await loadState(true);$('#entry-error').textContent=''}catch(error){$('#entry-error').textContent=error.message}finally{button.disabled=false}};
document.addEventListener('click',e=>{if(!e.target.closest('[data-invite]'))return;if(!loaded){toast('请先使用邀请链接进入。');return}$('#invite-link').value=window.museumStorage.inviteUrl();showDialog('#invite-dialog')});
$('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText($('#invite-link').value);toast('邀请链接已复制，可以发给对方了。')}catch{$('#invite-link').focus();$('#invite-link').select();toast('请长按或按复制，保存完整链接。')}};
let syncing=false;
async function syncFromCloud(){if(!loaded||saving||syncing||document.visibilityState!=='visible'||$$('dialog[open]').length)return;syncing=true;try{await loadState()}catch{status('同步暂时中断，回忆仍在云端','error')}finally{syncing=false}}
setInterval(syncFromCloud,10000);
window.addEventListener('focus',syncFromCloud);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncFromCloud()});

setView(location.hash.slice(1));loadState(true);
