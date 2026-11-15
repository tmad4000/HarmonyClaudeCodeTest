# Browser-only offline Neural Harmony (route A)

Record 10 seconds on the public HTTPS Harmony page, then generate a neural third
and optional fifth in a Web Worker using ONNX Runtime Web WASM. No audio upload,
server inference, tailnet route or public inference endpoint. No shared9827,
Funnel, sudo, operator policy, Mac bridge or main audio app changes.

The canonical Sites publisher is Sol96cbf9fa. Do not push native Sites in parallel.
Prepared publication assets are outside this Git tree:
`/home/dev/code/neural-harmony-20261115/browser-publisher-handoff/public/`.
Copy only its isolated page and `/neural-browser/` subtree into canonical dist.
Intended page: `https://harmony.jacobcole.net/neural-experiment.html`.

## Size and runtime

Original model56616643 bytes. Store90 large weight tensors atFP16 and insert
constant Cast toFP32 before existing arithmetic; no fine-tuning. Modified model
28396756 bytes (gzip26461509), SHA256
c8fa9907a7aa94321d4675fdc157253946b1f1eff91b79e155040a0db8849f0a.
Distributed as two14.2MB shards; loader concatenates and verifies model SHA256.
Total model+WASM+JS about 40 MB. Each deployed file is below15MB.
Model/runtime load only after explicit Load engine click. All dependencies are
vendored same-origin: onnxruntime-web1.22.0 (2025-05-09), fft.js4.0.4 (2021-01-11).
No CDN, remote code fetch, WebGPU dependency, cross-origin isolation, or global
header changes. Runtime uses WASM SIMD single-thread in a dedicated Worker.
The FFT vendored module export is changed from CommonJS to self.FFT.

Cancellation terminates the Worker; reload engine to try again. Invalid/quiet
WAV and download integrity errors are visible. Recording is 10 seconds at device
rate then resampled to44100Hz via OfflineAudioContext. File input accepts mono
PCM16 WAV at44100Hz,0.5–10s,<=900000 bytes. Key can be estimated or overridden;
major-scale harmony selection is rules/DSP. Final mix PCM16 mono44100Hz, exact
input duration, peak<=.94. Audio and output stay in tab memory until downloaded
or navigation. No localStorage/IndexedDB audio retention. Browser HTTP asset
caching is ordinary browser-managed caching; no offline-install claim.

## Evidence

- Sandboxed Linux Chrome157 synthetic mic:10s -> browser render59.8s -> playable/
  downloadable WAV,441000 frames,882044 bytes,RMS.01284,peak.1103. Zero POST
  requests,zero page errors,no390px viewport overflow. Engine load794ms over local
  HTTP; this is not an internet download-speed measurement.
- Updated sharded loader/control test:0.5s take ->2.8s render,nonzero finite output;
  malformed/short/quiet audio rejection; cancellation+reload control; intentionally
  corrupted shard checksum rejection;zero page errors.
- Ported DSP vs Python synthetic reference: maximum logmel difference.000210,
  pitch difference0 cents across43 voiced frames.
- One singing-clip precision comparison: relative waveformRMSE.0005482 (~.055%),
  logmelMAE.000850,similar RMS. This is one numerical comparison,not human quality
  acceptance or a general bound.
- Earlier WASM probe80frames(~.93s audio):3.35s on loaded Linux host. Offline
  mode works; live remains infeasible here. Browser hardware performance varies.
- Mac/iOS,physical microphone/human listening and published HTTPS recording are
  unverified. Linux secure loopback QA does not establish those outcomes.

## Reproduce packing

Existing virtualenv has numpy2.2.6,onnxruntime1.22.1,onnx1.18.0 and
typing_extensions4.13.2 (all releases older than a month).
`pack_model.py --input /absolute/original.onnx --output-directory /absolute/out`
stores weights/shards and writes model-pack.json. The source model is the
hash-verified OpenVPI archive from existing neural/setup.py, not a random model.
Runtime assets come from exact npm versions above; source licences and upstream
ThirdPartyNotices ship with the isolated publication bundle.

## Licence

Modified weights remain CC BY-NC-SA4.0. Full upstream acknowledgements, licence
link and explicit precision-modification notice are in MODEL-NOTICE.txt alongside
the model shards. Preserve them and the visible attribution link. Original
release https://github.com/openvpi/vocoders/releases/tag/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02
Original archiveSHA256 ba7d43142d41f6900c8264b5662ca7125a50feb8760bb8b9615c61a8f5e6902e.
No commercial licence claim; noncommercial research/friends evaluation.

QA scripts are host-scoped and use NEURAL_QA_LAB (default the absolute browser-lab
path above) for preview-owner.json and evidence. Start that task-owned lab server
when rerunning; it was stopped after verification. They do not start a publisher.
