# Speex AEC (Acoustic Echo Cancellation) Implementation Plan

## Why Speex AEC?

The browser's built-in `echoCancellation` option works reasonably well but has limitations:
- Quality varies significantly between browsers and devices
- It's a black box - no control over parameters
- May introduce artifacts or degrade audio quality
- Not designed specifically for musical applications

Speex AEC provides **true acoustic echo cancellation** by knowing exactly what signal is being played through the speakers and subtracting it from the microphone input.

## How Speex AEC Works

1. **Far-end signal**: The audio being played through speakers (harmonies, reverb output)
2. **Near-end signal**: The raw microphone input (your voice + echo of far-end)
3. **AEC processing**: Speex estimates the acoustic path from speaker to mic and removes the echo
4. **Output**: Clean voice signal without the speaker bleed

```
[Your Voice] ----+
                 |
                 v
[Microphone] --> [Speex AEC] --> [Clean Signal] --> [Pitch Detection/Harmonies]
                     ^
                     |
[Speaker Output] ----+ (reference signal)
```

## Implementation Steps

### Phase 1: Compile SpeexDSP to WebAssembly

1. **Get SpeexDSP source**
   ```bash
   git clone https://github.com/xiph/speexdsp.git
   ```

2. **Set up Emscripten**
   ```bash
   # Install Emscripten SDK
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh
   ```

3. **Create WASM build configuration**
   - Export these functions:
     - `speex_echo_state_init(frame_size, filter_length)`
     - `speex_echo_cancellation(echo_state, input_frame, echo_frame, output_frame)`
     - `speex_echo_state_destroy(echo_state)`
     - `speex_preprocess_state_init(frame_size, sample_rate)`
     - `speex_preprocess_run(preprocess_state, audio_frame)`

4. **Compile with Emscripten**
   ```bash
   emcc -O3 \
     -s WASM=1 \
     -s MODULARIZE=1 \
     -s EXPORT_NAME="SpeexModule" \
     -s EXPORTED_FUNCTIONS="['_speex_echo_state_init', '_speex_echo_cancellation', ...]" \
     -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap', 'setValue', 'getValue']" \
     speexdsp/libspeexdsp/*.c \
     -o speex-aec.js
   ```

### Phase 2: Create JavaScript Wrapper

```javascript
class SpeexAEC {
    constructor(frameSize = 256, filterLength = 2048, sampleRate = 48000) {
        this.frameSize = frameSize;
        this.filterLength = filterLength;
        this.sampleRate = sampleRate;
        this.echoState = null;
        this.preprocessState = null;
    }

    async init() {
        this.module = await SpeexModule();

        // Allocate memory for audio buffers
        this.inputPtr = this.module._malloc(this.frameSize * 2);  // 16-bit samples
        this.echoPtr = this.module._malloc(this.frameSize * 2);
        this.outputPtr = this.module._malloc(this.frameSize * 2);

        // Initialize echo canceller
        this.echoState = this.module._speex_echo_state_init(
            this.frameSize,
            this.filterLength
        );

        // Initialize preprocessor (noise suppression)
        this.preprocessState = this.module._speex_preprocess_state_init(
            this.frameSize,
            this.sampleRate
        );
    }

    process(inputSamples, echoSamples) {
        // Copy input samples to WASM memory
        this.module.HEAP16.set(inputSamples, this.inputPtr / 2);
        this.module.HEAP16.set(echoSamples, this.echoPtr / 2);

        // Run echo cancellation
        this.module._speex_echo_cancellation(
            this.echoState,
            this.inputPtr,
            this.echoPtr,
            this.outputPtr
        );

        // Run noise suppression
        this.module._speex_preprocess_run(this.preprocessState, this.outputPtr);

        // Return processed samples
        return new Int16Array(
            this.module.HEAP16.buffer,
            this.outputPtr,
            this.frameSize
        ).slice();
    }

    destroy() {
        if (this.echoState) {
            this.module._speex_echo_state_destroy(this.echoState);
        }
        if (this.preprocessState) {
            this.module._speex_preprocess_state_destroy(this.preprocessState);
        }
        this.module._free(this.inputPtr);
        this.module._free(this.echoPtr);
        this.module._free(this.outputPtr);
    }
}
```

