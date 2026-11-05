# Measured result — experimental, not accepted for the room

The alternate neural waveform engine runs and produces singing harmonies on Apple
Silicon. It is **not yet a transparent low-latency live choir or a room-robust
feedback fix**. Do not replace the working app. Human listening is pending.

## Resource and timing evidence

Measurements are from SDMM770 M4 under existing machine load. Two ONNX CPU
threads, one model, no GPU. 116.1 ms input buffering is followed by inference and
callback/device scheduling. Estimated live delay is not hardware loopback latency.

| Real singing fixture | End-to-end processing RTF | Inference p50 / p95 / p99 ms | Estimated live delay ms | Streamed pitch median abs cents |
|---|---:|---:|---:|---:|
| vocadito_1.wav | 0.78 | 61.5 / 108.2 / 117.3 | 236 | 16.0 |
| vocadito_10.wav | 0.61 | 54.0 / 68.7 / 81.8 | 196 | 25.4 |
| vocadito_20.wav | 0.66 | 53.7 / 101.3 / 128.9 | 229 | 28.5 |

Quality benchmark peak RSS: 335.5 MiB. Recursive test process peak
RSS reported in the final batch: 401.3 MiB. Warmup is separate.

RTF <1 is an average throughput result, not a deadline guarantee. p99 spikes can
exceed the 92.9 ms output step. The runtime can mute on starvation. Existing host
load made some runs slower; individual distributions are retained in raw JSON.
No unreported lower-resource model or conventional shifter fallback was used.

Pitch evaluation compares estimates with vocadito human F0 annotations on slowly
changing voiced frames. The input estimator itself has errors. Streamed gross
pitch errors >100 cents occur in roughly 2–6% of evaluated voiced frames, and
voiced coverage is 93–99%. This is a small sample, not a singing-quality benchmark
with perceptual raters. Stream/offline log-mel differences and all comparison
pitch measurements are retained in `quality.json`.

## Recursive feedback evidence

Each processed block actually changes future microphone input via a synthetic
room impulse, including after the singer becomes silent. Calibration is estimated
from a separate independent probe and checked on held-out noise, rather than
copying the simulator's impulse into the canceller. No singer gate or speech
residual suppressor is used. There are 33 runs across 11 conditions.

| Condition | Reference version: active clean-singer error SNR dB | Tail output dBFS | Safety mute |
|---|---:|---:|---|
| playback_only | n/a | -109.9 | none |
| doubletalk | 89.4 | -109.9 | none |
| unison | 90.3 | -109.9 | none |
| octave | 87.4 | -109.9 | none |
| sustained_vibrato | 86.4 | -109.9 | none |
| gain_change | 20.2 | -109.9 | none |
| delay_change | 13.2 | -90.0 | none |
| nonlinear_speaker | 49.1 | -109.9 | none |
| clock_drift_100ppm | 11.3 | -72.3 | none |
| singer_only | 164.4 | -109.9 | none |
| high_loop_gain | 77.4 | -109.9 | none |

The very high fixed-path SNR is a controlled, nearly noiseless linear simulation
upper bound. It must not be presented as 90 dB real-room cancellation. Singer-only
has an exactly zero echo path; its numerical-floor SNR is not echo evidence.

At fourfold room gain, both no-reference engines reach the independent overload
mute. Their silent tails are **not** successful separation. The calibrated
reference version does not mute. At normal room gain all engines' tails decay;
that alone does not prove feedback robustness. Delay mismatch and uncorrected
100 ppm time warping degrade reference cancellation sharply. Nonlinear clipping
also falls outside the fitted linear path. Hardware clock timestamp alignment is
unit-tested, not measured against a physical device.

The baseline is the exact vendored Signalsmith core at the brief's `fb46d29`,
without Chrome device AEC, gate, filters and notch graph. That is a synthesis/core
comparison, not a full baseline-versus-new-app physical-room result. M5's live
checkout was read back at `d5d0856` during this run and was not modified.

## Verified and still open

21 deterministic core/runtime/evidence tests pass: correlated unison preservation, probe
identification, pitch, feature shapes, bounded stream buffers, actual post-limiter
reference, fractional timestamp offsets, reference gaps, device dropout,
starvation, queue overload and nonfinite output. UI checks cover 11 scenarios,
safety state presentation, available audio files, no autoplay and mobile fit.

Still open: human quality acceptance, sustained real vowels/vibrato on the device,
macOS microphone permission, physical latency and room-loop acceptance; adaptive
path changes with singer preservation; lower latency/stateful neural synthesis;
Social project-directory update when authenticated access is available. The
original AIB-6q3 remains open for acceptance and robustness work.
