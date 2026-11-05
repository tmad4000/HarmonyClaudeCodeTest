import {calibrate} from './dsp.mjs';
const $=id=>document.getElementById(id);
let ctx,node,stream,source,room=null,heartbeat=null,running=false,busy=false,audioReady=null,operation=0;
const model=await fetch('models/authored.json').then(r=>{if(!r.ok)throw Error('Model not found');return r.json()});
const history=[];let lastTelemetry=0;
const note=m=>Number.isFinite(m)?['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1):'—';
function status(text){$('status').textContent=text;}
async function audio(microphone=false,token=operation){
 if(!audioReady)audioReady=(async()=>{
  ctx=new AudioContext({latencyHint:'interactive'});await ctx.audioWorklet.addModule('worklet.mjs');
  node=new AudioWorkletNode(ctx,'resonant-partner',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{model}});node.connect(ctx.destination);
  node.port.onmessage=receive;node.onprocessorerror=()=>{mute();status('Audio processor failed; output muted. Reload to restart.');};
  heartbeat=setInterval(()=>node.port.postMessage({type:'heartbeat'}),400);
 })();
 await audioReady;if(token!==operation)throw Error('Cancelled');
 await ctx.resume();
 if(token!==operation)throw Error('Cancelled');
 if(microphone&&!stream){
  const incoming=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  if(token!==operation){incoming.getTracks().forEach(t=>t.stop());throw Error('Cancelled');}stream=incoming;
  const settings=stream.getAudioTracks()[0].getSettings();
  if($('setup').value==='speakers'&&(settings.echoCancellation===true||settings.autoGainControl===true||settings.noiseSuppression===true)){stream.getTracks().forEach(t=>t.stop());stream=null;throw Error('Browser signal processing is still enabled; use headphones or another browser.');}
  source=ctx.createMediaStreamSource(stream);source.connect(node);
  for(const track of stream.getTracks())track.onended=()=>{mute();room=null;status('Microphone disconnected. Restart and recalibrate speakers.');};
 }
 node.port.postMessage({type:'level',value:Number($('level').value)/100});
 $('latency').textContent=`40 ms analysis window + device I/O; browser reports ${Math.round((ctx.baseLatency+(ctx.outputLatency||0))*1000)} ms output buffering (not measured round trip)`;
}
function mute(keepMic=false){
 operation++;
 node?.port.postMessage({type:'mute'});running=false;busy=false;$('mute').disabled=true;$('start').disabled=false;$('preview').disabled=false;$('calibrate').disabled=false;$('modeBadge').textContent='Muted';$('safety').textContent='Muted';
 if(!keepMic){if(source){source.disconnect();source=null;}if(stream){for(const t of stream.getTracks()){t.onended=null;t.stop();}stream=null;room=null;}}
 if(!keepMic&&ctx?.state==='running')ctx.suspend();
 if(keepMic)$('safety').textContent='Output muted · calibration mic still connected';
}
async function start(fixture=false){
 if(busy)return;busy=true;const token=++operation;
 try{
  if(!fixture&&$('setup').value==='speakers'&&!room?.accepted)throw Error('Calibrate speakers first, or choose headphones.');
  await audio(!fixture,token);if(token!==operation)return;node.port.postMessage({type:'start',fixture,room:fixture||$('setup').value==='headphones'?null:room,baseline:$('behavior').value==='baseline'});
  running=true;$('mute').disabled=false;$('start').disabled=true;$('preview').disabled=true;$('modeBadge').textContent=fixture?'Example':'Listening';status(fixture?'Synthetic contour is driving the partner. No microphone is used.':'Sing a comfortable phrase. Leave a pause, then change your contour. Escape mutes immediately.');
 }catch(e){if(token===operation){mute();status(e.message);}}finally{if(token===operation)busy=false;}
}
function receive({data:d}){
 if(d.type==='error'){mute();status(d.message);return;}
 if(d.type==='calibration'){
  if(d.operation!==operation)return;
  status('Checking the room measurement…');
  setTimeout(()=>{if(d.operation!==operation)return;try{room=calibrate(d.reference,d.mic,d.sr);$('roomStatus').textContent=`${room.erle.toFixed(1)} dB held-out cancellation · ${room.accepted?'ready':'rejected'}`;$('echo').textContent=`${room.taps.length} measured taps · frozen during singing`;status(room.accepted?'Room measurement passed. The microphone stays connected to preserve timing. Keep volume and position fixed, then start singing.':room.reason);}catch(e){room=null;status(e.message);}finally{mute(!!room?.accepted);}},20);return;
 }
 if(d.type!=='telemetry')return;lastTelemetry=performance.now();
 if(d.fault&&running){mute();status(d.fault);room=null;return;}
 $('voice').textContent=d.voiced?note(d.midi):'—';$('partner').textContent=d.gain>.001?note(d.partnerMidi):'—';
 $('relation').textContent=d.gain>.001?({[-7]:'A fifth below',[-5]:'A fourth below',[-12]:'An octave below'}[d.interval]||'Responding'):'Listening space';
 $('pulse').textContent=d.pulse?.confidence>.45?`Pulse ${Math.round(60/d.pulse.period)} · ${Math.round(d.pulse.confidence*100)}% confidence`:'Free time';
 $('memory').textContent=d.state?`Musical memory · ${d.state.filter(x=>Math.abs(x)>.1).length}/12 units active`:'Memory at rest';
 $('safety').textContent=running?'Output bounded · mute armed':'Muted';
 history.push([d.voiced?d.midi:null,d.gain>.001?d.partnerMidi:null]);if(history.length>220)history.shift();draw();
}
function draw(){
 const c=$('trace'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.strokeStyle='#ffffff0d';g.lineWidth=1;
 for(let y=20;y<180;y+=40){g.beginPath();g.moveTo(0,y);g.lineTo(c.width,y);g.stroke();}
 for(let k=0;k<2;k++){g.strokeStyle=k?'#a6b8ff':'#cbd4e5';g.lineWidth=2;g.beginPath();let open=false;history.forEach((pair,i)=>{const m=pair[k];if(m===null||!Number.isFinite(m)){open=false;return;}const x=i*c.width/220,y=160-(m-36)*3;open?g.lineTo(x,y):g.moveTo(x,y);open=true;});g.stroke();}
}
$('start').onclick=()=>start();$('preview').onclick=()=>{mute();start(true);};$('mute').onclick=()=>{mute();status('Muted. Microphone released.');};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){mute();status('Muted. Microphone released.');}});
$('setup').onchange=()=>{mute();room=null;$('speakerPanel').hidden=$('setup').value!=='speakers';$('roomStatus').textContent='No room measurement yet';};
$('behavior').onchange=()=>{mute();status('Behavior changed. Start again to compare with fresh musical memory.');};
$('level').oninput=()=>{ $('levelValue').textContent=$('level').value+'%';node?.port.postMessage({type:'level',value:Number($('level').value)/100});};
$('calibrate').onclick=async()=>{
 mute();busy=true;room=null;const token=++operation;
 try{await audio(true,token);if(token!==operation)return;node.port.postMessage({type:'calibrate',operation:token});$('mute').disabled=false;$('start').disabled=true;$('preview').disabled=true;$('calibrate').disabled=true;$('modeBadge').textContent='Measuring';status('Stay quiet during the short soft noise.');}catch(e){if(token===operation){mute();status(e.message);}}
};
navigator.mediaDevices?.addEventListener('devicechange',()=>{mute();room=null;status('Audio devices changed. Restart and recalibrate speakers.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden){mute();status('Muted because this page went into the background.');}});
window.addEventListener('pagehide',()=>{mute();clearInterval(heartbeat);ctx?.close();});
setInterval(()=>{if(running&&performance.now()-lastTelemetry>2500){mute();status('Audio telemetry stopped; output muted.');}},1000);
draw();
