# Renderer boundary for the resonant musical partner

Owner split (Jacob's clarification, Nov 4): `harmony-resonance` / Astra
`f2d6ba26-4a5a-4655-811c-c001f66a6e23` owns recurrent musical decisions and authored
weights. This workspace owns neural vocal rendering, latency/continuity measures
and playback-reference echo handling. No controller or authored tensors were
copied into this experiment. The handoff source is
`/Users/jacob/code/vocal-harmony-neural/progress.json`.

## In-process interface, not an integrated controller

`NeuralVocoder.synthesize` and `StreamingVocoder` accept an optional
`conditioning` callable. `LiveSession(conditioning=..., profile="responsive")`
also accepts it programmatically. The CLI still uses its original DSP/rule
harmony path. There is no new network endpoint or automatic cross-workspace import.

```python
from vocoder import FrameControls, StreamingVocoder, STREAM_PROFILES

# Provider is the controller owner's read-only event/trajectory lookup.
# It must NOT advance recurrent state on each call: windows overlap!
def conditioning(source_frame_centers, observed_f0_hz, default_target_f0_hz):
    # Retrieve values the external controller already computed for these times.
    target_hz, gain_multiplier = controller_trajectory.lookup(source_frame_centers)
    return FrameControls(target_hz, gain_multiplier)

renderer = StreamingVocoder(
    conditioning=conditioning, **STREAM_PROFILES["responsive"]
)
```

The example's `controller_trajectory` is intentionally not implemented here.
Neither this interface nor a queued coordination message means the two experiments
are connected. The controller owner must decide its policy and transport.

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
* Provider: bounded, nonblocking, deterministic lookup for repeated timestamps.
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

Joint test outcome: original and responsive both pass the specified numerical
criteria for double-talk, correlated unison, synthetic sustained vibrato and high
fixed loop gain. Both **fail** the delay-change condition on near-end error SNR
(~13 dB), despite keeping the harmony audible. This is an exposed limitation,
not a muted 'success'. See all ten comparison rows in `artifacts/continuity.json`.

Listening clips in the response sweep are source-aligned to compare timbre and
chunk artifacts. Their playback does not simulate different monitoring delays;
the timing comparison is in the measured JSON. Actual headphone/speaker response
still requires the native live experiment on M5.
