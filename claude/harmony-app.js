/**
 * Harmony Singer - Real-time AI Backup Vocalist
 * Uses Tone.js for audio processing and pitch shifting
 * Implements YIN-based pitch detection for accurate note recognition
 */

class HarmonySinger {
    constructor() {
        // Audio nodes
        this.mic = null;
        this.analyser = null;
        this.pitchShifters = {};
        this.gains = {};
        this.reverb = null;
        this.chorus = null;
        this.masterGain = null;
        this.dryGain = null;

        // State
        this.isRunning = false;
        this.currentMode = 'thirds';
        this.currentScale = 'major';
        this.harmonyVolume = 0.7;
        this.dryVolume = 0.8;
        this.reverbAmount = 0.3;
        this.chorusAmount = 0.3;
        this.smoothing = 0.5;
        this.speakerMode = false; // Enable AEC for speaker use (no headphones)
        this.mediaStream = null; // Native MediaStream for AEC control

        // Pitch detection
        this.audioContext = null;
        this.pitchAnalyser = null;
        this.lastPitch = null;
        this.smoothedPitch = null;

        // Choir voice states
        this.choirVoices = {
            soprano: true,
            alto: true,
            tenor: true,
            bass: true
        };

        // Note names for display
        this.noteStrings = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        // Scale intervals (in semitones from root)
        this.scales = {
            major: [0, 2, 4, 5, 7, 9, 11],
            minor: [0, 2, 3, 5, 7, 8, 10],
            chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        };

        // Harmony intervals for different modes
        // Simple two-voice modes (lower/upper)
        this.harmonyModes = {
            unison: { lower: 0, upper: 0 },       // Same tone (doubles your voice)
            thirds: { lower: -3, upper: 4 },      // Minor 3rd down, Major 3rd up
            fifths: { lower: -7, upper: 7 },      // Perfect 5th down/up
            octaves: { lower: -12, upper: 12 },   // Octave down/up
            sixths: { lower: -9, upper: 9 },      // Major 6th (sweet interval)
            power: { lower: -7, upper: 12 },      // Power chord (5th down, octave up) - rock!

            // Four-voice choir modes
            choir: {
                soprano: 12,   // Octave up
                alto: 4,       // Major 3rd up
                tenor: -3,     // Minor 3rd down
                bass: -12      // Octave down
            },
            barbershop: {
                soprano: 7,    // Perfect 5th up
                alto: 4,       // Major 3rd up
                tenor: -5,     // Perfect 4th down
                bass: -12      // Octave down
            },
            gospel: {
                soprano: 7,    // Perfect 5th up
                alto: 3,       // Minor 3rd up (soulful)
                tenor: -4,     // Major 3rd down
                bass: -7       // Perfect 5th down
            },
            jazz: {
                soprano: 11,   // Major 7th up (jazzy!)
                alto: 4,       // Major 3rd up
                tenor: -2,     // Major 2nd down (tension)
                bass: -10      // Minor 7th down
            },
            ethereal: {
                soprano: 7,    // Perfect 5th up
                alto: 12,      // Octave up
                tenor: -5,     // Perfect 4th down
                bass: -12      // Octave down
            },
            close: {
                soprano: 4,    // Major 3rd up
                alto: 2,       // Major 2nd up (very close)
                tenor: -1,     // Minor 2nd down (cluster)
                bass: -3       // Minor 3rd down
            }
        };

        // Harmony position: 'both', 'above', or 'below'
        this.harmonyPosition = 'both';

        this.initUI();
    }