### Phase 3: Integrate with AudioWorklet

For low-latency processing, use an AudioWorklet:

```javascript
// speex-aec-processor.js
class SpeexAECProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.speexAEC = null;
        this.port.onmessage = this.handleMessage.bind(this);
    }

    async handleMessage(event) {
        if (event.data.type === 'init') {
            // Initialize Speex in the worklet
            this.speexAEC = new SpeexAEC();
            await this.speexAEC.init();
        }
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0][0];  // Mic input
        const echo = inputs[1][0];   // Speaker output (loopback)
        const output = outputs[0][0];

        if (this.speexAEC && input && echo) {
            // Convert Float32 to Int16
            const inputInt16 = this.floatToInt16(input);
            const echoInt16 = this.floatToInt16(echo);

            // Process through Speex AEC
            const cleanInt16 = this.speexAEC.process(inputInt16, echoInt16);

            // Convert back to Float32
            const cleanFloat = this.int16ToFloat(cleanInt16);
            output.set(cleanFloat);
        } else if (input) {
            output.set(input);
        }

        return true;
    }

    floatToInt16(floatArray) {
        const int16 = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, floatArray[i] * 32768));
        }
        return int16;
    }

    int16ToFloat(int16Array) {
        const float32 = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32[i] = int16Array[i] / 32768;
        }
        return float32;
    }
}

registerProcessor('speex-aec-processor', SpeexAECProcessor);
```

### Phase 4: Audio Routing Changes

The key challenge is getting the "far-end" signal (what's playing through speakers) to the AEC:

```javascript
// In harmony-app.js

async setupSpeexAEC() {
    // Create AudioWorklet for Speex processing
    await this.audioContext.audioWorklet.addModule('speex-aec-processor.js');
    this.speexProcessor = new AudioWorkletNode(this.audioContext, 'speex-aec-processor');

    // Create a MediaStreamDestination to capture speaker output
    this.speakerCapture = this.audioContext.createMediaStreamDestination();
    this.speakerCaptureSource = this.audioContext.createMediaStreamSource(this.speakerCapture.stream);

    // Route speaker output to both speakers AND the AEC reference input
    this.masterGain.connect(this.audioContext.destination);  // To speakers
    this.masterGain.connect(this.speakerCapture);            // To AEC reference

    // Route mic through AEC before processing
    // Input 0: Mic, Input 1: Speaker reference
    this.micSource.connect(this.speexProcessor, 0, 0);
    this.speakerCaptureSource.connect(this.speexProcessor, 0, 1);

    // AEC output goes to rest of chain
    this.speexProcessor.connect(this.mic);
}
```

## Key Considerations

### Latency
- Speex AEC adds ~10-20ms latency
- Must account for system audio latency (speaker + mic)
- May need to adjust `filter_length` based on room acoustics

### Sample Rate Matching
- Ensure mic and speaker output use the same sample rate
- Speex supports: 8kHz, 16kHz, 32kHz, 48kHz

### Frame Size
- Smaller frames = lower latency but more CPU
- Typical: 128-512 samples per frame
- Must match between all audio nodes

### Filter Length
- Longer = handles more echo delay but more CPU
- Typical: 1024-4096 samples
- For ~50ms echo at 48kHz, need ~2400 samples

## Resources

- [SpeexDSP GitHub](https://github.com/xiph/speexdsp)
- [Speex Echo Cancellation Docs](https://www.speex.org/docs/api/speex-api-reference/group__SpeexEchoState.html)
- [Emscripten Documentation](https://emscripten.org/docs/)
- [AudioWorklet API](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)

## Alternative: Pre-built Libraries

If compiling Speex is too complex, consider:

1. **@nicholaslee119/echo-cancellation** - Pre-built WebRTC AEC
2. **Commercial SDKs** - Krisp, agora.io have browser SDKs
3. **WebRTC Insertable Streams** - May expose AEC in future Chrome versions

## Timeline Estimate

- Phase 1 (WASM compile): Research + setup
- Phase 2 (JS wrapper): Implementation
- Phase 3 (AudioWorklet): Integration
- Phase 4 (Testing): Tuning parameters for best quality

This is a significant undertaking but would provide professional-grade echo cancellation for the harmony app.
