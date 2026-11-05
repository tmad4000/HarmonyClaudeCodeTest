import test from 'node:test';
import assert from 'node:assert/strict';
import {jointMetrics} from './joint-metrics.mjs';
const sr=8000,voiced=Uint8Array.from({length:sr*3},(_,i)=>i>sr*.2&&i<sr*2),oracle=Float32Array.from(voiced,(v,i)=>v*.02*Math.sin(i*2*Math.PI*220/sr));
const score=output=>jointMetrics({output,oracle,voiced,sr,tailStartSeconds:2.5});
test('complete silence is stable but fails joint acceptance',()=>{const m=score(new Float32Array(oracle.length));assert.ok(m.checks.boundedAndReleased);assert.equal(m.jointSuccess,false);assert.equal(m.actualOutputCoverage,0);assert.equal(m.onsetMissing,true);});
test('strong attenuation and sustained gaps fail even with finite output',()=>{
 assert.equal(score(Float32Array.from(oracle,x=>x*.1)).jointSuccess,false);
 const gap=oracle.slice();gap.fill(0,sr,sr*1.3);const m=score(gap);assert.equal(m.jointSuccess,false);assert.ok(m.maxVoicedDropoutMs>=280);
});
test('delivered clean response passes; wrong note and missing attack fail',()=>{
 assert.ok(score(oracle).jointSuccess);
 const wrong=Float32Array.from(voiced,(v,i)=>v*.02*Math.sin(i*2*Math.PI*330/sr));assert.equal(score(wrong).checks.pitchResponsive,false);
 const late=oracle.slice();late.fill(0,0,sr*.5);assert.equal(score(late).checks.onsetResponsive,false);
});
