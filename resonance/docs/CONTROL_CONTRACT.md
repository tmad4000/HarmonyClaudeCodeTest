# Proposed controller → singing renderer boundary, v1

**Status: implemented and tested on the controller side; not integrated with the
neural vocoder.** This handoff does not claim the browser partner already drives
PC-NSF-HiFiGAN or has the vocoder's latency/quality characteristics.

Ownership: musical state, pitch decisions and expression stay with this controller.
Singing waveform rendering, source features, playback scheduling and reference AEC
stay with the neural-renderer owner. No duplicate musical policy should execute in
the renderer. The existing baseline's device-mode UI remains with its parent owner.

Artifacts:

- `control-timeline.mjs`: causal append-once producer and pure immutable lookup.
- `models/frame-controls-v1.schema.json`: transport shape and numeric bounds.
- `evidence/frame-controls-v1.json`: deterministic synthetic 12-frame example.
- `tests/control-timeline.test.mjs`: ordering, overlap, clock, gain, release and cache tests.
- `tests/export-controls.mjs`: reproduce example without running any neural renderer.

## Shared source clock

One `clock_id` identifies one continuous **44,100 Hz source/capture epoch**. Sample
zero is the first canonical source sample after the renderer owner's rate conversion
and capture/AEC alignment. Both sides must agree on that origin. It is not wall time,
an AudioContext timestamp, a device output position, or a feature-array index. Resampling
and ADC/DAC mapping remain the renderer/AEC owner's responsibility.

An epoch reset (capture restart, discontinuity, or unrecoverable clock loss) requires a
new clock ID, cleared controller state/cache and explicit renderer queue coordination.
Never reinterpret old queued samples under a new epoch. Reject cross-epoch packets.

Frames use hop **512 samples**, about 11.61 ms. For global source frame `k`:

```
support       [k*512, (k+1)*512)
center         k*512 + 256
observation_end_sample  (k+1)*512   // exclusive capture watermark
```

This matches the proposed renderer centers `source_start_sample + 256 + j*512`
when `source_start_sample` lies on the shared 512-sample lattice. Negative centers
are startup context padding only: zero target F0, zero gain and observation-end zero.
Future positive centers are **not** zero padding.

The producer appends once after each complete new source frame becomes available.
Its pitch/intensity/confidence features must use only samples strictly before that
frame's observation end; a trailing analysis window is allowed. The center label does
not pretend those features existed 256 samples earlier. Initial analysis may use
explicit zero preroll; do not extrapolate future source audio to fill it.

## Output packet

| Field | Meaning |
| --- | --- |
| `schema` | Literal `harmony-frame-controls/v1` |
| `clock_id` | Shared continuous capture epoch, nonempty string up to 128 characters |
| `sample_rate_hz` | 44100 |
| `frame_hop_samples` | 512 |
| `available_through_sample` | Exclusive producer observation watermark; multiple of 512 |
| `frame_center_samples[]` | Absolute source centers, in the request's order |
| `observation_end_samples[]` | When each control's causal observation was available |
| `target_f0_hz[]` | 0 for unvoiced/silent control, otherwise 50–2500 Hz |
| `gain_multiplier[]` | Finite dimensionless multiplier in [0,1] |

Arrays have equal lengths. The runtime validator additionally checks grid alignment,
causal availability, startup padding and (when given the receiver's clock ID) epoch
identity. JSON Schema alone cannot establish the cross-array timing constraints.

`gain_multiplier` is **not RMS**, a target loudness, a confidence value, or the browser
oscillator's amplitude. The controller now has a distinct normalized mix envelope:
voiced target `0.45 * expression`, 18 ms attack and 45 ms release, forced to zero after
220 ms without voicing. The initial expression factor is approximately 0.78–1.0.
Source loudness is already represented in the vocoder source features; do not multiply
by measured input RMS again merely to translate this field. The renderer may apply
its own user level downstream, capturing the actual final samples for reference AEC.

During the brief release, the previous pitch can remain nonzero while gain decays.
Once gain reaches zero, target F0 becomes zero. This is an explicit musical envelope,
not an emergency safety mute. Actual waveform loudness and continuity still require
measurement; the multiplier alone never establishes audible success.

## Integration pattern and immutability

```js
const timeline = new ControlTimeline(model, {clockId: captureEpoch});

// Called exactly once per new complete frame, by capture/feature delivery:
timeline.appendObservation(
  {midi, rms, voiced, confidence},
  nextExclusiveSourceSample // 512, 1024, 1536, ...
);

// Called repeatedly/out of order by overlapping synthesis windows:
const packet = timeline.lookup(absoluteSourceFrameCenters);
// Hand packet.target_f0_hz and packet.gain_multiplier to FrameControls.
```

Do **not** call `Partner.step` from a vocoder conditioning callback. Overlapping
windows repeat old timestamps and would advance the recurrent state multiple times.
The renderer's observed-F0/default-harmony callback arguments must not silently
overwrite these target controls. The v1 callback is a pure lookup.

Every appended frame is immutable immediately, even before it is queued. V1 has no
retroactive revisions: rerendered overlaps retrieve the same values. Returned arrays
are independent copies and cannot mutate the cache. The renderer additionally freezes
the actual conditioning it queues with each render job. Emergency output mute/limiting
can still act downstream on already rendered sound; its result, not the pre-mute
buffer, is the feedback reference.

Missing future controls produce `NOT_AVAILABLE`. An expired old frame produces
`EXPIRED`; replayed/out-of-order observations produce `ORDER`. This is a scheduling
failure, not a silent control packet or automatic fallback to the old harmony policy.
The renderer owner decides whether to wait before its deadline, drop with an explicit
discontinuity, or perform an explicit epoch recovery. Such a dropout fails joint
musical availability even if the safety outcome is correct.

The cache defaults to 2048 frames (about 23.8 seconds). At capacity it returns
`BACKPRESSURE` before stepping state. The consumer may call `releaseBefore(center)`
only after acknowledging that **no pending or future overlapping context window**
will need earlier centers. Old ACKs cannot regress. There is no silent eviction,
state replay or unbounded history growth.

## Timing and latency reporting

These are **source-frame controls**, not a second schedule for the speaker. The
renderer owns source-to-playback mapping. Do not shift them by an estimated 196–236 ms
or by this browser experiment's 35 ms contour-lookahead tuning. That would conflate
musical prediction, source observation and device scheduling.

The existing controller's bounded 35 ms contour anticipation remains an authored
musical hypothesis; it does not cancel vocoder delay or predict unknown syllables.
Record observation end, controller-ready time, render-ready time, queued output
sample positions and actual ADC/DAC timing separately. Compare worker readiness and
physical phrase response separately. No measured physical latency is supplied here.

At a window's right edge, wait for its required control observations; never recalculate
past controls using newly available right context. If the neural feature extractor
requires more right context than this boundary, account for that separately in its
renderer-ready deadline. The model may use that audio context, but the controller
must not secretly gain future observations relative to its declared watermark.

## Acceptance for the combined experiment

Integration remains a separate step owned jointly at this explicit boundary. First
consume the synthetic packet without advancing musical state and verify byte-identical
controls across overlapping render windows. Then measure emitted harmony continuity,
level, pitch response, onset/phrase delay and feedback stability together. A frozen
or muted stream is not successful entrainment. Preserve the known diagnostic unison
and large path-gain failures as open findings; this interface does not solve them.
