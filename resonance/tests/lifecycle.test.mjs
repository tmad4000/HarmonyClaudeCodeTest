import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');
const tick=()=>new Promise(r=>setImmediate(r));
async function harness(){
 const elements=new Map(),events={},timers=[],messages=[];let resolveMic,captureCalls=0,stops=0,node;
 const track={getSettings:()=>({echoCancellation:false,noiseSuppression:false,autoGainControl:false}),stop:()=>stops++};
 const stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
 const canvasContext=new Proxy({},{get:()=>()=>{}});
 const document={hidden:false,getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id==='setup'?'headphones':id==='behavior'?'partner':id==='level'?'50':'',textContent:'',disabled:false,getContext:()=>canvasContext});return elements.get(id)},addEventListener:(name,f)=>events[name]=f};
 const navigator={mediaDevices:{getUserMedia:()=>{captureCalls++;return new Promise(r=>resolveMic=r)},addEventListener:()=>{}}};
 class Context{constructor(){this.state='suspended';this.baseLatency=.01;this.audioWorklet={addModule:async()=>{}}}async resume(){this.state='running'}async suspend(){this.state='suspended'}createMediaStreamSource(){return{connect(){},disconnect(){}}}}
 class Node{constructor(){node=this;this.port={postMessage:m=>messages.push(m),onmessage:null}}connect(){}}
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('document','navigator','AudioContext','AudioWorkletNode','fetch','setInterval','setTimeout','window','calibrate',source);
 await execute(document,navigator,Context,Node,async()=>({ok:true,json:async()=>({})}),()=>0,f=>timers.push(f),{addEventListener(){}},()=>({accepted:true,erle:30,taps:[],reason:'ok'}));
 return {$:document.getElementById,events,messages,timers,resolve:()=>resolveMic(stream),get captureCalls(){return captureCalls},get stops(){return stops},get node(){return node},flush:async()=>{for(let i=0;i<5;i++)await tick()}};
}
test('cancel while microphone permission is pending cannot restart output later',async()=>{
 const h=await harness(),start=h.$('start').onclick();await h.flush();assert.equal(h.captureCalls,1);
 h.events.keydown({key:'Escape'});h.resolve();await start;
 assert.equal(h.stops,1);assert.equal(h.messages.filter(m=>m.type==='start').length,0);assert.equal(h.$('modeBadge').textContent,'Muted');
});
test('successful calibration retains capture; starting uses that exact stream',async()=>{
 const h=await harness();h.$('setup').value='speakers';const calibration=h.$('calibrate').onclick();await h.flush();h.resolve();await calibration;
 const command=h.messages.find(m=>m.type==='calibrate');h.node.port.onmessage({data:{type:'calibration',operation:command.operation,reference:[],mic:[],sr:8000}});h.timers.shift()();
 assert.equal(h.stops,0);await h.$('start').onclick();assert.equal(h.captureCalls,1);assert.ok(h.messages.find(m=>m.type==='start').room.accepted);
 h.events.keydown({key:'Escape'});assert.equal(h.stops,1);
 await h.$('start').onclick();assert.match(h.$('status').textContent,/Calibrate speakers first/);
});
test('stale calibration result after mute cannot restore an invalid room measurement',async()=>{
 const h=await harness();h.$('setup').value='speakers';const calibration=h.$('calibrate').onclick();await h.flush();h.resolve();await calibration;
 const command=h.messages.find(m=>m.type==='calibrate');h.events.keydown({key:'Escape'});
 h.node.port.onmessage({data:{type:'calibration',operation:command.operation,reference:[],mic:[],sr:8000}});assert.equal(h.timers.length,0);
 await h.$('start').onclick();assert.match(h.$('status').textContent,/Calibrate speakers first/);
});
