const assert=require('assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const Level=require('../output-level-control.js');
const {SpeakerLoopControl}=require('../echo-canceller.js');
const db=x=>20*Math.log10(x);
function settle(base=.01,volume=.7){const c=new Level();let result;for(let now=0;now<6000;now+=33){const rms=base*c.gain;result=c.update({inputLive:true,measurementFresh:true,now,rms,peak:rms*3,voiceActive:true,enabled:true,volume});}return {c,result,output:base*c.gain};}
for(const base of [.006,.01,.025,.08]){const {c,output}=settle(base);assert(db(output)>=-24&&db(output)<=-20,'measured output must converge to target range');assert(c.gain<=16&&c.gain>=.125);}
const limited=settle(.003);assert.equal(limited.c.gain,16);assert(limited.output<Math.pow(10,-24/20),'bounded boost may honestly miss target for extreme quiet input');
const lower=settle(.01,.35);assert(Math.abs(db(lower.output)-(-28.0206))<1.1,'respect user mix level');
const c=settle().c,near=c.gain;assert(near>1);
let x=c.update({inputLive:true,measurementFresh:true,now:6000,rms:.08,peak:.24,voiceActive:true,enabled:true,feedback:true});assert.equal(x.reason,'measured-feedback');assert(x.gain<=1);
x=c.update({inputLive:true,measurementFresh:true,now:6500,rms:.01,peak:.03,voiceActive:true,enabled:true});assert(x.gain<=1,'never normalize away feedback duck');
x=c.update({inputLive:true,measurementFresh:true,now:7100,rms:.01,peak:.03,voiceActive:true,enabled:true});assert(x.gain>1&&x.gain<1.1,'bounded measured recovery');
const hot=new Level();hot.gain=8;x=hot.update({inputLive:true,measurementFresh:true,now:0,rms:.25,peak:.7,voiceActive:true,enabled:true});assert(x.gain<=4);assert.equal(x.reason,'measured-hot-output');
const invalid=new Level();invalid.gain=8;x=invalid.update({inputLive:true,measurementFresh:true,now:0,rms:NaN,peak:NaN,voiceActive:true,enabled:true});assert.equal(x.gain,1);assert.equal(x.reason,'measurement-unavailable');
const stale=settle().c;x=stale.update({inputLive:true,measurementFresh:false,now:6000,rms:.01,peak:.03,voiceActive:true,enabled:true});assert.equal(x.gain,1);assert.equal(x.reason,'measurement-stale');
const micOff=settle().c;x=micOff.update({inputLive:false,measurementFresh:true,now:6000,rms:.08,peak:.24,voiceActive:true,enabled:false});assert.equal(x.gain,0);assert.equal(x.reason,'input-unavailable');x=micOff.update({inputLive:true,measurementFresh:true,now:6100,rms:0,peak:0,voiceActive:false,enabled:true});assert.equal(x.gain,1);
const quiet=new Level();for(let now=0;now<8000;now+=33)quiet.update({inputLive:true,measurementFresh:true,now,rms:0,peak:0,voiceActive:true,enabled:true});assert.equal(quiet.gain,1,'never amplify unmeasured silence');
const tail=settle().c;for(let now=6000;now<7000;now+=33)tail.update({inputLive:true,measurementFresh:true,now,rms:.005,peak:.02,voiceActive:false,enabled:true});assert.equal(tail.gain,1,'do not boost effect tails');
const bypass=settle().c;x=bypass.update({inputLive:true,measurementFresh:true,now:6000,rms:.01,peak:.03,voiceActive:true,enabled:false});assert.equal(x.gain,1);
x=bypass.update({inputLive:true,measurementFresh:true,now:6100,rms:.01,peak:.03,voiceActive:true,enabled:true,volume:0});assert.equal(x.gain,1);
const loop=new SpeakerLoopControl({mode:'speakers'});loop.setCoupling(1);
const measured=loop.update({inputLive:true,measurementFresh:true,now:0,voiced:true,stats:{adapted:false,leak:1,outPow:.01,refPow:.01,echoPow:0}});
assert(measured.emergencyActive&&measured.trim<1,'real measured coupling still attenuates');
const box={window:{addEventListener(){}},navigator:{},console};vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../harmony-app.js'),'utf8')+';globalThis.TestSinger=HarmonySinger;',box);
const h=Object.create(box.TestSinger.prototype);h.audioContext={state:'running',currentTime:1};h.usingCanceller=()=>true;h.aecStatsAt=1000;
assert(h.levelMeasurementsFresh(1000));assert(!h.levelMeasurementsFresh(1301),'stalled render clock must not drive gain');
h.audioContext.currentTime=1.2;assert(h.levelMeasurementsFresh(1302));h.audioContext.currentTime=1.3;assert(!h.levelMeasurementsFresh(1700),'stale AEC frame must not drive gain');
h.aecStatsAt=1700;assert(h.levelMeasurementsFresh(1700));h.audioContext.state='suspended';assert(!h.levelMeasurementsFresh(1733));
h.audioContext.state='running';h.audioContext.currentTime=1.4;h.aecStatsAt=1750;assert(h.levelMeasurementsFresh(1770));
console.log(JSON.stringify({passed:true,measuredTargetRangeDb:[-24,-20],boundedGain:true,respectsUserVolume:true,noSilenceChasing:true,noTailBoost:true,hotCut:true,feedbackHold:true,missingMeterUnity:true,renderClockAndAecFreshness:true,disabledInputMutesTail:true}));

const floorGuard=settle().c;const prior=floorGuard.gain;for(let now=6000;now<9000;now+=33){const v=floorGuard.update({inputLive:true,inputAboveFloor:false,measurementFresh:true,now,rms:.00002,peak:.00006,voiceActive:true,enabled:true});assert.equal(v.gain,prior,'below-floor residue must hold gain without raising it even with voice flag/gate held');}
const zero=floorGuard.update({inputLive:true,inputSilent:true,measurementFresh:true,now:9100,rms:.00002,peak:.00006,voiceActive:true,enabled:true});assert.equal(zero.gain,0,'live zero input must mute DSP residue');assert.equal(zero.reason,'input-silent');
