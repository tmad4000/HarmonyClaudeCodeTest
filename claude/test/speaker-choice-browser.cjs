const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('/home/dev/agent-worktrees/paseo-tab-local-splits-20261114/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.HARMONY_TEST_OUTPUT||'/tmp/harmony-speaker-choice-'+process.pid;
(async()=>{fs.mkdirSync(OUT,{recursive:true});const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'/opt/google/chrome/chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:430,height:932},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.7 Mobile Safari/604.1'}),page=await context.newPage();const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{window.__native={prepare:0,activate:0};window.__route={nativeBuild:{build:'8'},outputs:[{type:'Speaker',name:'Speaker'}],inputs:[{type:'MicrophoneBuiltIn'}],outputType:'speaker',sampleRate:48000,outputVolume:.5};window.Capacitor={isNativePlatform:()=>true,Plugins:{HarmonyAudioSession:{prepare:async()=>{__native.prepare++;return window.__prepareRoute||__route},activate:async()=>{__native.activate++;return __route},getRoute:async()=>__route,release:async()=>{if(window.__releaseBarriers?.length){window.__blockedReleases=(window.__blockedReleases||0)+1;await __releaseBarriers.shift();}else if(window.__releaseBarrier)await __releaseBarrier;},addListener(){}}}};});
 await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://harmony.jacobcole.net'){external.push(u.origin);return r.abort();}const name=u.pathname.slice(1)||'index.html';if(name==='debug-endpoint.js')return r.fulfill({contentType:'text/javascript',body:"window.HARMONY_DEBUG_ENDPOINT='';window.HARMONY_DEBUG_UPLOAD_ENABLED=false;"});if(name==='native-bridge.js')return r.fulfill({path:path.join(ROOT,'../mobile/native-bridge.js')});const file=path.resolve(ROOT,name);if(!file.startsWith(ROOT+'/')||!fs.existsSync(file))return r.abort();if(name==='index.html')return r.fulfill({contentType:'text/html',body:fs.readFileSync(file,'utf8').replace('<script defer src="harmony-wit-feedback.js"','<script src="native-bridge.js"></script><script defer src="harmony-wit-feedback.js"')});return r.fulfill({path:file});});
 try{
 await page.goto('https://harmony.jacobcole.net/?input=tone&freq=164&voice=1&level=.02&speaker=0&debug=0&check=0');
 await page.waitForFunction(()=>harmonySinger.detectedOutput==='speaker');
 assert.equal(await page.evaluate(()=>harmonySinger.speakerMode),false,'native route must not override chosen Headphones mode');
 await page.locator('#startBtn').click();assert.equal(await page.evaluate(()=>harmonySinger.isRunning),false);assert.equal(await page.evaluate(()=>__native.prepare),0,'consent is before native preparation');
 await page.evaluate(()=>harmonySinger.setExtraProtection(true));
 await page.getByRole('button',{name:'Use speaker anyway',exact:true}).click();
 await page.waitForFunction(()=>harmonySinger.isRunning||harmonySinger.lastError);assert.equal(await page.evaluate(()=>harmonySinger.lastError?.message||null),null);await page.waitForTimeout(4500);
 const running=await page.evaluate(()=>({levels:harmonySinger.debugAudioLevels(),speaker:harmonySinger.speakerMode,approved:harmonySinger.speakerApproved,mode:harmonySinger.loopControl.mode,extra:harmonySinger.extraProtection,makeup:harmonySinger.inputMakeup,voice:harmonySinger.voiceDecision,gains:Object.fromEntries(Object.entries(harmonySinger.gains).map(([n,g])=>[n,g.gain.value])),native:__native,telemetry:harmonySinger.getLog().filter(e=>e.type==='output-level')}));
 assert(running.speaker&&running.approved&&running.extra);assert.equal(running.mode,'speakers');assert.equal(running.gains.upper,.42);assert(running.levels.trim>=.5,'no unmeasured10dB cut');assert(running.makeup>4&&running.makeup<=16,'bounded speaker input normalization');assert(running.levels.outputRms>.005,'quiet synthetic voice must produce a measurable healthy output');assert.equal(running.telemetry.length,0,'Recording Off must not collect telemetry');
 await page.evaluate(async()=>{harmonySinger.stop();await harmonyNativeIdle();});
 await page.goto('https://harmony.jacobcole.net/?input=tone&freq=164&voice=1&level=.02&debug=0&check=0');await page.waitForFunction(()=>harmonySinger.detectedOutput==='speaker');
 assert.equal(await page.evaluate(()=>harmonySinger.speakerMode),true);assert.equal(await page.evaluate(()=>harmonySinger.speakerApproved),true);assert.equal(await page.locator('#useSpeakerAnyway').isVisible(),false);
 // Detection never overrides a later explicit Headphones choice; hot unplug stops instead.
 const choice=await page.evaluate(()=>{harmonySinger.setOutputPosition(0);harmonySinger.observeOutputRoute({nativeBuild:{build:'8'},outputs:[{type:'Headphones',name:'Headphones'}]});const plugged=harmonySinger.speakerMode;harmonySinger.observeOutputRoute({nativeBuild:{build:'8'},outputs:[{type:'Speaker',name:'Speaker'}]});return{plugged,unplugged:harmonySinger.speakerMode,allowed:harmonySinger.ensureOutputConsent()};});
 assert.equal(choice.plugged,false);assert.equal(choice.unplugged,false);assert.equal(choice.allowed,false);
 // Route changed only when native prepare resolved: no lost pending Sing during delayed release.
 await page.evaluate(()=>{harmonySinger.speakerApproved=false;harmonySinger.setOutputPosition(0);window.__route={nativeBuild:{build:'8'},outputs:[{type:'Headphones',name:'Headphones'}],outputType:'wired'};harmonySinger.observeOutputRoute(__route);window.__prepareRoute={nativeBuild:{build:'8'},outputs:[{type:'Speaker',name:'Speaker'}],outputType:'speaker'};window.__blockedReleases=0;window.__releaseBarriers=[new Promise(r=>window.__finishRelease=r),new Promise(r=>window.__finishFinalCleanup=r)];});
 await page.locator('#startBtn').click();await page.waitForFunction(()=>harmonySinger.outputConsentPending&&harmonySinger.outputChoiceBusy);
 assert.equal(await page.locator('#useSpeakerAnyway').isDisabled(),true);
 await page.evaluate(()=>{__route=__prepareRoute;__finishRelease();});await page.waitForFunction(()=>__blockedReleases===2);
 const preparesDuringCleanup=await page.evaluate(()=>__native.prepare);await page.locator('#startBtn').click();
 assert.equal(await page.evaluate(()=>__native.prepare),preparesDuringCleanup,'Sing must wait for final native cleanup');assert.equal(await page.locator('#useSpeakerAnyway').isDisabled(),true);
 await page.evaluate(()=>__finishFinalCleanup());await page.waitForFunction(()=>!harmonySinger.outputChoiceBusy);
 await page.getByRole('button',{name:'Use speaker anyway',exact:true}).click();await page.waitForFunction(()=>harmonySinger.isRunning);
 await page.evaluate(async()=>{harmonySinger.stop();await harmonyNativeIdle();});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={passed:true,physicalIOS:false,nativePluginMocked:true,syntheticInputOnly:true,noModeForcing:true,explicitChoiceRemembered:true,delayedNativeCleanupRace:true,running,choice};fs.writeFileSync(path.join(OUT,'speaker-choice-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
