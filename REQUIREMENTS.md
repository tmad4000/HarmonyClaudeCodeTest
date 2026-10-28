# Harmony Singing App - Requirements & Research

**Date:** 2025-12-08

## Overview

A web-based app that listens to your singing and generates real-time harmonies like a human backup singer or choir.

---

## Research Summary: Best Libraries

### Pitch Detection Libraries

| Library | Language | Algorithm | Pros | Cons |
|---------|----------|-----------|------|------|
| **[Pitchy](https://github.com/ianprime0509/pitchy)** | JS/TS | McLeod Pitch Method | Fast, accurate, pure JS, ES module | ESM-only |
| **[Pitchfinder](https://github.com/peterkhayes/pitchfinder)** | JS | YIN, AMDF, Dynamic Wavelet | Multiple algorithms, browser + Node | Older |
| **[ml5.js + CREPE](https://github.com/ml5js/ml5-library)** | JS | Deep CNN | Very accurate, handles poor audio | Requires model loading, slower |
| **[PitchDetect](https://github.com/cwilso/PitchDetect)** | JS | Autocorrelation | Simple, works with Web Audio API | Basic implementation |
| **[Aubio](https://aubio.org/)** | Python/C | YIN, MPM | Industry standard, very accurate | Requires Python or WASM |

**Recommendation:** Use **Pitchy** for real-time browser performance with McLeod Pitch Method.

---

### Audio Synthesis & Pitch Shifting Libraries

| Library | Language | Features | Pros | Cons |
|---------|----------|----------|------|------|
| **[Tone.js](https://tonejs.github.io/)** | JS | Full DAW, PitchShift, Synths | Complete framework, well-documented | Large bundle size |
| **[SoundTouchJS](https://github.com/cutterbl/SoundTouchJS)** | JS | Time-stretch, pitch-shift | Good quality | Higher latency (~100ms) |
| **[Kali](https://github.com/Infinity/Kali)** | JS | WSOLA time-stretching | High quality | Limited features |
| **Web Audio API** | Native | OscillatorNode, GainNode | Native, no dependencies | Lower-level, more work |

**Recommendation:** Use **Tone.js** for rich audio synthesis with built-in PitchShift effect.

---

### Voice/Vocal Processing

| Library | Features | Notes |
|---------|----------|-------|
| **Tone.js PitchShift** | Shift pitch by semitones | Real-time, but may have artifacts |
| **Web Audio GainNode** | Volume control per voice | Essential for mixing harmony voices |
| **Web Audio PannerNode** | Stereo positioning | Create choir spread effect |

---

## Technical Architecture

### Chosen Stack
- **Frontend:** HTML5 + Vanilla JS (for simplicity and portability)
- **Pitch Detection:** Pitchy (McLeod Pitch Method)
- **Audio Synthesis:** Tone.js (PitchShift + oscillators)
- **Audio Capture:** Web Audio API (MediaStreamAudioSourceNode)

### Core Flow
```
Microphone Input
      │
      ▼
┌─────────────────┐
│  Web Audio API  │
│  (Capture)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Pitch Detect   │
│  (Pitchy)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Harmony Calc   │
│  (Music Theory) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│        Tone.js Synthesis         │
├──────────┬──────────┬───────────┤
│ Voice 1  │ Voice 2  │ Voice 3   │
│ (3rd up) │ (5th up) │ (Octave)  │
└──────────┴──────────┴───────────┘
         │
         ▼
┌─────────────────┐
│   Audio Output  │
│   (Speakers)    │
└─────────────────┘
```

---

## Harmony Generation Rules

### Interval Options (from root note)
- **Major 3rd:** +4 semitones (sweet, bright harmony)
- **Minor 3rd:** +3 semitones (darker harmony)
- **Perfect 5th:** +7 semitones (powerful, open)
- **Octave:** +12 or -12 semitones (choir doubling)
- **Major 6th:** +9 semitones (classic backup singer)

### Chord-Based Harmony Modes
1. **Duet Mode:** One harmony voice (typically 3rd or 6th above)
2. **Trio Mode:** Two harmony voices (3rd + 5th)
3. **Choir Mode:** Three+ voices (3rd, 5th, octave, with stereo spread)

---

## Features

### MVP Features
- [x] Real-time microphone capture
- [x] Pitch detection with visual feedback
- [x] Configurable harmony intervals
- [x] Adjustable harmony volume/mix
- [x] Start/stop control

### Enhanced Features
- [x] Multiple harmony voices (choir mode) — `claude/`, 2025-12-08
- [ ] Stereo panning for choir spread
- [x] Key/scale detection for smarter harmonies — `claude/`, 2026-10-27 (diatonic degree intervals + Krumhansl-Kessler auto key)
- [~] Latency: Signalsmith Stretch engine at 60 ms block (measured 60 ms) vs 100 ms granular — 2026-10-27
- [ ] Recording/playback

---

## Sources

- [Pitchy - GitHub](https://github.com/ianprime0509/pitchy)
- [Tone.js - Official](https://tonejs.github.io/)
- [Tone.js PitchShift Docs](https://tonejs.github.io/docs/PitchShift)
- [Web Audio API Tutorial](https://alexanderell.is/posts/tuner/)
- [ml5.js CREPE Model](https://github.com/ml5js/ml5-data-and-models/tree/master/models/pitch-detection/crepe)
- [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS)
- [Pitchfinder](https://github.com/peterkhayes/pitchfinder)
- [Aubio](https://aubio.org/)

---

## Verification (2026-10-27)

`claude/test/verify_harmony.py` drives the app headlessly with a synthetic sawtooth "voice" and reads
the pitch at each harmony voice's output tap. 29 checks pass: theory unit tests, C/D major, chromatic,
runtime key switch, Classic Choir SATB, both engines, and auto key detection over a sung C-major scale.

| Engine | Upper 3rd error | Lower 3rd error | Reported latency |
|---|---|---|---|
| Signalsmith Stretch (default) | +3 to +4 cents | 0 to +2 cents | 60 ms |
| Tone.js PitchShift (granular) | +5 to +6 cents | −28 to −34 cents | 100 ms |

Tone.js `PitchShift` is audibly flat on downward shifts, which is one reason every earlier attempt
(VocalHarmony Jan 2025, harmonizerSonnet37, AudioHarmonySync2, VocalHarmony-1 Sept 2025) sounded off.
