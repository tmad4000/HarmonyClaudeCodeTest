import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {Engine} from '../engine.mjs';
import {Partner} from '../controller.mjs';
import {calibrate,Renderer,limit,rms,ReferenceCanceller} from '../dsp.mjs';
import {jointMetrics} from './joint-metrics.mjs';
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
for(const scenario of ['stable','baseline','sustained','quiet-sustained','quiet-under-gate','unison-stress','unison-headphones-control','no-cancellation','gain-jump','delay-jump','gradual-drift','extreme-gain','nonlinear-path','dropout','reference-dropout','near-only']){
 const engine=new Engine(sr,model,{room:['near-only','no-cancellation','unison-headphones-control'].includes(scenario)?null:room,baseline:scenario==='baseline'}),renderer=new Renderer(sr);
 const oracleEngine=new Engine(sr,model,{baseline:scenario==='baseline'}),oracleRenderer=new Renderer(sr),oracle=new Float32Array(sr*8),voicing=new Uint8Array(sr*8);
 const unison=scenario.startsWith('unison-');
 const output=new Float32Array(sr*8),human=new Float32Array(output.length),clean=new Float32Array(output.length),mix=new Float32Array(output.length);
 let phase=0,peak=0,firstHuman=null,firstOutput=null,faultAt=null,error=0,nearEnergy=0,activeOut=0,active=0;
 const blocks=[];let blockStart=performance.now(),start=blockStart;
 for(let n=0;n<output.length;n++){
  const t=n/sr,sustained=scenario.includes('sustained')||scenario==='quiet-under-gate'||unison,voiced=t>.5&&t<5&&(sustained||t%1.15<.95);
  const midi=unison?57:60+4*Math.sin(t*.7)+.07*Math.sin(2*Math.PI*5*t)+(t>3?3:0);
  phase+=2*Math.PI*440*2**((midi-69)/12)/sr;
  const amplitude=scenario==='quiet-sustained'?.012:scenario==='quiet-under-gate'?.003:.09;
  human[n]=voiced?amplitude*(Math.sin(phase)+.22*Math.sin(2*phase)):0;voicing[n]=voiced?1:0;
  let p=path;if(t>3&&scenario==='gain-jump')p=path.map(x=>({...x,gain:x.gain*8}));
  if(t>3&&scenario==='delay-jump')p=path.map(x=>({...x,lag:x.lag+173}));
  if(t>3&&scenario==='gradual-drift')p=path.map(x=>({...x,lag:x.lag+Math.round((t-3)*5),gain:x.gain*(1+(t-3)*.2)}));
  if(t>3&&scenario==='extreme-gain')p=path.map(x=>({...x,gain:x.gain*40}));
  let returned=['near-only','unison-headphones-control'].includes(scenario)?0:echo(output,n,p);
  if(scenario==='nonlinear-path')returned=.1*Math.tanh(returned/.1);
  const raw=human[n]+returned+.0001*noise();
  clean[n]=engine.push(scenario==='dropout'&&t>3?NaN:raw,scenario==='reference-dropout'&&t>3?NaN:output[n-1]||0);
  // Diagnostic unison renderer stresses separation; it is explicitly not the default lower voice.
  output[n]=engine.safety.fault?0:limit(renderer.sample(unison?{...engine.control,midi}:engine.control)*.5);
  oracleEngine.push(human[n],oracle[n-1]||0);
  oracle[n]=limit(oracleRenderer.sample(unison?{...oracleEngine.control,midi}:oracleEngine.control)*.5);
  mix[n]=human[n]+output[n];peak=Math.max(peak,Math.abs(output[n]));
  if(voiced&&firstHuman===null)firstHuman=t;if(output[n]>.001&&firstOutput===null)firstOutput=t;
  if(engine.safety.fault&&faultAt===null)faultAt=t;
  if(voiced){error+=(clean[n]-human[n])**2;nearEnergy+=human[n]**2;active++;if(Math.abs(engine.control.gain)>.001)activeOut++;}
  if(n%80===79){const now=performance.now();blocks.push(now-blockStart);blockStart=now;}
 }
 const totalMs=performance.now()-start;blocks.sort((a,b)=>a-b);
 const result={name:scenario,peakOutput:peak,tailRms:rms(output.slice(6*sr)),nearEndErrorDb:10*Math.log10((error+1e-12)/(nearEnergy+1e-12)),outputWhileSingingFraction:activeOut/active,onsetLatencyMs:1000*(firstOutput-firstHuman),fault:engine.safety.fault,faultAtSeconds:faultAt,renderComputeMs:totalMs,realTimeFactor:totalMs/8000,block10msComputeP99Ms:blocks[Math.floor(blocks.length*.99)],block10msComputeMaxMs:blocks.at(-1)};
 result.joint=jointMetrics({output,oracle,voiced:voicing,sr,tailStartSeconds:6,fault:engine.safety.fault});
 result.outputWhileSingingFractionMeaning='Legacy requested-control-gain statistic; use joint.actualOutputCoverage for emitted-audio acceptance';
 result.fixtureClass=unison?'diagnostic forced-unison renderer':scenario==='quiet-under-gate'?'below voice gate': ['extreme-gain','dropout','reference-dropout'].includes(scenario)?'emergency containment':'musical operation';
 report.scenarios.push(result);assert.ok(peak<=.120001);assert.ok(result.tailRms<.001,`${scenario} sustained tail`);
 if(scenario==='stable'){assert.ok(result.nearEndErrorDb< -40);assert.ok(result.outputWhileSingingFraction>.85);assert.equal(result.fault,null);writeWav('partner-stereo.wav',[human,output]);writeWav('partner-mix.wav',[mix]);}
 if(scenario==='baseline')writeWav('baseline-mix.wav',[mix]);
 if(scenario==='dropout'||scenario==='reference-dropout')assert.match(result.fault,/unavailable/);
 if(scenario==='extreme-gain')assert.ok(result.fault,'Extreme path must fail closed');
}
report.jointAcceptance={successes:report.scenarios.filter(s=>s.joint.jointSuccess).map(s=>s.name),failures:report.scenarios.filter(s=>!s.joint.jointSuccess).map(s=>({name:s.name,failedChecks:Object.entries(s.joint.checks).filter(([,ok])=>!ok).map(([k])=>k),fault:s.fault})),note:'A bounded/silent tail is not musical success. Emergency containment and known limitations remain visible joint failures. No production safety threshold was relaxed.'};
for(const name of ['stable','baseline','sustained','quiet-sustained','unison-headphones-control','near-only'])assert.ok(report.scenarios.find(s=>s.name===name).joint.jointSuccess,`${name}: required musical operation regressed`);
for(const name of ['quiet-under-gate','unison-stress','extreme-gain','dropout','reference-dropout'])assert.equal(report.scenarios.find(s=>s.name===name).joint.jointSuccess,false,`${name}: must not label known unavailable harmony a joint success`);
report.timingScope='Measured loop timing now includes the clean-input oracle engine/renderer and fixture bookkeeping; not an isolated production CPU benchmark.';
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
