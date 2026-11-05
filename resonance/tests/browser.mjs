// Real browser AudioWorklet integration, rendered offline: no mic and no speaker playback.
import {calibrate,rms} from '../dsp.mjs';
export async function runBrowserChecks(){
 const model=await fetch('/models/authored.json').then(r=>r.json()),results=[];
 for(const sr of [44100,48000]){
  const ctx=new OfflineAudioContext(1,sr*7,sr);await ctx.audioWorklet.addModule('/tests/offline-worklet.mjs');
  const node=new AudioWorkletNode(ctx,'resonance-offline-test',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{model,testMode:'fixture'}});
  let fault=null;node.onprocessorerror=()=>fault='processorerror';node.port.onmessage=({data})=>{if(data.type==='error')fault=data.message};node.connect(ctx.destination);
  for(let t=1;t<7;t++)ctx.suspend(t).then(()=>{node.port.postMessage({type:'heartbeat'});return ctx.resume()});
  const t0=performance.now(),buffer=await ctx.startRendering(),data=buffer.getChannelData(0);
  const earlyRms=rms(data.slice(sr*.2,sr*.7)),tailRms=rms(data.slice(sr*6)),peak=data.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
  if(fault||earlyRms<.001||tailRms>.0001||peak>.120001)throw Error(JSON.stringify({sr,fault,earlyRms,tailRms,peak}));
  results.push({sampleRate:sr,earlyRms,tailRms,peak,renderMs:performance.now()-t0,processorError:fault});node.disconnect();
 }
 // Actual high-rate probe -> fractional-delay acoustic fixture -> worklet decimator -> calibration.
 const sr=48000,ctx=new OfflineAudioContext(1,sr*3.2,sr);await ctx.audioWorklet.addModule('/tests/offline-worklet.mjs');
 const node=new AudioWorkletNode(ctx,'resonance-offline-test',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{model,testMode:'calibrate'}});node.connect(ctx.destination);
 const input=ctx.createBuffer(1,sr*3.2,sr),mic=input.getChannelData(0),ref=new Float32Array(mic.length);let seed=7727;
 for(let n=0;n<sr*3;n++){seed=(1664525*seed+1013904223)>>>0;ref[n]=.035*(seed/2147483648-1);}
 for(let n=0;n<mic.length;n++)mic[n]=.6*(ref[n-1441]||0)+.15*(ref[n-1823]||0);
 const src=ctx.createBufferSource();src.buffer=input;src.connect(node);src.start();
 const calibration=new Promise((resolve,reject)=>{node.port.onmessage=({data})=>{if(data.type==='calibration')resolve(data);if(data.type==='error')reject(Error(data.message))};node.onprocessorerror=()=>reject(Error('calibration processorerror'));});
 for(let t=1;t<4;t++)ctx.suspend(t).then(()=>{node.port.postMessage({type:'heartbeat'});return ctx.resume()});
 await ctx.startRendering();const captured=await calibration,room=calibrate(captured.reference,captured.mic,captured.sr);
 if(!room.accepted)throw Error('High-rate fractional-delay calibration rejected: '+room.erle);
 results.push({calibration:'48000 Hz -> 8000 Hz, fractional delay',erleDb:room.erle,accepted:room.accepted});node.disconnect();
 return {browser:navigator.userAgent,results,audioPlayback:false,microphoneAccess:false};
}
