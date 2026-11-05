import {clamp} from './controller.mjs';
export const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/Math.max(x.length,1));
// Matched fourth-order Butterworth anti-alias filters. Both mic and emitted
// reference get the same group delay before decimation; no audio output is filtered here.
export class AnalysisLowpass {
 constructor(sr){
  const w=2*Math.PI*1500/sr,c=Math.cos(w),s=Math.sin(w);
  this.sections=[.5411961,1.306563].map(q=>{const a=s/(2*q),a0=1+a;return {b0:(1-c)/2/a0,b1:(1-c)/a0,b2:(1-c)/2/a0,a1:-2*c/a0,a2:(1-a)/a0,z1:0,z2:0};});
 }
 sample(x){for(const f of this.sections){const y=f.b0*x+f.z1;f.z1=f.b1*x-f.a1*y+f.z2;f.z2=f.b2*x-f.a2*y;x=y;}return x;}
}
export class Ring {
 constructor(n){this.a=new Float32Array(n);this.i=0;}
 push(x){this.a[this.i]=x;this.i=(this.i+1)%this.a.length;}
 ago(lag){return this.a[(this.i-1-lag+this.a.length*2)%this.a.length];}
 frame(n){const x=new Float32Array(n);for(let k=0;k<n;k++)x[k]=this.ago(n-1-k);return x;}
}
export class Pitch {
 constructor(sr){this.sr=sr;this.last=null;}
 analyze(x,threshold=.004){
  const energy=rms(x);if(energy<threshold)return {rms:energy,voiced:false,confidence:0,midi:this.last??60};
  // Normalized squared-difference; first strong local minimum avoids octave subharmonics.
  const min=Math.floor(this.sr/900),max=Math.min(Math.floor(this.sr/75),Math.floor(x.length/2)-1);
  const d=new Float64Array(max+2);
  for(let lag=min;lag<=max+1;lag++){
   let diff=0,pow=0;for(let i=lag;i<x.length;i++){const a=x[i],b=x[i-lag];diff+=(a-b)**2;pow+=a*a+b*b;}
   d[lag]=diff/(pow+1e-12);
  }
  let best=min;for(let lag=min+1;lag<max;lag++)if(d[lag]<d[best])best=lag;
  for(let lag=min+1;lag<max;lag++)if(d[lag]<.16&&d[lag]<=d[lag-1]&&d[lag]<d[lag+1]){best=lag;break;}
  const den=d[best-1]-2*d[best]+d[best+1];
  const fraction=Number.isFinite(den)&&Math.abs(den)>1e-9?clamp(.5*(d[best-1]-d[best+1])/den,-.5,.5):0;
  const midi=69+12*Math.log2(this.sr/(best+fraction)/440),confidence=clamp(1-d[best],0,1);
  const voiced=confidence>.82;if(voiced)this.last=midi;
  return {rms:energy,voiced,confidence,midi};
 }
}
export class Renderer {
 constructor(sr){this.sr=sr;this.phase=0;this.gain=0;this.freq=220;}
 sample(control){
  this.freq+=(1-Math.exp(-1/(this.sr*.008)))*(440*2**((control.midi-69)/12)-this.freq);
  this.gain+=(1-Math.exp(-1/(this.sr*.006)))*(control.gain-this.gain);
  this.phase=(this.phase+2*Math.PI*this.freq/this.sr)%(2*Math.PI);
  const bright=.18+.08*(control.expression||0);
  return this.gain*(Math.sin(this.phase)+bright*Math.sin(2*this.phase)+.1*Math.sin(3*this.phase))/1.3;
 }
}
// A hard, independently enforced digital peak ceiling. Never called a room-level SPL limit.
export const limit=x=>Number.isFinite(x)?clamp(x,-.12,.12):0;

