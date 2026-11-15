/* Refresh stale idle tabs while preserving a running song/recording. */
window.addEventListener('DOMContentLoaded',()=>{
 const current=document.querySelector('meta[name="harmony-version"]').content;let checking=false,pending=null;
 const running=()=>window.harmonySinger?.isRunning||window.harmonySinger?.starting||window.harmonyDebug?.recorder?.state==='recording'||window.harmonyDebug?.finalizing?.size>0;
 const reload=()=>{if(!pending||running())return;let previous;try{previous=sessionStorage.getItem('harmony-update-attempt');}catch(_){}if(previous===pending)return;try{sessionStorage.setItem('harmony-update-attempt',pending);}catch(_){}const u=new URL(location.href);u.searchParams.set('_harmony_update',pending);location.replace(u.href);};
 const check=async()=>{if(checking||document.hidden)return;checking=true;try{const r=await fetch('version.json?fresh='+Date.now(),{cache:'no-store'});if(!r.ok)return;const v=await r.json();if(v.version&&v.version!==current){pending=v.version;reload();}else{const u=new URL(location.href);if(u.searchParams.get('_harmony_update')===current){u.searchParams.delete('_harmony_update');history.replaceState(null,'',u);}}}catch(_){}finally{checking=false;}};
 if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{reg.waiting?.postMessage({type:'SKIP_WAITING'});return reg.update();}).catch(()=>{});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});setInterval(check,60000);setInterval(reload,1000);check();
});
