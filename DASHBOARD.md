# Harmony Singer — Dashboard

Last updated: 2026-10-28

## Pinned
- Current app: `claude/index.html` (serve repo root: `python3 -m http.server 8080` → http://localhost:8080/claude/)
- Self-test (no mic): `python3 claude/test/verify_harmony.py` (pipx `playwright` 1.57, Chromium)
- Test-mode URL params: `?input=tone&freq=220&autostart=1&key=C&scale=major&mode=thirds&engine=stretch|granular&blockMs=60`
- Intent: `PROMPT.md` (2025-12-08) — "sing a harmony with you ... just like a human backup singer and/or a choir"
- Research + status: `REQUIREMENTS.md`
- Vendored engine: `claude/vendor/SignalsmithStretch.js` (MIT, 1.3.2, local patch documented in `claude/vendor/README.md`)
- Beads: tmpworkspace `AIB-dg0`
- Earlier lineage (all fixed-interval, superseded): `~/code/VocalHarmony` (Jan 2025 Replit), `~/code/harmonizerSonnet37`, `~/code/AudioHarmonySync2`, `~/code/HarmonyBot3` (Feb 2025), `~/code/Replit/projects/VocalHarmony-1` tarball (Sept 2025 React/Replit, published URL now 404)

## Current session (2026-10-28)
- Fixed "harmony blinks in and out on a sustained note": octave-robust YIN + continuity, gate opens on any voiced non-pure-tone input with 600 ms hold, HP 70 Hz, guard never notches recent voice harmonics. New rigs: `test/aec_doubletalk_fake_mic.py` (fake-mic WAV, AEC on), `test/sustained_tone_realistic.py` (real speakers). Verified stable; Chrome AEC does not suppress the singer because of our output.
- Backing option: piano / pad / voice+piano playing harmony voices or in-key chords (`chordForNote`), instrument note on/off follows voice presence. Headless suite extended.
- Speaker-safe mode shipped: AEC (AGC off after measuring 12 dB → 59 dB cancellation), dry mute, harmony gate, HP/LP, limiter, automatic feedback-guard notch bank. Headphone/Speakers toggle restarts the audio graph.
- Record & Debug: input(L)+output(R) .webm recording and JSON event log, `?record=1`, `?log=1`.
- `claude/test/aec_realistic.py` (real mic/speakers via installed Chrome) and `verify_harmony.py` now 38/38.
- Served on the M5 from tmux session `harmony` at http://localhost:8471/claude/ .
- Pushed older harmony repos (VocalHarmony, AudioHarmonySync2 `o3-attempt`, harmonizerSonnet37, HarmonyBot3 new private repo).

## Previous session (2026-10-27)
- Audited all seven attempts. Root cause they never "nailed it": every one pitch-shifts by a fixed semitone count; detected pitch and the Key/Scale buttons were display-only, so thirds go out of key half the time, plus Tone.PitchShift is ~30 cents flat on downward shifts.
- Rewrote `claude/harmony-app.js`: diatonic scale-degree harmony from the detected note, manual root or Krumhansl-Kessler auto key, Signalsmith Stretch formant-preserving engine (default) with granular fallback, per-voice output taps, test-tone input.
- Added `claude/test/verify_harmony.py`: 29/29 checks pass headlessly.

## Open questions
- **Piano vs pad vs voice as the default backing when on speakers?** Instruments are the feedback-safe choice; voice is the original intent. Default stays voice.
- **Does speaker mode hold up with real singing at living-room volume?** Measured with a tone only. If it howls, Record (input L / output R) + Save debug log and attach; the log shows gate/notch events and the pre-guard spectrum peaks.
- **Which engine sounds better on a real voice?** Numbers favour Signalsmith (in tune, 60 ms); only ears can judge formant/vowel quality. Open http://localhost:8080/claude/ with headphones and A/B the Engine dropdown.
- **Auto key vs manual key as the default?** Auto needs ~1 s of singing before it commits; manual is instant. Default is Auto.

## Open threads
- Jacob's own blinking session was not logged (no Save-debug-log click). If it recurs on the new build: Record + Save debug log, files land in ~/Downloads as harmony-*.webm / harmony-log-*.json.
- Not yet listened to by a human (pitch and cancellation verified programmatically only).
- Speaker mode still relies on browser echo cancellation; `claude/SPEEX_AEC_PLAN.md` is the WASM AEC plan if feedback is still a problem.
- `codex/` (PESTO ONNX + SoundTouch) needs a gated model download and was never run; `gemini/harmony_app` is a native Python/pedalboard variant with fixed intervals.
- Companion-agent / VA3 co-regulation idea ("sing with the user", 2026-10-28 notes) could reuse this engine.

## Recently shipped
- 2026-10-28 — instrumental backing (piano/pad, voices or chords).
- 2026-10-28 — speaker-safe mode (AEC without AGC, gate, feedback-guard notches), recording + debug log, realistic AEC test.
- 2026-10-27 — key-aware harmony + Signalsmith engine + headless verification (`claude/`).
- 2025-12-11 — just-intonation tuning for PianoDuet; codex/gemini variants.
- 2025-12-08 — Harmony Singer with rich modes, chorus, speaker mode.
