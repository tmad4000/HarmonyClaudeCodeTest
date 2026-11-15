const $=id=>document.getElementById(id), names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
names.forEach((n,i)=>$('key').add(new Option(`${n} major`,i)));
let objectURL;
function busy(value){$('record').disabled=value;$('file').disabled=value;$('key').disabled=value;$('voices').disabled=value;}
function wav(samples){
 const data=new ArrayBuffer(44+samples.length*2),v=new DataView(data);
 const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
 str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,44100,true);v.setUint32(28,88200,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
 samples.forEach((x,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,x))*32767),true));return new Blob([data],{type:'audio/wav'});
}
async function upload(blob){
 if(blob.size>900000)throw Error('Maximum upload is 900000 bytes (10 seconds of mono PCM).');
 $('status').textContent='Rendering neural voices… this may take a few seconds.';
 const response=await fetch(`/take?key=${$('key').value}&voices=${$('voices').value}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:blob,signal:AbortSignal.timeout(120000)});
 if(!response.ok){let msg='Render failed.';try{msg=(await response.json()).error||msg;}catch{}throw Error(msg);}
 const result=await response.blob();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(result);
 $('audio').src=objectURL;$('download').href=objectURL;$('result').hidden=false;
 $('status').textContent=`Ready in ${response.headers.get('X-Render-Seconds')} s · ${names[Number(response.headers.get('X-Harmony-Key'))]} major. Press play to listen.`;
}
$('record').onclick=async()=>{
 busy(true);$('result').hidden=true;let stream,ctx,node,source,timer;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone recording needs a secure browser. Use the WAV upload instead.');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  ctx=new AudioContext();await ctx.resume();await ctx.audioWorklet.addModule('/capture.js');
  const chunks=[];let count=0;const limit=ctx.sampleRate*10;
  node=new AudioWorkletNode(ctx,'take-capture');source=ctx.createMediaStreamSource(stream);source.connect(node);node.connect(ctx.destination);
  $('progress').hidden=false;$('progress').value=0;$('status').textContent='Recording… sing for 10 seconds.';
  await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Recording interrupted. Keep this tab active and try again.')),15000);node.port.onmessage=({data})=>{const part=data.slice(0,limit-count);chunks.push(part);count+=part.length;$('progress').value=count/ctx.sampleRate;if(count>=limit)resolve();};});
  clearTimeout(timer);node.disconnect();source.disconnect();stream.getTracks().forEach(t=>t.stop());
  const input=new Float32Array(count);let offset=0;for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
  const offline=new OfflineAudioContext(1,441000,44100),buffer=offline.createBuffer(1,input.length,ctx.sampleRate);buffer.copyToChannel(input,0);const b=offline.createBufferSource();b.buffer=buffer;b.connect(offline.destination);b.start();
  await upload(wav((await offline.startRendering()).getChannelData(0)));
 }catch(e){$('status').textContent=e.message||'Recording failed.';}finally{clearTimeout(timer);node?.disconnect();source?.disconnect();stream?.getTracks().forEach(t=>t.stop());await ctx?.close();$('progress').hidden=true;busy(false);}
};
$('file').onchange=async()=>{if(!$('file').files[0])return;busy(true);try{await upload($('file').files[0]);}catch(e){$('status').textContent=e.message;}finally{busy(false);$('file').value='';}};

if(isSecureContext&&navigator.mediaDevices?.getUserMedia){$('record').hidden=false;document.title='Neural Harmony · Record a take';$('status').textContent='Ready. Record a melody or choose a WAV.';}else{$('record').hidden=true;$('status').textContent='Choose a WAV take to render on the private host.';}
