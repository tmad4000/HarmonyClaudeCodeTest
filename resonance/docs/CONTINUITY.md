# Continuous responsive harmony is part of acceptance

Jacob's direct feedback: feedback suppression often kills the harmony, including in
the plain version. Stability and continuous musical response must be evaluated together.
The parent owns the baseline M5 device-mode radio-choice edit; this experiment does
not duplicate it or modify that baseline.

The previous `outputWhileSingingFraction` counted requested **controller gain**, not
the actual emitted waveform. Only the stable-room case enforced coverage. A safety
mute could therefore pass the general peak/tail assertions while making the product
unusable. That statistic remains labeled legacy in the JSON for comparison; it no
longer establishes musical availability.

`tests/joint-metrics.mjs` now measures post-render/post-limiter samples against a
separate causal clean-input oracle, using the same controller, renderer and output
level. Ground-truth singer voicing is supplied by the synthetic fixture, not by the
potentially confused detector. A failed detector cannot redefine singing as silence.

All checks must pass for `jointSuccess`:

| Requirement | Digital test criterion |
| --- | --- |
| Continuous output | At least 95% of voiced 20 ms windows above 0.00025 RMS and 35% of oracle level |
| No sustained holes | No voiced dropout longer than 80 ms |
| Responsive attack | Output for every phrase begins within 100 ms |
| Useful retained level | Median level no more than 6 dB below the clean-input oracle |
| Responsive pitch | 95th-percentile emitted pitch error against oracle no more than 50 cents |
| Stability/release | Peak at most 0.12; post-stop tail below 0.001 RMS |
| Availability | No latched safety mute |

Continuity excludes the first 100 ms of each phrase, but attack delay is checked
separately. Emitted pitch uses interpolated positive zero crossings over an 80 ms
trailing window; this is appropriate to this simple harmonic renderer, not a general
polyphonic audio-quality metric. An oracle that is itself silent supplies no level
comparison and cannot make a silent result pass. These thresholds are declared
engineering criteria, not validated human loudness or preference thresholds.

## Results

The expanded harness reports **9 joint successes and 7 joint failures** across
16 fixtures. Passing regression assertions means it classified them correctly;
it does not mean all fixtures are usable musical partners.

- **Fixed room, baseline, sustained singing, quiet sustained singing:** 100% emitted
  coverage after the attack budget, no voiced gaps, approximately 0 dB loss relative
  to the clean oracle, and attacks within 40 ms at this 20 ms measurement resolution.
- **Diagnostic unison with calibrated reference:** only 16.8% voiced coverage;
  3.66 seconds of missing harmony; a latched correlation mute. **Joint failure.**
- **Matched unison headphone control:** 100% coverage. This isolates the loss to
  the speaker-path guard rather than the synthesizer or musical network.
- **8× room-gain jump:** 100% coverage, but about 2101 cents 95th-percentile pitch
  disagreement with the clean oracle. **Joint failure despite continuous sound.**
- **No cancellation:** output stays present, but about 161 cents tracking disagreement.
  **Joint failure despite a quiet final tail.**
- **Voice below the current gate:** zero output even in the clean oracle. **Joint
  failure** of low-level operation, not evidence of successful feedback suppression.
- **40× gain jump and mic/reference dropout:** emergency containment mutes output.
  Containment is working, but each is explicitly a **joint musical failure**.
- **The tested modest delay jump, gradual drift, mild nonlinear path and near-only
  input:** pass these synthetic joint checks. This does not generalize to all rooms.

The unison fixtures deliberately substitute a same-pitch renderer while retaining the
production capture, subtraction, musical gain and safety chain. They are a separation
stress test, **not** a claim that the default lower-voice UI currently offers unison.
Every reference sample still comes from the actual emitted diagnostic output.

## What changed and what did not

The evaluation now rejects silence, heavy attenuation, wrong pitches, delayed attacks
and long gaps. Dedicated metric tests prove that each can fail even when the samples
are finite and the final tail is silent. No production safety threshold was weakened
to obtain a better score. The known correlated-unison failure remains unresolved.

The next algorithmic step needs evidence that distinguishes a changed playback path
from a correlated human voice. Simply removing the guard, making the mute slower, or
lowering the voice gate would exchange the current defect for possible self-chasing.
Any proposed correction must improve joint metrics while preserving overload/dropout
containment, then pass low-volume real singing and room trials. The experiment is not
accepted as solving Jacob's original feedback complaint.

See `evidence/validation.json` for per-case checks and full metrics. Loop CPU timings
now include an additional clean-oracle engine and renderer; they are harness timings,
not a direct comparison with the earlier single-engine benchmark.
