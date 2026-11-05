# Renderer boundary for the resonant musical partner

Owner split (Jacob's clarification, Nov 4): `harmony-resonance` / Astra
`f2d6ba26-4a5a-4655-811c-c001f66a6e23` owns recurrent musical decisions and authored
weights. This workspace owns neural vocal rendering, latency/continuity measures
and playback-reference echo handling. No controller or authored tensors were
copied into this experiment. The handoff source is
`/Users/jacob/code/vocal-harmony-neural/progress.json`.

## Packet adapter and in-process interface

`NeuralVocoder.synthesize` and `StreamingVocoder` accept an optional
`conditioning` callable. `LiveSession(conditioning=..., profile="responsive")`
also accepts it programmatically. The CLI still uses its original DSP/rule
harmony path. There is no new network endpoint or automatic cross-workspace import.

```python
from control_adapter import FrameControlCache
from vocoder import StreamingVocoder, STREAM_PROFILES

controls = FrameControlCache(clock_id="capture-epoch-1")
renderer = StreamingVocoder(
    conditioning=controls, **STREAM_PROFILES["responsive"]
)

# On packet delivery, outside synthesis; source_received is the receiver's
# exclusive complete-frame watermark in the agreed capture/AEC source clock.
controls.ingest(packet, available_source_sample=source_received)
# Only push source windows after their required controls are delivered.
# renderer.push(source_block)
```

`control_adapter.py` consumes `harmony-frame-controls/v1` from controller PR #2,
commit `4aefe8c554de963faa42a404ebc8f0dc74edb884`. Its bounded cache validates
epoch, 44,100 Hz/512-hop clock, observation ends, receiver source availability,
shapes, pitch/gain bounds and zero preroll. It rejects `CLOCK`, `CAUSALITY`,
`NOT_AVAILABLE`, `EXPIRED`, `REVISION`, `ORDER` and `BACKPRESSURE` explicitly.
Delivery is atomic; repeated identical packets and out-of-order render lookups
do not advance policy. Returned arrays are independent read-only copies.

This implements and tests the **packet-to-renderer boundary**. It does not wire
a live JS transport or causal source-feature producer into native capture. The
controller workspace is read-only; no policy or weights are copied. Current
`FrameControls` stays a two-array rendering object; transport fields are checked
by the adapter before it supplies those arrays. Do not pass whole packets directly
to `FrameControls`, or call `Partner.step` from conditioning.

The default receiver capacity is 2048 frames. `release_before(center)` is an
explicit consumer ACK, never called automatically during lookup. Only release
after all outstanding render jobs are accounted for and no future overlap needs
earlier context. For a synchronous, completed streaming push, the next required
center is `renderer.emitted_samples - renderer.context + 256`; retain everything
from that center onward. Asynchronous render queues must retain the oldest needed
center across **all** pending jobs too. Coordinate the producer's separate
`releaseBefore` ACK through the eventual transport. Epoch recovery requires a new
cache and explicit renderer/queue reset; never reinterpret old queued controls.

The cache only checks declared causality; it cannot prove that the producer's
features were causal. Source-feature generation must use samples strictly before
`observation_end_samples`, step once per completed frame, and never recalculate
old controls from newer right context. Existing vocoder feature arrays are not a
replacement for that producer. Available source `[0,N)` allows observation end
`<=N`; the producer watermark cannot exceed the receiver's. No extra input-RMS
factor is applied to the normalized controller gain. The controller's 35 ms
contour anticipation is not compensation for vocoder or device latency.

Reproduce the real ONNX boundary smoke (no audio devices):

```bash
neural/.venv/bin/python neural/adapter_smoke.py
```

The pinned 12-frame synthetic packet and commit/SHA provenance live under
`tests/fixtures/`; `artifacts/controller-adapter-smoke.json` records actual ONNX
delivery and overlap checks. This does not measure musical acceptance, live
transport deadlines, real-room echo behavior or physical latency.

Contract:

* Clock: absolute **source/input samples** at 44,100 Hz, origin zero for a new
  renderer. Frame centers are `window_start + 256 + 512*k`. They are not DAC wall
  timestamps. Initial left padding produces negative positions; return zero gain
  and unvoiced F0 for those. `renderer.emitted_samples` tracks already emitted
  source audio. A later decision cannot change audio already emitted to the device.
* `observed_f0_hz` and `default_target_f0_hz`: copies, one value per frame. The
  latter is the existing fixed interval or major-key third, offered as a fallback
  hint. The external provider may ignore it. No control decision is inferred here.
* `target_f0_hz`: exactly one finite value per requested frame, 0 for unvoiced or
  50–2500 Hz. The model's meaningful range and ±12-semitone training augmentation
  still constrain quality; input validation is not an accuracy guarantee.
* `gain_multiplier`: exactly one finite unitless value in [0,1] per frame. It
  scales the neural waveform before crossfade, live gain and independent limiter.
  It is **not target RMS or oscillator amplitude**. The third view's existing
  additive renderer gain must not be passed through without explicit conversion.
* Provider: bounded deterministic lookup for repeated timestamps, no I/O or policy.
  Compute recurrent state once in monotonically increasing source time outside
  this callback. Keep past control values stable for overlap/context frames;
  explicitly choose expiry and silence behavior in the controller. The renderer
  does not silently invent missing policy. Invalid shapes/values raise an error;
  the live worker then uses its existing fail-closed safety path.
* Output: bounded mono waveform chunks. Explicit gain zero is a **controller
  request for silence**, not evidence of AEC success. Post-mix/limiter/mute PCM
  remains the only reference submitted to the canceller.

The provider changes pitch/loudness conditioning of current sung spectral context.
It does not supply text, a voice identity, or an independent song generator. It
cannot make the noncausal pretrained vocoder a causal model. Timing compensation
must account for renderer and device delay rather than assuming sample timestamps
are audible immediately.

## Profiles and evidence

`original` preserves the first prototype's settings. `responsive` uses 2048-sample
steps, 1024 left context, 512 right context and 512 crossfade overlap. Explicit
CLI selection: `--profile responsive`. It does not change echo calibration or
safety thresholds. No automatic fallback switches the synthesis algorithm.

`sweep.py` compares five window layouts with one model/two CPU threads and three
real singing clips. `responsiveness-sweep.json` includes serialized worker-ready
latency from a virtual callback arrival schedule, so inference backlogs are
counted. This is more useful than summing nominal buffering and a compute quantile,
but still excludes actual devices, Python callback contention and physical audio.

This run: original p95 source-to-ready delays 171–175 ms; responsive 103–110 ms
(plus callback/device/playout time). The short-step candidate backed up to 786 ms
on one clip despite nominal latency below 100 ms and was rejected. Responsive
pitch median absolute errors were about 15, 23 and 30 cents versus 16, 25 and 29
for original in the same sweep. Spectral distance from whole-clip synthesis
increased; audible boundary/timbre acceptance remains open.

`continuity.py` compares actual recursive-loop output with an oracle using the
same neural renderer/profile on clean singer input. It requires audible retention,
level preservation, clean-input SNR, quiet tails **and no safety mute** jointly.
This addresses the distinction between containing feedback and providing a useful,
continuous musical response. Thresholds are engineering acceptance hypotheses,
not perceptual scores. No brain-wave or neural phase synchronization is claimed.

After Jacob's direct report that suppression kills harmony even in the plain
version, acceptance requires 100% audible-frame retention and zero detected
dropouts, in addition to the existing singer-error, output-level, tail and mute
checks. Previously the measured longest dropout was not enforced and a 95%
retention threshold could allow brief losses. The detector compares 512-sample
RMS frames against a clean-renderer oracle: an oracle frame above .002 RMS with
more than 12 dB attenuation counts as a dropout. This only detects severe losses
at that resolution; it does not prove perceptual continuity or preserved timbre.
Near-end preservation and continuous intended harmony are mandatory human
acceptance requirements too. Quiet output from suppression is never acceptance.

Joint test outcome: original and responsive both pass the specified numerical
criteria for double-talk, correlated unison, synthetic sustained vibrato and high
fixed loop gain. Both **fail** the delay-change condition on near-end error SNR
(~13 dB), despite keeping the harmony audible. This is an exposed limitation,
not a muted 'success'. See all ten comparison rows in `artifacts/continuity.json`.

Listening clips in the response sweep are source-aligned to compare timbre and
chunk artifacts. Their playback does not simulate different monitoring delays;
the timing comparison is in the measured JSON. Actual headphone/speaker response
still requires the native live experiment on M5.
