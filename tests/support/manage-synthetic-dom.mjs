import {readFileSync} from 'node:fs';
export function dom(){
 const all=[],ids=new Map();
 class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.dataset={};this.style={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;all.push(this);}
 append(...elements){this.children.push(...elements);if(this.tagName==='select'&&!this.value&&elements.length)this.value=elements[0].value;}
 replaceChildren(...elements){this.children=[];this.value=this.tagName==='select'?'':this.value;this.append(...elements);}
 addEventListener(event,fn){(this.handlers[event]??=[]).push(fn);}
 querySelectorAll(){return this.children;}
 reset(){for(const e of this.controls||[])e.value=e.defaultValue;}
 focus(){}
 async fire(event){for(const fn of this.handlers[event]||[])await fn({preventDefault(){}});}
 }
 const html=readFileSync(new URL('../../public/manage.html',import.meta.url),'utf8');
 for(const m of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)){const e=new Element(m[1]);e.id=m[2];e.value=/\bvalue="([^"]*)"/.exec(m[0])?.[1]||'';ids.set(e.id,e);}
 // Native reset restores select defaults without dispatching change events.
 for(const m of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
  const e=ids.get(m[1]);const options=[...m[2].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
  const selected=options.filter(o=>/\bselected\b/.test(o[1])).at(-1)||options[0];
  e.value=selected?(/\bvalue="([^"]*)"/.exec(selected[1])?.[1]??selected[2]):'';
 }
 for(const e of ids.values())e.defaultValue=e.value;
 for(const m of html.matchAll(/<form[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g))ids.get(m[1]).controls=[...m[2].matchAll(/<(?:input|textarea|select)\b[^>]*\bid="([^"]+)"/g)].map(c=>ids.get(c[1]));
 return {ids,document:{querySelector:s=>ids.get(s.slice(1)),querySelectorAll:s=>all.filter(e=>e.tagName==='button'&&(!s.includes('data-locked')||e.dataset.locked==='yes')),createElement:tag=>new Element(tag)}};
}

export function managementScript(){
 // This legacy in-process DOM suite exercises the disabled session path.
 // Enabled Cookie lifecycle is covered by the isolated HTTPS browser fixture.
 return 'const browserSession={enabled:false,authenticated:false,init:async()=>({enabled:false})};\n'+['common.js','references.js','manage.js'].map(name=>readFileSync(new URL('../../public/'+name,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')).join('\n');
}
