# Resonance: third musical-partner experiment

A local, causal musical partner: twelve leaky recurrent units with explicitly authored
weights shape a lower voice in response to pitch contour, energy, articulation and
musical history. A simple additive synthesizer renders it. This is distinct from the
second experiment's pretrained PC-NSF-HiFiGAN waveform renderer.

**Status:** runnable experimental prototype with known joint-acceptance failures.
Core and browser integration checks pass, but diagnostic correlated unison is muted
and a large path-gain change can produce the wrong pitch. Silence is not success.
Real singing, physical latency, and subjective musical quality are not accepted yet.
No model inference or microphone audio leaves the browser. No packages to install.

## Run

From this directory, using an existing Node 22 or later installation:

```sh
node server.mjs
```

The server binds to the loopback interface on port 8796. `RESONANCE_PORT` selects an
unused high port. Open the server on the **same machine as your browser**, or serve it
over your existing trusted HTTPS connection. Microphone access requires a secure
context. The server serves only this experiment directory. Do not expose it publicly.

In the demo:

1. Use **Hear example** for a synthetic contour, without a microphone. It drives the
   partner; the preview plays the partner only. Mixed comparison recordings are below.
2. With headphones, **Start singing**, then allow the browser's normal microphone
   request. Sing a rising contour, a falling one, and a held note. Leave pauses.
3. Compare **Recurrent partner** and **Simple fifth follower** on the same phrase.
4. For speakers, select that setup, lower physical output volume, and choose
   **Calibrate speakers**. Stay quiet during the three-second soft noise. A separate
   held-out portion must show at least 12 dB cancellation. Rejection leaves output muted.
5. Keep the calibrated mic stream, position, and physical volume unchanged. Start singing.
   Muting releases the mic and invalidates calibration. Changing audio devices or hiding
   the page also mutes. **Escape** is always the stop shortcut.

Calibration is in memory only. Restarting capture requires a new measurement because
the capture/playback delay can change. Partner level is applied **before** capturing
the output reference; changing it does not silently change the modeled physical path.

## Reproduce validation

```sh
node models/author.mjs
node --test tests/*.test.mjs
node tests/validate.mjs
```

Browser integration (from the served page's developer console, no microphone or
speaker playback):

```js
await (await import('/tests/browser.mjs')).runBrowserChecks()
```

This runs the actual production AudioWorklet processing code in an OfflineAudioContext
at 44.1 and 48 kHz, plus a high-rate fractional-delay room calibration. Its small test
subclass only supplies the initial offline mode synchronously; real sessions start muted.

Artifacts:

- [Experiment, research and limits](docs/EXPERIMENT.md)
- [Continuous-harmony acceptance and known failures](docs/CONTINUITY.md)
- [Authored tensors](models/authored.json), [reproducible coefficient source](models/author.mjs)
- [Recursive-loop metrics](evidence/validation.json), [browser metrics](evidence/browser.json)
- [Partner mix](evidence/partner-mix.wav), [baseline mix](evidence/baseline-mix.wav)
- [Separated singer/partner stereo](evidence/partner-stereo.wav): synthetic singer left,
  generated partner right; all fixtures generated here, no user recordings or licensed samples.

## Physical listening acceptance still needed

Use headphones first, then a low-volume calibrated speaker setup. Test comfortable
low/high notes, vibrato, breathy phonation, slides, quiet/loud phrases, rubato, repeated
onsets, long sustained notes and abrupt register/key changes. Confirm the partner
answers while you sing, releases after your pause, and remains audible without masking
you. Compare the two behaviors without knowing which is selected if practical. Rate
responsiveness, consonance and sense of partnership separately.

For speakers, include unison/correlated notes, simultaneous singing and playback,
stopping completely, and moving the microphone. **Expect to recalibrate after movement.**
The conservative ambiguity guard can mute a sustained correlated human voice; this is
an acknowledged limitation, not proof that it separated the singer. If it mutes, don't
increase volume to defeat it. Use headphones or recalibrate.

Measure physical round-trip timing with an external synchronized recording if needed;
the reported synthetic onset delay excludes audio-device and room latency. No live
speaker test was run unattended. This experiment makes no EEG or brain-state claim.
