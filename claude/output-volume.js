/* Final output gain and peak ceiling. Recording buses connect before this stage. */
(function(root){
 const gainForPosition=value=>value<=100?Math.max(0,value)/100:Math.pow(10,Math.min(12,(value-100)/10)/20);
 class OutputVolume {
  constructor(ctx){this.ctx=ctx;this.input=ctx.createGain();this.gentle=ctx.createDynamicsCompressor();this.peak=ctx.createDynamicsCompressor();this.output=ctx.createWaveShaper();
   this.gentle.threshold.value=-12;this.gentle.knee.value=18;this.gentle.ratio.value=1;this.gentle.attack.value=.006;this.gentle.release.value=.15;
   this.peak.threshold.value=-.6;this.peak.knee.value=0;this.peak.ratio.value=20;this.peak.attack.value=.001;this.peak.release.value=.15;
   const curve=new Float32Array(65537);for(let i=0;i<curve.length;i++)curve[i]=Math.max(-.98,Math.min(.98,i/(curve.length-1)*2-1));this.output.curve=curve;
   this.input.connect(this.gentle);this.gentle.connect(this.peak);this.peak.connect(this.output);
  }
  set(gain){this.gain=gain;this.input.gain.setTargetAtTime(gain,this.ctx.currentTime,.03);this.gentle.ratio.setTargetAtTime(gain>1.001?2.5:1,this.ctx.currentTime,.03);}
  metrics(){return {gain:this.gain||0,compressorDb:this.gentle.reduction,limiterDb:this.peak.reduction};}
  dispose(){for(const n of [this.input,this.gentle,this.peak,this.output])n.disconnect();}
 }
 const api={OutputVolume,gainForPosition};if(typeof module==='object'&&module.exports)module.exports=api;else root.HarmonyOutput=api;
})(globalThis);
