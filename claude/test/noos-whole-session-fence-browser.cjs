'use strict';
// Actual cached client + current client, shared real IDB. All HTTP is intercepted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/dev/agent-worktrees/paseo-tab-local-splits-20261114/node_modules/playwright');
const ROOT=process.env.HARMONY_SOURCE_ROOT||path.resolve(__dirname,'..'),OUT=process.env.HARMONY_TEST_OUTPUT||'/tmp/noos-whole-session-'+process.pid;
const ORIGIN='https://harmony.jacobcole.net',API='https://globalbr.ai/api/ingest/harmony/v1',DEVICE='0123456789abcdef0123456789abcdef',TOKEN='hdi_'+DEVICE+'.'+'Q'.repeat(43);
const oldSource=execFileSync('git',['show','8a8767fd9fa0427f48a3a695fa85e80581183d6e:claude/noos-debug-transfer.js'],{cwd:ROOT,encoding:'utf8'});
const oldSha=crypto.createHash('sha256').update(oldSource).digest('hex');assert.equal(oldSha,'1fb30357cc44362b8279ab80068cdce532a211df47ccd6fc488d71587c3665eb');
const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'noos-debug-transfer.js'))).digest('hex');
const fixture=`<!doctype html><meta name="harmony-version" content="review"><div id="firstDebugNotice">Beta notice</div><button id="debugChip"><span>On</span></button><section id="panel"><input type="checkbox" checked><p class="hint">Mock</p></section><script>HARMONY_DEBUG_UPLOAD_ENABLED=false;window.logs=[];window.rows=new Map();window.harmonySessionMetadata=()=>({generatedFixture:true});window.harmonySinger={logEvent:(type,data)=>logs.push({type,...data})};window.harmonyDebug={enabled:true,preferenceVersion:2,preferenceKey:'harmony-debug-v2',panel:document.getElementById('panel'),rows:async()=>[...rows.values()],write:async(row,remove)=>remove?rows.delete(row.id):rows.set(row.id,row),stop(){this.activeId=null;},review:async()=>{}};harmonyDebug.panel.querySelector('input').onchange=e=>harmonyDebug.enabled=e.target.checked;</script><script src="/noos-debug-transfer.js"></script><script>window.u=new HarmonyNoosTransfer.NoosDebugTransfer(harmonyDebug,'${API}');</script>`;
async function wait(p,fn,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const result=await p.evaluate(fn);if(result)return result;await p.waitForTimeout(25);}throw Error('Whole-session fixture condition timed out');}
function persistentBlobFault(){
 const bad=new WeakSet(),mark=(v,seen=new Set())=>{if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(v instanceof Blob){bad.add(v);return;}if(v instanceof ArrayBuffer||ArrayBuffer.isView(v))return;if(Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype)for(const x of Object.values(v))mark(x,seen);};
 for(const [proto,key]of[[IDBRequest.prototype,'result'],[IDBCursorWithValue.prototype,'value']]){const d=Object.getOwnPropertyDescriptor(proto,key);Object.defineProperty(proto,key,{...d,get(){const v=d.get.call(this);mark(v);return v;}});}
 const read=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(...args){if(bad.has(this)){window.persistentFailures=(window.persistentFailures||0)+1;return Promise.reject(new DOMException('Generated unavailable persistent backing','NotFoundError'));}return read.apply(this,args);};
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true,mode:0o700});const sourceSha=sha(),results=[],browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'/opt/google/chrome/chrome'});
 async function setup(){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage(),errors=[],outside=[],calls=[],uploads=new Map();let epoch=0,enrolls=0,actor='modern';
  p.on('pageerror',e=>errors.push(e.message));await c.addInitScript(persistentBlobFault);
  await c.route('**/*',r=>{
   const q=r.request(),url=new URL(q.url());if(url.origin===ORIGIN&&url.pathname==='/legacy-noos.js')return r.fulfill({contentType:'text/javascript',body:oldSource});
   if(url.origin===ORIGIN)return url.pathname==='/noos-debug-transfer.js'?r.fulfill({path:path.join(ROOT,'noos-debug-transfer.js')}):r.fulfill({contentType:'text/html',body:fixture});
   if(!url.href.startsWith(API+'/')){outside.push(url.origin);return r.abort();}
   const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Authorization,Content-Type,X-Upload-Epoch,X-Chunk-Kind','Access-Control-Allow-Methods':'POST,PUT,DELETE,OPTIONS'};
   if(q.method()==='OPTIONS')return r.fulfill({status:204,headers});
   if(url.pathname.endsWith('/devices')){enrolls++;return r.abort();}
   assert.equal(q.headers().authorization,'Bearer '+TOKEN);assert.equal(q.headers()['x-upload-epoch'],String(epoch));assert.ok(!q.headers().cookie);
   const parts=url.pathname.slice(new URL(API).pathname.length+1).split('/'),reply=data=>r.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
   if(q.method()==='DELETE'){calls.push({actor,method:'DELETE',session:parts[1]||null});epoch++;return reply({deleted:true,cleanupComplete:true,reconciliationRequired:false,epoch});}
   assert.equal(q.method(),'PUT');const bytes=q.postDataBuffer();
   if(parts[2]==='chunks'){const hash=crypto.createHash('sha256').update(bytes).digest('hex'),key=parts[1]+'/'+parts[3],prior=uploads.get(key);if(prior)assert.equal(prior.sha256,hash);uploads.set(key,{bytes:[...bytes],mime:q.headers()['content-type'],sha256:hash});calls.push({actor,method:'PUT',session:parts[1],chunk:parts[3],bytes:bytes.length,hash});return reply({id:parts[3],bytes:bytes.length,sha256:hash});}
   const body=JSON.parse(bytes);calls.push({actor,method:'PUT',session:parts[1],body});return reply({id:parts[1],saved:true,epoch});
  });
  await p.goto(ORIGIN);await wait(p,()=>u.noticed);await p.evaluate(async({token,device})=>{
   await u.ready;clearTimeout(u.timer);clearInterval(u.maintenance);u.schedule=()=>{};await u.store.config('device',{token,deviceId:device,epoch:0,limits:{chunkBytes:2*1024*1024}});await u.syncControl();
   window.all=async store=>{const db=await u.store.db;return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});};
   window.CurrentTransfer=HarmonyNoosTransfer;delete window.HarmonyNoosTransfer;
  },{token:TOKEN,device:DEVICE});
  await p.addScriptTag({url:ORIGIN+'/legacy-noos.js'});await p.evaluate(()=>{window.OldTransfer=HarmonyNoosTransfer;window.HarmonyNoosTransfer=CurrentTransfer;window.old=new OldTransfer.TransferDB();window.oldClient=Object.assign(Object.create(OldTransfer.NoosDebugTransfer.prototype),u,{store:old,owner:crypto.randomUUID(),busy:false,ready:Promise.resolve(),schedule(){}});});
  return {p,c,calls,uploads,errors,outside,get enrolls(){return enrolls;},async oldDrain(){actor='old';try{await p.evaluate(()=>oldClient.drain());}finally{actor='modern';}}};
 }
 async function test(name,fn){const f=await setup();try{const details=await fn(f);assert.deepEqual(f.errors,[]);assert.deepEqual(f.outside,[]);assert.equal(f.enrolls,0);results.push({case:name,passed:true,...details});}catch(e){results.push({case:name,passed:false,error:e.stack,errors:f.errors,calls:f.calls});}finally{await f.c.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({sourceSha,oldSha,sandbox:true,networkIntercepted:true,noMicrophone:true,noEncoder:true,results},null,2),{mode:0o600});}console.log(JSON.stringify(results.at(-1)));}
 try{
  await test('actual-old-repeated-retry-cannot-send-or-block-whole-session',async f=>{
   const loss=await f.p.evaluate(async()=>{
    harmonyDebug.activeId='lost-first';const row={id:'lost-first',events:[],mimeType:'audio/mp4'};await harmonyDebug.write(row);await u.drain();await harmonyDebug.write(row,false,{index:0,data:new Uint8Array(1237),mimeType:'audio/mp4'});
    const t=(await all('tasks')).find(t=>t.type==='audio');await u.store.change(['tasks'],tx=>tx.objectStore('tasks').put({...t,body:new Blob([t.data],{type:t.mime}),data:null}));await u.drain();await u.drain();
    const removed=!(await u.store.get('tasks',t.id)),s=await u.store.get('sessions','lost-first');return{removed,loss:s.localPayloadLoss,diagnosticStages:s.diagnosticStages};
   });assert.equal(loss.removed,true);assert.equal(loss.loss.chunks,1);assert.equal(loss.diagnosticStages['lost-on-device'],true);
   const cycles=[];
   for(let i=0;i<4;i++){
    await f.p.evaluate(async i=>{const row={id:'later-'+i,events:[{t:1,type:'generated',label:'é 🎵'}],audioEnded:true,mimeType:'audio/mp4'};await u.store.append(row,{index:0,data:new Uint8Array([7,8,9]),mimeType:'audio/mp4'},true,{fixture:true},(await u.store.get('config','control')).generation);const t=(await all('tasks')).find(t=>t.session===row.id&&t.type==='audio');await u.store.change(['tasks'],tx=>tx.objectStore('tasks').put({...t,failed:'generated retryable task',ready:0}));await old.retryFailed();},i);
    const before=f.calls.length;await f.oldDrain();assert.equal(f.calls.length,before,'old client issues no requests for protected session');
    const state=await f.p.evaluate(async i=>{const tasks=(await all('tasks')).filter(t=>t.session==='later-'+i),before=await u.store.get('config','control'),claims=[];for(const t of tasks)claims.push(await old.authorize(t.id,oldClient.owner));const oldAppend=await old.append({id:'later-'+i,events:[{t:1,type:'generated'},{t:2,type:'should-be-rejected'}]}, {index:99,blob:new Blob(['must not queue'])},false,{},before.generation);await u.drain();const after=await u.store.get('config','control');return{claims:claims.every(c=>c===null),oldAppend:oldAppend===false,priorBlock:before.block,block:after.block,retry:after.retry,remaining:(await all('tasks')).filter(t=>t.session==='later-'+i).length};},i);
    assert.equal(state.claims,true);assert.equal(state.oldAppend,true);assert.equal(state.priorBlock,0);assert.equal(state.block,0);assert.equal(state.remaining,0);assert.deepEqual(f.uploads.get('later-'+i+'/audio-000000-0000').bytes,[7,8,9]);
    const wire=f.calls.filter(c=>c.session==='later-'+i),end=wire.findIndex(c=>c.body?.complete===true);const audioAt=wire.findIndex(c=>c.chunk?.startsWith('audio-')),eventsAt=wire.findIndex(c=>c.chunk?.startsWith('events-'));assert.ok(audioAt>=0&&eventsAt>=0);assert.ok(end>audioAt&&end>eventsAt);assert.deepEqual(JSON.parse(Buffer.from(f.uploads.get('later-'+i+'/events-000000-000001').bytes).toString('utf8')),[{t:1,type:'generated',label:'é 🎵'}]);assert.ok(wire.every(c=>c.actor==='modern'));cycles.push(state);
   }
   return{loss,cycles,oldRequests:f.calls.filter(c=>c.actor==='old').length,exactBytes:true,noEarlyComplete:true,noManualBackoffClear:true};
  });
  await test('migration-preserves-original-generation-wire-bytes-and-delete',async f=>{
   const d=await f.p.evaluate(async()=>{
    const s=u.store;const c=await s.get('config','control'),deadline=Date.now()+1500;await s.config('control',{...c,generation:7,block:deadline,retry:4000});
    const now=Date.now(),payload=new Uint8Array([99,4,5,6,98]).subarray(1,4),meta={fixture:'migration'},mb=new Blob([JSON.stringify(meta)]).size;
    await s.change(['sessions','tasks','config'],tx=>{
     tx.objectStore('sessions').put({id:'migrate',eligible:true,generation:7,created:now,metadata:meta,metadataBytes:mb,localPayloadLoss:{chunks:1,bytes:17,reason:'lost-on-device'}});
     tx.objectStore('sessions').put({id:'stale',eligible:true,generation:6,created:now});
     tx.objectStore('tasks').add({session:'migrate',type:'begin',body:{metadata:meta},bytes:new Blob([JSON.stringify({metadata:meta})]).size,priority:1,ready:1,generation:7,epoch:0,created:now,attemptCount:3,attemptTrackingStarted:now-500});
     tx.objectStore('tasks').add({session:'migrate',type:'audio',body:null,data:payload,mime:'audio/mp4',remote:'audio-000003-0000',bytes:3,priority:2,ready:2,generation:7,epoch:0,created:now,attemptCount:2});
     tx.objectStore('tasks').add({session:'migrate',type:'end',body:{metadata:meta,complete:true},bytes:new Blob([JSON.stringify({metadata:meta,complete:true})]).size,priority:3,ready:1,generation:7,epoch:0,created:now});
     tx.objectStore('tasks').add({session:'migrate',type:'audio',body:null,bytes:0,priority:2,ready:0,generation:7,epoch:0,created:now,lostOnDevice:true,failed:'lost-on-device'});
     tx.objectStore('tasks').add({session:'stale',type:'audio',body:null,data:new Uint8Array([8]),mime:'audio/mp4',remote:'audio-000000-0000',bytes:1,priority:2,ready:2,generation:6,epoch:0,created:now});
     tx.objectStore('tasks').add({session:'delete-only',type:'delete',bytes:0,priority:0,ready:1,generation:7,created:now});
    });
    const before=await all('tasks'),usage={bytes:before.reduce((n,t)=>n+t.bytes,0)+mb,count:2};await s.config('usage',usage);
    const changed=await s.protectQueue(),after=await all('tasks'),second=await s.protectQueue(),control=await s.get('config','control'),afterUsage=await s.get('config','usage');
    const semantic=t=>({type:t.type,session:t.session,body:t.body,data:t.data&&[...t.data],mime:t.mime,remote:t.remote,bytes:t.bytes,epoch:t.epoch,created:t.created,attemptCount:t.attemptCount,attemptTrackingStarted:t.attemptTrackingStarted,priority:t.priority});
    const preserved=before.filter(t=>!t.lostOnDevice).every(t=>after.some(x=>JSON.stringify(semantic(x))===JSON.stringify(semantic(t))));
    const stale=after.find(t=>t.session==='stale'),deletion=after.find(t=>t.type==='delete'),oldDelete=before.find(t=>t.type==='delete'),tagged=after.filter(t=>!t.type.startsWith('delete'));
    const staleClaim=await s.authorize(stale.id,u.owner),oldClaims=[];await s.release(u.owner);for(const t of tagged)oldClaims.push(await old.authorize(t.id,oldClient.owner));
    return{changed,second,preserved,tagged:tagged.map(t=>({type:t.type,generation:t.generation,formatVersion:t.formatVersion,ready:t.ready})),staleClaim,oldClaimsAllNull:oldClaims.every(c=>c===null),deleteIdPreserved:deletion.id===oldDelete.id,deleteGeneration:deletion.generation,deadlinePreserved:control.block===deadline,retry:control.retry,usagePreserved:JSON.stringify(usage)===JSON.stringify(afterUsage),loss:(await s.get('sessions','migrate')).localPayloadLoss,sessionGeneration:(await s.get('sessions','migrate')).generation};
   });assert.equal(d.preserved,true);assert.equal(d.second,0);assert.equal(d.staleClaim,null);assert.equal(d.oldClaimsAllNull,true);assert.equal(d.deleteIdPreserved,true);assert.equal(d.deleteGeneration,7);assert.equal(d.deadlinePreserved,true);assert.equal(d.retry,4000);assert.equal(d.usagePreserved,true);assert.equal(d.sessionGeneration,'v2:7');assert.equal(d.loss.chunks,1);assert.ok(d.tagged.every(t=>t.formatVersion===2&&t.ready===2));assert.ok(d.tagged.some(t=>t.generation==='v2:6'));return d;
  });
  await test('Off-delete-epoch-and-quota-fences',async f=>{
   const d=await f.p.evaluate(async()=>{
    const s=u.store;await s.append({id:'off',events:[]},{index:0,data:new Uint8Array([1,2,3]),mimeType:'audio/mp4'},true,{},0);const t=(await all('tasks')).find(t=>t.type==='audio');await s.cancelUploads(false);await old.retryFailed();const offClaim=await s.authorize(t.id,u.owner),oldOffClaim=await old.authorize(t.id,oldClient.owner),offUsage=await s.get('config','usage');
    await s.cancelUploads(true);await u.syncControl();let control=await s.get('config','control');await s.append({id:'removed',events:[]},{index:0,data:new Uint8Array([1]),mimeType:'audio/mp4'},true,{},control.generation);const removed=(await all('tasks')).find(t=>t.session==='removed'&&t.type==='audio');await s.tombstone('removed');const afterRemove=await s.authorize(removed.id,u.owner),late=await s.append({id:'removed',events:[]},null,true,{},control.generation),deletion=(await all('tasks')).find(t=>t.type==='delete');const deletionVisible=(await old.next()).type==='delete';await s.deleteBarrier();await u.drain();const device=await s.get('config','device');
    await s.cancelUploads(true);await u.syncControl();control=await s.get('config','control');await s.append({id:'epoch',events:[]},null,true,{},control.generation);const task=(await s.next());await s.change(['tasks'],tx=>tx.objectStore('tasks').put({...task,epoch:0}));const staleEpoch=await s.authorize(task.id,u.owner,true,true);
    const usage=await s.get('config','usage');await s.config('usage',{...usage,bytes:100*1024*1024});let quota=false;try{await s.append({id:'over-cap',events:[]},null,true,{},control.generation);}catch(e){quota=e.code==='outbox_limit';}await s.config('usage',usage);await s.cancelUploads(false);
    return{offClaim,oldOffClaim,offBytes:offUsage.bytes,afterRemove,late,deletionVisible,deleteReady:deletion.ready,deleteNumeric:Number.isSafeInteger(deletion.generation),epoch:device.epoch,staleEpoch,quota,finalUsage:await s.get('config','usage')};
   });assert.equal(d.offClaim,null);assert.equal(d.oldOffClaim,null);assert.equal(d.offBytes,0);assert.equal(d.afterRemove,null);assert.equal(d.late,false);assert.equal(d.deletionVisible,true);assert.equal(d.deleteReady,1);assert.equal(d.deleteNumeric,true);assert.equal(d.epoch,1);assert.equal(d.staleEpoch,null);assert.equal(d.quota,true);assert.equal(d.finalUsage.bytes,0);return d;
  });
  await test('malformed-and-unknown-format-cannot-block-healthy-work',async f=>{
   const d=await f.p.evaluate(async()=>{
    const invalid=[{generation:'0'},{formatVersion:2,generation:0},{formatVersion:2,generation:'v2:00'},{formatVersion:2,generation:'v2:-1'},{formatVersion:2,generation:'v2:9007199254740992'},{formatVersion:3,generation:0},{formatVersion:2,generation:'v2:0junk'}],s=u.store;
    await s.change(['sessions','tasks'],tx=>{invalid.forEach((v,i)=>{tx.objectStore('sessions').put({id:'invalid-'+i,eligible:true,created:Date.now(),...v});tx.objectStore('tasks').add({session:'invalid-'+i,type:'begin',body:{metadata:{invalid:i}},bytes:32,priority:1,ready:1,epoch:0,created:Date.now(),...v});});});
    const seeded=await all('tasks'),beforeClaims=[];for(const t of seeded)beforeClaims.push(await s.authorize(t.id,u.owner));await s.release(u.owner);const changed=await s.protectQueue();await old.retryFailed();const oldClaims=[];for(const t of await all('tasks'))oldClaims.push(await old.authorize(t.id,oldClient.owner));await old.release(oldClient.owner);
    await s.append({id:'healthy',events:[]},{index:0,data:new Uint8Array([6,7]),mimeType:'audio/mp4'},true,{},0);const before=await s.get('config','control');await u.drain();const after=await s.get('config','control'),sessions=await all('sessions');return{invalidCount:invalid.length,beforeClaimsAllNull:beforeClaims.every(c=>c===null),oldClaimsAllNull:oldClaims.every(c=>c===null),changed,quarantined:(await all('tasks')).filter(t=>t.invalidGeneration).length,invalidSessions: sessions.filter(t=>t.id.startsWith('invalid-')).every(t=>t.eligible===false&&t.generation==='invalid'),beforeBlock:before.block,block:after.block,healthyRemaining:(await all('tasks')).filter(t=>t.session==='healthy').length};
   });assert.equal(d.beforeClaimsAllNull,true);assert.equal(d.oldClaimsAllNull,true);assert.equal(d.quarantined,d.invalidCount);assert.equal(d.invalidSessions,true);assert.equal(d.beforeBlock,0);assert.equal(d.block,0);assert.equal(d.healthyRemaining,0);assert.deepEqual(f.uploads.get('healthy/audio-000000-0000').bytes,[6,7]);return d;
  });
  await test('mixed-legacy-and-v2-session-keeps-same-priority-order',async f=>{
   const d=await f.p.evaluate(async()=>{const s=u.store,row={id:'mixed-order',events:[]};await s.append(row,{index:0,data:new Uint8Array([11]),mimeType:'audio/mp4'},true,{},0);await s.append({...row,audioEnded:true},{index:1,data:new Uint8Array([22]),mimeType:'audio/mp4'},false,{},0);const tasks=await all('tasks');await s.change(['tasks'],tx=>{for(const t of tasks)if(t.type==='begin'||t.remote==='audio-000000-0000'){const {formatVersion,...rest}=t;tx.objectStore('tasks').put({...rest,generation:0,ready:1});}});const before=(await all('tasks')).filter(t=>t.type==='audio').map(t=>t.remote);await s.protectQueue();await u.drain();return{expectedOrder:before};});const order=f.calls.filter(c=>c.chunk&&c.session==='mixed-order').map(c=>c.chunk);assert.deepEqual(order,d.expectedOrder,'within-session same-priority ordering survives mixed-format migration');assert.deepEqual(order,['audio-000000-0000','audio-000001-0000']);return{...d,actualOrder:order};
  });
  await test('pre-migration-old-claim-ACK-and-backoff-boundary',async f=>{
   const held=await f.p.evaluate(async()=>{await old.append({id:'held',events:[]},null,true,{fixture:'held'},0);const t=await old.next();return(await old.authorize(t.id,oldClient.owner)).task;});
   await f.p.evaluate(async()=>{await old.release(oldClient.owner);await u.store.protectQueue();});
   // Model HTTP already dispatched before migration; replay is an intercepted mock.
   const before=f.calls.length;await f.p.evaluate(async held=>{await oldClient.request('/sessions/'+held.session,'PUT',held.body,{'X-Upload-Epoch':'0'});},held);assert.equal(f.calls.length,before+1);
   const d=await f.p.evaluate(async held=>{const before=await all('tasks'),oldAck=await old.receipt(held,{epoch:0,saved:true}),afterAck=await all('tasks');await old.remove(held.id);const afterRemove=await all('tasks');await old.defer({retryAfter:25});const control=await u.store.get('config','control');await u.drain();return{oldAck,rekeyed:before.every(t=>t.id!==held.id),ackDidNotRemove:afterAck.length===before.length,oldRemoveDidNotRemove:afterRemove.length===before.length,oldDeferredDeadline:control.block,now:Date.now(),blocked:control.block>Date.now(),remaining:afterRemove.length};},held);
   assert.equal(d.rekeyed,true);assert.equal(d.oldAck,false);assert.equal(d.ackDidNotRemove,true);assert.equal(d.oldRemoveDidNotRemove,true);assert.equal(d.blocked,true);
   await f.p.waitForTimeout(Math.max(0,d.oldDeferredDeadline-d.now)+100);await f.p.evaluate(()=>u.drain());assert.equal(f.calls.filter(c=>c.session==='held'&&c.body).length,2,'modern replays exact accepted metadata after bounded existing backoff');assert.deepEqual(f.calls.filter(c=>c.session==='held').map(c=>c.body),[held.body,held.body]);
   return{...d,previouslyDispatchedRequestCanStillLand:true,oldDeferCanStillSetSharedBackoff:true,manualBackoffClear:false,modernReplayExact:true};
  });
 }finally{await browser.close();}
 assert.equal(sha(),sourceSha,'runtime changed during validation');assert.ok(results.every(r=>r.passed),'whole-session fence regression failed');
})().catch(e=>{console.error(e.stack);process.exit(1);});
