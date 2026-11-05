import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ControlTimeline,validateControlPacket} from '../control-timeline.mjs';
const model=JSON.parse(readFileSync(new URL('../models/authored.json',import.meta.url)));
const feature={voiced:true,midi:60,rms:.05,confidence:1};
const timeline=options=>new ControlTimeline(model,{clockId:'synthetic-capture-epoch-1',...options});
test('frame-centered packet distinguishes source observation availability from timestamp',()=>{
 const t=timeline();t.appendObservation(feature,512);t.appendObservation(feature,1024);
 const p=t.lookup([256,768]);assert.deepEqual(p.observation_end_samples,[512,1024]);assert.equal(p.available_through_sample,1024);assert.ok(p.target_f0_hz.every(x=>x>=50));assert.ok(p.gain_multiplier[1]>.2);validateControlPacket(JSON.parse(JSON.stringify(p)));
});
test('overlapping/out-of-order lookups do not advance or mutate recurrent state',()=>{
 const t=timeline();for(let i=1;i<=6;i++)t.appendObservation(feature,i*512);
 const before=Array.from(t.partner.net.h),a=t.lookup([768,1280,1792]),b=t.lookup([1792,768]);
 assert.equal(a.target_f0_hz[0],b.target_f0_hz[1]);assert.deepEqual(Array.from(t.partner.net.h),before);
 a.gain_multiplier[0]=0;assert.notEqual(t.lookup([768]).gain_multiplier[0],0);
 assert.throws(()=>t.appendObservation(feature,1024),e=>e.code==='ORDER');
});
test('future/gap/replay controls fail explicitly; pre-stream context is labeled zero',()=>{
 const t=timeline();assert.throws(()=>t.lookup([256]),e=>e.code==='NOT_AVAILABLE');assert.throws(()=>t.appendObservation(feature,1024),e=>e.code==='ORDER');
 assert.deepEqual(t.lookup([-768,-256]).target_f0_hz,[0,0]);t.appendObservation(feature,512);
 const bad=t.lookup([256]);bad.observation_end_samples[0]=1024;assert.throws(()=>validateControlPacket(bad),e=>e.code==='CAUSALITY');
 assert.throws(()=>validateControlPacket(t.lookup([256]),{clockId:'different-epoch'}),e=>e.code==='CLOCK');
});
test('bounded cache uses explicit context ACK and rejects expired window reuse',()=>{
 const t=timeline({maxFrames:2});t.appendObservation(feature,512);t.appendObservation(feature,1024);
 assert.throws(()=>t.appendObservation(feature,1536),e=>e.code==='BACKPRESSURE');t.releaseBefore(768);t.appendObservation(feature,1536);
 assert.throws(()=>t.lookup([256]),e=>e.code==='EXPIRED');assert.ok(t.lookup([768,1280]));assert.throws(()=>t.releaseBefore(256),e=>e.code==='ACK');
});
test('normalized gain is not oscillator amplitude; silence has explicit release',()=>{
 const t=timeline();for(let i=1;i<=50;i++)t.appendObservation(feature,i*512);
 const mix=t.lookup([50*512-256]).gain_multiplier[0];assert.ok(mix>.35&&mix<=.45);assert.ok(t.partner.gain<.03);
 for(let i=51;i<=80;i++)t.appendObservation({voiced:false,midi:null,rms:0,confidence:0},i*512);
 const p=t.lookup([80*512-256]);assert.equal(p.target_f0_hz[0],0);assert.equal(p.gain_multiplier[0],0);
});
