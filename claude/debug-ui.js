window.addEventListener('DOMContentLoaded',()=>{
 const $=id=>document.getElementById(id),dialog=$('debugDialog'),chip=$('debugChip'),debug=window.harmonyDebug,notice=$('firstDebugNotice');
 const open=()=>dialog.showModal();chip.onclick=open;$('debugDetails').onclick=open;$('closeDebug').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 let seen=false;try{seen=localStorage.getItem('harmony-debug-notice-v1')==='seen';}catch(_){}notice.hidden=seen||!debug.enabled;
 const dismiss=()=>{notice.hidden=true;try{localStorage.setItem('harmony-debug-notice-v1','seen');}catch(_){}};$('dismissDebugNotice').onclick=dismiss;$('startBtn').addEventListener('click',dismiss);
 const render=()=>{const active=debug.recorder?.state==='recording',status=document.querySelector('[data-status]').textContent;chip.classList.toggle('recording',active);chip.classList.toggle('armed',debug.enabled&&!debug.skip);chip.classList.toggle('failure',/full|unavailable|failed|Not saving/i.test(status));chip.title=status;chip.setAttribute('aria-label',status+'. Open debug details');};
 new MutationObserver(render).observe(document.querySelector('[data-status]'),{subtree:true,childList:true,characterData:true});setInterval(render,1000);render();
});
