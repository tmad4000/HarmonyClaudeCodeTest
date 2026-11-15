/* Slaney mel + YIN front end, ported from neural/dsp.py. No learned key selection. */
const SR=44100,HOP=512,NFFT=2048;
function rms(x){let s=0;for(const a of x)s+=a*a;return Math.sqrt(s/x.length+1e-20);}
const hzmel=f=>f<1000?f/(200/3):15+Math.log(Math.max(f,1)/1000)/(Math.log(6.4)/27);
const melhz=m=>m<15?m*(200/3):1000*Math.exp((m-15)*(Math.log(6.4)/27));
const edges=Array.from({length:130},(_,i)=>melhz(hzmel(40)+(hzmel(16000)-hzmel(40))*i/129));
const MEL=Array.from({length:128},(_,m)=>{const row=[];for(let k=0;k<=1024;k++){const hz=k*SR/NFFT,w=Math.max(0,Math.min((hz-edges[m])/(edges[m+1]-edges[m]),(edges[m+2]-hz)/(edges[m+2]-edges[m+1])))*2/(edges[m+2]-edges[m]);if(w)row.push([k,w]);}return row;});
const FFTM=new FFT(2048),FFTP=new FFT(8192);
function reflected(x,i){while(i<0||i>=x.length)i=i<0?-i:2*x.length-2-i;return x[i];}
function pitchFrame(x,center){
 const input=new Float64Array(8192),a=new Float64Array(8192),prefix=new Float64Array(4097);
 let mean=0;for(let i=0;i<4096;i++){input[i]=reflected(x,center+i-2048);mean+=input[i];}mean/=4096;
 let energy=0;for(let i=0;i<4096;i++){input[i]-=mean;energy+=input[i]*input[i];prefix[i+1]=energy;if(i<2048)a[i]=input[i];}
 if(Math.sqrt(energy/4096)<1e-4)return 0;
 const fx=FFTP.createComplexArray(),fa=FFTP.createComplexArray();FFTP.realTransform(fx,input);FFTP.completeSpectrum(fx);FFTP.realTransform(fa,a);FFTP.completeSpectrum(fa);
 for(let k=0;k<fx.length;k+=2){const re=fx[k]*fa[k]+fx[k+1]*fa[k+1],im=fx[k+1]*fa[k]-fx[k]*fa[k+1];fx[k]=re;fx[k+1]=im;}
 const corr=FFTP.createComplexArray();FFTP.inverseTransform(corr,fx);
 const cm=new Float64Array(2049);cm[0]=1;let sum=0;
 for(let t=1;t<=2048;t++){const diff=Math.max(0,prefix[2048]+prefix[t+2048]-prefix[t]-2*corr[2*t]);sum+=diff;cm[t]=diff*t/(sum+1e-12);}
 const lo=Math.max(2,Math.floor(SR/1100)),hi=Math.min(Math.floor(SR/65),2047),mins=[];
 for(let t=lo+1;t<hi;t++)if(cm[t]<cm[t-1]&&cm[t]<cm[t+1])mins.push(t);
 if(!mins.length)return 0;const best=Math.min(...mins.map(t=>cm[t]));if(best>.35)return 0;
 const tau=mins.find(t=>cm[t]<Math.max(.16,best*1.5));if(tau===undefined)return 0;
 const off=.5*(cm[tau-1]-cm[tau+1])/(cm[tau-1]-2*cm[tau]+cm[tau+1]+1e-12);
 return SR/(tau+Math.max(-.5,Math.min(.5,off)));
}
function features(x){
 const frames=Math.floor(x.length/HOP),mel=new Float32Array(frames*128),f0=new Float32Array(frames),input=new Float64Array(NFFT),spectrum=FFTM.createComplexArray(),mag=new Float64Array(1025);
 for(let t=0;t<frames;t++){
  for(let i=0;i<NFFT;i++)input[i]=reflected(x,t*HOP+i-768)*(.5-.5*Math.cos(2*Math.PI*i/NFFT));
  FFTM.realTransform(spectrum,input);
  for(let k=0;k<=1024;k++)mag[k]=Math.hypot(spectrum[k*2],spectrum[k*2+1]);
  for(let m=0;m<128;m++){let value=0;for(const [k,w] of MEL[m])value+=mag[k]*w;mel[t*128+m]=Math.log(Math.max(value,1e-5));}
  f0[t]=pitchFrame(x,t*HOP+256);
 }
 return {mel,f0,frames};
}
function estimateKey(f0){
 const hist=new Float64Array(12);let count=0;for(const f of f0)if(f>0){hist[((Math.round(69+12*Math.log2(f/440))%12)+12)%12]++;count++;}
 if(count<5)throw Error('No stable sung pitch detected. Try a clear melody.');
 const profile=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
 let key=0,best=-Infinity;for(let k=0;k<12;k++){let score=0;for(let n=0;n<12;n++)score+=hist[n]*profile[(n-k+12)%12];if(score>best){best=score;key=k;}}return key;
}
function harmonyF0(f0,key,degree){
 const scale=[];for(let o=-1;o<12;o++)for(const n of [0,2,4,5,7,9,11])scale.push(key+o*12+n);
 return Float32Array.from(f0,f=>{if(f<=0)return 0;const note=69+12*Math.log2(f/440);let nearest=0;for(let i=1;i<scale.length;i++)if(Math.abs(note-scale[i])<Math.abs(note-scale[nearest]))nearest=i;const result=f*2**((scale[Math.min(nearest+degree,scale.length-1)]-scale[nearest])/12);return result>=50&&result<=2500?result:0;});
}
