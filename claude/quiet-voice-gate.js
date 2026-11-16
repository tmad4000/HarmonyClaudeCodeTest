/* Adaptive voice decisions. Excluded modes keep the original classifier unchanged. */
(function(root){
 class QuietVoiceGate {
  constructor(){this.floor=.0002;this.lastPitch=null;this.stableSince=null;this.open=false;this.lastVoice=-Infinity;this.nearSeed=-Infinity;this.lastNow=null;this.independentGate=new IndependentQuietVoiceGate();}
  update(options){const {now,rms,pitch,speaker=false,pureTone=false,harmonic=false,stats=null,coupling=1,couplingKnown=false,confirmedHowl=false}=options;
   const valid=Number.isFinite(pitch)&&pitch>=60&&pitch<2000,dt=this.lastNow==null?0:Math.min(200,Math.max(0,now-this.lastNow));this.lastNow=now;
   if(!valid){this.stableSince=null;this.lastPitch=null;if(rms<.003)this.floor+=(Math.min(rms,.002)-this.floor)*Math.min(.08,dt/2000);}
   else{if(this.lastPitch&&[1,.5,2,1/3,3,.25,4].some(r=>Math.abs(1200*Math.log2(pitch*r/this.lastPitch))<100)){if(this.stableSince===null)this.stableSince=now;}else this.stableSince=now;this.lastPitch=pitch;}
   this.floor=Math.max(.00003,Math.min(.0015,this.floor));const openThreshold=Math.max(.0007,this.floor*3),closeThreshold=Math.max(.0004,this.floor*1.8),threshold=this.open?closeThreshold:openThreshold,stable=valid&&this.stableSince!==null&&now-this.stableSince>=130;
   const mic=stats?.micPow||rms*rms,ref=stats?.refPow||0,out=stats?.outPow||rms*rms,leak=stats?.adapted&&!stats?.suspect?Math.max(.02,stats.leak||0):1,echo=Math.max(stats?.echoPow||0,coupling*ref)*leak;
   const quietReference=ref<mic*.05,nearDominant=(!speaker||(couplingKnown&&stats?.adapted&&!stats?.suspect))&&out>4*echo+1e-9;
   if(stable&&rms>threshold&&quietReference)this.nearSeed=now;
   const tonalSafe=!speaker||(!confirmedHowl&&(quietReference||nearDominant||now-this.nearSeed<1500));
   const accepted=valid&&rms>threshold&&(harmonic||stable)&&(!pureTone||harmonic||(stable&&tonalSafe&&rms>openThreshold*1.5));
   if(accepted)this.lastVoice=now;this.open=now-this.lastVoice<450;
   const legacyDecision={voiced:accepted,open:this.open,threshold,openThreshold,closeThreshold,noiseFloor:this.floor,stable,allowTonal:stable&&tonalSafe,nearDominant,quietReference,reason:!valid?'no-pitch':rms<=threshold?'below-adaptive-floor':pureTone&&!tonalSafe?'possible-feedback':accepted?'pitch-and-near-end':'warming-pitch'};
   return options.independentPolicy===true?this.independentGate.update(options):legacyDecision;
  }
  revokeIndependentEvidence(){const g=this.independentGate;g.nearSeed=-Infinity;g.lastVoice=-Infinity;g.open=false;g.referenceQuietSince=null;g.stableSince=null;}
 }

 class IndependentQuietVoiceGate {
  constructor(){this.floor=.0002;this.lastPitch=null;this.stableSince=null;this.open=false;this.lastVoice=-Infinity;this.nearSeed=-Infinity;this.lastNow=null;this.referenceQuietSince=null;this.playedHistory=[];}
  update({now,rms,pitch,speaker=false,pureTone=false,harmonic=false,stats=null,coupling=1,couplingKnown=false,confirmedHowl=false,playedPitchesHz=[],referenceActive=null,quietLevelProof=false,suppressNearEvidence=false}){
   const valid=Number.isFinite(pitch)&&pitch>=60&&pitch<2000,dt=this.lastNow==null?0:Math.min(200,Math.max(0,now-this.lastNow));this.lastNow=now;
   if(!valid){this.stableSince=null;this.lastPitch=null;if(rms<.003)this.floor+=(Math.min(rms,.002)-this.floor)*Math.min(.08,dt/2000);}
   else{if(this.lastPitch&&[1,.5,2,1/3,3,.25,4].some(r=>Math.abs(1200*Math.log2(pitch*r/this.lastPitch))<100)){if(this.stableSince===null)this.stableSince=now;}else this.stableSince=now;this.lastPitch=pitch;}
   this.floor=Math.max(.00003,Math.min(.0015,this.floor));const openThreshold=Math.max(.0007,this.floor*3),closeThreshold=Math.max(.0004,this.floor*1.8),threshold=this.open?closeThreshold:openThreshold,stable=valid&&this.stableSince!==null&&now-this.stableSince>=130;
   const mic=stats?.micPow||rms*rms,ref=stats?.refPow||0,out=stats?.outPow||rms*rms,leak=stats?.adapted&&!stats?.suspect?Math.max(.02,stats.leak||0):1,echo=Math.max(stats?.echoPow||0,coupling*ref)*leak;
   const quietReference=ref<mic*.05,nearDominant=(!speaker||(couplingKnown&&stats?.adapted&&!stats?.suspect))&&out>4*echo+1e-9;
   // A digital speaker feed is not a measurement of acoustic echo. While the room
   // gain is unknown, establish a real near-end seed before allowing continuity.
   // Wait out the reference tail; a harmonic-looking echo alone is not a seed.
   referenceActive=referenceActive===null?ref>=1e-8:!!referenceActive;
   if(quietReference&&!referenceActive){if(this.referenceQuietSince===null)this.referenceQuietSince=now;}else this.referenceQuietSince=null;
   this.playedHistory=this.playedHistory.filter(p=>now-p.at<=750);
   const played=playedPitchesHz.filter(f=>Number.isFinite(f)&&f>=30&&f<=12000).slice(0,8);
   if(referenceActive)for(const hz of played){const prior=this.playedHistory.find(p=>Math.abs(1200*Math.log2(p.hz/hz))<20);if(prior){prior.at=now;prior.hz=hz;}else this.playedHistory.push({hz,at:now});}
   if(this.playedHistory.length>256)this.playedHistory.splice(0,this.playedHistory.length-256);
   // YIN may lock to a partial or subharmonic of our output. Those are ambiguous
   // too, including all unison/octave voices; they cannot renew a near-end lease.
   const matchesPlayed=valid&&this.playedHistory.some(p=>{for(let k=1;k<=6;k++)if(Math.abs(1200*Math.log2(pitch/(p.hz*k)))<80||Math.abs(1200*Math.log2(pitch/(p.hz/k)))<80)return true;return false;});
   const candidate=valid&&rms>threshold&&(harmonic||stable),settledQuiet=this.referenceQuietSince!==null&&now-this.referenceQuietSince>=300;
   const quietSeed=!suppressNearEvidence&&speaker&&candidate&&stable&&settledQuiet&&!matchesPlayed&&!confirmedHowl;
   const distinctRenewal=!suppressNearEvidence&&speaker&&candidate&&stable&&referenceActive&&this.playedHistory.length>0&&!matchesPlayed&&!confirmedHowl&&now-this.nearSeed<=3000;
   if(quietSeed||distinctRenewal)this.nearSeed=now;
   const nearSeeded=Number.isFinite(this.nearSeed);
   const independentNear=!suppressNearEvidence&&speaker&&candidate&&!confirmedHowl&&now-this.nearSeed<=450;
   // Retain the original conservative positive power evidence after a real seed.
   // It never bootstraps output, nor renews an ambiguous played-pitch seed.
   const powerNearAfterSeed=speaker&&!couplingKnown&&nearSeeded&&!matchesPlayed&&out>3*echo+1e-9;
   const nearReason=confirmedHowl?'confirmed-howl':quietSeed?'quiet-reference-seed':distinctRenewal?'distinct-near-continuity':powerNearAfterSeed?'power-near-after-seed':matchesPlayed?'played-reference-match':independentNear?'near-seed-hold':nearSeeded?'near-seed-expired':'awaiting-quiet-near-seed';
   const tonalSafe=!speaker||(!confirmedHowl&&(quietReference||nearDominant||independentNear||powerNearAfterSeed));
   const quietTonalProof=quietLevelProof&&independentNear&&stable&&!matchesPlayed&&!confirmedHowl;
   const accepted=valid&&rms>threshold&&(harmonic||stable)&&(!pureTone||harmonic||(stable&&tonalSafe&&rms>openThreshold*(quietTonalProof?1:1.5)));
   if(accepted)this.lastVoice=now;this.open=now-this.lastVoice<450;
   return {voiced:accepted,open:this.open,threshold,openThreshold,closeThreshold,noiseFloor:this.floor,stable,allowTonal:stable&&tonalSafe,nearDominant,quietReference,independentNear,nearSeeded,powerNearAfterSeed,nearReason,quietTonalMarginUsed:!!(accepted&&pureTone&&!harmonic&&quietTonalProof&&rms<=openThreshold*1.5),seedAgeMs:nearSeeded?Math.max(0,now-this.nearSeed):null,residualConfidence:couplingKnown?'measured-or-learned':'unknown',matchesPlayed,playedPitchesHz:played,referenceActive,reason:!valid?'no-pitch':rms<=threshold?'below-adaptive-floor':pureTone&&!tonalSafe?'possible-feedback':accepted?'pitch-and-near-end':'warming-pitch'};
  }
 }
 // Voice-only gain, downstream of the detectors. Continuous mode is never proof.
 class VoiceLevelNormalizer {
  constructor(){this.gain=1;this.lastNow=null;this.lastProof=-Infinity;}
  update(s){
   // A native deadman may have expired while JavaScript was stalled. Resume
   // from the physical gain, not the stale pre-stall command.
   if(Number.isFinite(s.actualGain))this.gain=Math.min(this.gain,Math.max(1,s.actualGain));
   const dt=this.lastNow===null?0:Math.min(.1,Math.max(0,(s.now-this.lastNow)/1000));this.lastNow=s.now;
   const clean=Number.isFinite(s.rms)&&s.rms>=.00005;
   const proof=!!s.enabled&&!!s.freshStats&&!!s.voiced&&!!s.stable&&!!s.independentNear&&!s.playedAmbiguous&&!s.howl&&!s.emergency&&clean;
   const blocked=!s.enabled||!s.freshStats||s.playedAmbiguous||s.howl||s.emergency||!clean;
   if(proof&&!blocked)this.lastProof=s.now;
   let ceiling=4,reason=s.couplingKnown?'prototype-cap':'unknown-room-cap';
   const basePower=Math.max(1,s.basePower||1);
   if(s.couplingKnown){const leak=Math.max(.02,Math.min(1,s.leak||1)),budget=Math.sqrt(.25/Math.max(1e-12,s.coupling*leak*basePower));ceiling=Math.min(ceiling,Math.max(1,budget));if(budget<4)reason='feedback-budget';}
   this.gain=Math.min(this.gain,ceiling);
   const desired=proof&&!blocked?Math.max(1,Math.min(ceiling,.035/s.rms)):this.gain;
   if(blocked||s.now-this.lastProof>80){this.gain=1;reason=blocked?'proof-blocked':'proof-lost';}
   else if(proof)this.gain=desired<this.gain?desired:Math.min(desired,this.gain*Math.pow(10,12*dt/20));
   return {gain:this.gain,ceiling,proof,reason,basePower,targetRms:.035,unknownRoomCap:4,proofAgeMs:Number.isFinite(this.lastProof)?s.now-this.lastProof:null};
  }
 }
 class QuietAssistContainment {
  constructor(){this.status='awaiting-first-voice';this.anchor=null;this.latched=false;this.reason=null;this.seedSamples=[];this.resetRender();}
  static cents(a,b){return Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>0?Math.abs(1200*Math.log2(a/b)):Infinity;}
  resetRender(){this.events=[];this.lastDominant=null;this.serial=0;this.pending=null;this.since=null;this.captures=[];this.lastCaptured=null;this.referencePeakHz=[];}
  considerVoice(s){
   if(this.status!=='awaiting-first-voice')return;
   if(s.quietReference&&!s.referenceActive&&s.rawPow>0&&Number.isFinite(s.rawPow)&&Number.isFinite(s.pitch)&&s.pitch>=60&&s.pitch<2000){this.seedSamples.push({at:s.now,power:s.rawPow,pitch:s.pitch});this.seedSamples=this.seedSamples.filter(x=>s.now-x.at<=200).slice(-8);}
   if(!s.accepted||!s.independentNear||!s.stable||s.playedAmbiguous||!s.freshStats||!Number.isFinite(s.rawPow)||s.rawPow<=0||!Number.isFinite(s.pitch)||s.pitch<60||s.pitch>=2000)return;
   if(!s.quietReference||s.referenceActive)return;
   this.firstVoice={at:s.now,micPow:s.rawPow,pitch:s.pitch};
   if(s.quietReference&&!s.referenceActive){
    const samples=this.seedSamples.filter(x=>QuietAssistContainment.cents(x.pitch,s.pitch)<100);
    const power=samples.length?samples.reduce((n,x)=>n+x.power,0)/samples.length:s.rawPow;
    if(Number.isFinite(power)&&power>0&&power<=1e-6&&s.rawPow<=1e-6){this.anchor={at:s.now,micPow:power,pitch:s.pitch,usedNewTonalMargin:!!s.marginUsed};this.status='assist-armed';this.reason='measured-quiet-first-independent-seed';}
   }
   if(!this.anchor){this.status='normal-first-excluded';this.reason='first-seeded-voice-above-quiet-threshold';}
   this.seedSamples=[];
  }
  inspect(s){
   if(!this.anchor||this.latched)return false;
   const cents=QuietAssistContainment.cents;
   if(s.peaks){
    const valid=s.peaks.filter(p=>Number.isFinite(p.hz)&&p.hz>=60&&p.hz<2000&&Number.isFinite(p.db)).sort((a,b)=>b.db-a.db);
    const strong=valid.length?valid.filter(p=>p.db>=valid[0].db-6).slice(0,3):[];
    this.referencePeakHz=strong.map(p=>p.hz);
    const dominant=strong[0];
    if(dominant&&(this.lastDominant===null||cents(dominant.hz,this.lastDominant)>=200)){
     this.lastDominant=dominant.hz;this.events.push({id:++this.serial,at:s.now,hz:dominant.hz,lead:Number.isFinite(s.pitch)&&s.pitch>=60&&s.pitch<2000&&cents(s.pitch,dominant.hz)>=80});
    }
   }
   this.events=this.events.filter(e=>s.now-e.at<=500).slice(-12);
   if(!Number.isFinite(s.rawPow)||s.rawPow<=0){this.pending=null;this.since=null;return false;}
   this.growthDb=10*Math.log10(Math.max(s.rawPow,1e-20)/this.anchor.micPow);
   const eligible=this.events.filter(e=>e.lead&&s.now-e.at>=50&&s.now-e.at<=500&&cents(s.pitch,e.hz)<80);
   const event=this.growthDb>=18&&cents(s.pitch,this.anchor.pitch)>=300?eligible.at(-1):null;
   if(!event){this.pending=null;this.since=null;return false;}
   if(this.pending!==event.id){this.pending=event.id;this.since=s.now;}
   if(s.now-this.since<100||this.lastCaptured===event.id)return false;
   this.lastCaptured=event.id;
   const capture={at:s.now,pitch:s.pitch,growthDb:this.growthDb,refAt:event.at,refHz:event.hz};
   const first=this.captures[0];
   if(first&&s.now-first.at<=1000&&cents(s.pitch,first.pitch)>=200&&this.growthDb-first.growthDb>=6){this.captures=[first,capture];this.latched=true;this.status='contained';this.reason='rendered-reference-growth';this.latchedAt=s.now;return true;}
   if(!first||s.now-first.at>1000)this.captures=[capture];else this.captures=[first,capture];
   return false;
  }
  snapshot(){return {status:this.status,armed:!!this.anchor,latched:this.latched,reason:this.reason,quietRmsThreshold:.001,firstVoice:this.firstVoice?{...this.firstVoice}:null,anchor:this.anchor?{...this.anchor}:null,captures:this.captures.map(c=>({...c})),referencePeakHz:[...this.referencePeakHz],growthDb:Number.isFinite(this.growthDb)?this.growthDb:null,latchedAt:this.latchedAt??null};}
 }
 const api={QuietVoiceGate,VoiceLevelNormalizer,QuietAssistContainment};if(typeof module==='object'&&module.exports)module.exports=api;else root.HarmonyQuietVoice=api;
})(globalThis);
