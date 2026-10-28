# Harmony Singer

A real-time vocal harmony generator that acts as your personal AI backup singer or choir. Sing into your microphone and hear harmonies generated in real-time!

> **Current version: [`claude/`](claude/)** — key-aware harmonies (diatonic thirds/fifths/sixths and
> 4-voice choir voicings computed from the detected note inside the selected or auto-detected key),
> formant-preserving Signalsmith Stretch engine (Tone.js granular as fallback), speaker-mode echo
> cancellation, and a mic-free self-test. Run `python3 -m http.server 8080` here and open
> http://localhost:8080/claude/ . Verify without a microphone: `python3 claude/test/verify_harmony.py`
> (needs the `playwright` Python package with Chromium). The root `index.html`/`app.js` below is the
> original 2025-12-08 prototype and is kept for reference.
>
> **Laptop open, no headphones?** Flip the Headphones/Speakers toggle. Speaker mode turns on Chrome's
> echo cancellation (measured 59 dB of cancellation on the M5 built-in mic once auto-gain is off),
> mutes your own voice in the output, only lets the harmonies sound while you are actually singing,
> and runs a feedback guard that notches any howl it hears building up. **Record & Debug** captures
> input (L) + output (R) as .webm and saves a JSON log of notes, shifts, key, gate and notch events.

## Features

- **Real-time pitch detection** using autocorrelation algorithm
- **Multiple harmony modes:**
  - **Duet** - Adds a major 3rd harmony above your voice
  - **Trio** - Adds major 3rd + perfect 5th harmonies
  - **Choir** - Full harmony with 3rd, 5th, and octave
  - **Octave Double** - Doubles your voice an octave above and below
- **Adjustable settings:**
  - Harmony volume
  - Dry/wet mix
  - Reverb amount
  - Detection sensitivity
- **Real-time visualization** of your voice waveform
- **Pass-through option** to hear your original voice mixed with harmonies

## Running the App

### Option 1: Simple HTTP Server (Python)

```bash
cd /Users/jacobcole/code/HarmonyClaudeCodeTest
python3 -m http.server 8080
```

Then open http://localhost:8080 in your browser.

### Option 2: Using Node.js

```bash
npx serve .
```

### Option 3: VS Code Live Server

If you have VS Code with the Live Server extension, right-click `index.html` and select "Open with Live Server".

## Usage

1. Click **"Start Singing"** to begin
2. Allow microphone access when prompted
3. Sing into your microphone
4. Hear the harmonies generated in real-time!
5. Adjust settings to customize your sound:
   - Choose a harmony mode (Duet, Trio, Choir, Octave)
   - Adjust the harmony volume
   - Control the dry/wet mix
   - Add reverb for a more natural sound

## Technical Details

### Libraries Used

- **[Tone.js](https://tonejs.github.io/)** - Web Audio framework for synthesis and pitch shifting
- **Web Audio API** - Native browser API for audio capture and analysis

### Pitch Detection

The app uses an **autocorrelation-based pitch detection algorithm** that:
1. Captures audio from your microphone
2. Analyzes the waveform to find repeating patterns
3. Calculates the fundamental frequency
4. Converts frequency to musical note

### Harmony Generation

Harmonies are generated using **Tone.js PitchShift**:
- Real-time pitch shifting without changing tempo
- Multiple voices for different harmony intervals
- Reverb effect for a natural, blended sound

### Intervals Used

| Mode | Intervals (semitones) | Musical Description |
|------|----------------------|---------------------|
| Duet | +4 | Major 3rd above |
| Trio | +4, +7 | Major 3rd + Perfect 5th |
| Choir | +4, +7, +12 | Major 3rd + 5th + Octave |
| Octave | +12, -12 | Octave above and below |

## Browser Support

Works best in:
- Chrome (recommended)
- Firefox
- Edge

Safari may have limited Web Audio API support.

## Tips for Best Results

1. **Use headphones** to prevent feedback
2. **Sing clearly** with good pitch
3. **Reduce background noise** for better detection
4. **Adjust sensitivity** if detection is inconsistent
5. **Start with Duet mode** to get familiar with the harmonies

## Troubleshooting

**No sound?**
- Check that your microphone is connected and allowed
- Make sure your browser isn't muting the page
- Try refreshing and clicking "Start Singing" again

**Harmonies sound choppy?**
- Increase the sensitivity slider
- Sing more sustained notes
- Reduce background noise

**Latency issues?**
- Use Chrome for best performance
- Close other audio applications
- Try reducing the reverb amount
