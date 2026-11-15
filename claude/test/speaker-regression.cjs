'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {synthSinger,makeRoom,runLoop,rms,idealSpeaker}=require('./lib/loop_sim.cjs');
const {analyzeEnvelope}=require('../session-metrics.js');
const {SpeakerLoopControl}=require('../echo-canceller.js');
const measurements=[];
for(const sr of [44100,48000]) for(const gain of [.3,1]) {
 const ctrl=new SpeakerLoopControl({mode:'speakers',backoffDb:3,minTrim:0.25,holdMs:800}); const near=synthSinger(sr,8,[{midi:60,start:1,end:6}]);let closed=0,active=0;
 const result=runLoop({sr,near,room:makeRoom(sr,{gain,lengthS:.06}),harmonyGain:1,control:({t,stats,nearRms})=>{
 const c=ctrl.update({now:t*1000,voiced:nearRms>.004,stats}); if(t>2&&t<6){active++;if(!c.gateOpen)closed++;} return {gate:c.gateOpen,trim:c.trim};}});
 assert.equal(closed,0,'sustained singing must keep harmony gate open');
 assert.ok(rms(result.speaker,7*sr)<1e-5,'speaker loop must decay after singer stops');
 assert.ok(result.cleaned.every(Number.isFinite)); const envelope=analyzeEnvelope(near,result.speaker,sr,idealSpeaker({near,sr,harmonyGain:1}),2*sr,6*sr); assert.ok(envelope.harmonyOnPct>=97);assert.ok(envelope.dropoutsPerMin<=1); measurements.push({...envelope,sr,gain,gateDropouts:closed,activeBlocks:active,tailRms:rms(result.speaker,7*sr)});
}
// Verify the envelope detector against a deliberate100ms dropout.
{const sr=48000,mic=new Float32Array(sr).fill(.1),out=new Float32Array(sr).fill(.1);out.fill(0,sr*.4,sr*.5);assert.equal(analyzeEnvelope(mic,out,sr,mic).dropouts,1);}
// Execute the actual AudioWorklet adapter, including future variable quantum support.
for(const sr of [44100,48000]) for(const quantum of [64,128,256]) {
 let Processor;const messages=[];const scope={sampleRate:sr,currentFrame:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(_,p)=>Processor=p};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../echo-canceller.js'),'utf8'),scope);
 const p=new Processor({processorOptions:{bypass:true}}); const mic=new Float32Array(quantum).fill(.1),out=new Float32Array(quantum);
 for(let i=0;i<100;i++){scope.currentFrame=i*quantum;p.process([[mic],[]],[[out]]);assert.ok(out.every(Number.isFinite));}
 const stats=messages.at(-1);assert.equal(stats.renderGaps,0);assert.equal(stats.missingInputBlocks,0);assert.equal(stats.hardwareUnderruns,null);
 scope.currentFrame+=quantum*2;p.process([[mic],[]],[[out]]);assert.equal(p.renderGaps,1);
 p.onMessage({type:'stop'});assert.equal(p.process([[mic],[]],[[out]]),false);
}
console.log(JSON.stringify({passed:true,measurements},null,2));
