# AIB-bcv — independent third view

The hypothesis is that a very small, explicitly structured recurrent network can act
as a useful musical control layer even without training. This implementation supports
the narrower claim that authored recurrent state can produce causal, history-dependent
musical responses. It does **not** establish that the responses are preferable to a
simple harmony follower, or that a person experiences them as a musical partner.

**Updated acceptance:** [continuous-harmony evaluation](CONTINUITY.md) supersedes any
interpretation of the original eleven bounded-loop scenarios as eleven musical successes.
The expanded 16-case evaluation finds 9 joint successes and 7 joint failures, including
severe suppression in diagnostic unison and wrong-pitch output after a large gain change.

## Research and design decisions

1. **Use leaky recurrent memory.** Jaeger et al., *Optimization and Applications of Echo
   State Networks with Leaky Integrator Neurons* (2007), describes multiscale recurrent
   dynamics and stability considerations. [Primary manuscript](https://www.ai.rug.nl/minds/uploads/leakyESN.pdf).
   Here the recurrent matrix has absolute row sums below one, a deliberately stronger,
   easy-to-check contraction condition than relying on spectral radius alone. Our
   coefficients are authored, not an ESN readout fitted to a dataset.
2. **Treat rhythmic phase separately from pitch.** Large and Palmer, *Perceiving Temporal
   Regularity in Music* (2002), studies adaptive oscillatory timing in expressive musical
   sequences. [Primary manuscript](https://musicdynamicslab.media.uconn.edu/wp-content/uploads/sites/433/2016/03/LargePalmer2002PubsAHEdits.pdf).
   Our event-driven pulse estimator is a small engineering scaffold inspired by that
   family of ideas, not a reproduction of their model or a model of Jacob's brain.
   It reduces confidence in irregular timing and silence. Free-time singing remains valid.
3. **Use actual output and explicit delay.** The [Speex echo-cancellation manual](https://www.speex.org/docs/manual/speex-manual/node7.html)
   documents the need to align playback and capture and the effects of delay/filter length.
   We implement an independent sparse FIR measurement rather than importing its code.
   The filter is frozen during singing to avoid adaptation toward correlated near-end sound.
4. **Keep the causal loop on the audio thread.** The [Web Audio specification](https://www.w3.org/TR/webaudio/)
   defines AudioWorklet processing and output latency. Browser-reported buffering does
   not measure full acoustic round trip. Main-thread display updates do not drive notes.
5. **Treat direct weight writing as a testable hypothesis.** The [RikiyaT experiment logs](https://github.com/RikiyaT/lm_understand-logs)
   include authored game-network experiments, including MinAtar in exp5. They establish
   no live-singing result or MIT attribution here. No execution/configuration instructions
   from those logs were adopted. No their code or weights were copied.

The second Astra's brief/progress supplied the architecture distinction (PC-NSF-HiFiGAN
waveform generation plus DSP control). None of its implementation, model weights, or
workspace was reused or modified. Resource coordination was queued noninterruptingly;
this third view used small single-process JS tests, no heavy inference, training or installs.

## Signal and state contract

```
microphone ─ matched lowpass/decimate ─ subtract measured returned output ─ pitch/features
                                                                               │
actual emitted samples ─ matched lowpass/decimate ─ delayed reference            ▼
                                                  12-unit recurrent controller
                                                                               │
                                constrained lower voice + additive synth ◀─────┘
                                                  │
                               level → peak ceiling → actual emitted samples
```

Microphone and output are distinct signals. The reference is captured after the app's
level and limiter, immediately before writing to the output buffer. No subsequent
effects or app gain exist. Physical speaker gain, device buffering, room propagation,
and capture filtering are part of the calibrated room path. The browser never monitors
the raw microphone back to the speaker.

Rendering occurs at device sample rate. Matched fourth-order 1.5 kHz Butterworth filters
precede analysis decimation to `sampleRate / round(sampleRate / 8000)` (8000 at 48 kHz,
7350 at 44.1 kHz). The feature window is the last 40 ms, updated every approximately
10 ms. The pitch detector looks for the first reliable normalized squared-difference
minimum over approximately 75–900 Hz. It is DSP, not a trained pitch model.

The network equation is:

`h[t] = (1-a) h[t-1] + a tanh(W h[t-1] + U x[t] + b)`

`z[t] = tanh(V h[t] + c)`

Leak is adjusted for actual frame duration. Every input and state is bounded. Model
loading checks tensor dimensions, finite coefficients, leaks, and the contraction
bound. It rejects malformed models instead of silently using them.

| Quantity | Numerical representation | Musical meaning |
| --- | --- | --- |
| Contour | smoothed semitones/s divided by 12, clipped to ±1 | rising/falling movement |
| Intensity | residual RMS / 0.15, clipped to 0–1 | loudness response |
| Articulation | onset impulse 0/1 | phrase/syllable attack |
| Voicing | 0/1 | sing versus pause |
| Pulse | sin/cos of event phase, multiplied by confidence | optional rhythmic context |
| Reliability | pitch confidence 0–1 | inhibit uncertain response |
| Phrase age | voiced time / 4, capped at 1 | phrase-scale context |
| Recurrent state | 12 tanh units with fast/slow leaks | contour, energy, onset, voice, pulse, reliability and phrase memory |
| Output 0 | signed anticipation drive | bounded pitch-contour extrapolation |
| Outputs 1–3 | interval preferences | fifth, fourth or octave below |
| Output 4 | expression | modest gain/timbre variation |

The exported JSON contains 329 numeric coefficients, counting dense matrices including
zeroes, biases and leaks. All are **authored** in `models/author.mjs`; none are trained
or pretrained. The input/output meaning and recurrence were designed deliberately.
This is a manually compiled nonlinear controller. It can encode useful dynamics and
memory; it cannot inherit taste, style, lyrics, long musical structure or a singer's
intent merely because its coefficients are stored as tensors.

Musical scaffolding is explicitly non-neural: onset detection, phase/period tracking,
candidate intervals, hysteresis, pitch range, confidence gate, release, rendering, AEC
and safety. These are not presented as learned behavior. There is no tonal-key classifier:
the available fourth/fifth/octave intervals transpose with the singer. Register changes
recover promptly; major/minor harmonic understanding and chord-function choice are absent.

## What “in phase” means here

- **Pitch-cycle phase:** the renderer preserves its own waveform phase across samples;
  it does not lock to the singer's glottal cycles. Frequency tracking is not phase locking.
- **Rhythmic/phrase synchrony:** causal onset response, multiscale memory, optional
  pulse estimate, and a short release. The partner does not force a beat in free time.
- **Latency compensation:** bounded contour extrapolation assumes 35 ms. This is a
  tuning hypothesis, not an acoustic latency measurement or reliable next-note prediction.
- **Tonal consonance:** projected interval choices, not proof of a shared key or taste.
- **Brain state:** no sensor, EEG, brain-wave estimate, or neural synchronization claim.

## Reference handling and limitations

Calibration emits three seconds of soft deterministic noise. It searches delays from
one analysis sample through 240 ms, chooses 48 correlated taps and fits their gains with
coordinate descent on the first 67% of the recording. The last 33% is a true holdout.
Acceptance requires at least 12 dB holdout echo reduction, enough probe energy and a
bounded path gain. There is no training during human singing. Room parameters are
measured calibration coefficients; they are **not** neural-network training.

The runtime uses a residual-energy threshold, an independent ±0.12 digital ceiling,
input overload detection, invalid-stream mute, a two-second UI heartbeat watchdog,
and a conservative sustained output-correlation guard. Mutes latch until a new start;
speaker faults invalidate calibration. It does not silence accompaniment merely because
the user is singing. In the stable fixture output remains active through 97.6% of voiced samples.

Frozen subtraction preserves even exact unison algebraically when the path is correct.
But a single mic cannot generally distinguish a changed echo from a perfectly correlated
human source. The separate guard may mute that human unison after roughly 0.75 s of
strong ambiguous residual. We expose that tradeoff instead of claiming both perfect
preservation and universal feedback rejection. Modest path changes can degrade cancellation
without tripping the guard. Recalibration is required; this is not continuous room tracking.

Other limits: dense reverberation may exceed the sparse model; nonlinear speaker distortion
and sample-clock drift can invalidate a fit; other apps' audio is not in our reference;
very soft/breathy or polyphonic input can confuse pitch/voicing; a digital ceiling cannot
bound physical sound pressure. Use a quiet first test with headphones.

## Validation and the iteration it caused

Machine-readable evidence is in `evidence/validation.json` and `evidence/browser.json`.
All fixtures are generated synthetic inputs. No user audio was uploaded or recorded.
The provided WAVs are for listening comparison; the agent did not claim to hear them.

Fifteen core/lifecycle/acceptance tests cover tensor contracts, bounded state, causal prefix invariance, musical
history dependence, contour-dependent interval choice, release, tempo change/recovery,
harmonic pitch tracking, exact correlated near-end preservation, output-reference placement
and latched safety, cancellation while mic permission is pending, retaining the same
calibrated capture stream, and rejecting stale calibration results after mute.
The original recursive harness ran eleven scenarios: stable room, baseline,
no cancellation, 8× gain jump, delay jump, gradual gain/delay drift, 40× gain jump,
soft nonlinear path, mic dropout, reference dropout and near-end only.
It now also evaluates sustained/quiet singing, below-gate input and matched diagnostic
unison speaker/headphone cases with actual emitted-audio joint acceptance metrics.

Representative results from this M4:

| Measurement | Result | Boundary |
| --- | --- | --- |
| Sparse-room holdout ERLE | 47.58 dB | synthetic stationary room |
| Full high-rate browser calibration | 37.52 dB | fractional delays at 48 kHz, then 8 kHz analysis |
| Stable-room near-end error | −61.07 dB relative to singer | includes fixture noise |
| Stable-room output coverage | 97.6% of voiced samples | not a subjective score |
| Initial synthetic response | 25.4 ms; baseline 21.5 ms | excludes device I/O/acoustics |
| Severe 40× path jump | latched correlation mute at 3.84 s, jump at 3 s | no claim of instant path-change detection |
| Tail after singer stops | zero in stable fixture and below 0.001 RMS in all scenarios | bounded synthetic runs |
| Ramp anticipation error | 0.097 vs 0.111 semitones without extrapolation | slight improvement on one steady 2-semitone/s ramp |
| Process RSS | approximately 83 MiB in one run | Node harness, not a browser memory measurement |

CPU results are measured per run, not promises. The stable 8-second low-rate render used
about 86 ms compute in the recorded run; p99 10 ms-block compute was 0.66 ms, with some
larger scheduling/JIT outliers. Browser offline rendering also succeeded at 44.1/48 kHz,
but it is not a real-time audio deadline or dropout measurement. Real hardware timing,
dropouts under browser load and acoustic acceptance remain open.

The first browser test **failed**: fractional delay reduced holdout ERLE to 5.57 dB,
despite passing low-rate tests. Matched anti-alias filtering raised it to 37.52 dB.
This demonstrates why low-rate synthetic feedback checks alone are inadequate. Review
also found that reopening the mic after calibration could change delay; the ready state
now retains the same stream, and release/device change invalidates its room measurement.

## Interface direction

The existing product uses sans-serif type, dark listening surfaces and paired voice
readouts. This experiment retains those cues with restrained blue-violet partner ink,
subtle borders, a shared pitch-contour staff and large native Start/Mute controls.
Domain: contour, breath, phrase, attack, interval, silence. Color world: dark audio
equipment, graphite controls, pale score marks, muted slate labels, blue monitor light.
The signature is two moving contours separated by the live interval relationship.
Decorative waveform dashboards, oversized marketing type and dense studio knobs were
avoided. Desktop and mobile DOM geometry and screenshots were inspected. Reduced motion,
native labels, keyboard Escape and a status live region are included.

## Next evidence

The prototype is ready for low-volume human listening acceptance, not production deployment.
Compare the authored partner with the simple fifth follower on the same live phrases.
Record separately whether it feels responsive, consonant and companionable. If it adds
no value, replace or train the musical readout rather than adding neural branding.
Speaker-room acceptance and physical latency must be measured before claiming the
original feedback complaint is resolved.
