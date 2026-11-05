# Neural Harmony Lab — AIB-6q3

A runnable **experimental** alternate harmony engine. PC-NSF-HiFiGAN generates
new singing audio at a target pitch. An explicit post-limiter playback reference
feeds a calibrated echo canceller. The working `claude/` app is unchanged.

**Status:** implementation and numerical experiments available; human listening,
physical-device latency, and real-room acceptance still pending. Do not treat
this as a production feedback fix. The pretrained singing model is noncausal and
licensed CC BY-NC-SA 4.0 (noncommercial).

**Required acceptance:** preserve the live singer and keep the intended harmony
continuously audible during singing, jointly with echo rejection. Jacob reports
that suppression still kills harmony even in the plain version; simulated results
do not resolve that real-use failure. A quiet tail achieved by erasing the singer,
dropping harmony or latching safety mute is a failed musical outcome. Safety
protection remains enabled. The parent owns the M5 baseline device-radio UI.

The controller PR #2 v1 handoff now has a bounded Python `FrameControlCache`
adapter. It validates source clock/availability and immutable controls, then
supplies pure pitch/gain lookup to the renderer. See
[the contract](research/RENDERER-CONTRACT.md) and run
`neural/.venv/bin/python neural/adapter_smoke.py` for the offline ONNX smoke.
Live controller transport and causal source-feature production remain unwired.

## Setup, entirely local on M5 or another Apple Silicon Mac

Use an isolated clone of branch `experiment/AIB-6q3-neural-reference-harmony`.
Do not switch the branch or settings in the running baseline checkout.
Python 3.11 and Node are required (Node runs the exact vendored Signalsmith
comparator). From the isolated repository root:

```bash
python3.11 -m venv neural/.venv
neural/.venv/bin/python -m pip install -r neural/requirements.txt
neural/.venv/bin/python neural/setup.py
neural/.venv/bin/python -m unittest discover -s neural/tests -v
neural/.venv/bin/python neural/validate.py
neural/.venv/bin/python neural/benchmark.py
```

Setup downloads ~53 MB of model weights from the official OpenVPI release and
~59 MB of licensed singing fixtures from Zenodo. It verifies checksums and only
writes inside `neural/models` / `neural/fixtures`. It sends no local recordings.
`requirements.txt` pins direct and transitive packages to releases over a year old.
Models, environments and generated WAVs are git-ignored.

## A/B review

On the prepared M5 checkout, open `neural/Review.command`, or run
`neural/.venv/bin/python neural/review.py` on the machine where you are sitting.
It selects an available high port, opens the local review in your browser, and
stops its server when you press Ctrl-C. No mic access or playback starts on load.
The page offers the same fixture/gain across Signalsmith, neural-only, and neural
with reference. Switch conditions to inspect unison, octave, high loop gain,
changed gain/delay, drift and speaker nonlinearity. Default review volume is 15%.
Escape or **Stop all audio** stops the players.

The UI follows the existing product's navy/coral/sans-serif palette, with a
restrained comparison layout. `artifacts/demo-desktop.png` and `demo-mobile.png`
are verified screenshots when the evidence bundle is present.

## Live headphone experiment

Only run these commands locally on the Mac being used to sing. Device queries
are read-only; `--headphones` opens the selected device and plays generated audio.

```bash
neural/.venv/bin/python neural/live.py --devices
neural/.venv/bin/python neural/live.py --headphones --key C --gain 0.25 --seconds 60
```

Use `--device NUMBER` for a full-duplex device. `--key C` produces a rule-based
C-major diatonic third; omit `--key` and use `--shift 4` for the fixed +4-semitone
interval in the test fixtures. Shift range is ±12 semitones. Default gain .35;
maximum accepted gain .7. Start quiet and keep a hand/voice-accessible stop nearby.
Ctrl-C ends the session. Native macOS microphone permission may require the
normal system approval; the prototype does not bypass it.

