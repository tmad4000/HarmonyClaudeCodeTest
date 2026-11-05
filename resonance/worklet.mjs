import {Engine} from './engine.mjs';
import {Renderer,limit,AnalysisLowpass} from './dsp.mjs';
export class ResonanceProcessor extends AudioWorkletProcessor {
 constructor(options){
  super();this.model=options.processorOptions.model;this.stride=Math.round(sampleRate/8000);this.sr=sampleRate/this.stride;
  this.renderer=new Renderer(sampleRate);this.engine=new Engine(this.sr,this.model);this.mode='muted';this.level=.5;
  this.micFilter=new AnalysisLowpass(sampleRate);this.refFilter=new AnalysisLowpass(sampleRate);
  this.count=0;this.micSum=0;this.refSum=0;this.prevRef=0;this.seed=7727;this.elapsed=0;this.fixturePhase=0;this.calMic=[];this.calRef=[];this.heartbeat=0;
  this.port.onmessage=({data:d})=>{
   if(d.type==='heartbeat')this.heartbeat=0;
   if(d.type==='mute'){this.mode='muted';this.renderer.gain=0;}
   if(d.type==='level')this.level=Math.max(0,Math.min(.8,Number(d.value)||0));
   if(d.type==='start'){
    try{this.engine=new Engine(this.sr,this.model,{room:d.room||null,baseline:!!d.baseline});this.renderer=new Renderer(sampleRate);this.mode=d.fixture?'fixture':'live';this.elapsed=0;this.prevRef=0;this.heartbeat=0;}
    catch(e){this.mode='muted';this.port.postMessage({type:'error',message:e.message});}
   }
   if(d.type==='calibrate'){this.mode='calibrate';this.elapsed=0;this.calMic=[];this.calRef=[];this.heartbeat=0;this.calOperation=d.operation;}
  };
 }
 noise(){this.seed=(1664525*this.seed+1013904223)>>>0;return this.seed/2147483648-1;}
 process(inputs,outputs){
  const output=outputs[0][0],input=inputs[0]?.[0];this.heartbeat+=output.length/sampleRate;
  if(this.heartbeat>2&&this.mode!=='muted'){this.mode='muted';this.port.postMessage({type:'error',message:'Control connection lost; output muted'});}
  if(!input&&(this.mode==='live'||this.mode==='calibrate')){this.mode='muted';this.port.postMessage({type:'error',message:'Microphone stream missing; output muted'});}
  for(let i=0;i<output.length;i++){
   this.elapsed+=1/sampleRate;let mic=input?.[i]??0;
   if(this.mode==='fixture'){
    const t=this.elapsed,part=t%8,active=part<5.5&&part%1.1<.85;
    const midi=60+3*Math.sin(t*.65)+.08*Math.sin(t*34);
    this.fixturePhase+=2*Math.PI*(440*2**((midi-69)/12))/sampleRate;
    mic=active?.09*(Math.sin(this.fixturePhase)+.22*Math.sin(2*this.fixturePhase)):0;
   }
   // Observe overload before filtering/decimation can hide input clipping.
   this.engine.rawPeak=Math.max(this.engine.rawPeak,Math.abs(mic));
   let value=0;
   if(this.mode==='calibrate')value=this.elapsed<3?.035*this.noise():0;
   else if(this.mode==='live'||this.mode==='fixture')value=this.renderer.sample(this.engine.control)*this.level;
   // No downstream gain/effects. This exact emitted value is the reference.
   value=limit(value);if(this.engine.safety.fault&&this.mode!=='calibrate')value=0;
   output[i]=value;this.micSum+=this.micFilter.sample(mic);this.refSum+=this.refFilter.sample(value);this.count++;
   if(this.count===this.stride){
    const m=this.micSum/this.stride,r=this.refSum/this.stride;
    if(this.mode==='calibrate'){this.calMic.push(m);this.calRef.push(r);}
    else this.engine.push(m,this.prevRef);
    this.prevRef=r;this.count=0;this.micSum=0;this.refSum=0;
    if(this.mode==='calibrate'&&this.elapsed>=3){this.mode='muted';this.port.postMessage({type:'calibration',operation:this.calOperation,sr:this.sr,mic:this.calMic,reference:this.calRef});this.calMic=[];this.calRef=[];}
   }
  }
  if(currentFrame%2048<128)this.port.postMessage({type:'telemetry',...this.engine.telemetry,mode:this.mode,sampleRate:this.sr});
  return true;
 }
}
registerProcessor('resonant-partner',ResonanceProcessor);
