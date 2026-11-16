# Unapproved quiet-assist prototype: actual-browser NO-GO

Preservation only. Nothing in this branch is approved for production. Testing
uses generated audio in sandboxed Linux Chromium, not a physical phone or a
private recording. Stop further threshold tuning; the architecture review is
owned separately.

## Frozen source and observed failures

Runtime SHA256: harmony-app.js `4f49c2597d273ba62b4cb092e3dcdbb0b7a2b440fa10a6bfa84b6d3db17aa91f`,
quiet-voice-gate.js `0b278017b8e1d7a42a980d52a7130371ce4787fa423c4fcaebb241fe16776558`,
echo-canceller.js `1630d43b612119987ff13d0620e5f1f06dfba3613d575930b74fc70220ad46da`.

Independent evidence on the development host is under
`/home/dev/code/vocal-harmony-next-20261115/phone-low-level-evidence/independent-normalizer/`.
The decisive artifact is `guard-final-room/room-results.json`, with source
hashes and actual production classifiers (no oracle near-voice signal).

| Generated room | Guard captures / latch | Observed output |
| --- | --- | --- |
| Gain 2, 180 ms delay | One / no latch | Peak RMS .04312; substantial regeneration before final decay |
| Gain 2, 40 ms delay | Zero / no latch | Peak RMS .02941; regeneration despite late-tail pass |
| Gain 2, 100 ms, Continuous after seed | Zero / no latch | Late RMS .005131 and 75 late gate frames after singer cut |

Six of eight strict final cases passed. The short-delay regeneration is an
additional quality failure; passing a late-tail check does not excuse it.
Legitimate continued +18/+24/+30 dB crescendo/350 ms pitch-step controls did
not falsely latch, but that positive result does not repair these negatives.

## Why the offline rule did not transfer

The saved diagnostic replay produced two qualifying reference-lead captures;
the actual browser runs produced at most one. The rule requires two distinct
reference changes, a finite current mic pitch, a 50–500 ms lead interval and a
100 ms persistent direct match. Missing/unstable YIN pitch correctly cannot
prove reference lead. Dominant FFT peaks are not guaranteed fundamentals.

The output FFT window is 4096 samples (85 ms at 48 kHz), with existing .8
smoothing and 100 ms JS sampling. The input detector uses a different window.
These are not synchronized acoustic timestamps; short acoustic delays, window
history, rank changes and callback timing can erase or reverse apparent lead.
One replay trace demonstrated a heuristic fit, not a reliable causal detector.

## Unity extra gain did not stop the loop

In the 180 ms failure, mic RMS grew approximately .00095 → .0072 → .055 while
the added normalizer was already mostly 1. The fixed generated singer stayed
at 177 Hz while detected pitch chased other notes. A separate forced-unity
causal experiment was not run, so this observation must not be described as
proving the bootstrap alone is sufficient.

The quiet exception opens a formerly muted path. Existing mic makeup, voice
gain, acoustic return and cancellation determine total loop gain; unity of
the *extra* stage is not unity of that loop. A quiet-reference seed proves
that a singer was initially present, not continued independent near-end
activity after output starts. Continuous bypass makes detection failure more
serious: the intended containment override never executes if it never latches.

## Next testable evidence, without amplifying unknown feedback

Keep the prototype unshipped. Measure aligned mic/reference evidence in the
existing AEC processing path before changing gain or trusting pitch lead.
Bench current AEC adaptation across reference amplitude and known physical
echo scaling, with far-end only, noise only, near-end only and doubletalk.
Report ERLE, adaptation/leak state, false near-end acceptance and exact delay.

A concrete unresolved hypothesis is the bootstrap test `Sxx > N * 30` after
reference pre-emphasis .9. At low fundamental frequency this attenuates the
reference further; it may prevent quiet-level learning. This has not yet been
causally established. Do not simply lower the threshold: noise training and
doubletalk corruption need negative controls. Any normalized training proposal
must be tested independently and followed by closed-loop reference-only,
seeded-stop, short-delay and Continuous tests before release.

The existing native AudioParam deadman and actual audio-clock reads passed
their generated stall tests; those bounded gains do not substitute for echo
exclusion. Cached coupling alone is not proof of a fresh route model. Physical
iOS behavior, audible quality and safety remain unverified.
