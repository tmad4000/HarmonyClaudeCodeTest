/**
 * Harmony Singer - Real-time vocal harmony generator
 * Uses Web Audio API for capture, custom pitch detection, and Tone.js for synthesis
 */

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Harmony intervals in semitones
const HARMONY_MODES = {
    duet: [4],           // Major 3rd up
    trio: [4, 7],        // Major 3rd + Perfect 5th
    choir: [4, 7, 12],   // Major 3rd + Perfect 5th + Octave
    octave: [12, -12]    // Octave up and down
};

class HarmonySinger {
    constructor() {
        this.isRunning = false;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.pitchDetector = null;

        // Tone.js components
        this.harmonySynths = [];
        this.pitchShifters = [];
        this.reverb = null;
        this.micInput = null;
        this.gain = null;

        // Settings
        this.currentMode = 'duet';
        this.harmonyVolume = 0.7;
        this.wetMix = 0.5;
        this.reverbAmount = 0.3;
        this.sensitivity = 0.5;
        this.passthrough = true;
        this.useSynth = false;

        // Pitch detection
        this.bufferSize = 2048;
        this.sampleRate = 44100;

        // Visualization
        this.visualizerCanvas = document.getElementById('visualizer');
        this.visualizerCtx = this.visualizerCanvas.getContext('2d');

        this.setupEventListeners();
        this.resizeCanvas();
    }

