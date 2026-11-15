/* Native lifecycle adapter; no DSP or engine replacement. */
window.addEventListener('DOMContentLoaded', () => {
 const h=window.harmonySinger, p=window.Capacitor?.Plugins?.HarmonyAudioSession;
 if(!h||!p)return;
 let starting=false, generation=0, captureAttempt=null;
 const media=navigator.mediaDevices;
 if(media?.getUserMedia){
  const getUserMedia=media.getUserMedia.bind(media);
  media.getUserMedia=async constraints=>{
   captureAttempt={constraints:JSON.parse(JSON.stringify(constraints,(key,value)=>['deviceId','groupId'].includes(key)?undefined:value)),secureContext:window.isSecureContext,origin:location.origin};
   try{return await getUserMedia(constraints);}
   catch(error){captureAttempt.native=await p.getRoute().catch(()=>null);captureAttempt.error={name:error.name||'Error',message:String(error.message||error)};throw error;}
  };
 }
 const reportFailure=async error=>{
  const native=captureAttempt?.native||await p.getRoute().catch(e=>({diagnosticsError:String(e.message||e)}));
  let permission='unavailable';
  try{permission=(await navigator.permissions.query({name:'microphone'})).state;}catch(_){}
  const failure={name:error?.name||error?.code||'Error',message:String(error?.message||error),permission,native,
   capture: captureAttempt||{constraints:null,attempted:false,secureContext:window.isSecureContext,origin:location.origin}};
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
 const originalStart=h.start.bind(h), originalStop=h.stop.bind(h);
 const route = data => { window.harmonyNativeRoute=data; h.logEvent('native-route',data); };
 const applyRoute = data => {
  route(data);
  h.setSpeakerMode(data.outputType==='speaker');
  if(data.outputType==='speaker'){
   h.setExtraProtection(true);
   const el=document.getElementById('extraProtection');if(el)el.checked=true;
  }
 };
 h.start=async function(...args){
  if(starting||h.starting||h.isRunning)return;
  starting=true;const own=++generation;
  captureAttempt=null;
  // Resume Web Audio inside the original tap, before any native promise yields.
  try {
   const audioReady=Promise.resolve(window.Tone?.start()).then(()=>null,error=>error);
   const data=await p.prepare();
   if(own!==generation){await p.release();return;}
   const audioError=await audioReady;if(audioError)throw audioError;
   applyRoute(data);await originalStart(...args);
   // The engine reports failures in lastError rather than rejecting its promise.
   if(h.lastError){await reportFailure(h.lastError);await p.release();return;}
   if(own!==generation){originalStop();await p.release();return;}
   if(h.isRunning)route(await p.activate());else await p.release();
  } catch(error){
   originalStop();h.lastError=error;
   await reportFailure(error).catch(e=>h.logEvent('diagnostic-error',{message:String(e.message||e)}));
   await p.release().catch(()=>{});
  }
  finally { starting=false; }
 };
 h.stop=function(...args){if(!args[0])generation++;const result=originalStop(...args);if(!args[0])p.release().catch(()=>{});return result;};
 p.addListener('routeChanged',data=>{if(starting){applyRoute(data);h.logEvent('native-startup-route',data);return;}h.stop();applyRoute(data);h.logEvent('native-stopped',{reason:'route-change'});});
 p.addListener('sessionChanged',route);
 p.addListener('interrupted',data=>{h.stop();h.logEvent('native-stopped',data);});
 p.getRoute().then(route).catch(()=>{});
});
