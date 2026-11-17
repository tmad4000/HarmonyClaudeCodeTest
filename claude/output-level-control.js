/* Measured speaker level control. No microphone, audio graph, storage or network ownership. */
(function(root){
 'use strict';
 class OutputLevelControl {
  constructor({targetDb=-22,maxGain=16,upDbPerSecond=6}={}) {
   this.targetDb=targetDb;this.maxGain=maxGain;this.upDbPerSecond=upDbPerSecond;this.reset();
  }
  reset(){this.gain=1;this.lastAt=null;this.lastNear=-Infinity;this.feedbackUntil=-Infinity;this.snapshot={gain:1,reason:'idle',targetDb:this.targetDb};}
  update({now,rms,peak,voiceActive,enabled,inputLive=false,inputSilent=false,inputAboveFloor=true,measurementFresh=false,feedback=false,volume=.7}) {
   if(!inputLive||inputSilent){
    this.gain=0;this.lastAt=now;this.lastNear=-Infinity;
    return(this.snapshot={gain:0,reason:inputSilent?'input-silent':'input-unavailable',targetDb:this.targetDb,enabled:!!enabled,inputLive:false,measurementFresh:false});
   }
   if(this.gain===0)this.gain=1; // A new live input starts at unity, not a stale pre-mute boost.
   const dt=this.lastAt===null?0:Math.max(0,Math.min(.1,(now-this.lastAt)/1000));this.lastAt=now;
   const valid=Number.isFinite(rms)&&rms>=0&&Number.isFinite(peak)&&peak>=0;
   const scale=Math.max(0,Math.min(1,Number.isFinite(volume)?volume:0))/.7;
   const target=Math.pow(10,this.targetDb/20)*scale;
   let wanted=this.gain,reason='hold';
   if(!enabled||target===0){wanted=1;reason='bypassed';}
   else if(!measurementFresh){wanted=Math.min(this.gain,1);reason='measurement-stale';}
   else if(!valid){wanted=Math.min(this.gain,1);reason='measurement-unavailable';}
   else if(rms>.16||peak>.6){
    wanted=Math.max(.125,this.gain*Math.min(.5,.12/Math.max(rms,1e-9),.5/Math.max(peak,1e-9)));
    this.feedbackUntil=now+1000;reason='measured-hot-output';
   } else if(feedback){
    this.feedbackUntil=now+1000;wanted=Math.min(this.gain,1);reason='measured-feedback';
   } else if(now<this.feedbackUntil){reason='feedback-recovery-hold';}
   else if(!inputAboveFloor){wanted=Math.min(this.gain,1);reason='input-below-floor';}
   else {
    if(voiceActive)this.lastNear=now;
    if(!voiceActive&&now-this.lastNear>250){wanted=1;reason='no-near-voice';}
    // Do not chase silence, the effect tail, a stale sample or a closed gate.
    else if(voiceActive&&valid&&rms>1e-5){
     const ratio=target/rms;
     // +/-1dB dead band avoids small meter fluctuations pumping the gain.
     wanted=Math.abs(20*Math.log10(ratio))<1?this.gain:Math.max(.125,Math.min(this.maxGain,this.gain*ratio));
     reason='measured-near-voice';
    }
   }
   if(!enabled||target===0)this.gain=1;
   else if(wanted<this.gain)this.gain=wanted; // cuts are immediate; the audio parameter ramps over20ms
   else if(reason==='no-near-voice')this.gain=Math.min(wanted,this.gain*Math.pow(10,3*dt/20));
   else this.gain=Math.min(wanted,this.gain*Math.pow(10,this.upDbPerSecond*dt/20));
   this.gain=Math.max(.125,Math.min(this.maxGain,this.gain));
   return (this.snapshot={gain:this.gain,reason,targetDb:this.targetDb,targetRms:target,measuredRms:valid&&measurementFresh?rms:null,measuredPeak:valid&&measurementFresh?peak:null,voiceActive:!!voiceActive,feedback:!!feedback,enabled:!!enabled,inputLive:!!inputLive,measurementFresh:!!measurementFresh,maxGain:this.maxGain,gainLimited:this.gain>=this.maxGain,targetReached:!!(enabled&&measurementFresh&&valid&&target>0&&rms>=target*.7943&&rms<=target*1.2589)});
  }
 }
 root.HarmonyOutputLevelControl=OutputLevelControl;
 if(typeof module==='object'&&module.exports)module.exports=OutputLevelControl;
})(typeof window==='object'?window:globalThis);
