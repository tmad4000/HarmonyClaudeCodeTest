'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs'),nodePath=require('node:path'),vm=require('node:vm');
const {QuietVoiceGate} = require('../quiet-voice-gate.js');
const {SpeakerLoopControl} = require('../echo-canceller.js');

const stats = (refPow = 0, extra = {}) => ({micPow: 2e-5, outPow: 2e-5, refPow,
    echoPow: 1e-8, adapted: true, suspect: false, leak: .95, ...extra});
function path() {
    const voice = new QuietVoiceGate();
    const loop = new SpeakerLoopControl({mode:'speakers',holdMs:450,minTrim:.25,backoffDb:3});
    return {voice, loop, step(now, {pitch=177, rms=.0045, ref=0, played=[], howl=false, pureTone=false,harmonic=true,extra={}} = {}) {
        const st=stats(ref,extra), decision=voice.update({now,rms,pitch,speaker:true,harmonic,pureTone,independentPolicy:true,
            stats:st,playedPitchesHz:played,confirmedHowl:howl,coupling:loop.coupling,couplingKnown:loop.couplingKnown});
        const control=loop.update({now,voiced:decision.voiced,stats:st,independentNear:decision.independentNear,nearSeeded:decision.nearSeeded,playedAmbiguous:decision.matchesPlayed});
        return {decision, control};
    }};
}

// Numeric positive evidence is preserved after (never before) a quiet seed.
// A clearly dominant distinct near singer can recover after a pause without
// relabeling a matched reference as independent near-end evidence.
{
    const p=path();for(let t=0;t<=400;t+=20)p.step(t);
    for(let t=420;t<=1000;t+=20)p.step(t,{pitch:null,rms:0,ref:.001,played:[223]});
    let d;for(let t=1020;t<=2500;t+=20)d=p.step(t,{ref:2e-6,played:[223],pureTone:true,harmonic:false});
    assert.equal(d.decision.independentNear,true);assert.equal(d.decision.nearSeeded,true);
    assert.equal(d.decision.powerNearAfterSeed,true);assert.equal(d.decision.voiced,true);
    assert.equal(d.control.powerNearOk,true);assert.equal(d.control.nearOk,true);assert.equal(d.control.gateOpen,true);
    const fresh=path();const c=fresh.loop.update({now:0,voiced:true,stats:stats(0),independentNear:false,nearSeeded:false});
    assert.equal(c.powerNearOk,true);assert.equal(c.gateOpen,false);
}

// A distinct signal cannot borrow a seed indefinitely after a long gap.
{
    const p=path();for(let t=0;t<=400;t+=20)p.step(t);
    for(let t=420;t<=4000;t+=20)p.step(t,{rms:0,pitch:null,ref:.001,played:[223]});
    let d;for(let t=4020;t<=4500;t+=20)d=p.step(t,{ref:.001,played:[223]});
    assert.equal(d.decision.independentNear,false);assert.equal(d.control.gateOpen,false);
}

// Even a strong (gain > sqrt(3)) coherent echo can satisfy the old positive
// power test. A seed from earlier singing does not authorize that echo forever.
{
    const p=path();for(let t=0;t<=400;t+=20)p.step(t);
    let d;for(let t=420;t<=2500;t+=20)d=p.step(t,{ref:2e-6,played:[177]});
    assert.equal(d.control.powerNearOk,true);assert.equal(d.decision.matchesPlayed,true);
    assert.equal(d.decision.powerNearAfterSeed,false);assert.equal(d.control.nearOk,false);assert.equal(d.control.gateOpen,false);
}

// A cached older app omitting the evidence fields retains its original numeric
// policy and conservative prior-based level bound; false is an explicit new API.
{
    const legacy=path().loop, explicit=path().loop;
    const old=legacy.update({now:0,voiced:true,stats:stats(.001)});
    const modern=explicit.update({now:0,voiced:true,stats:stats(.001),independentNear:false,nearSeeded:false});
    assert.ok(old.trim<1);assert.equal(old.nearOk,false);assert.equal(modern.trim,1);assert.equal(modern.nearOk,false);
}

// Digital output can be much louder than acoustic near voice. Unknown room gain
// is not evidence against a singer independently established before playback.
{
    const p=path();let d;
    for(let t=0;t<=400;t+=20){d=p.step(t);if(t<300)assert.equal(d.control.gateOpen,false);}
    assert.equal(d.decision.nearReason,'quiet-reference-seed');
    for(let t=420;t<5000;t+=20){d=p.step(t,{ref:.001,played:[222.999,140.485]});
        assert.equal(d.control.powerNearOk,false);assert.equal(d.control.nearOk,true);
        assert.equal(d.control.gateOpen,true);assert.equal(d.control.residualConfidence,'unknown');
        assert.equal(d.decision.nearReason,'distinct-near-continuity');
        assert.equal(d.control.trim,1);assert.equal(d.control.loopGainKnown,false);
        assert.equal(p.loop.appGain,1);}
}

// Worklet stats can arrive after the first pitch callback. Missing stats do not
// bypass the near-end evidence requirement or start output before the seed.
{
    const p=path();const c=p.loop.update({now:0,voiced:true,stats:null,independentNear:false});
    assert.equal(c.nearOk,false);assert.equal(c.gateOpen,false);
    const seeded=p.loop.update({now:20,voiced:true,stats:null,independentNear:false,nearSeeded:true});
    assert.equal(seeded.nearOk,false);
}

