'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.HARMONY_TEST_URL||'http://127.0.0.1:8963/';
const fixture=process.env.NOISE_VOICE_WAV||path.join(os.tmpdir(),`harmony-noise-voice-${process.pid}.wav`);
if(!process.env.NOISE_VOICE_WAV)execFileSync(process.execPath,[path.join(__dirname,'make-noise-voice.cjs'),fixture]);
const mean=(xs,key)=>xs.reduce((sum,x)=>sum+x[key],0)/xs.length;
(async()=>{const results=[];try{
 for(const input of ['injected','fakeMic'])for(const speaker of [0,1]){
  const args=['--mute-audio','--autoplay-policy=no-user-gesture-required'];
  if(input==='fakeMic')args.push('--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+fixture);
  const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROME_BIN||'/opt/google/chrome/chrome',args});
  try{const page=await browser.newPage({permissions:['microphone']}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(BASE+`?speaker=${speaker}&key=D&scale=major&debug=0${input==='injected'?'&input=tone&voice=1':''}`,{waitUntil:'domcontentloaded'});
   await page.locator('#startBtn').click();await page.waitForFunction(()=>harmonySinger.isRunning);
   await page.evaluate(()=>{harmonySinger.dryVolume=0;harmonySinger.updateGains();});
   const sample=()=>page.evaluate(()=>{const h=harmonySinger,b=new Float32Array(h.outTap.fftSize);h.outTap.getFloatTimeDomainData(b);return{rms:Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length),inputRms:h.lastInputRms,gate:h.gateOpen,trim:h.speakerTrim,calibrating:h.calibrating};});
   const quiet=[];if(input==='fakeMic'){const until=Date.now()+2000;while(Date.now()<until){quiet.push(await sample());await page.waitForTimeout(50);}}
   if(input==='fakeMic'&&speaker){assert.ok(quiet.length>=20);assert.ok(mean(quiet,'inputRms')<.004,'Fixture must still be quiet during startup measurement');assert.ok(Math.max(...quiet.map(x=>x.rms))<1e-4,'Default startup must be silent');assert.ok(quiet.every(x=>!x.calibrating));}
   await page.waitForFunction(()=>harmonySinger.voicePresent&&harmonySinger.lastInputRms>.01,{},{timeout:20000});await page.waitForTimeout(500);
   const voice=[];for(let i=0;i<25;i++){voice.push(await sample());await page.waitForTimeout(100);}
   assert.deepEqual(errors,[]);results.push({input,speaker,noisePeak:quiet.length?Math.max(...quiet.map(x=>x.rms)):null,voiceMean:mean(voice,'rms'),gateFraction:voice.filter(x=>x.gate).length/voice.length,trimMin:Math.min(...voice.map(x=>x.trim)),errors});
  }finally{await browser.close();}
 }
 const ratios={};for(const input of ['injected','fakeMic']){const hp=results.find(x=>x.input===input&&!x.speaker),sp=results.find(x=>x.input===input&&x.speaker);ratios[input]=sp.voiceMean/hp.voiceMean;assert.ok(ratios[input]>.5,JSON.stringify({input,ratio:ratios[input],hp,sp}));}
 const report={passed:true,ratios,results};fs.writeFileSync(process.env.HARMONY_RESULTS||'/tmp/harmony-startup-ratio-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(!process.env.NOISE_VOICE_WAV)fs.rmSync(fixture,{force:true});}})().catch(e=>{console.error(e);process.exit(1)});
