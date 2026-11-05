import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Partner,RecurrentNetwork,Pulse} from '../controller.mjs';
import {Pitch,ReferenceCanceller,limit,Safety,calibrate} from '../dsp.mjs';
const model=JSON.parse(readFileSync(new URL('../models/authored.json',import.meta.url)));
test('authored tensors load; malformed, nonfinite and noncontractive models fail closed',()=>{
 assert.equal(new RecurrentNetwork(model).h.length,12);
 for(const change of [m=>m.U[0].pop(),m=>m.W[0][0]=2,m=>m.leak[0]=NaN]){const m=structuredClone(model);change(m);assert.throws(()=>new RecurrentNetwork(m));}
});
test('same current observation yields different response after different contour histories',()=>{
 const a=new RecurrentNetwork(model),b=new RecurrentNetwork(model);
 for(let i=0;i<80;i++){a.step([.6,.4,0,1,0,0,1,.4]);b.step([-.6,.4,0,1,0,0,1,.4]);}
 const x=[0,.4,0,1,0,0,1,.4],ya=a.step(x),yb=b.step(x);
 assert.ok(Math.abs(ya[1]-yb[1])>.5);assert.ok(Math.abs(ya[2]-yb[2])>.5);
});
test('bounded state and causal prefix invariance',()=>{
 const a=new RecurrentNetwork(model),b=new RecurrentNetwork(model);
 for(let i=0;i<1000;i++){const x=Array.from({length:8},(_,j)=>Math.sin(i*(j+1)));assert.deepEqual(a.step(x),b.step(x));assert.ok(a.h.every(x=>Math.abs(x)<=1));}
 b.step(Array(8).fill(1));assert.notDeepEqual(a.h,b.h);
});
test('partner stops, follows new register and uses more than a fixed transposition',()=>{
 const p=new Partner(model),intervals=new Set();
 for(let i=0;i<600;i++){const midi=60+(i<300?i:-i+600)*.02;const o=p.step({voiced:true,midi,rms:.1,confidence:1});intervals.add(o.interval);}
 assert.ok(intervals.size>1);
 for(let i=0;i<80;i++)p.step({voiced:true,midi:77,rms:.1,confidence:1});
 assert.ok(Math.abs(p.pitch-(77+p.interval))<.5);
 for(let i=0;i<30;i++)p.step({voiced:false,midi:77,rms:0,confidence:0});assert.equal(p.gain,0);
});
test('pulse follows tempo change and loses confidence in silence',()=>{
 const p=new Pulse();for(let i=0;i<600;i++)p.step(i%60===0,.01);
 assert.ok(p.confidence>.45);for(let i=0;i<500;i++)p.step(i%40===0,.01);
 assert.ok(Math.abs(p.period-.4)<.03);for(let i=0;i<600;i++)p.step(false,.01);assert.ok(p.confidence<.1);
});
test('pitch tracks harmonic fixtures and rejects silence',()=>{
 const p=new Pitch(8000);for(const f of [90,130.81,220,440,700]){
 const x=Float32Array.from({length:320},(_,i)=>.08*(Math.sin(i*2*Math.PI*f/8000)+.3*Math.sin(i*4*Math.PI*f/8000)));
 const a=p.analyze(x);assert.ok(a.voiced);assert.ok(Math.abs(a.midi-(69+12*Math.log2(f/440)))<.12,`${f}: ${a.midi}`);}
 assert.equal(p.analyze(new Float32Array(320)).voiced,false);
});
test('fixed reference subtraction preserves exact correlated unison and opposite phase',()=>{
 const sr=8000,room={accepted:true,sampleRate:sr,taps:[{lag:23,gain:.7}]};
 for(const polarity of [-1,1]){const a=new ReferenceCanceller(sr,room);let error=0;const output=[];
 for(let n=0;n<12000;n++){output[n]=.08*Math.sin(n*2*Math.PI*220/sr);const human=polarity*.06*Math.sin(n*2*Math.PI*220/sr),mic=human+.7*(output[n-23]||0);const clean=a.process(mic,output[n-1]||0);error+=(clean-human)**2;}
 assert.ok(Math.sqrt(error/12000)<1e-8);}
});
test('safety latches, bounds peaks, and explicitly detects unison ambiguity',()=>{
 assert.equal(limit(Infinity),0);assert.equal(limit(-9),-.12);const s=new Safety();
 for(let i=0;i<80;i++)s.check({coherence:1,echoRms:.03,cleanRms:.04},.01);
 assert.match(s.fault,/correlated/);s.check({coherence:0,echoRms:0,cleanRms:0},1);assert.ok(s.fault);
 assert.throws(()=>calibrate([0],[0],8000));
});
test('using the post-limiter reference matters; a pre-output target is wrong',()=>{
 const sr=8000,room={accepted:true,sampleRate:sr,taps:[{lag:17,gain:.5}]};
 const correct=new ReferenceCanceller(sr,room),wrong=new ReferenceCanceller(sr,room),raw=[],sent=[];let good=0,bad=0;
 for(let n=0;n<4000;n++){raw[n]=.3*Math.sin(n*2*Math.PI*220/sr);sent[n]=limit(raw[n]);const mic=.5*(sent[n-17]||0);good+=correct.process(mic,sent[n-1]||0)**2;bad+=wrong.process(mic,raw[n-1]||0)**2;}
 assert.ok(good<1e-10);assert.ok(bad>.1);
});