// Echo from an already-playing reference never creates a near-end seed, even
// when it is stable and has many harmonics (a voice recording is not proof).
for(const ratio of [1,2,.5,3,1/3,4,.25,6,1/6]){
    const p=path();for(let t=0;t<2500;t+=20){const d=p.step(t,{pitch:177*ratio,ref:.001,played:[177]});
        assert.equal(d.decision.independentNear,false);assert.equal(d.control.gateOpen,false);}
}

// An existing seed may bridge a consonant/analysis gap, but a sounding unison,
// octave or its partial cannot renew it forever after the singer stops.
for(const pitch of [177,354,88.5]){
    const p=path();for(let t=0;t<=400;t+=20)p.step(t);
    let d;for(let t=420;t<=1600;t+=20)d=p.step(t,{pitch,ref:.001,played:[177]});
    assert.equal(d.decision.matchesPlayed,true);assert.equal(d.decision.independentNear,false);
    assert.equal(d.control.gateOpen,false);assert.equal(d.decision.nearReason,'played-reference-match');
}

// Delayed/reverberant old targets stay ambiguous after the current target changes.
{
    const p=path();for(let t=0;t<=400;t+=20)p.step(t);
    p.step(420,{ref:.001,played:[177]});
    const d=p.step(700,{pitch:177,ref:.001,played:[223]});
    assert.equal(d.decision.matchesPlayed,true);assert.notEqual(d.decision.nearReason,'distinct-near-continuity');
}

// No late bootstrap while output is loud; no silent/no-pitch renewal; no howl renewal.
{
    const p=path();for(let t=0;t<1500;t+=20)p.step(t,{ref:.001,played:[223]});
    assert.equal(p.voice.nearSeed,-Infinity);
    for(let t=1500;t<=1900;t+=20)p.step(t);
    const d=p.step(1920,{ref:.001,played:[223],howl:true});assert.equal(d.decision.independentNear,false);
    for(let t=1940;t<=3000;t+=20)p.step(t,{rms:0,pitch:null,ref:.001,played:[223]});
    assert.equal(p.loop.gateOpen,false);
}

// Calibrated dangerous echo cannot be bypassed by the independent-near flag.
{
    const p=path();p.loop.setCoupling(1);
    const c=p.loop.update({now:500,voiced:true,stats:stats(.001),independentNear:true});
    assert.equal(c.nearOk,false);assert.equal(c.gateOpen,false);assert.equal(c.residualConfidence,'speaker-check');
}

// The first converged echo-path sample is the measurement itself, not an EMA
// from the unmeasured 0dB prior incorrectly marked "known" after one sample.
{
    const p=path();const c=p.loop.update({now:500,voiced:true,stats:stats(.001,{leak:.05,echoPow:5e-7}),independentNear:false,nearSeeded:true,playedAmbiguous:false});
    assert.equal(p.loop.coupling,.0005);assert.equal(p.loop.couplingKnown,true);
    assert.equal(c.residualConfidence,'learned-aec');assert.equal(c.nearOk,true);
    const suspect=path();suspect.loop.update({now:500,voiced:true,stats:stats(.001,{leak:.05,suspect:true,echoPow:5e-7}),independentNear:false});
    assert.equal(suspect.loop.couplingKnown,false);
}

// Learning a room from an external reference does not bootstrap unseeded output.
{
    const p=path();p.loop.setCoupling(.0005);
    const c=p.loop.update({now:500,voiced:true,stats:stats(0),independentNear:false,nearSeeded:false,playedAmbiguous:false});
    assert.equal(c.powerNearOk,true);assert.equal(c.nearOk,false);assert.equal(c.gateOpen,false);
}

// Exercise the actual graph-target method, including post-gate effect and piano
// release tails. No browser, microphone or invented output signal is involved.
{
    const sandbox={window:{addEventListener(){}},navigator:{},console};vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(nodePath.join(__dirname,'../harmony-app.js'),'utf8')+'\nglobalThis.TestSinger=HarmonySinger;',sandbox);
    const h=Object.create(sandbox.TestSinger.prototype);
    Object.assign(h,{gateOpen:true,backing:'voice',smoothedPitch:220,voiceShifts:{upper:4,lower:-3},
        gains:{upper:{gain:{value:.42}},lower:{gain:{value:0}}},aecStats:{refPow:.001},instNotes:[]});
    const playing=h.playedPitchesHz();assert.equal(playing.length,1);assert.ok(Math.abs(playing[0]-220*2**(4/12))<1e-6);
    h.gateOpen=false;h.smoothedPitch=330;assert.equal(h.playedPitchesHz(),playing);
    h.aecStats.refPow=0;assert.equal(h.playedPitchesHz().length,0);
    Object.assign(h,{gateOpen:true,backing:'piano',instGain:{gain:{value:.9}},instNotes:[60,64]});
    const piano=h.playedPitchesHz();assert.equal(piano.length,2);h.gateOpen=false;h.aecStats.refPow=.001;h.instNotes=[];
    assert.equal(h.playedPitchesHz(),piano,'a released instrument still has a speaker-reference tail');
}

// Existing absolute hot-output emergency still attenuates even with near evidence.
{
    const p=path();p.loop.setCoupling(.0005);
    for(let t=0;t<=500;t+=20)p.loop.update({now:t,voiced:true,stats:stats(.2),independentNear:true});
    assert.ok(p.loop.emergencies>0);assert.ok(p.loop.applied<=.5);
}

console.log(JSON.stringify({passed:true,quietUnknownContinuity:true,noUnseededEcho:true,
    noUnisonOctaveRenewal:true,recentPlayedTargetsProtected:true,knownEchoVeto:true,
    firstMeasurementUnbiased:true,suspectDoesNotCalibrate:true,hotEmergencyUnchanged:true}));
