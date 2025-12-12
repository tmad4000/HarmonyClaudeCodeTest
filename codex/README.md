# Harmony Buddy (web MVP)

Sing into your mic and hear a live harmony voice. This MVP uses:

- `onnxruntime-web` for streaming pitch detection with the PESTO ONNX model.
- `@soundtouchjs/audio-worklet` for low-latency pitch shifting (one harmony lane).
- Web Audio API + AudioWorklet to stay under ~40 ms round-trip.

## Run it

```bash
cd /Users/jacobcole/code/HarmonyClaudeCodeTest/codex
python3 -m http.server 5173
```

Open http://localhost:5173 in a Chromium-based browser, click **Start**, and grant mic access.

## Configure the PESTO model

The app now expects a local file at `models/mir-1k_g7_44100_1024.onnx` (same-origin avoids CORS/gated downloads).

Two ways to get it:

1) If you have a Hugging Face token for `mbarnes/pesto-onnx`:
   ```bash
   huggingface-cli download mbarnes/pesto-onnx --include "mir-1k_g7_44100_1024.onnx*" --local-dir models
   ```
   This grabs the `.onnx` plus any external `.onnx.data` shard if present.

2) Build it yourself from source:
   ```bash
   git clone https://github.com/SonyCSLParis/pesto.git
   cd pesto
   pip install -e .
   python -m realtime.export_onnx --checkpoint mir-1k_g7 --sample-rate 44100 --window 1024 --output /path/to/your/app/models/mir-1k_g7_44100_1024.onnx
   ```
   The exported file will embed weights; no external data file needed.

If you rename or relocate the model, update `PESTO_MODEL_URL` near the top of `src/main.js`.

## Controls

- Interval: choose harmony interval in semitones.
- Harmony Mix: level of the shifted voice.
- Formant offset: small rate/tempo skew to emulate formant shift.
- Dry level: original voice level.

## Notes

- The first run will fetch onnxruntime WASM binaries (~1 MB), the SoundTouch worklet (~40 KB), and the PESTO ONNX model.
- Latency budget targets: 256-sample hop at 48 kHz is ~5.3 ms; keep the audio context on “interactive”.
