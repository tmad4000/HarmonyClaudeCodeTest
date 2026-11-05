import {Partner} from './controller.mjs';
import {Ring,Pitch,ReferenceCanceller,Safety,rms} from './dsp.mjs';
export class Engine {
 constructor(sr,model,{room=null,baseline=false}={}){
  this.sr=sr;this.room=room;this.partner=new Partner(model,{baseline});this.pitch=new Pitch(sr);
  this.aec=new ReferenceCanceller(sr,room);this.safety=new Safety();
  this.size=Math.round(sr*.04);this.hop=Math.round(sr*.01);this.clean=new Ring(this.size);this.echo=new Ring(this.size);
  this.rawPeak=0;this.n=0;this.control={midi:60,gain:0,expression:0};this.telemetry={};this.coherence=0;
 }
 push(mic,previousOutput){
  const valid=Number.isFinite(mic)&&Number.isFinite(previousOutput);
  if(!valid){this.safety.fault='Input/reference unavailable';mic=0;previousOutput=0;}
  this.rawPeak=Math.max(this.rawPeak,Math.abs(mic));
  const clean=this.aec.process(mic,previousOutput);this.clean.push(clean);this.echo.push(this.aec.estimate);this.n++;
  if(this.n%this.hop===0){
   const x=this.clean.frame(this.size),e=this.echo.frame(this.size),energy=rms(x),echoRms=rms(e);
   // Compare to actual emitted output over the entire supported delay range, never to a target note.
   if(this.room&&this.n%(this.hop*10)===0){
    let best=0;const ref=this.aec.reference;
    for(let lag=0;lag<Math.ceil(this.sr*.24);lag++){
     let dot=0,a=0,b=0;
     for(let k=0;k<this.size;k+=4){const u=x[this.size-1-k],v=ref.ago(lag+k);dot+=u*v;a+=u*u;b+=v*v;}
     if(a>1e-8&&b>1e-8)best=Math.max(best,Math.abs(dot)/Math.sqrt(a*b));
    }
    this.coherence=best;
   }
   const threshold=this.room?Math.max(.004,this.room.noise*3,echoRms*Math.max(.06,this.room.residualRatio*3/Math.max(this.room.l1,.01))):.004;
   const features=this.pitch.analyze(x,threshold);
   this.control=this.partner.step(features,this.hop/this.sr);
   this.safety.check({rawPeak:this.rawPeak,coherence:this.room?this.coherence:0,echoRms,cleanRms:energy,valid},this.hop/this.sr);
   if(this.safety.fault)this.control.gain=0;
   this.telemetry={...features,partnerMidi:this.control.midi,gain:this.control.gain,interval:this.control.interval,coherence:this.coherence,echoRms,threshold,fault:this.safety.fault,pulse:this.control.pulse,state:this.control.state,phraseAge:this.control.phraseAge};
   this.rawPeak=0;
  }
  return clean;
 }
}
