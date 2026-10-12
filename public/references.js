const images=new Map();
let generation=0;
const key=reference=>JSON.stringify([reference.id,reference.name,reference.contentType,reference.sha256,reference.size]);
function discard(id,entry){if(entry.url)URL.revokeObjectURL(entry.url);images.delete(id);}
export function clearReferenceImages(){generation++;for(const [id,entry] of images)discard(id,entry);}
export function retainReferenceImages(references){
 const valid=new Set(references.map(key));
 for(const [id,entry] of images)if(!valid.has(id))discard(id,entry);
}
export function referenceGallery(references,getToken){
 const galleryGeneration=generation;
 const root=document.createElement('div');root.className='reference-gallery';
 for(const reference of references||[]){
  const id=key(reference);
  const button=document.createElement('button');button.type='button';button.textContent='查看参考图：'+reference.name;
  async function open(){
   if(galleryGeneration!==generation||!root.isConnected)return;
   const current=generation,token=getToken();button.disabled=true;button.textContent='正在读取参考图…';
   let entry=images.get(id);
   if(!entry){
    entry={};images.set(id,entry);
    entry.pending=(async()=>{
     const response=await fetch('/api/v3/business/references/'+encodeURIComponent(reference.id),{headers:{Authorization:'Bearer '+token}});
     if(!response.ok)throw Error('参考图读取失败，请重新登录或刷新后重试。');
     const blob=await response.blob();
     if(current!==generation||images.get(id)!==entry||token!==getToken())return;
     entry.url=URL.createObjectURL(blob);
    })();
   }
   try{
    await entry.pending;
    if(current!==generation||images.get(id)!==entry||token!==getToken()||!root.isConnected||!entry.url)return;
    const image=document.createElement('img');image.alt=reference.name;image.src=entry.url;image.style.maxWidth='100%';image.style.maxHeight='320px';
    image.addEventListener('error',()=>{image.remove();button.textContent='浏览器无法预览此格式；可下载原图。';});
    const link=document.createElement('a');link.href=entry.url;link.download=reference.name;link.textContent='下载参考图：'+reference.name;
    root.append(image,link);button.textContent=reference.name;
   }catch(e){
    if(images.get(id)===entry)discard(id,entry);
    if(current===generation&&token===getToken()&&root.isConnected){button.textContent=e.message;button.disabled=false;}
   }
  }
  button.addEventListener('click',open);root.append(button);
  // Reattach the opened image (or the same pending read) after a successful poll.
  if(images.has(id))queueMicrotask(open);
 }
 return root;
}
