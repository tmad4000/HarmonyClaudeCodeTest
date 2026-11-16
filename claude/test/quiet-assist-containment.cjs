'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {QuietAssistContainment,QuietVoiceGate}=require('../quiet-voice-gate.js');
const peak=hz=>[{hz,db:-50,papr:20}];
function arm(power=1e-8,pitch=177,marginUsed=true){const c=new QuietAssistContainment();c.considerVoice({now:0,pitch,rawPow:power,accepted:true,stable:true,independentNear:true,playedAmbiguous:false,freshStats:true,quietReference:true,referenceActive:false,marginUsed});return c;}
assert.equal(arm(1e-8,177,false).status,'assist-armed','equally quiet harmonic voices are included');
assert.equal(arm(1e-4).status,'normal-first-excluded');
for(const pitch of [null,NaN,undefined,0]){const c=arm();c.inspect({now:100,pitch,rawPow:1e-8,peaks:peak(224)});for(let now=200;now<500;now+=33)c.inspect({now,pitch:224,rawPow:1e-6});assert.equal(c.captures.length,0,'missing input pitch is not proof of reference lead');}
for(const power of [0,NaN,Infinity])assert.equal(arm(power).status,'awaiting-first-voice');
{const c=new QuietAssistContainment();c.considerVoice({now:0,pitch:177,accepted:true,stable:true,independentNear:true,freshStats:true,quietReference:true});assert.equal(c.status,'awaiting-first-voice');}
{
 const c=arm();c.inspect({now:100,pitch:177,rawPow:1e-8,peaks:peak(224)});
 c.inspect({now:200,pitch:224,rawPow:1e-6});c.inspect({now:330,pitch:224,rawPow:1e-6});
 assert.equal(c.captures.length,1);assert.equal(c.latched,false);
 c.inspect({now:350,pitch:224,rawPow:1e-6,peaks:peak(283)});
 c.inspect({now:450,pitch:283,rawPow:5e-6});assert.equal(c.inspect({now:580,pitch:283,rawPow:5e-6}),true);
 assert.equal(c.latched,true);assert.equal(c.snapshot().captures.length,2);
}
{
 const c=arm();c.inspect({now:100,pitch:177,rawPow:1e-8,peaks:peak(224)});
 for(let now=1000;now<1500;now+=33)c.inspect({now,pitch:224,rawPow:1e-4,peaks:peak(224)});
 assert.equal(c.latched,false,'a stale steady tail does not establish fresh reference lead');
}
for(const file of ['generated-reference-growth.json','generated-crescendo-steps.json']){
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',file),'utf8'));assert.equal(f.generatedOnly,true);
 const c=arm(f.seedPower,f.seedPitch);
 for(const [now,pitch,rawPow,peaks] of f.rows)c.inspect({now,pitch,rawPow,peaks:peaks.map(([hz,db,papr])=>({hz,db,papr}))});
 assert.equal(c.latched,f.expectedContained,file);
 if(c.latched)assert.ok(c.latchedAt<1500,'contain before the measured later high-output episode');
 assert.ok(c.snapshot().captures.length<=2);assert.ok(c.snapshot().referencePeakHz.length<=3);
}
{
 const q=new QuietVoiceGate();for(let now=0;now<600;now+=33)q.update({now,rms:.001,pitch:177,speaker:true,harmonic:true,independentPolicy:true,stats:{micPow:1e-6,outPow:1e-6,refPow:0},quietLevelProof:true});
 q.revokeIndependentEvidence();const d=q.update({now:700,rms:.001,pitch:177,speaker:true,harmonic:true,independentPolicy:true,suppressNearEvidence:true,stats:{micPow:1e-6,outPow:1e-6,refPow:0},quietLevelProof:true});
 assert.equal(d.nearSeeded,false);assert.equal(d.independentNear,false);
}
{
 const sandbox={window:{addEventListener(){}},navigator:{},performance:{now:()=>1000},console};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../harmony-app.js'),'utf8')+'\nglobalThis.TestSinger=HarmonySinger;',sandbox);
 const h=Object.create(sandbox.TestSinger.prototype),node=()=>({gain:{value:1,cancelAndHoldAtTime(){},linearRampToValueAtTime(v){this.value=v;},rampTo(v){this.value=v;}}});
 Object.assign(h,{speakerMode:true,isRunning:true,debugContinuous:false,calibrating:false,duckUntil:0,audioContext:{currentTime:1},quietAssistContainment:{latched:true},gateGain:node(),masterGain:node(),dryGain:node(),instGain:node(),gains:{upper:node()},updateGuardStatus(){},logEvent(){}});
 h.setDebugContinuous(true);assert.equal(h.debugContinuous,true);assert.equal(h.gateOpen,false);assert.equal(h.masterGain.gain.value,0);assert.equal(h.instGain.gain.value,0);assert.equal(h.normalHarmonyGate(),false);
 h.resetVoiceNormalization();assert.equal(h.quietAssistContainment.latched,true,'mode/mix reset cannot clear the safety latch');
}
console.log(JSON.stringify({passed:true,quietHarmonicIncluded:true,normalFirstExcluded:true,twoFreshLeadCaptures:true,continuedGrowthRequired:true,generatedLoopContained:true,generatedCrescendoStepsNotContained:true,continuousOverridden:true,boundedMetadata:true}));
