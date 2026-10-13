// Explicit local verification harness. Requires isolated synthetic evidence and pinned author source.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createChartCommand,refreshChartCommand} from './chart.mjs';
const [authorRoot,evidenceRoot,playwrightPath]=process.argv.slice(2).map(value=>resolve(value));
const {chromium}=await import(pathToFileURL(playwrightPath));
const require=createRequire(import.meta.url),{ChartService}=require(join(authorRoot,'chartService.js'));
const controller=require(join(authorRoot,'ChartControllerService.js'));
const data=JSON.parse(readFileSync(join(evidenceRoot,'synthetic-chart-data.json'),'utf8'));
const scratch=mkdtempSync(join(tmpdir(),'jso-vchart-render-'));
const service=await new ChartService({appDataRoot:scratch}).initialize();controller.initialize({chartService:service});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',chromiumSandbox:true});
try {
 const page=await browser.newPage({viewport:{width:1100,height:700}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><body><div id="host" style="width:1050px;height:650px"></div></body></html>');
 await page.addScriptTag({path:join(authorRoot,'chart-runtime.js')});
 const created=await controller.processToolCall(createChartCommand(data.before));
 const dir=join(scratch,'Charts','jso-local-candidate');
 const snapshot=()=>({manifest:JSON.parse(readFileSync(join(dir,'chart.json'))),data:JSON.parse(readFileSync(join(dir,'data.json'))),
  template:readFileSync(join(dir,'template.html'),'utf8'),style:readFileSync(join(dir,'style.css'),'utf8'),runtime:readFileSync(join(dir,'runtime.js'),'utf8')});
 await page.evaluate(async snap=>{
  window.renderErrors=[];window.stable=false;
  window.chart=new window.VCPChartRuntime.ChartRuntime({host:document.querySelector('#host'),api:{},
   onError:e=>window.renderErrors.push(e),onStable:()=>window.stable=true});
  await window.chart.mount(snap);
 },snapshot());
 await page.waitForFunction(()=>window.stable);
 assert.equal(await page.locator('tr').count(),5);
 await page.screenshot({path:join(evidenceRoot,'chart-before.png')});
 let event;service.on('change',e=>event=e);
 await controller.processToolCall(refreshChartCommand(data.after,created.details.manifest.dataRevision));
 assert.equal(event.type,'data-replaced');
 // chart.js handleChartEvent fetches the authoritative chart snapshot before Runtime.update.
 await page.evaluate(async change=>{window.stable=false;await window.chart.update(change);},{...event,data:snapshot().data});
 await page.waitForFunction(()=>window.stable);
 const text=await page.locator('#host').innerText();assert.match(text,/2026\/10\/13/);
 assert.match(text,new RegExp('排程版本 '+data.after.revisions.scheduleRevision));
 const result=await page.evaluate(()=>({errors:window.renderErrors,diagnostics:window.chart.collectDiagnostics()}));
 assert.equal(errors.length,0);assert.equal(result.errors.length,0);assert.equal(result.diagnostics.warnings.length,0);
 await page.screenshot({path:join(evidenceRoot,'chart-after.png')});
 writeFileSync(join(evidenceRoot,'browser-result.json'),JSON.stringify({ok:true,mode:'isolated-author-ChartRuntime-harness',browser:await browser.version(),event,
  sourceRevisions:data.after.revisions,rows:5,text,...result},null,2));
}finally{await browser.close();await service.shutdown();rmSync(scratch,{recursive:true,force:true});}
