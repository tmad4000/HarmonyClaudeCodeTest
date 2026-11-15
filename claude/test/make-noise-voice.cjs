// Generated fixture only; no human microphone data.
const fs=require('node:fs'),{synthSinger,rng}=require('./lib/loop_sim.cjs');
const sr=44100,x=synthSinger(sr,24,[{midi:57,start:8,end:23}],{level:.6}),random=rng(21);
for(let i=0;i<x.length;i++)x[i]+=(random()-.5)*.002;
const b=Buffer.alloc(44+x.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(x.length*2,40);
for(let i=0;i<x.length;i++)b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(x[i]*32767))),44+i*2);
fs.writeFileSync(process.argv[2]||'/tmp/harmony-noise-voice.wav',b);
