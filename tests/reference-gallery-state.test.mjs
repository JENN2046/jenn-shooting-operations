import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceGallery,clearReferenceImages,retainReferenceImages} from '../public/references.js';

class Element extends EventTarget {
 constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.isConnected=true;}
 append(...children){this.children.push(...children);for(const child of children)child.parent=this;}
 remove(){this.parent.children=this.parent.children.filter(child=>child!==this);this.isConnected=false;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('opened and pending reference images survive redraw, while removal and identity changes invalidate them',async()=>{
 const saved={document:globalThis.document,fetch:globalThis.fetch,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
 const revoked=[];let reads=0,serial=0,resolveBlob,token='first';
 globalThis.document={createElement:tag=>new Element(tag)};
 URL.createObjectURL=()=>`blob:${++serial}`;URL.revokeObjectURL=url=>revoked.push(url);
 globalThis.fetch=async()=>{reads++;return {ok:true,blob:async()=>new Blob(['image'])};};
 const ref={id:'UP-1',name:'image.png'},getToken=()=>token;
 try{
  let gallery=referenceGallery([ref],getToken);gallery.children[0].dispatchEvent(new Event('click'));await tick();
  const url=gallery.children.find(child=>child.tagName==='img').src;
  gallery.isConnected=false;retainReferenceImages([ref]);gallery=referenceGallery([ref],getToken);await tick();
  assert.equal(gallery.children.find(child=>child.tagName==='img').src,url);assert.equal(reads,1);
  retainReferenceImages([]);assert.deepEqual(revoked,[url]);
  gallery=referenceGallery([ref],getToken);await tick();assert.equal(gallery.children.length,1);
  globalThis.fetch=async()=>{reads++;return {ok:true,blob:()=>new Promise(resolve=>resolveBlob=resolve)};};
  gallery.children[0].dispatchEvent(new Event('click'));await tick();gallery.isConnected=false;
  retainReferenceImages([ref]);gallery=referenceGallery([ref],getToken);await tick();
  resolveBlob(new Blob(['image']));await tick();assert.equal(gallery.children.filter(child=>child.tagName==='img').length,1);assert.equal(reads,2);
  clearReferenceImages();gallery=referenceGallery([ref],getToken);gallery.children[0].dispatchEvent(new Event('click'));await tick();
  token='second';clearReferenceImages();resolveBlob(new Blob(['old identity']));await tick();
  assert.equal(gallery.children.filter(child=>child.tagName==='img').length,0);assert.equal(serial,2);
  gallery=referenceGallery([ref],getToken);gallery.children[0].dispatchEvent(new Event('click'));await tick();
  retainReferenceImages([]);resolveBlob(new Blob(['removed']));await tick();assert.equal(serial,2);
 }finally{
  clearReferenceImages();globalThis.document=saved.document;globalThis.fetch=saved.fetch;URL.createObjectURL=saved.create;URL.revokeObjectURL=saved.revoke;
 }
});
