# Neural Harmony browser-only offline experiment

Current root authorization selects browser-only route A, superseding the earlier
withdrawal and route B plan. The sole canonical Sites publisher is96cbf9fa.
This session prepares isolated reviewed assets and does not push native Sites.

The public Neural page records10 seconds and renders harmony AFTER recording.
It is experimental, not live. The page asks users to allow about1–2minutes,
longer on slower devices, and keep the tab open. The model/runtime load only
on the explicit Load neural engine click within Neural. No main Harmony changes,
no public inference service, no audio upload and no WebGPU requirement.

## Licence and model

Visible attribution: OpenVPI Team / DiffSinger Community Vocoder,
PC-NSF-HiFiGAN2025.02. The page spells out CC BY-NC-SA4.0 — Attribution,
NonCommercial,ShareAlike — and noncommercial use only. Modified weights retain
that same licence. The model directory contains full MODEL-LICENSE.txt,
MODEL-NOTICE.txt (complete upstream acknowledgements plus modification notice)
and model-manifest.json, all adjacent to both weight shards. Page links to the
full licence and notice. Preserve these with redistribution.

The conversion stores90 large float32 weight tensors atfloat16 and inserts Cast
back tofloat32 before arithmetic. No fine-tuning. Original56616643bytes becomes
28396756bytes. Packed model SHA256:
c8fa9907a7aa94321d4675fdc157253946b1f1eff91b79e155040a0db8849f0a.
Two14.2MB shards are concatenated and checksum-verified before session creation.
One singing-clip comparison:relative waveformRMSE.055%,logmelMAE.00085. This is
numerical evidence on one clip,not human quality acceptance or a general bound.

Vendored ONNX Runtime Web1.22.0 (2025-05-09) and fft.js4.0.4 (2021-01-11), with
MIT licences/upstream notices. Whole download about40MB. Every file below15MB.
WASM SIMD single-thread in a Worker; no COOP/COEP/global-header change or CDN.
FFT module export changed toself.FFT for classic Worker loading.

## QA and timing

Fresh release QA:390×844 viewport,2×device scale,mobile/touch emulation on Linux
Chrome,sandbox enabled.10-second synthetic microphone take ->82.550s worker
render ->playable/downloadable WAV. Output441000frames/882044bytes at44100Hz,
RMS.01305,peak.1069. ZeroPOSTs,page errors,or horizontal overflow.
Local loopback model/runtime load took1.428s; this is NOT internet download time.
A physical phone may render much slower or run out of memory. No Mac/iOS or human
singing-quality acceptance claim. The page's1–2minute wait is guidance,not a cap.

Public Harmony main page loaded200 with zero Neural requests. Neural page itself
requested no weights/runtime before the Load click, then exactly two model shards.
Recheck main-page requests after the publisher deploys the isolated asset subtree.

Earlier protocol/UI QA covers malformed/short/quiet WAV, cancel/reload, corrupted
shard rejection, canonical asset paths and measurable neural contribution beyond
the dry signal. DSP vs Python reference:maxlogmel difference.000210,pitch0cents
on43 synthetic voicedframes. Full licence file/link added after timing run is
checked separately in final static/link review; rendering code was unchanged.

## Publication/reproduction

Fresh reviewed bundle:
/home/dev/code/neural-harmony-20261115/browser-reviewed-handoff/public/
Copy only neural-experiment.html and neural-browser/ into canonical dist.
Intended page:https://harmony.jacobcole.net/neural-experiment.html
Publisher captures CURRENT rollback and verifies deployed HTTPS before reporting
it live. Do not reuse older withdrawn bundles or route B/interim patches.

Weights are not committed in Git. pack_model.py converts the hash-verified
original archive's ONNX (existing neural/setup.py) with numpy2.2.6,onnx1.18.0,
typing_extensions4.13.2. Pass absolute --input and --output-directory. Preserve
licence/notice/manifest beside its output; use the exact ORT/FFT versions above.
Host-scoped QA script defaults to the absolute browser-lab directory; a task-owned
loopback server is started for verification and stopped afterward. No shared
service is changed. Private port9918 fallback stays up separately by root request.
