import {createServer} from 'node:http';

// HTTP transport closure alone does not await an async handler after its client
// disconnects. Keep application work and response/stream completion together.
export function createDrainingHttpServer({handler, closeResources, onDrain = () => {},
  onEvent = () => {}, timeoutMs = 25_000}) {
  if(typeof handler!=='function'||typeof closeResources!=='function'
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120_000)throw new TypeError('Invalid shutdown configuration');
  let draining=false, transportClosed=false, finalizing=false, finished=false, failed=false;
  let deadline, hold, resolve;
  const active=new Set(), completion=new Promise(r=>{resolve=r;});
  const status=()=>({draining,transportClosed,activeRequests:active.size,finished,failed});
  const emit=(event,ok)=>{try{onEvent({event,ok,...status()});}catch{/* Diagnostics cannot interrupt cleanup. */}};
  const fail=event=>{failed=true;emit(event,false);};
  function maybeFinish(){
    if(!draining||!transportClosed||active.size||finalizing)return;
    finalizing=true;
    Promise.resolve().then(closeResources).catch(()=>fail('SHUTDOWN_RESOURCE_CLOSE_FAILED')).then(()=>{
      finished=true;clearTimeout(deadline);clearInterval(hold);emit('SHUTDOWN_COMPLETE',!failed);
      resolve(Object.freeze({ok:!failed,...status()}));
    });
  }
  function begin(){
    if(draining)return;
    draining=true;
    // Prevent a pending handler with no remaining libuv handles from silently
    // becoming an exit-0 shutdown. This exists only while draining.
    hold=setInterval(()=>{},1000);
    deadline=setTimeout(()=>fail('SHUTDOWN_TIMEOUT'),timeoutMs);
    try{onDrain();}catch{fail('SHUTDOWN_ADMISSION_FAILED');}
    emit('SHUTDOWN_STARTED',!failed);
  }
  const server=createServer((request,response)=>{
    if(draining){
      response.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Connection':'close'});
      response.end(JSON.stringify({ok:false,code:'SERVICE_SHUTTING_DOWN'}));return;
    }
    const work={handlerDone:false,responseDone:response.writableFinished||response.destroyed};active.add(work);
    const release=()=>{if(work.handlerDone&&work.responseDone){active.delete(work);response.off('finish',done);response.off('close',done);maybeFinish();}};
    const done=()=>{work.responseDone=true;release();};
    response.once('finish',done);response.once('close',done);
    Promise.resolve().then(()=>handler(request,response)).catch(()=>{
      if(!response.destroyed){
        if(!response.headersSent){response.writeHead(500,{'Content-Type':'application/json','Connection':'close'});response.end(JSON.stringify({ok:false,code:'INTERNAL_ERROR'}));}
        else response.destroy();
      }
    }).finally(()=>{work.handlerDone=true;release();});
  });
  server.on('close',()=>{transportClosed=true;begin();maybeFinish();});
  function shutdown(){
    if(draining)return completion;
    begin();
    server.close(error=>{
      if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')fail('SHUTDOWN_TRANSPORT_FAILED');
      if(!error||error.code==='ERR_SERVER_NOT_RUNNING'){transportClosed=true;maybeFinish();}
    });
    return completion;
  }
  return Object.freeze({server,shutdown,status,completion});
}

export function installShutdownSignals(lifecycle, target=process) {
  const fail=()=>{if(!target.exitCode)target.exitCode=1;};
  const handle=()=>{lifecycle.shutdown().then(result=>{if(!result.ok)fail();},fail);};
  target.on('SIGTERM',handle);target.on('SIGINT',handle);
  lifecycle.completion.then(()=>{target.off('SIGTERM',handle);target.off('SIGINT',handle);});
}
