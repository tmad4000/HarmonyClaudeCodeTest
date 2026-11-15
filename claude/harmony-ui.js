/* Fable v2 surface. Existing controls remain the source of settings and audio actions. */
window.addEventListener('DOMContentLoaded', () => {
 const h=window.harmonySinger,$=id=>document.getElementById(id),container=document.querySelector('.container');
 const oldMain=document.querySelector('main'),oldHeader=document.querySelector('header'),footer=document.querySelector('footer');
 const app=document.createElement('div');app.className='harmony-app';
 app.innerHTML=`<div class="app-top"><span class="app-word">Harmony</span><div class="app-right"><div id="buildMount"></div><button id="debugChip" class="debug-chip" aria-label="Debug recording details"><i aria-hidden="true"></i><span>rec</span></button><button id="openSettings" class="gear-button" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="7"/></svg></button></div></div><div class="app-read"><div id="helloNote">Sing a note.<span>Harmonies follow, in key.</span></div><div id="noteMount"></div><button id="openKey" class="app-key">Key · Auto ▾</button></div><div class="pitch-stage"><canvas id="pitchHistory" role="img" aria-label="Live voice pitch and target harmonies"></canvas></div><div id="harmonyChips" class="harmony-chips" role="group" aria-label="Harmony style"></div><div id="outputMount" class="app-output"></div><div class="sing-area"><div id="singMount"></div><span id="singLabel">Sing</span><div id="firstDebugNotice" class="first-debug">Debug recording on · saved here only <button id="debugDetails">Details</button><button id="dismissDebugNotice" aria-label="Dismiss recording notice">×</button></div><div id="appStatus" role="status"></div></div>`;
 const sheet=document.createElement('dialog');sheet.id='settingsSheet';sheet.className='settings-sheet';sheet.setAttribute('aria-labelledby','settingsTitle');
 sheet.innerHTML='<div class="sheet-heading"><h2 id="settingsTitle">Settings</h2><button id="closeSettings" aria-label="Close settings">×</button></div><div id="sheetContent"></div>';
 container.append(app,sheet);
 const release=document.querySelector('.release-info');release.querySelector('[data-status]').removeAttribute('role');$('buildMount');
 app.querySelector('#buildMount').append(release);
 const chipStatus=release.querySelector('[data-status]');chipStatus.hidden=true;
 const start=$('startBtn');app.querySelector('#singMount').append(start);
 app.querySelector('#noteMount').append($('currentNote'));
 const output=$('speakerModeToggle');output.className='output-segments';output.setAttribute('role','radiogroup');output.setAttribute('aria-label','Listening on');
 $('outputPosition').hidden=true;
 output.querySelectorAll('[data-output-position]').forEach((b,i)=>{b.setAttribute('role','radio');b.append(document.createTextNode(i?'Speakers':'Headphones'));b.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const value=e.key==='ArrowRight'?1:0;h.setOutputPosition(value);$('outputPosition').dispatchEvent(new Event('change',{bubbles:true}));output.querySelector(`[data-output-position="${value}"]`).focus();}});});
 app.querySelector('#outputMount').append(output);
 const cap=document.createElement('p');cap.className='output-caption';cap.textContent='Echo removal on. Harmonies stay at full level.';app.querySelector('#outputMount').append(cap);
 sheet.querySelector('#sheetContent').append(oldMain);if(footer)sheet.querySelector('#sheetContent').append(footer);
 // Existing technical controls are behind one sheet. No debug card on the singing screen.
 const advanced=$('advanced');if(advanced)advanced.open=true;
 const debugPanel=$('debugSessions');debugPanel.querySelector('p.hint').textContent='Microphone (left), app output (right) and diagnostics stay in this browser. No uploads. Unkept takes expire after 14 days; 100 MB of unkept storage, 10 minutes audio per take. Keep prevents automatic deletion. When kept audio fills storage, only events continue. Anyone using this browser profile can review its takes.';
 const feedback=document.createElement('span');feedback.id='harmony-feedback-mount';sheet.querySelector('#sheetContent').append(feedback);
 const speakers=$('advSpeakers').parentElement;for(const id of ['speakerModeStatus','speakerCheckStatus','protectionHint'])speakers.append($(id));
 const about=document.createElement('section');about.className='card';about.innerHTML='<h2>About Harmony</h2><p id=sheetBuildTime></p><p>Version 2026-11-15-speaker-debug-1</p><button id=sheetCheckVersion type=button>Check for update</button>';sheet.querySelector('#sheetContent').append(about);
 oldHeader.remove();container.replaceChildren(app,sheet);$('sheetCheckVersion').onclick=()=>$('checkVersion').click();
 const open=(id)=>{if(!sheet.open)sheet.showModal();if(id)$(id)?.scrollIntoView({block:'start'});};
 $('openSettings').onclick=()=>open();$('debugChip').onclick=()=>open('debugSessions');$('openKey').onclick=()=>open('keyLabel');$('closeSettings').onclick=()=>sheet.close();sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.close();});
 h.onOutputSafetyChange=()=>{const status=document.createElement('div');status.className='app-toast';status.setAttribute('role','status');app.append(status);status.textContent='Speakers detected. Echo removal enabled. ';const undo=document.createElement('button');undo.textContent='Undo';undo.onclick=()=>{h.setOutputPosition(0);$('outputPosition').dispatchEvent(new Event('change',{bubbles:true}));status.remove();};status.append(undo);$('outputPosition').dispatchEvent(new Event('change',{bubbles:true}));};
 const notice=$('firstDebugNotice');let seen=false;try{seen=localStorage.getItem('harmony-debug-notice-v1')==='seen';}catch(_){}
 notice.hidden=seen||!window.harmonyDebug.enabled;
 const dismiss=()=>{notice.hidden=true;try{localStorage.setItem('harmony-debug-notice-v1','seen');}catch(_){}};
 $('dismissDebugNotice').onclick=dismiss;$('debugDetails').onclick=()=>{open('debugSessions');dismiss();};start.addEventListener('click',dismiss);
 const mic='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',stop='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" stroke="none"/></svg>';
 const styles=[['Third above','thirds','above'],['Third below','thirds','below'],['Fifth','fifths','above'],['Octave','octaves','below'],['Choir','choir',null]];
 for(const [label,mode,pos] of styles){const b=document.createElement('button');b.className='harmony-chip';b.textContent=label;b.type='button';b.dataset.harmony=mode;b.dataset.positionChoice=pos||'';b.onclick=()=>{document.querySelector(`.mode-btn[data-mode="${mode}"]`).click();if(pos)document.querySelector(`.position-btn[data-position="${pos}"]`).click();};$('harmonyChips').append(b);}
 const more=document.createElement('button');more.className='harmony-more';more.textContent='More';more.onclick=()=>open('harmonyHeading');$('harmonyChips').append(more);
 const updateChip=()=>{const text=chipStatus.textContent,chip=$('debugChip');chip.title=text;chip.setAttribute('aria-label',text+'. Open debug details');chip.classList.toggle('off',/OFF|Not recording|unavailable|full|Not saving/i.test(text));chip.classList.toggle('failure',/full|unavailable|failed/i.test(text));};new MutationObserver(updateChip).observe(chipStatus,{subtree:true,childList:true,characterData:true});updateChip();
 h.drawWaveform=()=>{}; // The live pitch view replaces the old amplitude oscilloscope.
 const cv=$('pitchHistory'),cx=cv.getContext('2d');let width=0,height=0,history=[],centre=64,last=0,lastState='';
 const resize=()=>{const r=cv.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);width=r.width;height=r.height;cv.width=width*d;cv.height=height*d;cx.setTransform(d,0,0,d,0,0);};new ResizeObserver(resize).observe(cv);resize();
 const y=m=>height/2-(m-centre)*height/26;
 function frame(now){requestAnimationFrame(frame);if(document.hidden||now-last<33)return;last=now;
  const state=[h.isRunning,h.speakerMode,h.extraProtection,h.currentMode,h.harmonyPosition].join(':');
  if(state!==lastState||!start.querySelector('svg')){lastState=state;app.classList.toggle('singing',h.isRunning);start.innerHTML=h.isRunning?stop:mic;start.setAttribute('aria-label',h.isRunning?'Stop':'Sing');$('singLabel').textContent=h.isRunning?'Stop':'Sing';$('helloNote').hidden=h.isRunning;$('noteMount').hidden=!h.isRunning;
   output.querySelectorAll('[data-output-position]').forEach(b=>{const selected=Number(b.dataset.outputPosition)===h.outputPosition;b.setAttribute('aria-checked',String(selected));b.tabIndex=selected?0:-1;});
   cap.textContent=h.speakerMode?(h.extraProtection?'Echo removal with extra feedback protection.':'Echo removal on. Harmonies stay at full level.'):'Cleanest sound. You can hear yourself in the mix.';
   document.querySelectorAll('.harmony-chip').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.harmony===h.currentMode&&(!b.dataset.positionChoice||b.dataset.positionChoice===h.harmonyPosition))));}
  $('openKey').textContent=$('keyStatus').textContent.replace('Auto key: listening…','Key · Auto')+' ▾';
  $('sheetBuildTime').textContent=$('buildTime').textContent;
  const status=$('status').textContent;$('appStatus').textContent=h.lastError?status:(h.calibrating?'Checking speakers…':'');
  const p=h.isRunning&&h.voicePresent&&h.smoothedPitch?69+12*Math.log2(h.smoothedPitch/440):null;
  if(h.isRunning)history.push({t:now,p,targets:p===null?[]:Object.entries(h.voiceTargets).filter(([k])=>h.gains[k]?.gain.value>.001).map(([,m])=>m)});
  history=history.filter(r=>now-r.t<5500);if(p!==null)centre+=(p-centre)*.025;
  cx.clearRect(0,0,width,height);cx.font='10px system-ui';cx.textBaseline='middle';
  cx.lineWidth=1;
  for(let m=Math.floor(centre-13);m<centre+13;m++){if(![0,2,4,5,7,9,11].includes((m%12+12)%12))continue;const yy=y(m);cx.strokeStyle=m%12===0?'#333843':'#20242c';cx.beginPath();cx.moveTo(0,yy);cx.lineTo(width,yy);cx.stroke();if(m%12===0){cx.fillStyle='#747d8c';cx.fillText('C'+(Math.floor(m/12)-1),8,yy-7);}}
  const line=(get,color,w)=>{cx.strokeStyle=color;cx.lineWidth=w;cx.lineJoin=cx.lineCap='round';cx.beginPath();let open=false,prev=null;for(const r of history){const m=get(r);if(m==null){open=false;prev=null;continue;}const x=width*.78-(now-r.t)/5200*width*.78;if(prev!==null&&Math.abs(m-prev)>2)open=false;if(!open)cx.moveTo(x,y(m));else cx.lineTo(x,y(m));open=true;prev=m;}cx.stroke();};
  for(let i=0;i<4;i++)line(r=>r.targets[i],['#8f9dff','#7785df','#606fc4','#4b5ba5'][i],2);line(r=>r.p,'#f3f4f6',3);
 }
 requestAnimationFrame(frame);
});
