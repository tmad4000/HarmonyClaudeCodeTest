/* Envelope diagnostics: exact target in simulator, inferred recent target for recorded takes.
 * A dip is >12dB for30–500ms during voiced input. Hardware underruns are not exposed. */
(function(root){
function analyzeEnvelope(mic,out,sr,expected,start=0,end=Math.min(mic.length,out.length)){
 const hop=Math.max(1,Math.round(sr*.01)),window=Math.max(hop,Math.round(sr*.03));let voiced=0,on=0,run=0,dips=0,longDips=0,reference=0;
 function finish(){if(run>=3&&run<=50)dips++;else if(run>50)longDips++;run=0;}
 function power(a,p){let sum=0;const to=Math.min(a.length,p+window);for(let i=p;i<to;i++)sum+=a[i]*a[i];return sum/Math.max(1,to-p);}
 for(let p=start;p+window<=end;p+=hop){const m=power(mic,p),o=power(out,p);reference=expected?power(expected,p):Math.max(o,reference*.995);if(m>0.004**2&&reference>1e-7){voiced++;if(o>=reference*.25)on++;if(o<reference/16)run++;else finish();}else finish();}
 finish();const minutes=(end-start)/sr/60;
 return {harmonyOnPct:voiced?Math.round(on/voiced*1000)/10:null,dropouts:dips,dropoutsPerMin:minutes?dips/minutes:0,longAttenuations:longDips,voicedWindows:voiced,target:expected?'known synthetic target':'inferred recent output envelope',hardwareUnderruns:null};
}
const api={analyzeEnvelope};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HarmonySessionMetrics=api;
})(globalThis);
