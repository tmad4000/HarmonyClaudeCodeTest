// Acceptance uses emitted samples, never an internal requested gain. These are
// digital audibility proxies; physical loudness and musical preference need listening.
const rms=(x,a,b)=>{let s=0;for(let n=a;n<b;n++)s+=x[n]*x[n];return Math.sqrt(s/Math.max(1,b-a));};
const quantile=(xs,p)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]:null;
function pitch(x,a,b,sr){
 const crossings=[];
 for(let n=Math.max(a+1,1);n<b;n++)if(x[n-1]<=0&&x[n]>0)crossings.push(n-1-x[n-1]/(x[n]-x[n-1]));
 if(crossings.length<3)return null;
 const hz=sr*(crossings.length-1)/(crossings.at(-1)-crossings[0]);
 return 69+12*Math.log2(hz/440);
}
export function jointMetrics({output,oracle,voiced,sr,tailStartSeconds,fault=null}){
 const hop=Math.round(sr*.02),floor=.00025,ratios=[],pitchErrors=[],onsetDelays=[];
 let eligible=0,delivered=0,missing=0,maxMissing=0,age=0,onsetAt=null,found=false,mutedVoiced=0;
 for(let a=0;a<output.length;a+=hop){
  const b=Math.min(output.length,a+hop),duration=(b-a)/sr;
  const isVoiced=voiced.slice(a,b).reduce((s,v)=>s+v,0)>(b-a)*.8;
  const actual=rms(output,a,b),expected=rms(oracle,a,b);
  if(!isVoiced){if(onsetAt!==null&&!found)onsetDelays.push(Infinity);age=0;onsetAt=null;found=false;missing=0;continue;}
  if(onsetAt===null)onsetAt=a/sr;
  const audible=actual>=floor&&(expected<floor||actual>=expected*.35);
  if(!found&&audible){onsetDelays.push(b/sr-onsetAt);found=true;}
  if(actual<floor)mutedVoiced+=duration;
  age+=duration;
  // Startup budget is separately tested, never silently removed from acceptance.
  if(age<=.1)continue;
  eligible++;if(audible){delivered++;missing=0;}else{missing+=duration;maxMissing=Math.max(maxMissing,missing);}
  if(expected>=floor)ratios.push(20*Math.log10((actual+1e-12)/(expected+1e-12)));
  if(audible&&expected>=floor){
   const start=Math.max(0,b-Math.round(sr*.08)),p=pitch(output,start,b,sr),q=pitch(oracle,start,b,sr);
   if(p!==null&&q!==null)pitchErrors.push(Math.abs(p-q)*100);
  }
 }
 if(onsetAt!==null&&!found)onsetDelays.push(Infinity);
 const maxOnset=onsetDelays.length?Math.max(...onsetDelays):Infinity;
 const continuity=eligible?delivered/eligible:0,level=quantile(ratios,.5),tracking=quantile(pitchErrors,.95);
 const tail=rms(output,Math.floor(sr*tailStartSeconds),output.length),peak=output.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
 const checks={boundedAndReleased:peak<=.120001&&tail<.001,continuous:continuity>=.95&&maxMissing<=.080001,onsetResponsive:maxOnset<=.100001,levelRetained:level!==null&&level>=-6,pitchResponsive:tracking!==null&&tracking<=50,notLatchedMuted:fault===null};
 return {jointSuccess:Object.values(checks).every(Boolean),checks,actualOutputCoverage:continuity,maxVoicedDropoutMs:1000*maxMissing,mutedVoicedSeconds:mutedVoiced,levelRetentionMedianDb:level,pitchTrackingVsCleanOracleP95Cents:tracking,onsetLatencyMaxMs:Number.isFinite(maxOnset)?maxOnset*1000:null,onsetMissing:!Number.isFinite(maxOnset),postStopTailRms:tail,peakOutput:peak,criteria:{windowMs:20,startupBudgetMs:100,minCoverage:.95,maxVoicedDropoutMs:80,absoluteDigitalRmsFloor:floor,minRelativeBlockLevel:.35,minMedianLevelDb:-6,maxTrackingP95Cents:50},interpretation:'Joint musical availability proxy, not proof of subjective quality or physical audibility; containment by mute is a joint failure.'};
}
