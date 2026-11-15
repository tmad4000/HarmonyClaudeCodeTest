/* Native lifecycle adapter; no DSP or engine replacement. */
window.addEventListener('DOMContentLoaded', () => {
 const h=window.harmonySinger, p=window.Capacitor?.Plugins?.HarmonyAudioSession;
 if(!h||!p)return;
 let starting=false, generation=0;
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
  try {
   const data=await p.prepare();
   if(own!==generation){await p.release();return;}
   applyRoute(data);await originalStart(...args);
   if(own!==generation){originalStop();await p.release();return;}
   if(h.isRunning)route(await p.activate());else await p.release();
  } catch(error){ originalStop();h.lastError=String(error.message||error);h.logEvent('native-error',{message:h.lastError});h.setStatus(h.lastError,'error');await p.release().catch(()=>{}); }
  finally { starting=false; }
 };
 h.stop=function(...args){if(!args[0])generation++;const result=originalStop(...args);if(!args[0])p.release().catch(()=>{});return result;};
 p.addListener('routeChanged',data=>{h.stop();applyRoute(data);h.logEvent('native-stopped',{reason:'route-change'});});
 p.addListener('sessionChanged',route);
 p.addListener('interrupted',data=>{h.stop();h.logEvent('native-stopped',data);});
 p.getRoute().then(route).catch(()=>{});
});
