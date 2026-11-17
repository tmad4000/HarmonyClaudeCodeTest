/* Native lifecycle adapter; no DSP or engine replacement. */
window.addEventListener('DOMContentLoaded', () => {
 const h=window.harmonySinger, p=window.Capacitor?.Plugins?.HarmonyAudioSession;
 if(!h||!p)return;
 let starting=false, generation=0, captureAttempt=null, attemptContext=null;
 const contextState=()=>{try{const c=window.Tone?.getContext()?.rawContext;return {state:c?.state||null,sampleRate:c?.sampleRate||null};}catch(e){return {error:String(e.message||e)};}};
 const activation=()=>({isActive:navigator.userActivation?.isActive??null,hasBeenActive:navigator.userActivation?.hasBeenActive??null});
 const media=navigator.mediaDevices;
 if(media?.getUserMedia){
  const getUserMedia=media.getUserMedia.bind(media);
  media.getUserMedia=async constraints=>{
   captureAttempt={constraints:JSON.parse(JSON.stringify(constraints,(key,value)=>['deviceId','groupId'].includes(key)?undefined:value)),secureContext:window.isSecureContext,origin:location.origin,mediaDevices:!!media,getUserMedia:typeof media?.getUserMedia==='function',userActivation:activation(),contextBefore:contextState()};
   try{const stream=await getUserMedia(constraints);captureAttempt.contextAfter=contextState();return stream;}
   catch(error){captureAttempt.native=await p.getRoute().catch(()=>null);captureAttempt.contextAfter=contextState();captureAttempt.error={name:error.name||'Error',message:String(error.message||error),constraint:typeof error.constraint==='string'?error.constraint:null};throw error;}
  };
 }
 const reportFailure=async error=>{
  const native=captureAttempt?.native||await p.getRoute().catch(e=>({diagnosticsError:String(e.message||e)}));
  let permission='unavailable';
  try{permission=(await navigator.permissions.query({name:'microphone'})).state;}catch(_){}
  const failure={name:error?.name||error?.code||'Error',message:String(error?.message||error),constraint:typeof error?.constraint==='string'?error.constraint:null,permission,native,attempt:attemptContext,contextAfter:contextState(),
   capture: captureAttempt||{constraints:null,attempted:false,secureContext:window.isSecureContext,origin:location.origin,mediaDevices:!!media,getUserMedia:typeof media?.getUserMedia==='function',userActivation:activation()}};
  h.logEvent('mic-start-failed',failure);
  const denied=native.recordPermission==='denied'||permission==='denied'||failure.name==='NotAllowedError'||error?.code==='MIC_PERMISSION_DENIED';
  const reason=denied?'Microphone permission denied: enable in Settings → Harmony':!media?.getUserMedia?'Microphone capture is unavailable in this app. Update Harmony and try again.':'Microphone could not start: '+failure.message;
  h.setStatus(reason,'error');
  const d=window.harmonyDebug,transfer=window.harmonyDebugUpload;
  if(!d?.enabled||!transfer)return;
  await transfer.ready;
  // The same upload gate requires the visible notice to have painted; Off wins.
  for(let i=0;i<100&&d.enabled&&transfer.accepting&&!transfer.noticed&&!document.hidden;i++)await new Promise(resolve=>setTimeout(resolve,20));
  if(!d.enabled||!transfer.accepting||!transfer.noticed)return;
  const id=crypto.randomUUID(),now=Date.now();
  const row={id,kind:'mic-start-failed',started:now,ended:now,audioEnded:true,events:[{type:'mic-start-failed',t:0,...failure}],bytes:0,
   settings:h.snapshotSettings(),version:document.querySelector('meta[name="harmony-version"]')?.content,browser:navigator.userAgent};
  d.activeId=id;d.latestId=id;
  try{await d.write(row);}finally{if(d.activeId===id)d.activeId=null;}
 };
 document.addEventListener('click',event=>{const a=event.target.closest?.('a');if(!a)return;const page=a.getAttribute('href');if(page==='neural-experiment.html'||page==='privacy.html'){event.preventDefault();(page==='privacy.html'?p.openPrivacy():p.openNeural()).catch(()=>{});}},true);
 let idleCleanup=Promise.resolve();
 const mediaState=active=>{
  const session=navigator.mediaSession;if(!session)return;
  const safely=fn=>{try{fn();}catch(error){h.logEvent('native-media-session-error',{name:error.name});}};
  safely(()=>{session.metadata=active&&typeof MediaMetadata==='function'?new MediaMetadata({title:'Harmony',artist:'Ideaflow',artwork:[{src:new URL('harmony-app-icon.png',location.href).href,sizes:'1024x1024',type:'image/png'}]}):null;});
  safely(()=>{session.playbackState=active?'playing':'none';});
  for(const [action,handler] of [['play',()=>{if(!h.isRunning&&!starting)void h.start();}],['pause',()=>h.stop()],['stop',()=>h.stop()]])safely(()=>session.setActionHandler(action,active?handler:null));
 };
 const clearMedia=()=>{
  mediaState(false);
  for(const element of document.querySelectorAll('audio,video')){
   try{element.pause();element.srcObject?.getTracks?.().forEach(track=>track.stop());element.srcObject=null;element.removeAttribute('src');element.load();}catch(error){h.logEvent('native-media-cleanup-error',{name:error.name});}
  }
  const context=window.Tone?.getContext()?.rawContext;
  let suspended;
  try{suspended=context&&context.state!=='closed'&&context.state!=='suspended'?context.suspend():Promise.resolve();}catch(error){suspended=Promise.reject(error);}
  idleCleanup=Promise.allSettled([idleCleanup,suspended]).then(results=>{for(const result of results)if(result.status==='rejected')h.logEvent('native-idle-cleanup-error',{name:result.reason?.name||'Error'});return p.release();}).catch(error=>{h.logEvent('native-release-error',{name:error.name});});
  return idleCleanup;
 };
 window.harmonyNativeIdle=()=>idleCleanup;
 mediaState(false);
 const originalStart=h.start.bind(h), originalStop=h.stop.bind(h);
 const route = data => { window.harmonyNativeRoute=data; h.logEvent('native-route',data); };
 const originalMetadata=window.harmonySessionMetadata;
 window.harmonySessionMetadata=()=>({...originalMetadata?.(),native:window.harmonyNativeRoute?.nativeBuild||{platform:'ios',sessionOwner:'webkit'},nativeRoute:window.harmonyNativeRoute||null});
 const applyRoute = data => {
  route(data);
  h.setSpeakerMode(data.outputType==='speaker');
 };
 h.start=async function(...args){
  if(starting||h.starting||h.isRunning)return;
  starting=true;const own=++generation;
  captureAttempt=null;attemptContext={contextBefore:contextState(),userActivation:activation(),mediaDevices:!!media,getUserMedia:typeof media?.getUserMedia==='function',secureContext:window.isSecureContext};
  // Match the reviewed web session selection before the native tap-time resume.
  try { if(navigator.audioSession)navigator.audioSession.type='play-and-record'; } catch(_) {}
  // Resume Web Audio inside the original tap, before any native promise yields.
  try {
   const audioReady=Promise.resolve(window.Tone?.start()).then(()=>null,error=>error);
   await idleCleanup;
   if(own!==generation)return;
   const data=await p.prepare();route(data);attemptContext.nativeAfterPrepare=data;attemptContext.contextAfterPrepare=contextState();
   if(own!==generation){await p.release();return;}
   const audioError=await audioReady;
   if(own!==generation){await p.release();return;}
   if(audioError)throw audioError;
   applyRoute(data);await originalStart(...args);
   // The engine reports failures in lastError rather than rejecting its promise.
   if(h.lastError){await reportFailure(h.lastError);await p.release();return;}
   if(own!==generation){originalStop();if(attemptContext?.interruption)await reportFailure(Object.assign(new Error('Audio was interrupted while the microphone was starting; tap Sing again.'),{name:'AbortError'}));await p.release();return;}
   if(h.isRunning){const activeRoute=await p.activate();if(own!==generation){originalStop();await p.release();return;}route(activeRoute);mediaState(true);}else {await reportFailure(new Error('Microphone startup stopped before capture became active'));await p.release();}
  } catch(error){
   originalStop();h.lastError=error;
   await reportFailure(error).catch(e=>h.logEvent('diagnostic-error',{message:String(e.message||e)}));
   await p.release().catch(()=>{});
  }
  finally { starting=false;if(!h.isRunning)await clearMedia(); }
 };
 h.stop=function(...args){if(!args[0])generation++;const result=originalStop(...args);if(!args[0])void clearMedia();return result;};
 const routeIdentity=data=>JSON.stringify({sampleRate:data?.sampleRate,inputs:(data?.inputs||[]).map(x=>({type:x.type,name:x.name})),outputs:(data?.outputs||[]).map(x=>({type:x.type,name:x.name}))});
 p.addListener('routeChanged',data=>{if(starting){applyRoute(data);h.logEvent('native-startup-route',data);return;}if(routeIdentity(data)===routeIdentity(window.harmonyNativeRoute)){route(data);h.logEvent('native-route-unchanged',{reason:data.reason});return;}h.stop();applyRoute(data);h.logEvent('native-stopped',{reason:'route-change'});});
 p.addListener('sessionChanged',route);
 p.addListener('interrupted',data=>{if(starting&&attemptContext)attemptContext.interruption=data;h.stop();h.logEvent('native-stopped',data);});
 p.getRoute().then(route).catch(()=>{});
 void clearMedia();
});
