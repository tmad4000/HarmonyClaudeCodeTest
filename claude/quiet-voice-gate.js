/* Adaptive voice decisions for quiet phone microphones. No audio is altered here. */
(function(root){
 class QuietVoiceGate {
  constructor(){this.floor=.0002;this.lastPitch=null;this.stableSince=null;this.open=false;this.lastVoice=-Infinity;this.nearSeed=-Infinity;this.lastNow=null;}
  update({now,rms,pitch,speaker=false,pureTone=false,harmonic=false,stats=null,coupling=1,couplingKnown=false,confirmedHowl=false}){
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
   return {voiced:accepted,open:this.open,threshold,openThreshold,closeThreshold,noiseFloor:this.floor,stable,allowTonal:stable&&tonalSafe,nearDominant,quietReference,reason:!valid?'no-pitch':rms<=threshold?'below-adaptive-floor':pureTone&&!tonalSafe?'possible-feedback':accepted?'pitch-and-near-end':'warming-pitch'};
  }
 }
 const api={QuietVoiceGate};if(typeof module==='object'&&module.exports)module.exports=api;else root.HarmonyQuietVoice=api;
})(globalThis);