    setupEventListeners() {
        // Start button
        document.getElementById('startBtn').addEventListener('click', () => this.toggle());

        // Mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setMode(e.target.dataset.mode));
        });

        // Sliders
        this.setupSlider('harmonyVolume', (v) => {
            this.harmonyVolume = v / 100;
            this.updateHarmonyVolumes();
        });

        this.setupSlider('wetMix', (v) => {
            this.wetMix = v / 100;
            this.updateMix();
        });

        this.setupSlider('reverb', (v) => {
            this.reverbAmount = v / 100;
            this.updateReverb();
        });

        this.setupSlider('sensitivity', (v) => {
            this.sensitivity = v / 100;
        });

        // Checkboxes
        document.getElementById('passthrough').addEventListener('change', (e) => {
            this.passthrough = e.target.checked;
            this.updateMix();
        });

        document.getElementById('useSynth').addEventListener('change', (e) => {
            this.useSynth = e.target.checked;
        });

        // Resize handler
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    setupSlider(id, callback) {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(id + 'Val');

        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            valueDisplay.textContent = value + '%';
            callback(value);
        });
    }

    resizeCanvas() {
        const canvas = this.visualizerCanvas;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        this.visualizerCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    setMode(mode) {
        this.currentMode = mode;

        // Update UI
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Show/hide voice indicators
        const intervals = HARMONY_MODES[mode];
        document.getElementById('voice1').style.display = intervals.length >= 1 ? 'block' : 'none';
        document.getElementById('voice2').style.display = intervals.length >= 2 ? 'block' : 'none';
        document.getElementById('voice3').style.display = intervals.length >= 3 ? 'block' : 'none';

        // Update pitch shifters if running
        if (this.isRunning) {
            this.updatePitchShifters();
        }
    }

    async toggle() {
        if (this.isRunning) {
            this.stop();
        } else {
            await this.start();
        }
    }

    async start() {
        try {
            this.setStatus('Requesting microphone access...');

            // Start Tone.js
            await Tone.start();

            // Get microphone stream
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.setStatus('Setting up audio...');

            // Create audio context for analysis
            this.audioContext = new AudioContext();
            this.sampleRate = this.audioContext.sampleRate;

            // Create analyser for pitch detection
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.bufferSize * 2;

            // Connect microphone to analyser
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            // Setup Tone.js for harmony generation
            await this.setupToneJS(stream);

            // Start pitch detection loop
            this.isRunning = true;
            this.detectPitch();

            // Update UI
            const btn = document.getElementById('startBtn');
            btn.textContent = 'Stop';
            btn.classList.remove('stopped');
            btn.classList.add('running');
            this.setStatus('Listening... Sing something!');

        } catch (error) {
            console.error('Error starting:', error);
            this.setStatus('Error: ' + error.message, true);
        }
    }

    async setupToneJS(stream) {
        // Create input from microphone stream
        this.micInput = Tone.context.createMediaStreamSource(stream);

        // Create reverb
        this.reverb = new Tone.Reverb({
            decay: 2.5,
            wet: this.reverbAmount
        }).toDestination();
        await this.reverb.generate();

        // Create gain for passthrough
        this.passthroughGain = new Tone.Gain(this.passthrough ? this.wetMix : 0);
        this.passthroughGain.connect(this.reverb);

        // Connect mic to passthrough
        Tone.connect(this.micInput, this.passthroughGain);

        // Create pitch shifters for each harmony voice
        this.setupPitchShifters();
    }

    setupPitchShifters() {
        // Clean up existing
        this.pitchShifters.forEach(ps => ps.dispose());
        this.harmonySynths.forEach(s => s.dispose());
        this.pitchShifters = [];
        this.harmonySynths = [];

        const intervals = HARMONY_MODES[this.currentMode];

        intervals.forEach((semitones, i) => {
            // Create pitch shifter
            const shifter = new Tone.PitchShift({
                pitch: semitones,
                windowSize: 0.1,
                delayTime: 0,
                feedback: 0
            });

            // Create gain for this voice
            const gain = new Tone.Gain(this.harmonyVolume * this.wetMix);

            shifter.connect(gain);
            gain.connect(this.reverb);

            // Connect mic to pitch shifter
            Tone.connect(this.micInput, shifter);

            this.pitchShifters.push({ shifter, gain, semitones });

            // Also create synth voice as alternative
            const synth = new Tone.Synth({
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.1,
                    decay: 0.2,
                    sustain: 0.8,
                    release: 0.5
                }
            });

            const synthGain = new Tone.Gain(0); // Start muted
            synth.connect(synthGain);
            synthGain.connect(this.reverb);

            this.harmonySynths.push({ synth, gain: synthGain, semitones });
        });
    }

    updatePitchShifters() {
        this.setupPitchShifters();
    }

    updateHarmonyVolumes() {
        this.pitchShifters.forEach(ps => {
            ps.gain.gain.value = this.harmonyVolume * this.wetMix;
        });
        this.harmonySynths.forEach(s => {
            s.gain.gain.value = this.useSynth ? this.harmonyVolume * this.wetMix : 0;
        });
    }

    updateMix() {
        if (this.passthroughGain) {
            this.passthroughGain.gain.value = this.passthrough ? (1 - this.wetMix * 0.5) : 0;
        }
        this.updateHarmonyVolumes();
    }

    updateReverb() {
        if (this.reverb) {
            this.reverb.wet.value = this.reverbAmount;
        }
    }

    stop() {
        this.isRunning = false;

        // Cleanup audio
        if (this.microphone) {
            this.microphone.disconnect();
        }
        if (this.audioContext) {
            this.audioContext.close();
        }

        // Cleanup Tone.js
        this.pitchShifters.forEach(ps => {
            ps.shifter.dispose();
            ps.gain.dispose();
        });
        this.harmonySynths.forEach(s => {
            s.synth.dispose();
            s.gain.dispose();
        });
        if (this.reverb) this.reverb.dispose();
        if (this.passthroughGain) this.passthroughGain.dispose();

        this.pitchShifters = [];
        this.harmonySynths = [];

        // Update UI
        const btn = document.getElementById('startBtn');
        btn.textContent = 'Start Singing';
        btn.classList.remove('running');
        btn.classList.add('stopped');

        document.getElementById('currentNote').textContent = '--';
        document.getElementById('frequency').textContent = 'Click Start to begin';
        document.getElementById('clarityFill').style.width = '0%';

        this.setStatus('Stopped');
    }

    detectPitch() {
        if (!this.isRunning) return;

        // Get time domain data
        const buffer = new Float32Array(this.analyser.fftSize);
        this.analyser.getFloatTimeDomainData(buffer);

        // Detect pitch using autocorrelation
        const result = this.autoCorrelate(buffer, this.sampleRate);

        // Draw visualizer
        this.drawVisualizer(buffer);

        if (result.frequency > 0 && result.clarity > (0.5 - this.sensitivity * 0.4)) {
            const note = this.frequencyToNote(result.frequency);

            // Update main display
            document.getElementById('currentNote').textContent = note.name + note.octave;
            document.getElementById('frequency').textContent = `${result.frequency.toFixed(1)} Hz`;
            document.getElementById('clarityFill').style.width = (result.clarity * 100) + '%';

            // Update harmony voice displays
            this.updateHarmonyDisplays(result.frequency, note);

            // Trigger synth voices if enabled
            if (this.useSynth) {
                this.triggerSynthHarmonies(result.frequency);
            }
        } else {
            document.getElementById('clarityFill').style.width = (result.clarity * 100) + '%';
        }

        // Continue loop
        requestAnimationFrame(() => this.detectPitch());
    }

    autoCorrelate(buffer, sampleRate) {
        // Find the RMS of the signal
        let rms = 0;
        for (let i = 0; i < buffer.length; i++) {
            rms += buffer[i] * buffer[i];
        }
        rms = Math.sqrt(rms / buffer.length);

        // Not enough signal
        if (rms < 0.01) {
            return { frequency: -1, clarity: 0 };
        }

        // Autocorrelation
        const correlations = new Array(buffer.length).fill(0);

        for (let lag = 0; lag < buffer.length; lag++) {
            let sum = 0;
            for (let i = 0; i < buffer.length - lag; i++) {
                sum += buffer[i] * buffer[i + lag];
            }
            correlations[lag] = sum;
        }

        // Find the first peak after the initial decline
        let foundPeak = false;
        let peakLag = 0;
        let peakValue = 0;

        // Skip the first part where correlation is always high
        const minLag = Math.floor(sampleRate / 1000); // ~1000 Hz max
        const maxLag = Math.floor(sampleRate / 60);   // ~60 Hz min

        for (let lag = minLag; lag < maxLag && lag < correlations.length; lag++) {
            if (correlations[lag] > peakValue) {
                peakValue = correlations[lag];
                peakLag = lag;
                foundPeak = true;
            }
        }

        if (!foundPeak || peakLag === 0) {
            return { frequency: -1, clarity: 0 };
        }

        // Parabolic interpolation for more accurate peak
        const y1 = correlations[peakLag - 1] || 0;
        const y2 = correlations[peakLag];
        const y3 = correlations[peakLag + 1] || 0;

        const a = (y1 + y3 - 2 * y2) / 2;
        const b = (y3 - y1) / 2;

        let refinedLag = peakLag;
        if (a !== 0) {
            refinedLag = peakLag - b / (2 * a);
        }

        const frequency = sampleRate / refinedLag;
        const clarity = peakValue / correlations[0]; // Normalize

        return { frequency, clarity: Math.min(1, Math.max(0, clarity)) };
    }

    frequencyToNote(frequency) {
        // A4 = 440 Hz
        const semitones = 12 * Math.log2(frequency / 440);
        const noteNum = Math.round(semitones) + 69; // MIDI note number
        const octave = Math.floor(noteNum / 12) - 1;
        const noteIndex = ((noteNum % 12) + 12) % 12;

        return {
            name: NOTE_NAMES[noteIndex],
            octave: octave,
            midi: noteNum,
            cents: Math.round((semitones - Math.round(semitones)) * 100)
        };
    }

    noteToFrequency(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    updateHarmonyDisplays(frequency, note) {
        const intervals = HARMONY_MODES[this.currentMode];

        intervals.forEach((semitones, i) => {
            const harmonyMidi = note.midi + semitones;
            const harmonyNote = this.frequencyToNote(this.noteToFrequency(harmonyMidi));

            const voiceEl = document.getElementById(`voice${i + 1}`);
            if (voiceEl) {
                voiceEl.querySelector('.voice-note').textContent = harmonyNote.name + harmonyNote.octave;
                voiceEl.classList.add('active');

                // Remove active class after a short delay
                setTimeout(() => voiceEl.classList.remove('active'), 100);
            }
        });
    }

    triggerSynthHarmonies(frequency) {
        const intervals = HARMONY_MODES[this.currentMode];

        this.harmonySynths.forEach((s, i) => {
            if (i < intervals.length) {
                const harmonyFreq = frequency * Math.pow(2, intervals[i] / 12);
                s.synth.triggerAttack(harmonyFreq, Tone.now());
                s.gain.gain.value = this.harmonyVolume * this.wetMix;
            }
        });
    }

    drawVisualizer(buffer) {
        const canvas = this.visualizerCanvas;
        const ctx = this.visualizerCtx;
        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;

        // Clear
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, width, height);

        // Draw waveform
        ctx.beginPath();
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;

        const sliceWidth = width / buffer.length;
        let x = 0;

        for (let i = 0; i < buffer.length; i++) {
            const v = buffer[i];
            const y = (v * 0.5 + 0.5) * height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();
    }

    setStatus(message, isError = false) {
        const status = document.getElementById('status');
        status.textContent = message;
        status.classList.toggle('error', isError);
    }
}

// Initialize app when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.harmonySinger = new HarmonySinger();
});
