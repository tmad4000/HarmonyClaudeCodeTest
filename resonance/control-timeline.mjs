import {Partner} from './controller.mjs';
export const CONTROL_SCHEMA='harmony-frame-controls/v1';
export const CONTROL_RATE=44100,CONTROL_HOP=512;
const centerValid=n=>Number.isSafeInteger(n)&&(n-256)%512===0;
export class ControlBoundaryError extends Error {
 constructor(code,message){super(message);this.name='ControlBoundaryError';this.code=code;}
}
function fail(code,message){throw new ControlBoundaryError(code,message);}
export function validateControlPacket(p,{clockId}={}){
 if(p.schema!==CONTROL_SCHEMA||typeof p.clock_id!=='string'||!p.clock_id||p.clock_id.length>128||p.sample_rate_hz!==44100||p.frame_hop_samples!==512)fail('FORMAT','Unsupported clock or format');
 if(clockId!==undefined&&p.clock_id!==clockId)fail('CLOCK','Control packet belongs to a different capture epoch');
 const keys=['frame_center_samples','observation_end_samples','target_f0_hz','gain_multiplier'];
 if(keys.some(k=>!Array.isArray(p[k]))||p.frame_center_samples.length===0||p.frame_center_samples.length>8192||keys.some(k=>p[k].length!==p.frame_center_samples.length))fail('SHAPE','Equal nonempty arrays required');
 if(!Number.isSafeInteger(p.available_through_sample)||p.available_through_sample<0||p.available_through_sample%512!==0)fail('CLOCK','Invalid availability watermark');
 for(let i=0;i<p.frame_center_samples.length;i++){
  const center=p.frame_center_samples[i],end=p.observation_end_samples[i],f0=p.target_f0_hz[i],gain=p.gain_multiplier[i];
  if(!centerValid(center)||end!==Math.max(0,center+256)||end>p.available_through_sample)fail('CAUSALITY','Frame observation is unavailable or off the agreed clock');
  if(!Number.isFinite(f0)||(f0!==0&&(f0<50||f0>2500))||!Number.isFinite(gain)||gain<0||gain>1)fail('RANGE','Invalid pitch/gain');
  if(center<0&&(f0!==0||gain!==0))fail('PREROLL','Pre-stream padding must be zero');
 }
 return p;
}
// Append once on capture/feature arrival; lookup freely from overlapping render windows.
// No ONNX import, renderer callback, AEC policy or wall-clock scheduling lives here.
export class ControlTimeline {
 constructor(model,{clockId,baseline=false,maxFrames=2048}={}){
  if(typeof clockId!=='string'||!clockId||clockId.length>128||!Number.isInteger(maxFrames)||maxFrames<1||maxFrames>8192)fail('FORMAT','Provide stream clock ID and bounded capacity');
  this.clockId=clockId;this.partner=new Partner(model,{baseline});this.maxFrames=maxFrames;
  this.frames=new Map();this.available=0;this.evictionWatermark=-Infinity;
 }
 appendObservation(features,observationEndSample){
  if(!Number.isSafeInteger(observationEndSample)||observationEndSample!==this.available+512)fail('ORDER','Exactly one next complete 512-sample observation required; replay/gaps need explicit epoch recovery');
  if(typeof features.voiced!=='boolean'||!Number.isFinite(features.rms)||features.rms<0||features.rms>1||!Number.isFinite(features.confidence)||features.confidence<0||features.confidence>1||(features.voiced&&(!Number.isFinite(features.midi)||features.midi<0||features.midi>127)))fail('FEATURES','Invalid causal observation');
  if(this.frames.size>=this.maxFrames)fail('BACKPRESSURE','Release consumed context before appending; no silent eviction');
  const out=this.partner.step(features,512/44100),center=observationEndSample-256;
  const gain=out.gainMultiplier<1e-4?0:out.gainMultiplier;
  const frame=Object.freeze({center,observationEndSample,target_f0_hz:gain===0?0:440*2**((out.midi-69)/12),gain_multiplier:gain});
  this.frames.set(center,frame);this.available=observationEndSample;return frame;
 }
 lookup(frameCenters){
  if(!Array.isArray(frameCenters)||!frameCenters.length||frameCenters.length>8192)fail('SHAPE','Provide frame-center array');
  const packet={schema:CONTROL_SCHEMA,clock_id:this.clockId,sample_rate_hz:44100,frame_hop_samples:512,available_through_sample:this.available,frame_center_samples:[...frameCenters],observation_end_samples:[],target_f0_hz:[],gain_multiplier:[]};
  for(const center of frameCenters){
   if(!centerValid(center))fail('CLOCK','Centers must lie on 256 + k*512 source grid');
   if(center<0){packet.observation_end_samples.push(0);packet.target_f0_hz.push(0);packet.gain_multiplier.push(0);continue;}
   const f=this.frames.get(center);
   if(!f)fail(center<this.evictionWatermark?'EXPIRED':'NOT_AVAILABLE',`No immutable controller frame at ${center}`);
   packet.observation_end_samples.push(f.observationEndSample);packet.target_f0_hz.push(f.target_f0_hz);packet.gain_multiplier.push(f.gain_multiplier);
  }
  return validateControlPacket(packet);
 }
 releaseBefore(frameCenter){
  // Consumer ACK: no future overlapping window may request centers below this value.
  if(!centerValid(frameCenter)||frameCenter<this.evictionWatermark||frameCenter>this.available+256)fail('ACK','Invalid or regressing context-release watermark');
  for(const center of this.frames.keys())if(center<frameCenter)this.frames.delete(center);
  this.evictionWatermark=frameCenter;
 }
}
