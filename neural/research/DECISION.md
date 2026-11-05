# AIB-6q3: architecture decision, 2026-11-04

This is an experimental alternate engine in the HarmonyClaudeCodeTest lineage,
base `fb46d29`. Jacob's Nov 4 report of persistent real-room feedback overrides
older synthetic/tone successes. Neither old tests nor this simulation establish
successful human singing acceptance.

## Candidate evidence and selection

| Candidate | Evidence / release | Decision |
|---|---|---|
| **OpenVPI PC-NSF-HiFiGAN** | [Official release](https://github.com/openvpi/vocoders/releases/tag/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02), Feb 27 2025. Singing-trained, explicit F0, pitch-controllable ONNX asset. | Implemented. One pretrained neural waveform generator, CPU ONNX Runtime. No voice clone or user training required. |
| SiFi-GAN | [Paper](https://arxiv.org/abs/2210.15533), [official implementation](https://github.com/chomeyama/SiFiGAN). Source-filter neural vocoder with pitch control and pretrained speech + singing option. | Credible follow-up. More feature/runtime integration than the packaged PC-NSF ONNX asset. Not benchmarked here. |
| StreamVC | [Paper](https://arxiv.org/abs/2401.03078). Low-latency causal voice conversion demonstrated on mobile. | Useful architectural target. This inspection did not establish an official distributable singing-validated checkpoint; did not substitute unofficial learning implementations. |
| LLVC | [Paper](https://arxiv.org/abs/2311.00873), [official code](https://github.com/KoeAI/LLVC). Low-latency CPU speech conversion. | Speech conversion speed is not evidence of singing/pitch-control fidelity. Not used as a singing engine. |
| DTLN-aec | [Official code/weights](https://github.com/breizhn/DTLN-aec), [paper](https://arxiv.org/abs/2010.14337). Explicit loopback reference; pretrained speech AEC. | Research lead, not enabled: singing preservation, correlated unison and high notes are unvalidated. Model not downloaded or benchmarked. |
| Microsoft task splitting | [Braun & Valero, 2022](https://www.microsoft.com/en-us/research/wp-content/uploads/2022/07/Paper_E12.pdf). Separates echo removal from subsequent enhancement. | Supports treating AEC and residual removal as separate stages. We implement a measured linear AEC first and expose residual failure rather than applying an unvalidated speech suppressor. |

A model filename alone does not prove singing quality. Actual vocadito singing is
resynthesized and measured in `artifacts/quality.json`; listen to the exported A/B
files. Model and fixture sources are independent of Jacob's voice.

## What is learned

* Learned: waveform generation from 128-bin log-mel features and explicitly
  transposed F0, using PC-NSF-HiFiGAN pretrained singing weights.
* DSP: YIN pitch estimation, Slaney mel extraction, overlapping windows and
  crossfades, playback path identification and FIR subtraction, limiter.
* Rules: fixed semitone intervals or a major-key diatonic third. No claim of
  learned chord selection, learned musical judgment, or foundation-model training.
* Not present: a conventional pitch shifter after a neural pitch detector. The
  Signalsmith WASM core exists only as a labeled A/B comparator.

## Signal contract

Native local full-duplex audio at 44.1 kHz, 512-sample callbacks. The callback
submits post-gain, post-limiter (and post-mute) mono PCM to the device and stores
that exact PCM against `outputBufferDacTime`. Mic blocks query the reference
against `inputBufferAdcTime`; fractional timestamp interpolation accommodates
clock offset. Missing reference coverage and device dropouts latch output mute.

A low-level independent noise probe identifies a causal 8192-tap path (~186 ms).
An independent held-out probe must achieve >=15 dB cancellation before speaker
mode starts. The filter is then **frozen**, so correlated singer/unison content
cannot drive adaptation into subtracting the singer. This assumes a quiet user
during calibration and a fixed room/device/gain afterward. It is not a solution
to moving-room identification: a changed echo path and a correlated singer are
not generally identifiable from these two signals alone.

Neural generation consumes bounded overlapping windows: 4096-sample output step,
2048 left context, 512 right context and 512 crossfade overlap. This exposes
116.1 ms initial input buffering; compute and device scheduling add latency.
The pretrained generator is not natively causal. Its independent excitation
phase in each window can cause artifacts despite crossfading. Python callbacks
are experimental, not certified hard-real-time.

One inference worker, two ONNX CPU threads; bounded queues; no torch, GPU model,
training job, voice upload or cloud audio processing. Sustained output overload,
nonfinite output, input/output queue overflow, device dropout and starvation
latch a visible mute. That mute is not evidence of successful cancellation.

## Limits and next engineering work

The static-path result is an upper bound, not a field result. Delay changes,
100 ppm uncorrected time warping, and nonlinear playback are deliberately tested.
Clock timestamps are unit-tested but their physical accuracy is not verified.
Need physical loopback/device measurements and a singing-safe path-change
strategy before claiming room-robust operation. Likely next experiments: gated
independent probe updates with explicit calibration state, a shadow adaptive
filter with conservative promotion, or a reference-conditioned residual network
validated on singing. Do not silently place a speech-denoising gate in the path.

For substantially lower latency and fewer boundary artifacts, train/fine-tune or
obtain a licensed **stateful causal singing vocoder**. This prototype's measured
latency is too high to call a transparent live choir. Do not replace the M5 app
on the basis of these results.

## Licensing and provenance

Weights: OpenVPI Community, **CC BY-NC-SA 4.0**. This is a noncommercial research
prototype; weights are not committed, and their notices/attribution ship in the
upstream archive downloaded by `setup.py`. Commercial integration needs separate
license resolution or another suitable model. Code changes here are separate
from model licensing. Existing vendored Signalsmith remains under its MIT notice.

Fixtures: Rachel Bittner, Katherine Pasalo, Juan José Bosch, Gabriel Meseguer
Brocal, David Rubinstein, **vocadito**, [Zenodo v3](https://zenodo.org/records/5578807),
CC BY 4.0. Crop/level changes are recorded in measurement JSON. No original audio
or lyrics are committed; setup fetches the verified public archive. Synthetic
vibrato is clearly labeled and does not count as human sustained-vowel acceptance.

All pinned Python dependencies were published no later than July 10 2025;
`dependency-ages.json` records PyPI evidence. No existing app dependencies changed.

Social project directory: no connected Social tool was exposed; the normal
Chrome extension inventory was empty, and Paseo browser registration timed out.
No directory entry was created or altered. This remains a metadata follow-up;
local repo/progress files are provisional implementation pointers, not a replacement
for Jacob's Social directory.
