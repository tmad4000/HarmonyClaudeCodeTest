"""GCP CPU timings: no device/hardware or network latency claim."""
import io,json,platform,time,wave
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import take_service as take
from dsp import SR,HOP,rms
from vocoder import NeuralVocoder,StreamingVocoder,STREAM_PROFILES
ROOT=Path(__file__).parent
model=NeuralVocoder(threads=2);take.MODEL=model
model.synthesize(np.zeros(8192,dtype=np.float32))
report={'host':platform.node(),'engine':'CPUExecutionProvider, 2 threads','rows':[],'note':'Measured CPU timings, excludes network/hardware. Shared-host load may vary.'}
for number in (1,10,20):
    x,sr=sf.read(ROOT/f'fixtures/Audio/vocadito_{number}.wav')
    if x.ndim>1:x=x.mean(axis=1)
    if sr!=SR:x=resample_poly(x,SR,sr)
    ann=np.loadtxt(ROOT/f'fixtures/Annotations/F0/vocadito_{number}_f0.csv',delimiter=',')
    start=max(0,int(ann[np.flatnonzero(ann[:,1]>0)[0],0]*SR)-SR//4)
    x=x[start:start+SR*2].astype(np.float32);x*=min(1,.06/rms(x))
    for name,p in STREAM_PROFILES.items():
        st=StreamingVocoder(model=model,**p);before=len(model.timings);clock=0;ages=[];began=time.perf_counter()
        for i in range(0,len(x)+st.buffering_samples,HOP):
            chunk=np.pad(x[i:i+HOP],(0,max(0,HOP-len(x[i:i+HOP]))))
            arrival=(i+HOP)/SR;t=time.perf_counter();out=st.push(chunk);elapsed=time.perf_counter()-t
            clock=max(clock,arrival)+elapsed
            if len(out):ages.append((clock-(st.emitted_samples-st.step)/SR)*1000)
        timings=model.timings[before:]
        report['rows'].append({'fixture':number,'profile':name,'seconds':len(x)/SR,'rtf':(time.perf_counter()-began)/(len(x)/SR),'compute_p95_ms':float(np.percentile(timings,95)*1000),'worker_ready_p95_ms':float(np.percentile(ages,95)),'input_buffer_ms':st.buffering_samples/SR*1000})
        print(json.dumps(report['rows'][-1]),flush=True)
    # Ten-second two-voice offline take, licensed real singing repeated for load only.
    ten=np.tile(x,5)[:SR*10];buf=io.BytesIO()
    with wave.open(buf,'wb') as w:w.setparams((1,2,SR,0,'NONE',''));w.writeframes((ten*32767).astype('<i2').tobytes())
    out,key,elapsed=take.render(buf.getvalue())
    (ROOT.parent.parent/'evidence'/f'vocadito-{number}-mixed.wav').write_bytes(out)
    report['rows'].append({'fixture':number,'profile':'offline-two-voices','seconds':len(ten)/SR,'render_seconds':elapsed,'key':key})
    print(json.dumps(report['rows'][-1]),flush=True)
(ROOT.parent.parent/'evidence'/'cpu-benchmark.json').write_text(json.dumps(report,indent=2))
