importScripts('vendor/ort.wasm.min.js','vendor/fft.js','dsp.js');
let session;
self.onmessage=async({data})=>{try{
 if(data.type==='load'){
  const start=performance.now();ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('vendor/',self.location.href).href;
  const parts=await Promise.all(['model-1.bin','model-2.bin'].map(async name=>{const response=await fetch(new URL(name,self.location.href));if(!response.ok)throw Error('Model download failed. Retry loading the engine.');return new Uint8Array(await response.arrayBuffer());}));
  const model=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){model.set(part,offset);offset+=part.length;}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',model))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!=='c8fa9907a7aa94321d4675fdc157253946b1f1eff91b79e155040a0db8849f0a')throw Error('Model checksum mismatch. Reload the page and retry.');
  session=await ort.InferenceSession.create(model,{executionProviders:['wasm']});
  postMessage({type:'ready',seconds:(performance.now()-start)/1000});return;
 }
 if(data.type!=='render'||!session)throw Error('Load the neural engine first.');
 const started=performance.now(),x=new Float32Array(data.samples);
 if(x.length<22050||x.length>441000||!x.every(Number.isFinite))throw Error('Take must be 0.5–10 seconds.');
 if(rms(x)<.0003)throw Error('Take is too quiet. Sing closer to the microphone.');
 const padded=new Float32Array(Math.ceil(x.length/HOP)*HOP);padded.set(x);
 postMessage({type:'progress',text:'Finding melody and key…'});
 const {mel,f0,frames}=features(padded),key=data.key==='auto'?estimateKey(f0):Number(data.key);
 if(!Number.isInteger(key)||key<0||key>11||![1,2].includes(data.voices))throw Error('Invalid key or voice count.');
 const mix=Float32Array.from(x,v=>v*.65),step=80,overlap=8,total=Math.ceil(frames/step)*data.voices;let done=0;
 for(const degree of [2,4].slice(0,data.voices)){
  const targets=harmonyF0(f0,key,degree),y=new Float32Array(padded.length),weight=new Float32Array(padded.length);
  for(let start=0;start<frames;start+=step){
   const lo=Math.max(0,start-overlap),hi=Math.min(frames,start+step+overlap),n=hi-lo;
   const output=Object.values(await session.run({mel:new ort.Tensor('float32',mel.slice(lo*128,hi*128),[1,n,128]),f0:new ort.Tensor('float32',targets.slice(lo,hi),[1,n])}))[0];
   for(let i=0;i<n*HOP;i++){
    let w=1;if(lo&&i<overlap*HOP)w=i/(overlap*HOP-1);if(hi<frames&&i>=n*HOP-overlap*HOP)w=(n*HOP-i-1)/(overlap*HOP-1);
    const pos=lo*HOP+i;
    const frame=(i-256)/HOP,idx=Math.floor(frame),alpha=frame-idx;
    const voiced=j=>targets[Math.max(0,Math.min(frames-1,lo+j))]>0?1:0;
    const gain=voiced(idx)*(1-alpha)+voiced(idx+1)*alpha;
    const v=output.data[i]*gain;if(!Number.isFinite(v))throw Error('Neural output failed validation.');
    y[pos]+=v*w;weight[pos]+=w;
   }
   postMessage({type:'progress',text:`Rendering harmony… ${Math.round(++done/total*100)}%`});
  }
  for(let i=0;i<y.length;i++)y[i]/=Math.max(weight[i],1e-9);
  const gain=Math.min(2,rms(x)/Math.max(rms(y.subarray(0,x.length)),1e-6))*.35;
  for(let i=0;i<x.length;i++)mix[i]+=y[i]*gain;
 }
 let peak=0;for(const v of mix)peak=Math.max(peak,Math.abs(v));const gain=Math.min(1,.94/Math.max(peak,1e-9));for(let i=0;i<mix.length;i++)mix[i]*=gain;
 postMessage({type:'result',samples:mix.buffer,key,seconds:(performance.now()-started)/1000},[mix.buffer]);
}catch(e){postMessage({type:'error',message:e.message||String(e)});}};
