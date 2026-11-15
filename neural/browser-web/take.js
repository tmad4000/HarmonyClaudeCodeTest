const ASSET_BASE=new URL('./',document.currentScript.src);
const $=id=>document.getElementById(id), names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
names.forEach((n,i)=>$('key').add(new Option(`${n} major`,i)));
let objectURL;
function busy(value){$('record').disabled=value||!engineReady;$('file').disabled=value;$('key').disabled=value;$('voices').disabled=value;}
function wav(samples){
 const data=new ArrayBuffer(44+samples.length*2),v=new DataView(data);
 const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
 str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,44100,true);v.setUint32(28,88200,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
 samples.forEach((x,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,x))*32767),true));return new Blob([data],{type:'audio/wav'});
}
let worker,engineReady=false,pending;
function resetEngine(){engineReady=false;$('load').hidden=false;$('load').disabled=false;$('record').disabled=true;$('cancel').hidden=true;}
function createWorker(){
 worker=new Worker(new URL('renderer.js',ASSET_BASE));
 worker.onerror=()=>{if(pending){pending.reject(Error('Neural engine stopped. Reload it and try a shorter take.'));pending=null;}resetEngine();};
 worker.onmessage=({data})=>{
  if(data.type==='progress'){$('status').textContent=data.text;return;}
  if(data.type==='ready'){engineReady=true;$('load').hidden=true;$('cancel').hidden=true;$('record').disabled=!navigator.mediaDevices?.getUserMedia;$('status').textContent='Engine ready. Record a melody or upload a WAV.';return;}
  if(data.type==='error'){if(pending){pending.reject(Error(data.message));pending=null;}else{$('status').textContent=data.message;resetEngine();}return;}
  if(data.type==='result'&&pending){pending.resolve(data);pending=null;}
 };
}
$('cancel').onclick=()=>{worker?.terminate();resetEngine();if(pending){pending.reject(Error('Rendering cancelled. Reload the engine to try again.'));pending=null;}else $('status').textContent='Loading cancelled.';};
$('load').onclick=()=>{worker?.terminate();$('load').disabled=true;$('cancel').hidden=false;$('status').textContent='Downloading 40 MB neural model and loading engine…';createWorker();worker.postMessage({type:'load'});};
function parseWav(buffer){
 const v=new DataView(buffer),ascii=(o,n)=>String.fromCharCode(...new Uint8Array(buffer,o,n));
 if(buffer.byteLength<44||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE')throw Error('Use a PCM WAV file.');
 let fmt,chunk;
 for(let o=12;o+8<=buffer.byteLength;){const n=v.getUint32(o+4,true),end=o+8+n;if(end>buffer.byteLength)throw Error('Truncated WAV.');if(ascii(o,4)==='fmt '){if(n<16)throw Error('Invalid WAV format.');fmt=[v.getUint16(o+8,true),v.getUint16(o+10,true),v.getUint32(o+12,true),v.getUint16(o+22,true)];}if(ascii(o,4)==='data')chunk=[o+8,n];o=end+(n%2);}
 if(!fmt||fmt[0]!==1||fmt[1]!==1||fmt[2]!==44100||fmt[3]!==16||!chunk||chunk[1]%2)throw Error('Use mono 16-bit PCM WAV at 44100 Hz.');
 const length=chunk[1]/2;if(length<22050||length>441000)throw Error('Take must be 0.5–10 seconds.');
 return Float32Array.from({length},(_,i)=>v.getInt16(chunk[0]+i*2,true)/32768);
}
async function upload(blob){
 if(!engineReady)throw Error('Load the neural engine first.');
 if(blob.size>900000)throw Error('Maximum WAV size is 900000 bytes.');
 const samples=parseWav(await blob.arrayBuffer());
 $('status').textContent='Rendering neural voices in your browser…';$('cancel').hidden=false;
 const result=await new Promise((resolve,reject)=>{pending={resolve,reject};worker.postMessage({type:'render',samples:samples.buffer,key:$('key').value,voices:Number($('voices').value)},[samples.buffer]);});
 if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(wav(new Float32Array(result.samples)));
 $('cancel').hidden=true;$('audio').src=objectURL;$('download').href=objectURL;$('result').hidden=false;
 $('status').textContent=`Ready in ${result.seconds.toFixed(1)} s · ${names[result.key]} major. Press play to listen.`;
}
$('record').onclick=async()=>{
 busy(true);$('result').hidden=true;let stream,ctx,node,source,timer;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone recording needs a secure browser. Use the WAV upload instead.');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  ctx=new AudioContext();await ctx.resume();await ctx.audioWorklet.addModule(new URL('capture.js',ASSET_BASE).href);
  const chunks=[];let count=0;const limit=ctx.sampleRate*10;
  node=new AudioWorkletNode(ctx,'take-capture');source=ctx.createMediaStreamSource(stream);source.connect(node);node.connect(ctx.destination);
  $('progress').hidden=false;$('progress').value=0;$('status').textContent='Recording… sing for 10 seconds.';
  await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Recording interrupted. Keep this tab active and try again.')),15000);node.port.onmessage=({data})=>{const part=data.slice(0,limit-count);chunks.push(part);count+=part.length;$('progress').value=count/ctx.sampleRate;if(count>=limit)resolve();};});
  clearTimeout(timer);node.disconnect();source.disconnect();stream.getTracks().forEach(t=>t.stop());
  const input=new Float32Array(count);let offset=0;for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
  const offline=new OfflineAudioContext(1,441000,44100),buffer=offline.createBuffer(1,input.length,ctx.sampleRate);buffer.copyToChannel(input,0);const b=offline.createBufferSource();b.buffer=buffer;b.connect(offline.destination);b.start();
  await upload(wav((await offline.startRendering()).getChannelData(0)));
 }catch(e){$('status').textContent=e.message||'Recording failed.';}finally{clearTimeout(timer);node?.disconnect();source?.disconnect();stream?.getTracks().forEach(t=>t.stop());await ctx?.close();$('progress').hidden=true;$('cancel').hidden=true;busy(false);}
};
$('file').onchange=async()=>{if(!$('file').files[0])return;busy(true);try{await upload($('file').files[0]);}catch(e){$('status').textContent=e.message;}finally{$('cancel').hidden=true;busy(false);$('file').value='';}};

if(!navigator.mediaDevices?.getUserMedia){$('record').disabled=true;$('status').textContent='Microphone recording requires HTTPS. WAV upload remains available after loading the engine.';}