// Sparse FIR identified once using a quiet independent broadband probe. Holdout is never fitted.
export function calibrate(reference,mic,sr,{maxDelay=.24,taps=48}={}){
 if(reference.length!==mic.length||reference.length<sr*2||[...reference,...mic].some(x=>!Number.isFinite(x)))throw Error('Invalid calibration buffers');
 const maxLag=Math.ceil(sr*maxDelay),end=Math.floor(reference.length*.67),start=maxLag+2;
 const residual=Float64Array.from(mic.slice(0,end)),selected=[];
 const energy=new Float64Array(maxLag+1),corr=new Float64Array(maxLag+1);
 for(let lag=1;lag<=maxLag;lag++){
  let e=1e-12,c=0;for(let n=start;n<end;n++){const r=reference[n-lag];e+=r*r;c+=mic[n]*r;}
  energy[lag]=e;corr[lag]=c;
 }
 const order=Array.from({length:maxLag},(_,i)=>i+1).sort((a,b)=>corr[b]**2/energy[b]-corr[a]**2/energy[a]);
 for(const lag of order.slice(0,taps))selected.push({lag,gain:0});
 // Coordinate descent least squares on selected support; subtraction is independent of near-end.
 for(let iter=0;iter<8;iter++)for(const tap of selected){
  let c=0;for(let n=start;n<end;n++)c+=residual[n]*reference[n-tap.lag];
  const delta=c/energy[tap.lag];tap.gain+=delta;
  for(let n=start;n<end;n++)residual[n]-=delta*reference[n-tap.lag];
 }
 let before=0,after=0,refEnergy=0;
 for(let n=end;n<mic.length;n++){
  let p=0;for(const t of selected)p+=t.gain*reference[n-t.lag];
  before+=mic[n]**2;after+=(mic[n]-p)**2;refEnergy+=reference[n]**2;
 }
 const erle=10*Math.log10((before+1e-12)/(after+1e-12)),noise=Math.sqrt(after/(mic.length-end));
 const l1=selected.reduce((s,t)=>s+Math.abs(t.gain),0);
 const accepted=erle>=12&&rms(reference)>.003&&before/(mic.length-end)>1e-7&&l1<4;
 return {format:'resonance-room-v1',sampleRate:sr,taps:selected,erle,noise,residualRatio:Math.sqrt(after/(refEnergy+1e-12)),l1,accepted,reason:accepted?'validated on held-out probe':'Room fit rejected: need >=12 dB holdout cancellation, audible probe and bounded path'};
}
export class ReferenceCanceller {
 constructor(sr,room=null){
  this.sr=sr;this.reference=new Ring(Math.ceil(sr*.6));this.room=room;this.estimate=0;
  if(room&&(room.sampleRate!==sr||!room.accepted||room.taps.some(t=>!Number.isInteger(t.lag)||t.lag<1||t.lag>=this.reference.a.length||!Number.isFinite(t.gain))))throw Error('Invalid room/reference contract');
 }
 process(mic,actualPreviousOutput){
  // Call once per sample with the PREVIOUS emitted sample, before generating this sample.
  this.reference.push(actualPreviousOutput);this.estimate=0;
  if(this.room)for(const t of this.room.taps)this.estimate+=t.gain*this.reference.ago(t.lag-1);
  return mic-this.estimate;
 }
}
export class Safety {
 constructor(){this.fault=null;this.suspicion=0;this.clipped=0;}
 check({rawPeak=0,coherence=0,echoRms=0,cleanRms=0,valid=true},dt){
  if(!valid)this.fault='Input/reference unavailable';
  this.clipped=rawPeak>.98?this.clipped+dt:0;
  if(this.clipped>.04)this.fault='Microphone overload';
  // Conservative ambiguity guard. Can reject sustained exact unison after a path change.
  this.suspicion=coherence>.92&&echoRms>.003&&cleanRms>echoRms*.25?this.suspicion+dt:Math.max(0,this.suspicion-dt*2);
  if(this.suspicion>.75)this.fault='Playback-correlated residual: recalibrate or use headphones';
  return !this.fault;
 }
}