## Live speaker experiment — human acceptance step

Keep speaker volume low and remain silent through the quiet calibration probe:

```bash
neural/.venv/bin/python neural/live.py --speakers-calibrate --key C --gain 0.20 --seconds 60
```

This command emits a quiet noise probe, learns the path, validates on a separate
probe, and refuses to start if held-out cancellation is below 15 dB. Calibration
is per session. Do not move the device or change system volume afterward.
The filter stays frozen during singing to preserve correlated/unison input;
movement can invalidate it. There is no promise of eliminating room feedback.

`artifacts/live-status.json` and console status show calibration, running,
muted/stopped, queue depth, p95 inference time, reference discontinuities and
mute reason. An independent limiter caps output at .18 peak; overload or dropout
latches mute. Restart explicitly to clear it. There is no automatic loud restart.

Acceptance sequence: headphones first; sustained vowels and vibrato; short phrases;
unison (`--shift 0` without `--key`); octave; stop singing and check that output
ends; then low-volume speakers with fresh calibration. Listen for delayed
response, vowel damage, pitch errors, chunk-boundary roughness, disappearance of
the singer and residual echoes. Changing device/gain requires fresh calibration.
No M5 audio was played or microphone opened by the implementation run.

## Evidence and interpretation

* `artifacts/measurements.json`: 11 recursive scenarios × 3 engines. Each output
  block is actually routed through a simulated acoustic path back to subsequent
  microphone blocks. No one-pass-only substitution.
* `artifacts/quality.json`: three real singing recordings, target-pitch error
  against vocadito annotations, bounded streaming versus whole-clip resynthesis,
  compute quantiles, RTF and process peak RSS.
* `artifacts/unit-tests.txt`: DSP, correlated double-talk, reference timestamps,
  bounded buffering and runtime safety tests. `artifacts/ui-tests.json`: UI checks.
* `research/DECISION.md`: architecture, model alternatives, primary sources,
  limitations and licenses. `artifacts/RESULTS.md`: measured interpretation.

Clean-singer error SNR is measured **before** synthesis using known near-end audio.
It is not perceptual singing quality or pure echo-return-loss enhancement during
double-talk. Signalsmith uses the exact `claude/vendor` WASM core with 60 ms blocks,
but Chrome device AEC, the original app's gate/filters/notches, and a physical room
are not reproduced. No superiority claim over the full M5 app is justified.

Timing reports include warmup separately. Estimated live delay adds input
buffering + measured p95 compute + one callback; it is not measured hardware
round-trip latency. RTF below 1 is necessary but does not guarantee deadline
success; p99 spikes and callback scheduling still matter. No gate masks a failed
separation in this experiment.

## Responsiveness continuation: a rendering lane for the musical partner

The separate third-view Astra owns the stateful musical controller. This engine
now exposes a documented [renderer boundary](research/RENDERER-CONTRACT.md) for
sample-timestamped target pitch and unitless waveform gain. No controller policy
or authored weights were duplicated, and the two demos are not yet integrated.

Try `--profile responsive` with either native headphone or speaker mode to use
the measured smaller-window option. `original` remains the default. In the same
M4 sweep, responsive p95 source-to-worker-ready delay was 103–110 ms versus
171–175 ms for original. These exclude device/playout delay and do not replace
physical latency measurement. Pitch metrics were similar; spectral difference
increased, so listen to both before choosing a default.

```bash
neural/.venv/bin/python neural/live.py --headphones --profile responsive --key C --gain 0.25 --seconds 60
neural/.venv/bin/python neural/sweep.py
neural/.venv/bin/python neural/continuity.py
```

`sweep.py` reports measured scheduling backlog as well as throughput and pitch.
`continuity.py` requires audible output, level preservation and loop stability
together; muting cannot pass as a musical success. New evidence lives in
`artifacts/responsiveness-sweep.json` and `artifacts/continuity.json`.
