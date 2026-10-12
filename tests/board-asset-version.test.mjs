import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launch} from './support/first-launch-v3-fixture.mjs';

test('board entry and references dependency bypass pre-change cache keys and resolve through static routing',async()=>{
 const html=readFileSync(new URL('../public/board.html',import.meta.url),'utf8');
 const source=readFileSync(new URL('../public/board.js',import.meta.url),'utf8');
 const entry=new URL(html.match(/<script type="module" src="([^"]*board\.js[^\"]*)"/)[1],'http://localhost');
 const dependency=source.match(/import\s*\{([^}]*retainReferenceImages[^}]*)\}\s*from\s*'([^']+)'/);
 const reference=new URL(dependency[2],entry);
 assert.equal(entry.pathname,'/board.js');assert.equal(reference.pathname,'/references.js');
 assert.ok(entry.searchParams.get('v'));assert.equal(reference.searchParams.get('v'),entry.searchParams.get('v'));
 assert.notEqual(entry.pathname+entry.search,'/board.js?v=ui-20260922');assert.notEqual(reference.pathname+reference.search,'/references.js');
 const f=await launch();try{
  await new Promise(resolve=>f.server.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${f.server.server.address().port}`;
  for(const [url,path] of [[entry,'board.js'],[reference,'references.js']]){
   const response=await fetch(base+url.pathname+url.search);assert.equal(response.status,200);
   assert.match(response.headers.get('content-type'),/javascript/);assert.match(response.headers.get('cache-control'),/max-age=300/);
   assert.equal(await response.text(),readFileSync(new URL('../public/'+path,import.meta.url),'utf8'));
  }
  const exports=await import(new URL('../public/'+reference.pathname.slice(1)+reference.search,import.meta.url));
  for(const name of dependency[1].split(',').map(s=>s.trim()))assert.equal(typeof exports[name],'function');
 }finally{await new Promise(resolve=>f.server.server.close(resolve));f.close();}
});