    initUI() {
        // Start button
        document.getElementById('startBtn').addEventListener('click', () => this.toggle());

        // Mode buttons
        document.querySelectorAll('.mode-btn:not(.scale-btn)').forEach(btn => {
            btn.addEventListener('click', (e) => this.setMode(e.target.dataset.mode));
        });

        // Scale buttons
        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setScale(e.target.dataset.scale));
        });

        // Volume sliders
        document.getElementById('harmonyVolume').addEventListener('input', (e) => {
            this.harmonyVolume = e.target.value / 100;
            document.getElementById('volumeValue').textContent = `${e.target.value}%`;
            this.updateGains();
        });

        document.getElementById('dryVolume').addEventListener('input', (e) => {
            this.dryVolume = e.target.value / 100;
            document.getElementById('dryValue').textContent = `${e.target.value}%`;
            this.updateGains();
        });

        document.getElementById('reverbAmount').addEventListener('input', (e) => {
            this.reverbAmount = e.target.value / 100;
            document.getElementById('reverbValue').textContent = `${e.target.value}%`;
            if (this.reverb) {
                this.reverb.wet.value = this.reverbAmount;
            }
        });

        document.getElementById('chorusAmount').addEventListener('input', (e) => {
            this.chorusAmount = e.target.value / 100;
            document.getElementById('chorusValue').textContent = `${e.target.value}%`;
            if (this.chorus) {
                this.chorus.wet.value = this.chorusAmount;
            }
        });

        document.getElementById('smoothing').addEventListener('input', (e) => {
            this.smoothing = e.target.value / 100;
            document.getElementById('smoothValue').textContent = `${e.target.value}%`;
        });

        // Choir voice toggles
        document.querySelectorAll('.toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const voice = e.target.dataset.voice;
                this.choirVoices[voice] = !this.choirVoices[voice];
                e.target.classList.toggle('on', this.choirVoices[voice]);
                this.updateGains();
            });
        });

        // Harmony position buttons (above/below/both)
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setPosition(e.target.dataset.position));
        });

        // Speaker mode toggle (AEC for no headphones)
        const speakerToggle = document.getElementById('speakerModeToggle');
        if (speakerToggle) {
            speakerToggle.addEventListener('click', () => this.toggleSpeakerMode());
        }

        // Initialize canvas
        this.setupCanvas();
    }

    setPosition(position) {
        this.harmonyPosition = position;

        // Update UI
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.position === position);
        });

        // Update gains to reflect new position
        this.updateGains();
    }

    toggleSpeakerMode() {
        this.speakerMode = !this.speakerMode;

        // Update UI
        const toggle = document.getElementById('speakerModeToggle');
        if (toggle) {
            toggle.classList.toggle('on', this.speakerMode);
        }

        const statusText = document.getElementById('speakerModeStatus');
        if (statusText) {
            statusText.textContent = this.speakerMode ? 'Speaker Mode (AEC On)' : 'Headphone Mode';
        }

        // If currently running, need to restart with new audio constraints
        if (this.isRunning) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }
    }

    setupCanvas() {
        this.canvas = document.getElementById('waveform');
        this.canvasCtx = this.canvas.getContext('2d');
        this.canvas.width = this.canvas.offsetWidth * 2;
        this.canvas.height = this.canvas.offsetHeight * 2;
        this.canvasCtx.scale(2, 2);
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
            await Tone.start();

            // Get the underlying audio context
            this.audioContext = Tone.getContext().rawContext;

            // Configure audio constraints based on speaker mode
            const audioConstraints = {
                echoCancellation: this.speakerMode,
                noiseSuppression: this.speakerMode,
                autoGainControl: this.speakerMode,
                // Request specific sample rate for consistency
                sampleRate: this.audioContext.sampleRate
            };

            console.log('Audio constraints:', audioConstraints);

            // Get microphone with native getUserMedia for AEC control
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints
            });

            // Log actual constraints applied
            const track = this.mediaStream.getAudioTracks()[0];
            const settings = track.getSettings();
            console.log('Actual audio settings:', settings);

            // Create a Tone.js source from the native MediaStream
            this.micSource = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Wrap in Tone.js gain for compatibility with Tone routing
            this.mic = new Tone.Gain(1);
            this.micSource.connect(this.mic.input);

            // Create analyser for pitch detection
            this.analyser = new Tone.Analyser('waveform', 2048);

            // Create chorus for richer, more human sound
            this.chorus = new Tone.Chorus({
                frequency: 1.5,      // Slow modulation for natural sound
                delayTime: 3.5,      // ms
                depth: 0.7,
                wet: this.chorusAmount
            });
            this.chorus.start();

            // Create reverb
            this.reverb = new Tone.Reverb({
                decay: 2.5,
                preDelay: 0.01,
                wet: this.reverbAmount
            });
            await this.reverb.generate();

            // Create master gain
            this.masterGain = new Tone.Gain(1);

            // Create dry signal path
            this.dryGain = new Tone.Gain(this.dryVolume);

            // Create pitch shifters for harmonies
            this.createPitchShifters();

            // Connect the audio graph
            // Signal flow: mic -> dryGain -> chorus -> reverb -> masterGain -> output
            this.mic.connect(this.analyser);
            this.mic.connect(this.dryGain);
            this.dryGain.connect(this.chorus);
            this.chorus.connect(this.reverb);
            this.reverb.connect(this.masterGain);
            this.masterGain.toDestination();

            // Connect pitch shifters (harmonies go through chorus too for richness)
            this.connectPitchShifters();

            // Use AnalyserNode for pitch detection
            this.pitchAnalyser = this.audioContext.createAnalyser();
            this.pitchAnalyser.fftSize = 2048;

            // Wrap our native analyser as a Tone node so we can connect to it
            const analyserWrapper = Tone.getContext().createGain();
            analyserWrapper.connect(this.pitchAnalyser);
            this.mic.connect(analyserWrapper);

            this.isRunning = true;
            this.updateUI();
            this.startPitchDetection();
            this.drawWaveform();

        } catch (err) {
            console.error('Error starting:', err);
            document.getElementById('status').textContent = 'Error: ' + err.message;
            document.getElementById('status').className = 'status idle';
        }
    }

    createPitchShifters() {
        // Dispose existing shifters
        Object.values(this.pitchShifters).forEach(ps => ps.dispose());
        Object.values(this.gains).forEach(g => g.dispose());

        this.pitchShifters = {};
        this.gains = {};

        const fourVoiceModes = ['choir', 'barbershop', 'gospel', 'jazz', 'ethereal', 'close'];

        if (fourVoiceModes.includes(this.currentMode)) {
            // Create SATB voices for 4-voice modes
            ['soprano', 'alto', 'tenor', 'bass'].forEach(voice => {
                this.pitchShifters[voice] = new Tone.PitchShift({
                    pitch: this.harmonyModes[this.currentMode][voice],
                    windowSize: 0.1,
                    delayTime: 0,
                    feedback: 0
                });
                this.gains[voice] = new Tone.Gain(this.choirVoices[voice] ? this.harmonyVolume * 0.5 : 0);
            });
        } else {
            // Create simple two-voice harmony
            this.pitchShifters.lower = new Tone.PitchShift({
                pitch: this.harmonyModes[this.currentMode].lower,
                windowSize: 0.1,
                delayTime: 0,
                feedback: 0
            });
            this.pitchShifters.upper = new Tone.PitchShift({
                pitch: this.harmonyModes[this.currentMode].upper,
                windowSize: 0.1,
                delayTime: 0,
                feedback: 0
            });

            this.gains.lower = new Tone.Gain(this.harmonyVolume * 0.6);
            this.gains.upper = new Tone.Gain(this.harmonyVolume * 0.6);
        }
    }

    connectPitchShifters() {
        Object.keys(this.pitchShifters).forEach(key => {
            this.mic.connect(this.pitchShifters[key]);
            this.pitchShifters[key].connect(this.gains[key]);
            // Route harmonies through chorus for richer sound
            this.gains[key].connect(this.chorus);
        });
    }

    updateGains() {
        if (this.dryGain) {
            this.dryGain.gain.value = this.dryVolume;
        }

        const fourVoiceModes = ['choir', 'barbershop', 'gospel', 'jazz', 'ethereal', 'close'];

        Object.keys(this.gains).forEach(key => {
            if (this.gains[key]) {
                if (fourVoiceModes.includes(this.currentMode)) {
                    // For 4-voice modes, check individual voice toggles
                    this.gains[key].gain.value = this.choirVoices[key] ? this.harmonyVolume * 0.5 : 0;
                } else {
                    // For simple modes, check harmony position
                    let shouldPlay = true;
                    if (this.harmonyPosition === 'above' && key === 'lower') {
                        shouldPlay = false;
                    } else if (this.harmonyPosition === 'below' && key === 'upper') {
                        shouldPlay = false;
                    }
                    this.gains[key].gain.value = shouldPlay ? this.harmonyVolume * 0.6 : 0;
                }
            }
        });
    }

    stop() {
        this.isRunning = false;

        // Stop the native MediaStream tracks
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Disconnect the native media source
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }

        // Dispose Tone.js mic wrapper
        if (this.mic) {
            this.mic.dispose();
            this.mic = null;
        }

        if (this.pitchAnalyser) {
            this.pitchAnalyser.disconnect();
            this.pitchAnalyser = null;
        }

        Object.values(this.pitchShifters).forEach(ps => ps.dispose());
        Object.values(this.gains).forEach(g => g.dispose());

        if (this.chorus) this.chorus.dispose();
        if (this.reverb) this.reverb.dispose();
        if (this.masterGain) this.masterGain.dispose();
        if (this.dryGain) this.dryGain.dispose();
        if (this.analyser) this.analyser.dispose();

        this.updateUI();
    }

    setMode(mode) {
        this.currentMode = mode;

        // Update UI
        document.querySelectorAll('.mode-btn:not(.scale-btn)').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Show/hide choir layout - check if it's a 4-voice mode
        const simpleHarmony = document.getElementById('simpleHarmony');
        const choirLayout = document.getElementById('choirLayout');
        const fourVoiceModes = ['choir', 'barbershop', 'gospel', 'jazz', 'ethereal', 'close'];

        if (fourVoiceModes.includes(mode)) {
            simpleHarmony.style.display = 'none';
            choirLayout.classList.add('visible');
        } else {
            simpleHarmony.style.display = 'flex';
            choirLayout.classList.remove('visible');
        }

        // Recreate pitch shifters if running
        if (this.isRunning) {
            // Disconnect old shifters
            Object.values(this.pitchShifters).forEach(ps => {
                this.mic.disconnect(ps);
            });

            this.createPitchShifters();
            this.connectPitchShifters();
        }
    }

    setScale(scale) {
        this.currentScale = scale;

        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.scale === scale);
        });
    }

    updateUI() {
        const btn = document.getElementById('startBtn');
        const status = document.getElementById('status');

        if (this.isRunning) {
            btn.textContent = 'Stop';
            btn.classList.add('active');
            status.textContent = 'Listening... Sing something!';
            status.className = 'status listening';
        } else {
            btn.textContent = 'Start Singing';
            btn.classList.remove('active');
            status.textContent = 'Click to begin';
            status.className = 'status idle';

            // Reset displays
            document.getElementById('currentNote').textContent = '--';
            document.getElementById('currentNote').classList.remove('singing');
            document.getElementById('frequency').textContent = 'Waiting for input...';
        }
    }

    startPitchDetection() {
        // Create buffer for time-domain data
        const bufferLength = this.pitchAnalyser ? this.pitchAnalyser.fftSize : 2048;
        const timeDataBuffer = new Float32Array(bufferLength);

        const detect = () => {
            if (!this.isRunning) return;

            // Get time-domain data from analyser
            if (this.pitchAnalyser) {
                this.pitchAnalyser.getFloatTimeDomainData(timeDataBuffer);
            } else {
                // Fallback: use Tone's analyser
                const waveform = this.analyser.getValue();
                timeDataBuffer.set(waveform);
            }

            const pitch = this.detectPitch(timeDataBuffer, this.audioContext.sampleRate);

            if (pitch && pitch > 60 && pitch < 2000) {
                // Apply smoothing
                if (this.smoothedPitch === null) {
                    this.smoothedPitch = pitch;
                } else {
                    this.smoothedPitch = this.smoothedPitch * this.smoothing + pitch * (1 - this.smoothing);
                }

                this.updatePitchDisplay(this.smoothedPitch);
            } else {
                // No pitch detected
                if (this.lastPitch !== null) {
                    document.getElementById('currentNote').classList.remove('singing');
                }
            }

            requestAnimationFrame(detect);
        };

        detect();
    }

    // YIN pitch detection algorithm
    detectPitch(buffer, sampleRate) {
        const SIZE = buffer.length;
        const MAX_SAMPLES = Math.floor(SIZE / 2);
        const yinBuffer = new Float32Array(MAX_SAMPLES);

        let probability = 0;
        let tau;

        // Compute the difference function
        for (let t = 0; t < MAX_SAMPLES; t++) {
            yinBuffer[t] = 0;
            for (let i = 0; i < MAX_SAMPLES; i++) {
                const delta = buffer[i] - buffer[i + t];
                yinBuffer[t] += delta * delta;
            }
        }

        // Compute the cumulative mean normalized difference
        yinBuffer[0] = 1;
        let runningSum = 0;
        for (let t = 1; t < MAX_SAMPLES; t++) {
            runningSum += yinBuffer[t];
            yinBuffer[t] *= t / runningSum;
        }

        // Absolute threshold
        const threshold = 0.2;
        for (tau = 2; tau < MAX_SAMPLES; tau++) {
            if (yinBuffer[tau] < threshold) {
                while (tau + 1 < MAX_SAMPLES && yinBuffer[tau + 1] < yinBuffer[tau]) {
                    tau++;
                }
                probability = 1 - yinBuffer[tau];
                break;
            }
        }

        if (tau === MAX_SAMPLES || yinBuffer[tau] >= threshold) {
            return null;
        }

        // Parabolic interpolation for better accuracy
        let betterTau;
        const x0 = tau < 1 ? tau : tau - 1;
        const x2 = tau + 1 < MAX_SAMPLES ? tau + 1 : tau;

        if (x0 === tau) {
            betterTau = yinBuffer[tau] <= yinBuffer[x2] ? tau : x2;
        } else if (x2 === tau) {
            betterTau = yinBuffer[tau] <= yinBuffer[x0] ? tau : x0;
        } else {
            const s0 = yinBuffer[x0];
            const s1 = yinBuffer[tau];
            const s2 = yinBuffer[x2];
            betterTau = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
        }

        return sampleRate / betterTau;
    }

    updatePitchDisplay(frequency) {
        this.lastPitch = frequency;

        // Calculate note
        const noteNum = 12 * (Math.log2(frequency / 440)) + 69;
        const note = Math.round(noteNum);
        const noteName = this.noteStrings[note % 12];
        const octave = Math.floor(note / 12) - 1;
        const cents = Math.round((noteNum - note) * 100);

        // Update main display
        const noteDisplay = document.getElementById('currentNote');
        noteDisplay.textContent = `${noteName}${octave}`;
        noteDisplay.classList.add('singing');

        document.getElementById('frequency').textContent =
            `${frequency.toFixed(1)} Hz | ${cents >= 0 ? '+' : ''}${cents} cents`;

        // Update harmony displays
        if (this.currentMode === 'choir' || this.currentMode === 'barbershop') {
            this.updateChoirDisplay(note, noteName, octave);
        } else {
            this.updateSimpleHarmonyDisplay(note, noteName, octave);
        }

        // Activate voice indicators
        document.querySelectorAll('.voice-indicator').forEach(vi => vi.classList.add('active'));
    }

    updateSimpleHarmonyDisplay(note, noteName, octave) {
        const mode = this.harmonyModes[this.currentMode];

        const lowerNote = note + mode.lower;
        const upperNote = note + mode.upper;

        const lowerNoteName = this.noteStrings[((lowerNote % 12) + 12) % 12];
        const upperNoteName = this.noteStrings[((upperNote % 12) + 12) % 12];

        const lowerOctave = Math.floor(lowerNote / 12) - 1;
        const upperOctave = Math.floor(upperNote / 12) - 1;

        document.getElementById('lowNote').textContent = `${lowerNoteName}${lowerOctave}`;
        document.getElementById('youNote').textContent = `${noteName}${octave}`;
        document.getElementById('highNote').textContent = `${upperNoteName}${upperOctave}`;
    }

    updateChoirDisplay(note, noteName, octave) {
        const mode = this.harmonyModes[this.currentMode];

        ['soprano', 'alto', 'tenor', 'bass'].forEach(voice => {
            const voiceNote = note + mode[voice];
            const voiceNoteName = this.noteStrings[((voiceNote % 12) + 12) % 12];
            const voiceOctave = Math.floor(voiceNote / 12) - 1;
            document.getElementById(`${voice}Note`).textContent = `${voiceNoteName}${voiceOctave}`;
        });
    }

    drawWaveform() {
        if (!this.isRunning) {
            this.canvasCtx.clearRect(0, 0, this.canvas.width / 2, this.canvas.height / 2);
            return;
        }

        requestAnimationFrame(() => this.drawWaveform());

        const width = this.canvas.width / 2;
        const height = this.canvas.height / 2;

        // Get waveform data
        const waveform = this.analyser.getValue();

        // Clear canvas with fade effect
        this.canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.canvasCtx.fillRect(0, 0, width, height);

        // Draw waveform
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.strokeStyle = '#e94560';
        this.canvasCtx.beginPath();

        const sliceWidth = width / waveform.length;
        let x = 0;

        for (let i = 0; i < waveform.length; i++) {
            const v = waveform[i];
            const y = (v + 1) / 2 * height;

            if (i === 0) {
                this.canvasCtx.moveTo(x, y);
            } else {
                this.canvasCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        this.canvasCtx.stroke();

        // Add glow effect
        this.canvasCtx.shadowBlur = 15;
        this.canvasCtx.shadowColor = '#e94560';
        this.canvasCtx.stroke();
        this.canvasCtx.shadowBlur = 0;
    }
}

// Initialize the app when the page loads
window.addEventListener('DOMContentLoaded', () => {
    window.harmonySinger = new HarmonySinger();
});
