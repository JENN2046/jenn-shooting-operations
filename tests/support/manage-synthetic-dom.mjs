import {readFileSync} from 'node:fs';
export function dom(){
 const all=[],ids=new Map();
 class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;all.push(this);}
 append(...elements){this.children.push(...elements);if(this.tagName==='select'&&!this.value&&elements.length)this.value=elements[0].value;}
 replaceChildren(...elements){this.children=[];this.value=this.tagName==='select'?'':this.value;this.append(...elements);}
 addEventListener(event,fn){(this.handlers[event]??=[]).push(fn);}
 querySelectorAll(){return this.children;}
 focus(){}
 async fire(event){for(const fn of this.handlers[event]||[])await fn({preventDefault(){}});}
 }
 const html=readFileSync(new URL('../../public/manage.html',import.meta.url),'utf8');
 for(const m of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)){const e=new Element(m[1]);e.id=m[2];e.value=/\bvalue="([^"]*)"/.exec(m[0])?.[1]||'';ids.set(e.id,e);}
 return {ids,document:{querySelector:s=>ids.get(s.slice(1)),querySelectorAll:s=>all.filter(e=>e.tagName==='button'&&(!s.includes('data-locked')||e.dataset.locked==='yes')),createElement:tag=>new Element(tag)}};
}
