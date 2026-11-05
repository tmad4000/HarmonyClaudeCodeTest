// Authored coefficients, not trained weights. This script is the reproducible source.
import {writeFileSync} from 'node:fs';
const n=12, m=8;
const W=Array.from({length:n},()=>Array(n).fill(0));
const U=Array.from({length:n},()=>Array(m).fill(0));
const leak=[.55,.08,.4,.035,.75,.06,.45,.04,.35,.35,.2,.025];
// Paired short/long memories of contour, energy, articulation and voicing.
for(let i=0;i<8;i++){U[i][Math.floor(i/2)]=1.2;W[i][i]=.3;}
U[8][4]=.8;U[9][5]=.8;U[10][6]=1;U[11][7]=1;
W[8][9]=-.2;W[9][8]=.2;W[10][10]=.35;W[11][11]=.6;
W[4][2]=.1;W[6][10]=.15;
const V=[
 [1.4,-.7,0,0,0,0,0,0,0,0,0,0], // contour anticipation
 [-1.4,-.7,0,.2,.6,-.2,0,0,0,0,0,.1], // fifth below
 [1.2,.6,-.2,0,-.3,.2,0,0,0,0,0,-.1], // fourth below / contrary motion
 [0,0,0,.2,-.4,.5,0,.2,0,0,0,.2], // octave resting option
 [0,0,.6,.3,.25,-.15,.3,0,.08,0,.2,0], // expression
];
const model={format:'resonance-tensors-v1',provenance:{kind:'authored',author:'Astra experiment AIB-bcv',training:'none',pretrained:'none',note:'Manually compiled dynamical hypothesis; no learned musical understanding.'},inputs:['pitch_velocity_semitones_per_second / 12','rms / 0.15','onset','voiced','rhythm_sin * confidence','rhythm_cos * confidence','pitch_confidence','phrase_age / 4'],states:['contour_fast','contour_slow','energy_fast','energy_slow','onset_fast','onset_slow','voice_fast','voice_slow','pulse_x','pulse_y','reliability','phrase_memory'],outputs:['anticipation','fifth_below','fourth_below','octave_below','expression'],leak,W,U,b:Array(n).fill(0),V,c:[0,.25,0,-.15,0]};
writeFileSync(new URL('./authored.json',import.meta.url),JSON.stringify(model,null,2)+'\n');
console.log(`${n} recurrent units; ${W.flat().length+U.flat().length+V.flat().length+12+5+12} exported coefficients`);
