/* Raw microphone counters only; this processor never sends microphone audio to output. */
class RawDebugTap extends AudioWorkletProcessor {
 constructor(){super();this.alive=true;this.frames=0;this.samples=0;this.zeroRun=0;this.longest=0;this.totalZero=0;this.power=0;this.period=0;this.missing=0;this.gaps=0;this.expected=null;this.port.onmessage=e=>{if(e.data?.type==='stop')this.alive=false;};}
 process(inputs){if(!this.alive)return false;const x=inputs[0]?.[0],n=x?.length||128;if(this.expected!==null&&currentFrame!==this.expected)this.gaps++;this.expected=currentFrame+n;this.frames++;if(!x)this.missing++;
  for(let i=0;i<n;i++){const v=x?.[i]||0;this.power+=v*v;if(Math.abs(v)<1e-8){this.totalZero++;this.zeroRun++;this.longest=Math.max(this.longest,this.zeroRun);}else this.zeroRun=0;}this.samples+=n;this.period+=n;
  if(this.period>=sampleRate/4){this.port.postMessage({rawRms:Math.sqrt(this.power/this.period),sampleRate,quantum:n,frames:this.frames,rawZeroSamples:this.totalZero,rawZeroRunMs:this.zeroRun/sampleRate*1000,longestRawZeroRunMs:this.longest/sampleRate*1000,missingInputBlocks:this.missing,renderGaps:this.gaps,hardwareUnderruns:null});this.period=0;this.power=0;}return true;
 }
}
registerProcessor('harmony-raw-debug-tap',RawDebugTap);
