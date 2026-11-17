/* Write-only beta diagnostics. One recorder; durable immutable outbox; no device read API. */
(() => {
 if(window.HarmonyNoosTransfer)return;
 const CAP=2*1024*1024,AUDIO_CAP=20*1024*1024,QUEUE_CAP=100*1024*1024,SESSION_CAP=200,AGE=30*86400000;
 const clean=v=>JSON.parse(JSON.stringify(v,(k,x)=>['deviceId','groupId','token'].includes(k)?undefined:x));
 const isBytes=body=>body instanceof ArrayBuffer||ArrayBuffer.isView(body);
 const bytesOf=body=>body instanceof ArrayBuffer?new Uint8Array(body):new Uint8Array(body.buffer,body.byteOffset,body.byteLength);
 const size=body=>isBytes(body)?body.byteLength:body instanceof Blob?body.size:new Blob([JSON.stringify(body)]).size;
 // Fence the whole session from older open tabs, including their Retry path.
 // ready=2 hides normal discovery; opaque generations also reject old authorize/append.
 const taskPayload=t=>t.data??t.body;
 const queueGeneration=row=>{const value=row?.generation;if(row?.formatVersion===2){if(typeof value!=='string'||!/^v2:(0|[1-9][0-9]*)$/.test(value))return null;const n=Number(value.slice(3));return Number.isSafeInteger(n)&&n>=0?n:null;}return (row?.formatVersion===undefined||row.formatVersion===1)&&Number.isSafeInteger(value)&&value>=0?value:null;};
 const generationTag=n=>'v2:'+n;
 const payloadReady=t=>t.formatVersion===2||['audio','events'].includes(t.type)&&isBytes(taskPayload(t))?2:1;
 const quota=()=>Object.assign(new Error('Transfer storage limit reached; local Export remains available'),{code:'outbox_limit'});
 class TransferDB {
  constructor(){this.db=new Promise((resolve,reject)=>{const r=indexedDB.open('harmony-noos-transfer-v1',3);r.onupgradeneeded=()=>{
   const db=r.result,tx=r.transaction;
   if(!db.objectStoreNames.contains('config'))db.createObjectStore('config');
   if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'id'});
   if(!db.objectStoreNames.contains('tasks'))db.createObjectStore('tasks',{keyPath:'id',autoIncrement:true});
   const ss=tx.objectStore('sessions'),ts=tx.objectStore('tasks');
   if(!ss.indexNames.contains('created'))ss.createIndex('created','created');
   if(!ts.indexNames.contains('order'))ts.createIndex('order',['priority','id']);
   if(!ts.indexNames.contains('session'))ts.createIndex('session','session');
   if(!ts.indexNames.contains('ready'))ts.createIndex('ready',['ready','priority','id']);
   // One migration scan, never a scan on the recording path.
   let bytes=0,count=0,taskDone=false,sessionDone=false;
   const finish=()=>{if(taskDone&&sessionDone)tx.objectStore('config').put({bytes,count},'usage');};
   const a=ts.openCursor();a.onsuccess=()=>{const c=a.result;if(c){const t=c.value;t.bytes=size(taskPayload(t)??{});t.generation??=0;t.epoch??=null;t.ready=t.failed?0:payloadReady(t);t.created??=Date.now();bytes+=t.bytes;c.update(t);c.continue();}else{taskDone=true;finish();}};
   const b=ss.openCursor();b.onsuccess=()=>{const c=b.result;if(c){count++;c.update({...c.value,created:c.value.created||Date.now(),generation:c.value.generation??0});c.continue();}else{sessionDone=true;finish();}};
  };r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async change(names,fn){const db=await this.db;return new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite');let result,error;const abort=e=>{error=e;try{tx.abort();}catch(_){}};const guard=f=>e=>{try{f(e);}catch(err){abort(err);}};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||new Error('Transfer transaction aborted'));try{fn(tx,v=>result=v,guard,abort);}catch(e){abort(e);}});}
  async get(store,key){const db=await this.db;return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  config(key,value){if(key==='device')return this.mutate((tx,c,u,done,g)=>{const cs=tx.objectStore('config'),r=cs.get('device');r.onsuccess=g(()=>{const chosen=r.result||value;if(!r.result)cs.put(chosen,'device');c.epoch=chosen.epoch;done(chosen);});});return this.change(['config'],tx=>tx.objectStore('config').put(value,key));}
  control(on,version=1){return this.change(['config','sessions','tasks'],(tx,set,g)=>{
   const config=tx.objectStore('config'),r=config.get('control');r.onsuccess=g(()=>{
    const c=r.result||{generation:0,enabled:on,epoch:0,block:0,retry:1000,policyVersion:version};
    if((c.policyVersion||1)>=version){config.put(c,'control');set(c);return;}
    // A new recording policy revokes old automatic work, never relabels it.
    c.policyVersion=version;c.generation++;c.policyResumeOn=!!on&&!!c.deletePending;c.enabled=!!on&&!c.deletePending;delete c.lease;
    const usage=config.get('usage');usage.onsuccess=g(()=>{
     const u=usage.result||{bytes:0,count:0};let sessionsDone=false,tasksDone=false;
     const finish=()=>{if(sessionsDone&&tasksDone){config.put(u,'usage');config.put(c,'control');set(c);}};
     const sessions=tx.objectStore('sessions').openCursor();sessions.onsuccess=g(()=>{const cursor=sessions.result;if(cursor){u.bytes=Math.max(0,u.bytes-(cursor.value.metadataBytes||0));cursor.update({...cursor.value,eligible:false,metadata:null,metadataBytes:0});cursor.continue();}else{sessionsDone=true;finish();}});
     const tasks=tx.objectStore('tasks').openCursor();tasks.onsuccess=g(()=>{const cursor=tasks.result;if(cursor){if(!cursor.value.type.startsWith('delete')){u.bytes=Math.max(0,u.bytes-(cursor.value.bytes||0));cursor.delete();}cursor.continue();}else{tasksDone=true;finish();}});
    });
   });
  });}
  protectQueue(){return this.mutate((tx,c,u,done,g)=>{
   let sessionsDone=false,tasksDone=false,changed=0;const finish=()=>{if(sessionsDone&&tasksDone){tx.objectStore('config').put(u,'usage');done(changed);}};
   const sessions=tx.objectStore('sessions').openCursor();sessions.onsuccess=g(()=>{const cursor=sessions.result;if(!cursor){sessionsDone=true;finish();return;}const s=cursor.value,n=queueGeneration(s);if(n===null){if(s.generation!=='invalid'||s.eligible){cursor.update({...s,generation:'invalid',formatVersion:2,eligible:false});changed++;}}else if(s.formatVersion!==2){cursor.update({...s,generation:generationTag(n),formatVersion:2});changed++;}cursor.continue();});
   const ts=tx.objectStore('tasks'),legacySessions=new Set();let maxId;
   // Include protected rows in a mixed session's rekey so their original order is
   // retained. Bound the second cursor: newly allocated IDs must not be rescanned.
   const scan=ts.openCursor();scan.onsuccess=g(()=>{const cursor=scan.result;if(cursor){const t=cursor.value;maxId=cursor.key;if(!t.type.startsWith('delete')&&!t.lostOnDevice&&t.formatVersion!==2&&queueGeneration(t)!==null)legacySessions.add(t.session);cursor.continue();return;}
    if(maxId===undefined){tasksDone=true;finish();return;}
    const tasks=ts.openCursor(IDBKeyRange.upperBound(maxId));tasks.onsuccess=g(()=>{const cursor=tasks.result;if(!cursor){tasksDone=true;finish();return;}const t=cursor.value;if(!t.type.startsWith('delete')){
     if(t.lostOnDevice){u.bytes=Math.max(0,u.bytes-(t.bytes||0));cursor.delete();changed++;}
     else{const n=queueGeneration(t);if(n===null){if(!t.invalidGeneration){cursor.update({...t,generation:'invalid',formatVersion:2,invalidGeneration:true,failed:'invalid queue generation',ready:0});changed++;}}
      else if(legacySessions.has(t.session)){
       // Old receipts remove by local ID without checking generation. New local IDs
       // fence those callbacks; wire IDs, original generations and bytes stay exact.
       const {id,...payload}=t;ts.add({...payload,generation:generationTag(n),formatVersion:2,ready:t.failed?0:2});cursor.delete();changed++;
      }else if(!t.failed&&t.ready!==2){cursor.update({...t,ready:2});changed++;}
     }
    }cursor.continue();});
   });
  });}
  async next(){const db=await this.db;return new Promise((resolve,reject)=>{
   const tx=db.transaction(['config','tasks']),control=tx.objectStore('config').get('control');control.onerror=()=>reject(control.error);control.onsuccess=()=>{
    const config=control.result||{},index=tx.objectStore('tasks').index('ready'),candidates=[];let finished=0;
    const done=t=>{if(t)candidates.push(t);if(++finished===2)resolve(candidates.sort((a,b)=>a.priority-b.priority||a.id-b.id)[0]||null);};
    for(const ready of [1,2]){const r=index.openCursor(IDBKeyRange.bound([ready],[ready+1],false,true));r.onsuccess=()=>{const c=r.result;if(!c)return done(null);const t=c.value;if(t.failed||t.lostOnDevice||t.invalidGeneration||(!t.type.startsWith('delete')&&(!config.enabled||config.deletePending||config.tombstones?.['id:'+t.session]||queueGeneration(t)!==config.generation))){c.continue();return;}done(t);};r.onerror=()=>reject(r.error);}
   };
  });}
  mutate(fn){return this.change(['config','sessions','tasks'],(tx,set,g,abort)=>{const cs=tx.objectStore('config'),r=cs.get('control');r.onsuccess=g(()=>{const c=r.result||{generation:0,enabled:false,epoch:0,block:0,retry:1000},u=cs.get('usage');u.onsuccess=g(()=>fn(tx,c,u.result||{bytes:0,count:0},v=>{cs.put(c,'control');set(v);},g,abort));});});}
  async append(row,chunk,canCreate,metadata,generation){
   // Compatibility callers may supply a live Blob; no Blob is written by this append path.
   if(chunk?.blob&&!chunk.data)chunk={...chunk,data:new Uint8Array(await chunk.blob.arrayBuffer()),mimeType:chunk.mimeType||chunk.blob.type};
   return this.mutate((tx,c,u,done,g)=>{
   if(!c.enabled||c.generation!==generation||c.deletePending||c.tombstones?.['id:'+row.id]){done(false);return;}
   const ss=tx.objectStore('sessions'),ts=tx.objectStore('tasks'),r=ss.get(row.id);r.onsuccess=g(()=>{
    let s=r.result;const fresh=!s;if(fresh){if(!canCreate){done(false);return;}s={id:row.id,eligible:true,events:0,audio:{},audioBytes:0,created:Date.now(),generation:generationTag(c.generation),formatVersion:2,eventStart:(row.events||[]).filter(e=>e.type==='start').at(-1)?.t||0};}
    if(!s.eligible||s.deleted||queueGeneration(s)!==c.generation){done(false);return;}
    s.generation=generationTag(c.generation);s.formatVersion=2;
    if(s.localPayloadLoss)metadata={...metadata,localPayloadLoss:s.localPayloadLoss};
    const pending=[];s.chunkCount||=0;s.payloadBytes||=0;
    const add=t=>{const bytes=size(taskPayload(t)??{});if(t.type==='audio'||t.type==='events'){if(s.chunkCount>=256||s.payloadBytes+bytes>30*1024*1024){s.transferLimited=true;return false;}s.chunkCount++;s.payloadBytes+=bytes;}pending.push({...t,session:row.id,generation:generationTag(c.generation),formatVersion:2,epoch:null,ready:2,created:Date.now(),bytes});return true;};
    if(size(metadata)>256*1024)throw Object.assign(new Error('Session metadata exceeds upload cap'),{code:'event_limit'});
    if(fresh)add({priority:1,type:'begin',body:{metadata,complete:false}});
    const events=row.events||[];for(let start=s.events;start<events.length;start+=32){const end=Math.min(events.length,start+32),batch=clean(events.slice(start,end).filter(e=>e.t>=s.eventStart));if(batch.length){const body=new TextEncoder().encode(JSON.stringify(batch));if(body.byteLength>CAP)throw Object.assign(new Error('Diagnostic event exceeds upload cap'),{code:'event_limit'});add({priority:2,type:'events',remote:'events-'+String(start).padStart(6,'0')+'-'+String(end).padStart(6,'0'),body:null,data:body,mime:'application/json'});}s.events=end;}
    if(chunk?.data&&!s.audio[chunk.index]){const data=bytesOf(chunk.data);for(let part=0;part<Math.ceil(data.byteLength/CAP);part++){const body=data.slice(part*CAP,(part+1)*CAP);if(s.audioBytes+body.byteLength>AUDIO_CAP){s.audioLimited=true;break;}s.audioBytes+=body.byteLength;add({priority:2,type:'audio',remote:'audio-'+String(chunk.index).padStart(6,'0')+'-'+String(part).padStart(4,'0'),body:null,data:body,mime:chunk.mimeType||row.mimeType||'application/octet-stream'});}s.audio[chunk.index]=true;}
    // Latest readings can use the already accepted JSON metadata path even when a binary chunk is stuck.
    // One immutable pending heartbeat per active eligible session, including events after the audio cap.
    if(!fresh&&s.remoteBegun&&canCreate&&!s.heartbeatPending&&Date.now()-(s.heartbeatAt||s.created)>=5000){
     add({priority:1,type:'heartbeat',body:{metadata:{...metadata,...(s.metadata?.uploadDiagnostic?{uploadDiagnostic:s.metadata.uploadDiagnostic}:{})}}});s.heartbeatPending=true;s.heartbeatAt=Date.now();
    }
    if(row.audioEnded&&!s.ended){add({priority:3,type:'end',body:{metadata:{...metadata,...(s.metadata?.uploadDiagnostic?{uploadDiagnostic:s.metadata.uploadDiagnostic}:{}),audioLimited:!!s.audioLimited,transferLimited:!!s.transferLimited},complete:true}});s.ended=true;}
    const bytes=pending.reduce((n,t)=>n+t.bytes,0);if(u.bytes+bytes>QUEUE_CAP||(fresh&&u.count>=SESSION_CAP))throw quota();
    pending.forEach(t=>ts.add(t));ss.put(s);u.bytes+=bytes;if(fresh)u.count++;tx.objectStore('config').put(u,'usage');done({limited:!!s.transferLimited});
   });
  });}
  diagnostic(task,detail){return this.mutate((tx,c,u,done,g)=>{
   if(!['blob-read','digest','request-build','fetch'].includes(detail.stage)||!c.enabled||c.deletePending||c.generation!==queueGeneration(task)||c.epoch!==task.epoch||c.tombstones?.['id:'+task.session]){done(false);return;}
   const ss=tx.objectStore('sessions'),ts=tx.objectStore('tasks'),r=ss.get(task.session);r.onsuccess=g(()=>{
    const s=r.result;if(!s?.eligible||s.deleted||!s.remoteBegun||s.begunEpoch!==c.epoch||!s.metadata||queueGeneration(s)!==c.generation||s.diagnosticStages?.[detail.lostOnDevice?'lost-on-device':detail.stage]){done(false);return;}
    const q=ts.get(task.id);q.onsuccess=g(()=>{
     const t=q.result;if(!t||t.failed||!['audio','events'].includes(t.type)||queueGeneration(t)!==c.generation||t.epoch!==c.epoch){done(false);return;}
     const metadata={...s.metadata,uploadDiagnostic:detail},metadataBytes=size(metadata),body={metadata},bytes=size(body),updates=[];let extra=0,tooLarge=metadataBytes>256*1024||bytes>CAP;
     const ends=ts.index('session').openCursor(IDBKeyRange.only(t.session));ends.onsuccess=g(()=>{
      const cursor=ends.result;if(cursor){const end=cursor.value;if(['end','heartbeat'].includes(end.type)&&!end.failed&&queueGeneration(end)===c.generation&&(end.epoch===null||end.epoch===c.epoch)){
       const nextBody={...end.body,metadata:{...end.body.metadata,uploadDiagnostic:detail}},nextBytes=size(nextBody);if(size(nextBody.metadata)>256*1024||nextBytes>CAP)tooLarge=true;
       extra+=nextBytes-(end.bytes||0);updates.push({...end,body:nextBody,bytes:nextBytes});
      }cursor.continue();return;}
      const total=u.bytes+bytes+metadataBytes-(s.metadataBytes||0)+extra;if(tooLarge||total>QUEUE_CAP){done(false);return;}
      // Same accepted session, JSON only. Omitted flags preserve complete/pinned.
      // Preserve the report through a queued final metadata write; never change chunk bytes.
      ts.add({priority:1,type:'diagnostic',session:t.session,body,generation:generationTag(c.generation),formatVersion:2,epoch:c.epoch,ready:2,created:Date.now(),bytes});updates.forEach(end=>ts.put(end));
      s.metadata=metadata;s.metadataBytes=metadataBytes;s.diagnosticStages={...s.diagnosticStages,[detail.lostOnDevice?'lost-on-device':detail.stage]:true};ss.put(s);u.bytes=total;tx.objectStore('config').put(u,'usage');done(true);
     });
    });
   });
  });}
  losePayload(task){return this.mutate((tx,c,u,done,g)=>{
   if(!c.enabled||c.deletePending||c.generation!==queueGeneration(task)||c.epoch!==task.epoch||c.tombstones?.['id:'+task.session]){done(false);return;}
   const ts=tx.objectStore('tasks'),ss=tx.objectStore('sessions'),r=ts.get(task.id);r.onsuccess=g(()=>{
    const t=r.result;if(!t||t.failed||queueGeneration(t)!==c.generation||t.epoch!==c.epoch||!['audio','events'].includes(t.type)){done(false);return;}
    const q=ss.get(t.session);q.onsuccess=g(()=>{
     const s=q.result;if(!s?.eligible||s.deleted||queueGeneration(s)!==c.generation){done(false);return;}
     const loss={reason:'lost-on-device',deliveryUnconfirmed:true,chunks:Math.min(256,(s.localPayloadLoss?.chunks||0)+1),bytes:(s.localPayloadLoss?.bytes||0)+(t.bytes||0),lastChunk:t.remote,lastKind:t.type,at:new Date().toISOString()};
     s.localPayloadLoss=loss;u.bytes=Math.max(0,u.bytes-(t.bytes||0));ts.delete(t.id);
     if(s.metadata){const metadata={...s.metadata,localPayloadLoss:loss},n=size(metadata);if(n<=256*1024&&u.bytes+n-(s.metadataBytes||0)<=QUEUE_CAP){u.bytes+=n-(s.metadataBytes||0);s.metadata=metadata;s.metadataBytes=n;}}
     const updates=ts.index('session').openCursor(IDBKeyRange.only(t.session));updates.onsuccess=g(()=>{const cursor=updates.result;if(cursor){const pending=cursor.value;if(pending.body?.metadata&&!pending.failed&&queueGeneration(pending)===c.generation){const metadata={...pending.body.metadata,localPayloadLoss:loss},body={...pending.body,metadata},n=size(body);if(size(metadata)<=256*1024&&n<=CAP&&u.bytes+n-(pending.bytes||0)<=QUEUE_CAP){u.bytes+=n-(pending.bytes||0);cursor.update({...pending,body,bytes:n});}}cursor.continue();}else{ss.put(s);tx.objectStore('config').put(u,'usage');done(true);}});
    });
   });
  });}
  remove(id){return this.mutate((tx,c,u,done,g)=>{const ts=tx.objectStore('tasks'),r=ts.get(id);r.onsuccess=g(()=>{if(r.result){u.bytes=Math.max(0,u.bytes-(r.result.bytes||0));ts.delete(id);tx.objectStore('config').put(u,'usage');}done();});});}
  cancelUploads(on=false,transient=false){return this.mutate((tx,c,u,done,g)=>{
   c.generation++;if(!transient){if(on&&c.deletePending)c.policyResumeOn=true;else delete c.policyResumeOn;}c.enabled=on&&!c.deletePending;
   let tasksDone=false,sessionsDone=false;const finish=()=>{if(tasksDone&&sessionsDone){tx.objectStore('config').put(u,'usage');done(c);}};
   const ss=tx.objectStore('sessions').openCursor();ss.onsuccess=g(()=>{const x=ss.result;if(x){u.bytes=Math.max(0,u.bytes-(x.value.metadataBytes||0));x.update({...x.value,eligible:false,metadata:null,metadataBytes:0});x.continue();}else{sessionsDone=true;finish();}});
   const r=tx.objectStore('tasks').openCursor();r.onsuccess=g(()=>{const x=r.result;if(x){if(!x.value.type.startsWith('delete')){u.bytes=Math.max(0,u.bytes-(x.value.bytes||0));x.delete();}x.continue();}else{tasksDone=true;finish();}});
  });}
  tombstone(id){return this.mutate((tx,c,u,done,g)=>{
   const ss=tx.objectStore('sessions'),r=ss.get(id);r.onsuccess=g(()=>{const saved=r.result;
    const fence=()=>{c.tombstones||={};if(!c.tombstones['id:'+id]&&Object.keys(c.tombstones).length>=200)throw Object.assign(new Error('Deletion fence limit reached; use Delete my recordings'),{code:'outbox_limit'});c.tombstones['id:'+id]=Date.now();if(saved){u.bytes=Math.max(0,u.bytes-(saved.metadataBytes||0));ss.put({...saved,eligible:false,deleted:true,metadata:null,metadataBytes:0});}
     const q=tx.objectStore('tasks').index('session').openCursor(IDBKeyRange.only(id));q.onsuccess=g(()=>{const x=q.result;if(x){u.bytes=Math.max(0,u.bytes-(x.value.bytes||0));x.delete();x.continue();}else{tx.objectStore('tasks').add({priority:0,session:id,type:'delete',ready:1,bytes:0,created:Date.now(),generation:c.generation});tx.objectStore('config').put(u,'usage');done();}});
    };
    if(saved)fence();else{const d=tx.objectStore('config').get('device');d.onsuccess=g(()=>{if(d.result?.token)fence();else done(false);});}
   });
  });}
  deleteBarrier(){return this.mutate((tx,c,u,done)=>{c.generation++;c.deleteGeneration=c.generation;delete c.policyResumeOn;c.tombstones={};c.enabled=false;c.deletePending=crypto.randomUUID();tx.objectStore('sessions').clear();tx.objectStore('tasks').clear();tx.objectStore('tasks').add({priority:0,type:'deleteAll',ready:1,operation:c.deletePending,generation:c.generation,bytes:0,created:Date.now()});tx.objectStore('config').put({bytes:0,count:0},'usage');done(c);});}
  // Atomically bind only an existing, still authorized task. Never reinsert a deleted task.
  authorize(id,owner,bind=true,startAttempt=false){return this.mutate((tx,c,u,done,g)=>{const now=Date.now();if(c.lease&&c.lease.owner!==owner&&c.lease.until>now){done(null);return;}const ts=tx.objectStore('tasks'),r=ts.get(id);r.onsuccess=g(()=>{const t=r.result;if(!t||t.failed||t.lostOnDevice){done(null);return;}const deletion=t.type.startsWith('delete');if(!deletion&&(!c.enabled||c.deletePending||c.tombstones?.['id:'+t.session]||queueGeneration(t)!==c.generation)){done(null);return;}if(c.block>now){done({blocked:c.block});return;}if(bind){if(!deletion&&t.epoch!==null&&t.epoch!==c.epoch){t.failed='stale epoch';t.ready=0;ts.put(t);done(null);return;}if(t.epoch==null)t.epoch=c.epoch;if(startAttempt){t.attemptCount=Math.min(1000000,(Number.isSafeInteger(t.attemptCount)&&t.attemptCount>=0?t.attemptCount:0)+1);if(!Number.isSafeInteger(t.attemptTrackingStarted)||t.attemptTrackingStarted<0||t.attemptTrackingStarted>now)t.attemptTrackingStarted=now;}ts.put(t);}c.lease={owner,until:now+30000};done({task:t,control:c});});});}
  release(owner){return this.mutate((tx,c,u,done)=>{if(c.lease?.owner===owner)delete c.lease;done();});}
  receipt(task,reply){return this.mutate((tx,c,u,done,g)=>{const ts=tx.objectStore('tasks'),r=ts.get(task.id);r.onsuccess=g(()=>{
   if(!r.result){done(false);return;}
   if(['begin','end','heartbeat'].includes(task.type)){
    const ss=tx.objectStore('sessions'),s=ss.get(task.session);s.onsuccess=g(()=>{
     if(!s.result||s.result.deleted||queueGeneration(s.result)!==queueGeneration(task)||c.generation!==queueGeneration(task))return;
     const metadata={...task.body.metadata,...(s.result.localPayloadLoss?{localPayloadLoss:s.result.localPayloadLoss}:{}),...(s.result.metadata?.uploadDiagnostic?{uploadDiagnostic:s.result.metadata.uploadDiagnostic}:{})},metadataBytes=size(metadata);
     u.bytes=Math.max(0,u.bytes-(s.result.metadataBytes||0)+metadataBytes);
     ss.put({...s.result,remoteBegun:true,begunEpoch:task.epoch,metadata,metadataBytes,...(task.type==='heartbeat'?{heartbeatPending:false}:{})});tx.objectStore('config').put(u,'usage');
    });
   }
   if(task.type==='deleteAll'){if(c.deletePending!==task.operation){done(false);return;}c.epoch=reply.epoch;c.deletePending=null;if(c.policyResumeOn)c.enabled=true;delete c.policyResumeOn;const d=tx.objectStore('config').get('device');d.onsuccess=g(()=>{if(d.result)tx.objectStore('config').put({...d.result,epoch:reply.epoch},'device');});}
   u.bytes=Math.max(0,u.bytes-(r.result.bytes||0));ts.delete(task.id);if(!['heartbeat','diagnostic'].includes(task.type)){c.block=0;c.retry=1000;}tx.objectStore('config').put(u,'usage');done(true);
  });});}
  defer(error,generation){return this.mutate((tx,c,u,done)=>{if(generation!==undefined&&c.generation!==generation){done(c.block||0);return;}c.retry=Math.max(error.retryAfter||0,Math.min(60000,(c.retry||1000)*2));c.block=Date.now()+c.retry;done(c.block);});}
  permanent(task,message){return this.mutate((tx,c,u,done,g)=>{if(task.session&&!task.type.startsWith('delete')){const ss=tx.objectStore('sessions'),s=ss.get(task.session);s.onsuccess=g(()=>{if(s.result)ss.put({...s.result,eligible:false,failed:message});});}const ts=tx.objectStore('tasks'),r=task.session?ts.index('session').openCursor(IDBKeyRange.only(task.session)):ts.openCursor(IDBKeyRange.only(task.id));r.onsuccess=g(()=>{const x=r.result;if(x){x.update({...x.value,failed:message,ready:0});x.continue();}else done();});});}
  retryFailed(){return this.mutate((tx,c,u,done,g)=>{const r=tx.objectStore('tasks').openCursor();r.onsuccess=g(()=>{const x=r.result;if(x){if(x.value.failed&&!x.value.lostOnDevice&&!x.value.invalidGeneration)x.update({...x.value,failed:null,ready:payloadReady(x.value)});x.continue();}else done();});});}
  prune(now=Date.now()){return this.mutate((tx,c,u,done,g)=>{const ss=tx.objectStore('sessions'),r=ss.index('created').openCursor(IDBKeyRange.upperBound(now-AGE));let removed=0;r.onsuccess=g(()=>{const x=r.result;if(!x){tx.objectStore('config').put(u,'usage');done(removed);return;}const q=tx.objectStore('tasks').index('session').openCursor(IDBKeyRange.only(x.value.id));q.onsuccess=g(()=>{const t=q.result;if(t){if(!t.value.type.startsWith('delete')){u.bytes=Math.max(0,u.bytes-(t.value.bytes||0));t.delete();}t.continue();}else{u.bytes=Math.max(0,u.bytes-(x.value.metadataBytes||0));x.delete();u.count=Math.max(0,u.count-1);removed++;x.continue();}});});});}
 }
 class NoosDebugTransfer {
  constructor(debug,endpoint){this.debug=debug;this.endpoint=endpoint.replace(/\/$/,'');this.store=new TransferDB();this.owner=crypto.randomUUID();this.operation=0;this.state='idle';this.accepting=debug.enabled;this.handlesToggle=true;this.writes=Promise.resolve();this.rowGenerations=new Map();this.enableReady=Promise.resolve();this.inventory=debug.rows().then(rows=>new Set(rows.map(r=>r.id)));this.originalWrite=debug.write.bind(debug);this.installUI();
   this.channel=typeof BroadcastChannel==='function'?new BroadcastChannel('harmony-noos-transfer-v1'):null;this.channel?.addEventListener('message',e=>{this.operation++;this.controller?.abort();if(e.data?.off)this.forceOff();this.syncControl().catch(e=>this.failStorage(e));});
   this.ready=(async()=>{await this.store.control(debug.enabled,debug.preferenceVersion||2);this.channel?.postMessage({changed:true,policyVersion:debug.preferenceVersion||2});if(!debug.enabled)await this.store.cancelUploads(false);if(await this.store.protectQueue())this.channel?.postMessage({changed:true,queueFormatVersion:2});await this.store.prune();await this.syncControl();this.revealNotice();this.schedule();})().catch(e=>this.failStorage(e));
   debug.write=(row,remove=false,chunk=null)=>{const tag=this.rowGenerations.get(row.id)??this.control?.generation??0;this.rowGenerations.set(row.id,tag);const operation=async()=>{await this.ready;const legacy=await this.inventory;const saved=await this.store.get('sessions',row.id),control=await this.store.get('config','control');if(!remove&&(saved?.deleted||control.tombstones?.['id:'+row.id]||(control.deleteGeneration&&(tag<control.deleteGeneration||(legacy.has(row.id)&&!saved)))))return;if(remove){await this.store.tombstone(row.id);this.invalidate();await this.originalWrite(row,true);this.schedule();return;}await this.originalWrite(row,false,chunk);await this.enableReady;if(!this.accepting||!debug.enabled||this.storageFailed)return;const meta=clean({...row,events:undefined,blob:undefined,environment:window.harmonySessionMetadata?.(),app:'harmony',appVersion:row.version||document.querySelector('meta[name="harmony-version"]')?.content,purpose:'debug',recordingPolicyVersion:'2026-11-15-beta-default-on-v2'});const result=await this.store.append(row,chunk,debug.activeId===row.id&&!legacy.has(row.id),meta,this.control.generation);if(result?.limited){this.captureError='Session transfer limit reached; complete audio remains in local Export.';this.failureReason='This session reached the upload limit. Complete audio remains in local Export.';this.state='error';this.status(this.captureError);}this.schedule();};this.writes=this.writes.catch(()=>{}).then(operation).catch(e=>{if(['outbox_limit','event_limit'].includes(e.code)){this.captureError=e.message;this.recordFailure(e);this.state='error';this.status('Not sent: '+e.message);this.schedule();}else this.failStorage(e);});return this.writes;};
   debug.panel.querySelector('input').addEventListener('change',()=>{this.setEnabled(debug.enabled,!!debug.suppressPreferenceWrite).catch(e=>this.failStorage(e));});window.addEventListener('storage',e=>{if(e.key===(debug.preferenceKey||'harmony-debug-v2')&&e.newValue==='off'){this.operation++;this.controller?.abort();this.forceOff();}});window.addEventListener('online',()=>this.schedule());document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.syncControl().then(()=>{if(!this.noticed)this.revealNotice();this.schedule();}).catch(e=>this.failStorage(e));});
   this.maintenance=setInterval(()=>this.store.prune().then(n=>{if(n)this.status('Expired offline debug transfers removed after 30 days.');this.schedule();}).catch(e=>this.failStorage(e)),60000);
  }
  installUI(){const d=this.debug,p=d.panel;const status=document.createElement('p');status.id='noosTransferStatus';status.className='hint';p.append(status);this.statusNode=status;const del=document.createElement('button');del.type='button';del.textContent='Delete my recordings';del.onclick=()=>{if(confirm('Remove every recording sent from this browser and turn Recording off? This ends access at once; backup copies may last longer.'))this.deleteAll().catch(e=>this.status('Deletion pending: '+e.message));};p.append(del);const retry=document.createElement('button');retry.type='button';retry.textContent='Retry sending';retry.onclick=()=>{this.storageFailed=false;this.captureError=null;this.permanentError=null;this.failureReason=null;this.limitError=false;this.store.retryFailed().then(()=>this.schedule()).catch(e=>this.failStorage(e));};p.append(retry);const notice=document.getElementById('firstDebugNotice');notice.hidden=!d.enabled;notice.classList.add('beta-upload-notice');notice.firstChild.textContent='Beta: mic audio sent to Ideaflow to debug ';const hint=p.querySelector('p.hint');if(hint)hint.textContent='Ideaflow (Jacob Cole and those working on Harmony with him, including AI assistants) receives microphone audio, app sound and technical readings for debugging this beta. Ideaflow can open a recording for 30 days. After that it cannot be opened and its stored file is removed. Inaccessible backup copies may persist longer; their cleanup time is not yet known. Removing a recording ends access right away. Offline transfers are capped at100 MiB / 200 sessions and expire after 30 days. Private: never published or shared.';}
  revealNotice(){
   this.noticed=false;const ticket=this.noticeOperation=(this.noticeOperation||0)+1;
   if(!this.accepting||!this.debug.enabled||document.hidden)return;
   const notice=document.getElementById('firstDebugNotice');notice.hidden=false;
   // Two callbacks leave a rendering opportunity after the notice is revealed.
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(ticket!==this.noticeOperation||!this.accepting||!this.debug.enabled||document.hidden)return;
    const r=notice.getBoundingClientRect(),style=getComputedStyle(notice);
    if(!notice.hidden&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0){this.noticed=true;this.noticeShownAt=performance.now();this.schedule();}
   }));
  }
  renderIndicator(button){const on=this.debug.enabled,recording=on&&this.debug.recorder?.state==='recording';let label=!on?'Recording off':recording?'Recording':'Recording on';if(on&&this.state==='sending'&&!recording)label='Sending';if(on&&this.state==='offline')label=(recording?'Recording':'Recording on')+' · will send when online';if(on&&this.state==='error')label=(recording?'Recording':'Recording on')+(this.limitError||/limit|cap/i.test(this.captureError||'')?' · limit reached':' · not sent');const caption=button.querySelector('span');if(caption.textContent!==label)caption.textContent=label;button.setAttribute('aria-live','polite');button.setAttribute('aria-atomic','true');button.classList.toggle('off',!on);button.classList.toggle('failure',on&&this.state==='error');button.classList.toggle('uploading',on&&this.state==='sending');button.setAttribute('aria-label',label+(on?'. Click to turn recording and upload off.':'. Click to turn recording and upload on.'));button.title=label;}
  status(text){this.statusNode.textContent=text;}
  stageError(error,stage){const e=new Error(typeof error?.message==='string'?error.message:'Upload operation failed');e.name=typeof error?.name==='string'?error.name:'Error';for(const key of ['status','code','retryAfter'])if(error?.[key]!==undefined)e[key]=error[key];e.uploadStage=stage;return e;}
  failureDetail(error={},task={},savedToken){
   const stages=['blob-read','digest','request-build','fetch'];if(!stages.includes(error.uploadStage))return null;
   const scrub=value=>{let text=typeof value==='string'?value:'';for(const token of [this.device?.token,savedToken])if(token)text=text.split(token).join('[credential]');return text.replace(/\bBearer\s+[^\s,;]+/gi,'Bearer [credential]').replace(/hdi_[^\s"'<>]+/gi,'[credential]').replace(/(?:https?:\/\/|blob:|data:)[^\s"'<>]+/gi,'[URL]').replace(/(?:authorization|cookie|x-api-key)\s*[:=][^\n]+/gi,'[credential]').replace(/[A-Za-z0-9_+\/=\-]{40,}/g,'[redacted]').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,160);};
   const names=['Error','TypeError','RangeError','SyntaxError','AbortError','NotSupportedError','NotReadableError','SecurityError','DataCloneError','OperationError','InvalidStateError','QuotaExceededError','NetworkError','NotAllowedError','NotFoundError','UnknownError','InvalidAccessError','DataError','TimeoutError'];
   let subtleDigest=false;try{subtleDigest=typeof crypto.subtle?.digest==='function';}catch(_){}
   const now=Date.now(),number=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
   // Counts start when this instrumentation first attempts a task; never invent legacy retry history.
   return {stage:error.uploadStage,errorName:names.includes(error.name)?error.name:'Error',message:scrub(error.message),chunkBytes:['audio','events'].includes(task.type)?number(size(taskPayload(task))):null,taskBytes:number(task.bytes),kind:['audio','events','begin','end','diagnostic','heartbeat','delete','deleteAll'].includes(task.type)?task.type:null,attemptCount:number(task.attemptCount,1000000),attemptTrackingStartedAt:number(task.attemptTrackingStarted,now)!==null?new Date(task.attemptTrackingStarted).toISOString():null,taskAgeMs:number(task.created)!==null?Math.max(0,now-task.created):null,blobType:scrub(taskPayload(task) instanceof Blob?taskPayload(task).type:''),contentType:scrub(['audio','events'].includes(task.type)?task.mime||taskPayload(task)?.type||'application/octet-stream':'application/json'),secureContext:!!window.isSecureContext,blobArrayBuffer:typeof Blob.prototype.arrayBuffer==='function',subtleDigest,at:new Date(now).toISOString(),...(error.uploadStage==='blob-read'&&error.name==='NotFoundError'?{lostOnDevice:true}:{})};
  }
  async queueFailure(task,error){
   if(!task||!['audio','events'].includes(task.type)||error.name==='AbortError'||error.status||!this.accepting||!this.debug.enabled||!this.noticed)return;
   const device=await this.store.get('config','device');if(!device?.token)return;
   const detail=this.failureDetail(error,task,device.token);if(detail)await this.store.diagnostic(task,detail);
  }
  recordFailure(error={},task){
   const status=Number.isInteger(error.status)&&error.status>=100&&error.status<=599?error.status:null;
   let reason;
   if(error.uploadStage==='blob-read'&&error.name==='NotFoundError')reason='The local copy of one recording part is unavailable; delivery could not be confirmed. Other parts and new sessions can still send.';
   else if(error.code==='upload_timeout')reason='Sending timed out after 20 seconds. This recording stays here and will retry.';
   else if(error.code==='local_storage')reason='This browser could not save the upload queue. Local Export still works.';
   else if(error.code==='event_limit')reason='The diagnostic data is too large to send. Local Export still works.';
   else if(error.code==='storage_pending')reason='The server is still checking whether the upload was saved. Sending will retry safely.';
   else if(error.code==='outbox_limit')reason='This browser’s upload queue is full. Local Export still works.';
   else if(/acknowledgement|checksum/i.test(error.message||''))reason='The server reply did not confirm the recording correctly. Sending has stopped.';
   else if(/deletion cleanup pending/i.test(error.message||''))reason='Access has ended; the server is still removing the stored file.';
   else reason=({400:'The server rejected this recording’s data.',401:'The server did not accept this browser’s upload credential.',403:'The server refused uploads from this browser.',404:'The server could not find this recording.',409:'The server rejected a conflicting recording upload.',410:'This recording was removed or expired on the server.',413:'This recording is too large to send.',415:'The server does not support this audio format.',422:'The server reply could not be verified.',429:'The upload limit was reached. Sending will retry later.',503:'The upload server is unavailable. Sending will retry.',507:'The server’s recording storage is full.'})[status]||(navigator.onLine===false?'This device is offline. Sending will retry when it reconnects.':'Sending failed at an unknown stage. Local Export is available; sending will retry.');
   const detail=this.failureDetail(error,task);if(detail&&!detail.lostOnDevice){const labels={'blob-read':'Reading the recording in this browser','digest':'Preparing the secure upload checksum','request-build':'Preparing the upload request','fetch':'Connecting to the upload server'};reason=error.status||error.code==='upload_timeout'?reason+' Stage: '+detail.stage+'.':labels[detail.stage]+' failed ('+detail.errorName+'). The recording stays here; sending will retry.';}
   this.failureReason=reason;
   const allowed=['invalid_token','chunk_conflict','stale_epoch','payload_too_large','metadata_limit','chunk_limit','storage_pending','rate_limit','session_limit','checksum_mismatch','invalid_audio_mime','deleted','not_found','local_storage','outbox_limit','event_limit','upload_timeout'];
   const code=allowed.includes(error.code)?error.code:status?'http_'+status:'network_or_protocol';
   if(this.debug.enabled)window.harmonySinger?.logEvent?.('debug-transfer-error',{status,code,reason,...(detail?{uploadDiagnostic:detail}:{})});
   return reason;
  }
  failStorage(){this.storageFailed=true;this.state='error';this.controller?.abort();this.status(this.recordFailure({code:'local_storage'}));}
  invalidate(){this.operation++;this.controller?.abort();this.channel?.postMessage({changed:true});}
  forceOff(persist=false){if(!this.debug.enabled&&!persist)return;const previous=this.debug.suppressPreferenceWrite;this.debug.suppressPreferenceWrite=persist?previous:true;try{const input=this.debug.panel.querySelector('input');input.checked=false;input.dispatchEvent(new Event('change'));}finally{this.debug.suppressPreferenceWrite=previous;}}
  async syncControl(){this.control=await this.store.get('config','control');this.device=await this.store.get('config','device');this.block=this.control?.block||0;this.accepting=!!this.control?.enabled&&this.debug.enabled;if(!this.control?.enabled)this.forceOff();}
  async setEnabled(on,transient=false){const operation=++this.operation;this.noticeOperation=(this.noticeOperation||0)+1;this.noticed=false;if(!on)document.getElementById('firstDebugNotice').hidden=true;this.accepting=false;this.controller?.abort();if(!on)this.channel?.postMessage({off:true});this.enableReady=this.store.cancelUploads(on,transient);const c=await this.enableReady;this.channel?.postMessage({changed:true});if(operation!==this.operation)return;this.control=c;this.accepting=c.enabled&&this.debug.enabled;if(on&&!c.enabled)this.forceOff();this.state=this.accepting?'idle':'off';if(this.accepting)this.revealNotice();this.status(this.accepting?'Beta recording on.':transient&&c.deletePending?'Recording is temporarily off while a previous removal finishes. Reload afterward to use the new default.':'Recording off. Pending uploads discarded; deletions still retry.');this.schedule();}
  schedule(delay=300){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.drain();},Math.max(delay,(this.block||0)-Date.now()));}
  async request(path,method,body,headers={}){
   const controller=new AbortController();this.controller=controller;let timedOut=false,stage='request-build';
   const timeout=setTimeout(()=>{if(!controller.signal.aborted){timedOut=true;controller.abort();}},20000);
   try{
    const request=new Request(this.endpoint+path,{method,mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{...(this.device?.token?{Authorization:'Bearer '+this.device.token}:{}),'Content-Type':body instanceof Blob?body.type||'application/octet-stream':'application/json',...headers},body:body instanceof Blob?body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    stage='fetch';const r=await fetch(request);let data={};try{data=await r.json();}catch(e){if(controller.signal.aborted)throw e;}
    if(timedOut)throw new Error('Upload timed out');if(!r.ok)throw Object.assign(new Error('HTTP '+r.status),{status:r.status,code:data.error,retryAfter:Number(r.headers.get('Retry-After'))*1000});return data;
   }catch(e){throw this.stageError(timedOut?Object.assign(new Error('Upload timed out'),{code:'upload_timeout'}):e,stage);}
   finally{clearTimeout(timeout);if(this.controller===controller)this.controller=null;}
  }
  async enroll(){const saved=await this.store.get('config','device');if(saved?.token){this.device=saved;return;}const installId=window.harmonyInstallId||crypto.randomUUID(),d=await this.request('/devices','POST',{installId});if(typeof d.deviceId!=='string'||!/^([a-f0-9]{32})$/.test(d.deviceId)||typeof d.token!=='string'||!/^hdi_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(d.token)||!d.token.startsWith('hdi_'+d.deviceId+'.')||!Number.isSafeInteger(d.epoch)||d.epoch<0)throw Object.assign(new Error('Invalid enrollment acknowledgement'),{status:422});const device={deviceId:d.deviceId,token:d.token,epoch:d.epoch,installId,limits:d.limits||{}};this.device=await this.store.config('device',device);}
  async drain(){if(this.busy||this.storageFailed)return;this.busy=true;let task,removalMessage,taskOperation;try{await this.ready;await this.syncControl();while((task=await this.store.next())){
    let claim=await this.store.authorize(task.id,this.owner,false);if(!claim){this.schedule(1000);break;}if(claim.blocked){this.block=claim.blocked;this.schedule();break;}task=claim.task;const deleting=task.type.startsWith('delete'),operation=this.operation;taskOperation=operation;
    if(!deleting&&(!this.accepting||!this.debug.enabled||!this.noticed))break;
    if(!this.device?.token){if(['diagnostic','heartbeat'].includes(task.type)){await this.store.remove(task.id);continue;}if(deleting){await this.store.receipt(task,{epoch:claim.control.epoch});this.status('Removed local copies. No server device was enrolled.');continue;}await this.enroll();}
    // Enrollment, credential persistence and tab changes may revoke the original task.
    claim=await this.store.authorize(task.id,this.owner,true,true);if(!claim||claim.blocked||(!deleting&&(operation!==this.operation||!this.accepting||!this.debug.enabled||!this.noticed)))continue;
    task=claim.task;this.device=await this.store.get('config','device');let digest;
    let buffer;const payload=taskPayload(task),binary=['audio','events'].includes(task.type);
    if(binary){
     try{if(size(payload)>(this.device.limits.chunkBytes||this.device.limits.request_bytes||CAP))throw Object.assign(new Error('Negotiated request cap exceeded'),{status:413});buffer=isBytes(payload)?bytesOf(payload).slice().buffer:await payload.arrayBuffer();}catch(e){throw this.stageError(e,'blob-read');}
     claim=await this.store.authorize(task.id,this.owner);if(!claim||claim.blocked||operation!==this.operation||!this.accepting||!this.debug.enabled||!this.noticed)continue;
     try{digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');}catch(e){throw this.stageError(e,'digest');}
    }
    claim=await this.store.authorize(task.id,this.owner);if(!claim||claim.blocked||(!deleting&&(operation!==this.operation||!this.accepting||!this.debug.enabled||!this.noticed)))continue;
    task=claim.task;this.state=deleting?'deleting':'sending';const headers={'X-Upload-Epoch':String(task.epoch)};let reply;
    if(task.type==='deleteAll'){reply=await this.request('/sessions','DELETE',{operationId:task.operation},headers);this.checkDeletion(reply);}
    else if(task.type==='delete'){reply=await this.request('/sessions/'+task.session,'DELETE',undefined,headers);this.checkDeletion(reply);}
    else if(task.type==='audio'||task.type==='events'){if(size(payload)>(this.device.limits.chunkBytes||this.device.limits.request_bytes||CAP))throw Object.assign(new Error('Negotiated request cap exceeded'),{status:413});reply=await this.request('/sessions/'+task.session+'/chunks/'+task.remote,'PUT',new Blob([buffer],{type:task.mime}),{...headers,'Content-Type':task.mime,'X-Chunk-Kind':task.type});if(reply.id!==task.remote||reply.bytes!==size(taskPayload(task))||reply.sha256!==digest)throw Object.assign(new Error('Chunk acknowledgement mismatch'),{status:409});}
    else{reply=await this.request('/sessions/'+task.session,'PUT',task.body,headers);if(reply.id!==task.session||reply.epoch!==task.epoch||reply.saved!==true)throw Object.assign(new Error('Session acknowledgement mismatch'),{status:409});}
    if(!['diagnostic','heartbeat'].includes(task.type)){this.limitError=false;if(!this.permanentError&&!this.captureError)this.failureReason=null;}const acknowledged=await this.store.receipt(task,reply);if(deleting&&acknowledged){removalMessage=this.removalSummary(task,reply);this.status(removalMessage);}this.block=0;
   }if(this.accepting){this.state=this.captureError||this.permanentError||this.failureReason?'error':navigator.onLine?'idle':'offline';this.status(this.captureError||this.permanentError||this.failureReason||removalMessage|| (navigator.onLine?'Beta diagnostics sent privately to Ideaflow.':'Recording · will send when online'));}
  }catch(e){
   const deleting=task?.type.startsWith('delete'),stale=()=>!!task&&!deleting&&(taskOperation!==this.operation||!this.accepting||!this.debug.enabled||!this.noticed);
   if(stale())return;
   if(task&&!deleting){const claim=await this.store.authorize(task.id,this.owner,false).catch(()=>null);if(!claim||claim.blocked||stale())return;}
   if(e.name!=='AbortError'){this.recordFailure(e,task);await this.queueFailure(task,e).catch(()=>{});if(stale())return;}
   if(task&&['audio','events'].includes(task.type)&&e.uploadStage==='blob-read'&&e.name==='NotFoundError'){const lost=await this.store.losePayload(task).catch(()=>{this.failStorage();return false;});if(stale())return;if(lost){this.localLossNote='An older recording part could not be recovered. New recordings can still send.';this.failureReason=this.captureError||this.permanentError||null;this.state=this.captureError||this.permanentError?'error':navigator.onLine?'idle':'offline';this.status(this.captureError||this.permanentError||this.localLossNote);this.schedule(0);}return;}
   this.limitError=[413,429,507].includes(e.status);this.state=this.accepting?'error':'off';
   if(task&&[400,401,403,404,409,410,413,415,422,507].includes(e.status)){
    await this.store.permanent(task,'HTTP '+e.status).catch(()=>this.failStorage());if(stale())return;
    this.permanentError=this.failureReason+' Local Export remains available.';this.status(this.permanentError);
   }else if(e.name!=='AbortError'){
    this.status(this.accepting?this.failureReason:'Recording off. Pending deletion will retry.');
    const block=await this.store.defer(e,deleting?undefined:queueGeneration(task)).catch(()=>{this.failStorage();return Date.now()+60000;});if(stale())return;this.block=block;
   }
   this.schedule();
  }finally{await this.store.release(this.owner).catch(()=>this.failStorage());this.busy=false;if(!this.timer&&!this.storageFailed){const next=await this.store.next().catch(()=>null);if(next)this.schedule();}}}
  removalSummary(task,reply){if(task.type==='delete')return 'Removed. It can no longer be opened.';const n=reply.deletedCount;return Number.isSafeInteger(n)&&n>=0?'Removed '+n+' recording'+(n===1?'':'s')+'. '+(n===1?'It':'They')+' can no longer be opened.':'Removed recordings from this browser. They can no longer be opened.';}
  checkDeletion(reply){for(const key of ['sessionCount','deletedCount'])if(reply[key]!==undefined&&(!Number.isSafeInteger(reply[key])||reply[key]<0))throw Object.assign(new Error('Invalid removal count'),{status:422});if(reply.deletedCount!==undefined&&reply.sessionCount!==undefined&&reply.deletedCount>reply.sessionCount)throw Object.assign(new Error('Inconsistent removal count'),{status:422});if(reply.deleted!==true||!Number.isSafeInteger(reply.epoch)||reply.epoch<0)throw Object.assign(new Error('Deletion acknowledgement missing'),{status:422});if(reply.cleanupComplete!==true||reply.reconciliationRequired!==false)throw Object.assign(new Error('Server deletion cleanup pending'),{retryAfter:2000});}
  async deleteAll(){this.accepting=false;this.invalidate();await this.store.deleteBarrier();this.channel?.postMessage({changed:true});this.forceOff(true);this.debug.stop();await this.writes;for(const row of await this.debug.rows())await this.originalWrite(row,true);this.status('Removed local copies. Server removal is pending.');this.schedule();await this.debug.review();}
 }
 window.HarmonyNoosTransfer={TransferDB,NoosDebugTransfer};
 window.addEventListener('DOMContentLoaded',()=>{const endpoint=window.HARMONY_DEBUG_ENDPOINT||'';if(window.HARMONY_DEBUG_UPLOAD_ENABLED===true&&/^https:\/\/globalbr\.ai\/api\/ingest\/harmony\/v1$/.test(endpoint))window.harmonyDebugUpload=new NoosDebugTransfer(harmonyDebug,endpoint);});
})();
