'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base='6b5783d';
function baseline(file){const source=execFileSync('git',['show',base+':claude/'+file],{cwd:root,encoding:'utf8'}),box={module:{exports:{}}};vm.runInNewContext(source,box);return box.module.exports;}
const OldVoice=baseline('quiet-voice-gate.js').QuietVoiceGate,OldLoop=baseline('echo-canceller.js').SpeakerLoopControl;
const {QuietVoiceGate}=require('../quiet-voice-gate.js'),{SpeakerLoopControl}=require('../echo-canceller.js');
const json=x=>JSON.parse(JSON.stringify(x));
for(const mode of ['speakers','protected']){
 const oldVoice=new OldVoice(),voice=new QuietVoiceGate(),options={mode,holdMs:450,minTrim:.25,backoffDb:3},oldLoop=new OldLoop(options),loop=new SpeakerLoopControl(options);
 for(let i=0;i<1800;i++){
  const phase=i%240,now=i*33,rms=phase<20?0:.0025+Math.sin(i/17)*.001,pitch=rms?phase<130?177:221:null;
  const st={micPow:rms*rms,outPow:rms*rms*.8,refPow:phase<50?0:.00001*(1+Math.sin(i/13)*.5),echoPow:phase<50?0:2e-7,adapted:i>50,suspect:i%97<3,leak:phase>120?.04:.95};
  if(i===600){oldLoop.setCoupling(.00046);loop.setCoupling(.00046);}
  if(i===1200){oldLoop.reset();loop.reset();}
  const input={now,rms,pitch,speaker:true,pureTone:phase%3===0,harmonic:phase%3!==0,stats:st,coupling:oldLoop.coupling,couplingKnown:oldLoop.couplingKnown,confirmedHowl:phase===100};
  const old=oldVoice.update(input),current=voice.update({...input,independentPolicy:false,playedPitchesHz:[177,221]});
  assert.deepEqual(json(current),json(old),'legacy classifier '+mode+' frame '+i);
  const state={now,voiced:old.voiced&&(!input.pureTone||input.harmonic||old.allowTonal),stats:st},a=oldLoop.update(state),b=loop.update(state);
  for(const key of Object.keys(a))assert.equal(b[key],a[key],'legacy controller '+key+' '+mode+' frame '+i);
  for(const key of ['coupling','couplingKnown','appGain','bound','trim','applied','lastNearAt'])assert.equal(loop[key],oldLoop[key],'legacy state '+key+' '+mode+' frame '+i);
 }
}
const sandbox={window:{addEventListener(){}},navigator:{},console};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'harmony-app.js'),'utf8')+'\nglobalThis.TestSinger=HarmonySinger;',sandbox);
const h=Object.create(sandbox.TestSinger.prototype);
for(const mode of ['thirds','unison','octaves','fifths','sixths','power','choir','barbershop','gospel','jazz','ethereal','close'])for(const backing of ['voice','voice+piano','piano','strings'])for(const position of ['above','below','both']){
 Object.assign(h,{currentMode:mode,backing,harmonyPosition:position,voiceShifts:{lower:0,upper:0}});
 assert.equal(h.usesIndependentNearEvidence(),mode==='thirds'&&backing==='voice');
}
console.log(JSON.stringify({passed:true,baseline:base,legacyClassifierAndControllerParityFrames:3600,includesFirstLearningSuspectCalibrationReset:true,scope:'thirds + voice only; above/below/both; independent of initial zero shifts'}));
