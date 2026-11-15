const LAB=process.env.NEURAL_QA_LAB||'/home/dev/code/neural-harmony-20261115/browser-lab';
const {chromium}=require('/home/dev/agent-worktrees/paseo-tab-local-splits-20261114/node_modules/playwright');const fs=require('fs'),assert=require('assert/strict');
(async()=>{const owner=JSON.parse(fs.readFileSync(LAB+'/preview-owner.json'));const b=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'/opt/google/chrome/chrome'});try{const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:${owner.port}/studio/`);await p.locator('#load').click();await p.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Engine ready'),{},{timeout:120000});
 const result=await p.evaluate(async()=>{
 const invalid=[];for(const x of [new ArrayBuffer(20),wav(new Float32Array(100))]){try{parseWav(x instanceof Blob?await x.arrayBuffer():x);invalid.push(false);}catch{invalid.push(true);}}
 try{await upload(wav(new Float32Array(22050)));}catch(e){invalid.push(e.message.includes('quiet'));}
 const t=new Float32Array(22050);for(let i=0;i<t.length;i++)t[i]=.1*Math.sin(2*Math.PI*220*i/44100);
 await upload(wav(t));const blob=await(await fetch(document.getElementById('download').href)).blob();const y=parseWav(await blob.arrayBuffer());let peak=0,energy=0;for(const v of y){peak=Math.max(peak,Math.abs(v));energy+=v*v;}
 return{invalid,frames:y.length,rms:Math.sqrt(energy/y.length),peak,status:document.getElementById('status').textContent};});
 assert.deepEqual(result.invalid,[true,true,true]);assert.equal(result.frames,22050);assert(result.rms>.01);assert(result.peak<.941);
 await p.evaluate(()=>{const a=new Float32Array(441000);for(let i=0;i<a.length;i++)a[i]=.1*Math.sin(2*Math.PI*220*i/44100);window.cancelTest=upload(wav(a)).catch(e=>e.message);});await p.locator('#cancel').click();const cancelled=await p.evaluate(()=>window.cancelTest);assert(cancelled.includes('cancelled'));assert.equal(await p.locator('#load').isVisible(),true);assert.equal(await p.locator('#load').isEnabled(),true);
 // A model integrity failure must surface and permit a retry.
 await p.route('**/model-2.bin',route=>route.fulfill({body:Buffer.from([0,1,2])}));await p.locator('#load').click();await p.waitForFunction(()=>document.getElementById('status').textContent.includes('checksum mismatch'),{},{timeout:120000});assert.equal(await p.locator('#load').isEnabled(),true);
 const report={result,cancelled,integrity_error:await p.locator('#status').innerText(),errors,sandbox:true};assert.deepEqual(errors,[]);fs.writeFileSync(LAB+'/controls-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
