const urls=new Set();
let generation=0;
export function clearReferenceImages(){generation++;for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
export function referenceGallery(references,getToken){
 const root=document.createElement('div');root.className='reference-gallery';
 for(const reference of references||[]){
  const button=document.createElement('button');button.type='button';button.textContent='查看参考图：'+reference.name;
  button.addEventListener('click',async()=>{
   const current=generation;button.disabled=true;button.textContent='正在读取参考图…';
   try{
    const response=await fetch('/api/v3/business/references/'+encodeURIComponent(reference.id),{headers:{Authorization:'Bearer '+getToken()}});
    if(!response.ok)throw Error('参考图读取失败，请重新登录或刷新后重试。');
    const blob=await response.blob();if(current!==generation||!root.isConnected)return;
    const url=URL.createObjectURL(blob);urls.add(url);
    const image=document.createElement('img');image.alt=reference.name;image.src=url;image.style.maxWidth='100%';image.style.maxHeight='320px';
    image.addEventListener('error',()=>{image.remove();button.textContent='浏览器无法预览此格式；可下载原图。';});
    const link=document.createElement('a');link.href=url;link.download=reference.name;link.textContent='下载参考图：'+reference.name;
    root.append(image,link);button.textContent=reference.name;
   }catch(e){if(current===generation){button.textContent=e.message;button.disabled=false;}}
  });root.append(button);
 }
 return root;
}
