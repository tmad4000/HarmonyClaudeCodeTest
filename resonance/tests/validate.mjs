import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {Engine} from '../engine.mjs';
import {Partner} from '../controller.mjs';
import {calibrate,Renderer,limit,rms,ReferenceCanceller} from '../dsp.mjs';
const sr=8000,model=JSON.parse(readFileSync(new URL('../models/authored.json',import.meta.url)));
let seed=9341;const noise=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2147483648-1};
const path=[{lag:240,gain:.65},{lag:311,gain:.18},{lag:412,gain:-.09}];
function echo(x,n,p){let s=0;for(const t of p)s+=t.gain*(x[n-t.lag]||0);return s;}
const reference=Float32Array.from({length:sr*3},()=>.035*noise());
const mic=Float32Array.from(reference,(_,n)=>echo(reference,n,path)+.0001*noise());
const calStart=performance.now(),room=calibrate(reference,mic,sr),calMs=performance.now()-calStart;
assert.ok(room.accepted,JSON.stringify(room));
const report={createdAt:new Date().toISOString(),kind:'synthetic causal validation; not real-room acceptance',environment:{node:process.version,platform:process.platform,architecture:process.arch},model:{units:12,coefficients:329,provenance:'authored, no gradient training or pretrained parameters'},calibration:{erleDb:room.erle,noiseRms:room.noise,residualRatio:room.residualRatio,mainDelayMs:1000*room.taps.reduce((a,b)=>Math.abs(a.gain)>Math.abs(b.gain)?a:b).lag/sr,fitMs:calMs,accepted:room.accepted},scenarios:[],controller:{},limitations:['Synthetic room fixtures only; no live human listening claim','Digital output ceiling is not a physical sound-pressure guarantee','Speaker ambiguity guard can mute sustained correlated unison','Sparse 48-tap room fit may reject dense/reverberant rooms','Frozen path must be recalibrated after device/room/volume changes']};
function writeWav(name,channels){
 const length=channels[0].length,buf=Buffer.alloc(44+length*channels.length*2),num=channels.length;
 buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVE',8);buf.write('fmt ',12);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(num,22);buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*num*2,28);buf.writeUInt16LE(num*2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(buf.length-44,40);
 for(let n=0;n<length;n++)for(let c=0;c<num;c++)buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][n]))*32767),44+2*(n*num+c));writeFileSync(new URL('../evidence/'+name,import.meta.url),buf);
}
for(const scenario of ['stable','baseline','no-cancellation','gain-jump','delay-jump','gradual-drift','extreme-gain','nonlinear-path','dropout','reference-dropout','near-only']){
 const engine=new Engine(sr,model,{room:scenario==='near-only'||scenario==='no-cancellation'?null:room,baseline:scenario==='baseline'}),renderer=new Renderer(sr);
 const output=new Float32Array(sr*8),human=new Float32Array(output.length),clean=new Float32Array(output.length),mix=new Float32Array(output.length);
 let phase=0,peak=0,firstHuman=null,firstOutput=null,faultAt=null,error=0,nearEnergy=0,activeOut=0,active=0;
 const blocks=[];let blockStart=performance.now(),start=blockStart;
 for(let n=0;n<output.length;n++){
  const t=n/sr,voiced=t>.5&&t<5&&t%1.15<.95;
  const midi=60+4*Math.sin(t*.7)+.07*Math.sin(2*Math.PI*5*t)+(t>3?3:0);
  phase+=2*Math.PI*440*2**((midi-69)/12)/sr;
  human[n]=voiced?.09*(Math.sin(phase)+.22*Math.sin(2*phase)):0;
  let p=path;if(t>3&&scenario==='gain-jump')p=path.map(x=>({...x,gain:x.gain*8}));
  if(t>3&&scenario==='delay-jump')p=path.map(x=>({...x,lag:x.lag+173}));
  if(t>3&&scenario==='gradual-drift')p=path.map(x=>({...x,lag:x.lag+Math.round((t-3)*5),gain:x.gain*(1+(t-3)*.2)}));
  if(t>3&&scenario==='extreme-gain')p=path.map(x=>({...x,gain:x.gain*40}));
  let returned=scenario==='near-only'?0:echo(output,n,p);
  if(scenario==='nonlinear-path')returned=.1*Math.tanh(returned/.1);
  const raw=human[n]+returned+.0001*noise();
  clean[n]=engine.push(scenario==='dropout'&&t>3?NaN:raw,scenario==='reference-dropout'&&t>3?NaN:output[n-1]||0);
  output[n]=engine.safety.fault?0:limit(renderer.sample(engine.control)*.5);
  mix[n]=human[n]+output[n];peak=Math.max(peak,Math.abs(output[n]));
  if(voiced&&firstHuman===null)firstHuman=t;if(output[n]>.001&&firstOutput===null)firstOutput=t;
  if(engine.safety.fault&&faultAt===null)faultAt=t;
  if(voiced){error+=(clean[n]-human[n])**2;nearEnergy+=human[n]**2;active++;if(Math.abs(engine.control.gain)>.001)activeOut++;}
  if(n%80===79){const now=performance.now();blocks.push(now-blockStart);blockStart=now;}
 }
 const totalMs=performance.now()-start;blocks.sort((a,b)=>a-b);
 const result={name:scenario,peakOutput:peak,tailRms:rms(output.slice(6*sr)),nearEndErrorDb:10*Math.log10((error+1e-12)/(nearEnergy+1e-12)),outputWhileSingingFraction:activeOut/active,onsetLatencyMs:1000*(firstOutput-firstHuman),fault:engine.safety.fault,faultAtSeconds:faultAt,renderComputeMs:totalMs,realTimeFactor:totalMs/8000,block10msComputeP99Ms:blocks[Math.floor(blocks.length*.99)],block10msComputeMaxMs:blocks.at(-1)};
 report.scenarios.push(result);assert.ok(peak<=.120001);assert.ok(result.tailRms<.001,`${scenario} sustained tail`);
 if(scenario==='stable'){assert.ok(result.nearEndErrorDb< -40);assert.ok(result.outputWhileSingingFraction>.85);assert.equal(result.fault,null);writeWav('partner-stereo.wav',[human,output]);writeWav('partner-mix.wav',[mix]);}
 if(scenario==='baseline')writeWav('baseline-mix.wav',[mix]);
 if(scenario==='dropout'||scenario==='reference-dropout')assert.match(result.fault,/unavailable/);
 if(scenario==='extreme-gain')assert.ok(result.fault,'Extreme path must fail closed');
}
// Compare pitch prediction to same recurrent controller with zero look-ahead, not just different intervals.
const predict=new Partner(model),noPredict=new Partner(model,{latency:0});let predError=0,plainError=0,count=0;
const intervals=new Set();
for(let i=0;i<600;i++){
 const t=i*.01,midi=58+2*t,f={midi,rms:.08,voiced:true,confidence:1},a=predict.step(f),b=noPredict.step(f);
 if(i>100){const nowMidi=58+2*(t+.035);predError+=Math.abs(a.midi-a.interval-nowMidi);plainError+=Math.abs(b.midi-b.interval-nowMidi);count++;}intervals.add(a.interval);
}
report.controller.rampLookahead={withPredictionMeanSemitones:predError/count,withoutPredictionMeanSemitones:plainError/count,assumedLatencyMs:35,scope:'steady 2 semitone/s synthetic ramp only'};
report.controller.testedIntervals=[...intervals];
// Correlated near-end preservation is measured on subtraction separately from the ambiguity guard.
let preservationError=0;const cancel=new ReferenceCanceller(sr,room),unisonRef=Float32Array.from({length:sr*2},(_,n)=>.04*Math.sin(n*2*Math.PI*220/sr));
for(let n=0;n<unisonRef.length;n++){const singer=unisonRef[n];const residual=cancel.process(singer+echo(unisonRef,n,path),unisonRef[n-1]||0);preservationError+=(residual-singer)**2;}
report.correlatedUnisonSubtractionErrorRms=Math.sqrt(preservationError/unisonRef.length);
report.memoryRssMiB=process.memoryUsage().rss/1024/1024;
writeFileSync(new URL('../evidence/validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL('../evidence/synthetic-room.json',import.meta.url),JSON.stringify(room,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
