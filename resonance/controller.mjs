export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class RecurrentNetwork {
 constructor(model){
  const {W,U,V,b,c,leak}=model;
  if(model.format!=='resonance-tensors-v1'||W.length!==12||U.length!==12||V.length!==5||b.length!==12||c.length!==5||leak.length!==12)throw Error('Invalid tensor dimensions');
  for(const [matrix,cols] of [[W,12],[U,8],[V,12]])if(matrix.some(row=>row.length!==cols||row.some(x=>!Number.isFinite(x))))throw Error('Invalid tensor values');
  if([...b,...c,...leak].some(x=>!Number.isFinite(x))||leak.some(x=>x<=0||x>1)||W.some(row=>row.reduce((s,x)=>s+Math.abs(x),0)>=1))throw Error('Unbounded model contract');
  this.m=model;this.h=new Float64Array(12);this.next=new Float64Array(12);
 }
 step(x,dt=.01){
  if(x.length!==8||x.some(v=>!Number.isFinite(v))||!Number.isFinite(dt)||dt<=0)throw Error('Invalid neural input');
  const m=this.m;
  for(let i=0;i<12;i++){
   let z=m.b[i];for(let j=0;j<12;j++)z+=m.W[i][j]*this.h[j];for(let j=0;j<8;j++)z+=m.U[i][j]*clamp(x[j],-1,1);
   const a=1-Math.pow(1-m.leak[i],dt/.01);this.next[i]=(1-a)*this.h[i]+a*Math.tanh(z);
  }
  [this.h,this.next]=[this.next,this.h];
  return m.V.map((row,k)=>Math.tanh(row.reduce((s,w,j)=>s+w*this.h[j],m.c[k])));
 }
}
// Timing scaffold: event-driven phase/period estimate, not a brain-state measurement.
export class Pulse {
 constructor(){this.t=0;this.last=-10;this.period=.6;this.phase=0;this.confidence=0;this.error=0;}
 step(onset,dt){
  this.t+=dt;this.phase=(this.phase+dt/this.period)%1;this.confidence*=Math.exp(-dt/2);
  if(onset&&this.t-this.last>.18){
   const interval=this.t-this.last;
   if(interval>.22&&interval<1.8){
    const rel=Math.abs(interval-this.period)/this.period;
    this.confidence=clamp(this.confidence+(rel<.22?.28:-.32),0,1);
    this.period+= (rel>.3?.65:.3)*(interval-this.period);
   }else this.confidence=0;
   this.error=Math.min(this.phase,1-this.phase)*this.period;
   this.phase*=.15;this.last=this.t;
  }
  return {phase:this.phase,confidence:this.confidence,period:this.period,error:this.error};
 }
}
export class Partner {
 constructor(model,{baseline=false,latency=.035}={}){
  this.net=new RecurrentNetwork(model);this.pulse=new Pulse();this.baseline=baseline;this.latency=latency;
  this.lastPitch=null;this.velocity=0;this.pitch=60;this.lastRms=0;this.wasVoiced=false;this.age=0;this.silence=10;this.interval=-7;this.switchAge=1;this.gain=0;
 }
 step(f,dt=.01){
  const voiced=!!f.voiced&&Number.isFinite(f.midi)&&f.confidence>.65;
  const onset=voiced&&(!this.wasVoiced||f.rms>this.lastRms*1.6+.006);
  const pulse=this.pulse.step(onset,dt);this.switchAge+=dt;
  if(voiced){
   if(!this.wasVoiced){this.age=0;this.velocity=0;this.lastPitch=f.midi;}
   const v=clamp((f.midi-this.lastPitch)/dt,-24,24);this.velocity+=.2*(v-this.velocity);
   this.lastPitch=f.midi;this.age+=dt;this.silence=0;
  }else {this.silence+=dt;this.velocity*=.8;}
  const z=this.net.step([this.velocity/12,clamp(f.rms/.15,0,1),onset?1:0,voiced?1:0,Math.sin(pulse.phase*2*Math.PI)*pulse.confidence,Math.cos(pulse.phase*2*Math.PI)*pulse.confidence,f.confidence||0,Math.min(this.age/4,1)],dt);
  if(voiced){
   const opts=[-7,-5,-12];let best=0;for(let i=1;i<3;i++)if(z[i+1]>z[best+1])best=i;
   const current=opts.indexOf(this.interval);
   if(!this.baseline&&(onset||this.switchAge>.35)&&z[best+1]>z[current+1]+.12){this.interval=opts[best];this.switchAge=0;}
   if(this.baseline)this.interval=-7;
   const anticipation=this.baseline?0:clamp(z[0]*Math.abs(this.velocity)*this.latency,-.6,.6);
   const target=clamp(f.midi+this.interval+anticipation,36,84);
   this.pitch+= (onset?1:1-Math.exp(-dt/.025))*(target-this.pitch);
  }
  // Explicit release and confidence safety scaffolding; no invented future notes.
  const targetGain=voiced?clamp(f.rms*.48,0,.065)*(this.baseline?1:.78+.22*(z[4]+1)/2):0;
  this.gain+=(1-Math.exp(-dt/(voiced?.018:.045)))*(targetGain-this.gain);
  if(this.silence>.22)this.gain=0;
  this.lastRms=f.rms;this.wasVoiced=voiced;
  return {midi:this.pitch,gain:this.gain,interval:this.interval,onset,voiced,anticipation:z[0],expression:z[4],pulse,phraseAge:this.age,state:Array.from(this.net.h)};
 }
}
