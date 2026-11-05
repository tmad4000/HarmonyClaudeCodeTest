import {readFileSync,writeFileSync} from 'node:fs';
import {ControlTimeline} from '../control-timeline.mjs';
const model=JSON.parse(readFileSync(new URL('../models/authored.json',import.meta.url)));
const timeline=new ControlTimeline(model,{clockId:'synthetic-contract-fixture-v1'});
const centers=[];
for(let k=0;k<12;k++){const end=(k+1)*512;timeline.appendObservation({voiced:true,midi:60+k*.03,rms:.05,confidence:.98},end);centers.push(end-256);}
writeFileSync(new URL('../evidence/frame-controls-v1.json',import.meta.url),JSON.stringify(timeline.lookup(centers),null,2)+'\n');
console.log('Exported deterministic 12-frame synthetic controller packet; no renderer invoked.');
