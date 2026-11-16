'use strict';
const assert=require('node:assert/strict');
const {VoiceLevelNormalizer,QuietVoiceGate}=require('../quiet-voice-gate.js');
const {SpeakerLoopControl}=require('../echo-canceller.js');
const valid={enabled:true,freshStats:true,voiced:true,stable:true,independentNear:true,playedAmbiguous:false,howl:false,emergency:false,rms:.0009,couplingKnown:false,basePower:12};
function run(overrides={}){const n=new VoiceLevelNormalizer();let state;for(let now=0;now<=4000;now+=33)state=n.update({...valid,...overrides,now});return {n,state};}
const quiet=run();assert.equal(quiet.state.gain,4);assert.equal(quiet.state.reason,'unknown-room-cap');
for(const bad of [{independentNear:false},{stable:false},{voiced:false},{freshStats:false},{playedAmbiguous:true},{howl:true},{emergency:true},{enabled:false},{rms:1e-7}])assert.equal(run(bad).state.gain,1,JSON.stringify(bad));
// Gate and Continuous are deliberately not inputs to proof authorization.
assert.equal(run({independentNear:false,gate:true,continuous:true}).state.gain,1);
assert.equal(run({rms:.1}).state.gain,1,'normal loud voice is never boosted');
const before=quiet.state.gain;const loss=quiet.n.update({...valid,now:4033,playedAmbiguous:true});assert.equal(loss.gain,1);assert.equal(before,4);
const lapse=run();lapse.n.update({...valid,now:4033,independentNear:false});assert.equal(lapse.n.update({...valid,now:4200,independentNear:false}).gain,1);
const measured=run({couplingKnown:true,coupling:.0001,leak:.02,basePower:12});assert.equal(measured.state.gain,4);assert.equal(measured.state.reason,'prototype-cap');
const held=run({couplingKnown:true,coupling:.2,leak:1,basePower:12});assert.equal(held.state.gain,1);
const rise=new VoiceLevelNormalizer();rise.update({...valid,now:0});assert.ok(rise.update({...valid,now:10000}).gain<=10**(12*.1/20));
const expired=run();assert.ok(expired.n.update({...valid,now:10000,actualGain:1}).gain<=10**(12*.1/20),'expired native gain resumes with bounded rise');
// Amplification is represented outside the historic appGain learning cap. The
// same factor divides measured learning and multiplies the feed-forward bound.
const c=new SpeakerLoopControl({mode:'protected'});c.setCoupling(.01);c.update({now:0,voiced:false,stats:{adapted:false,suspect:false,leak:1,micPow:1e-6,outPow:1e-6,echoPow:1e-8,refPow:1e-6},voiceGain:64,appGainFloor:45});
assert.ok(Math.abs(c.bound-Math.sqrt(.25/(.01*45*4096)))<1e-8);
function tonal(options={}){const q=new QuietVoiceGate();let d;for(let now=0;now<=800;now+=33)d=q.update({now,rms:.0009,pitch:123.47,speaker:true,pureTone:true,harmonic:false,independentPolicy:true,quietLevelProof:true,stats:{micPow:5e-8,outPow:5e-8,refPow:0,echoPow:0,adapted:false},...options});return d;}
assert.equal(tonal().voiced,true,'quiet tonal margin requires a genuine established independent seed');
assert.equal(tonal({quietLevelProof:false}).voiced,false,'excluded profiles retain original tonal margin');
assert.equal(tonal({rms:.00069}).voiced,false,'adaptive floor remains unchanged');
assert.equal(tonal({pitch:null}).voiced,false);
assert.equal(tonal({confirmedHowl:true}).voiced,false);
assert.equal(tonal({playedPitchesHz:[123.47],referenceActive:true,stats:{micPow:5e-8,outPow:5e-8,refPow:1e-4,echoPow:5e-8}}).voiced,false,'reference-only signal cannot bootstrap the exception');
console.log(JSON.stringify({passed:true,unknownCap:4,proofRequired:true,continuousNotProof:true,lossReset:true,knownFeedbackBudget:true,externalPowerAccounting:true}));
