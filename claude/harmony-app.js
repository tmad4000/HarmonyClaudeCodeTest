/**
 * Harmony Singer - Real-time AI Backup Vocalist
 *
 * Audio: Tone.js (granular PitchShift) or Signalsmith Stretch (formant-preserving WASM worklet)
 * Pitch: YIN detector on the mic signal
 * Harmony: key-aware. The detected note is mapped onto the selected scale and each
 *          harmony voice is shifted by a *scale-degree* interval, so a "third" is a
 *          major or minor third depending on where you are in the key (like a real
 *          backup singer). Chromatic scale falls back to fixed semitone intervals.
 *
 * Agent-testable: open with ?input=tone&freq=220&autostart=1 to replace the microphone
 * with a synthetic sawtooth, then call window.harmonySinger.measureVoices() to read the
 * pitch of every harmony voice at its output. See test/verify_harmony.py.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

// Harmony voices expressed in SCALE DEGREES (used for major / minor keys).
// +2 degrees = a diatonic third, +4 = fifth, +5 = sixth, +7 = octave.
const DEGREE_MODES = {
    unison:     { lower: 0,  upper: 0 },
    thirds:     { lower: -2, upper: 2 },
    fifths:     { lower: -4, upper: 4 },
    sixths:     { lower: -5, upper: 5 },
    octaves:    { lower: -7, upper: 7 },
    power:      { lower: -4, upper: 7 },
    choir:      { soprano: 7, alto: 2, tenor: -2, bass: -7 },
    barbershop: { soprano: 4, alto: 2, tenor: -3, bass: -7 },
    gospel:     { soprano: 4, alto: 2, tenor: -2, bass: -4 },
    jazz:       { soprano: 6, alto: 2, tenor: -1, bass: -6 },
    ethereal:   { soprano: 4, alto: 7, tenor: -3, bass: -7 },
    close:      { soprano: 2, alto: 1, tenor: -1, bass: -2 }
};

// Harmony voices expressed in SEMITONES (used for the chromatic scale: parallel shifts).
const SEMITONE_MODES = {
    unison:     { lower: 0,   upper: 0 },
    thirds:     { lower: -3,  upper: 4 },
    fifths:     { lower: -7,  upper: 7 },
    sixths:     { lower: -9,  upper: 9 },
    octaves:    { lower: -12, upper: 12 },
    power:      { lower: -7,  upper: 12 },
    choir:      { soprano: 12, alto: 4, tenor: -3, bass: -12 },
    barbershop: { soprano: 7,  alto: 4, tenor: -5, bass: -12 },
    gospel:     { soprano: 7,  alto: 3, tenor: -4, bass: -7 },
    jazz:       { soprano: 11, alto: 4, tenor: -2, bass: -10 },
    ethereal:   { soprano: 7,  alto: 12, tenor: -5, bass: -12 },
    close:      { soprano: 4,  alto: 2, tenor: -1, bass: -3 }
};

const FOUR_VOICE_MODES = ['choir', 'barbershop', 'gospel', 'jazz', 'ethereal', 'close'];
const SATB = ['soprano', 'alto', 'tenor', 'bass'];

// Krumhansl-Kessler key profiles for automatic key detection.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// ---------- Pure music-theory helpers (exposed on window.HarmonyTheory for tests) ----------

function midiToName(midi) {
    const m = Math.round(midi);
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

function freqToMidi(freq) {
    return 12 * Math.log2(freq / 440) + 69;
}

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Semitone shift for a harmony voice `degreeOffset` scale degrees away from the
 * input note, inside the key (rootPc, scale). Notes outside the scale are snapped
 * to the nearest scale degree first (ties go down).
 */
function harmonyShiftInKey(inputMidi, rootPc, scale, degreeOffset) {
    const n = scale.length;
    const pc = (((inputMidi - rootPc) % 12) + 12) % 12;
    let idx = scale.indexOf(pc);
    let snapped = inputMidi;
    if (idx < 0) {
        let best = 0, bestDist = 99;
        for (let i = 0; i < n; i++) {
            const raw = Math.abs(scale[i] - pc);
            const d = Math.min(raw, 12 - raw);
            if (d < bestDist || (d === bestDist && scale[i] < pc)) { bestDist = d; best = i; }
        }
        idx = best;
        let delta = scale[idx] - pc;
        if (delta > 6) delta -= 12;
        if (delta < -6) delta += 12;
        snapped = inputMidi + delta;
    }
    const target = idx + degreeOffset;
    const oct = Math.floor(target / n);
    const tIdx = ((target % n) + n) % n;
    const targetMidi = snapped - scale[idx] + scale[tIdx] + 12 * oct;
    return targetMidi - inputMidi;
}

/** Correlate a 12-bin pitch-class histogram against all keys of the allowed types. */
function detectKeyFromHistogram(hist, allowedTypes) {
    const total = hist.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const mean = total / 12;
    const results = [];
    const profiles = { major: KK_MAJOR, minor: KK_MINOR };
    for (const type of allowedTypes) {
        const prof = profiles[type];
        const pMean = prof.reduce((a, b) => a + b, 0) / 12;
        for (let root = 0; root < 12; root++) {
            let num = 0, dh = 0, dp = 0;
            for (let i = 0; i < 12; i++) {
                const h = hist[(i + root) % 12] - mean;
                const p = prof[i] - pMean;
                num += h * p; dh += h * h; dp += p * p;
            }
            const r = (dh > 0 && dp > 0) ? num / Math.sqrt(dh * dp) : 0;
            results.push({ root, type, score: r });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return { best: results[0], second: results[1], total };
}

// YIN pitch detection. Returns Hz or null.
function yinPitch(buffer, sampleRate, threshold = 0.2) {
    const SIZE = buffer.length;
    const MAX = Math.floor(SIZE / 2);
    const yin = new Float32Array(MAX);
    for (let t = 0; t < MAX; t++) {
        let s = 0;
        for (let i = 0; i < MAX; i++) {
            const d = buffer[i] - buffer[i + t];
            s += d * d;
        }
        yin[t] = s;
    }
    yin[0] = 1;
    let running = 0;
    for (let t = 1; t < MAX; t++) {
        running += yin[t];
        yin[t] *= t / (running || 1e-12);
    }
    let tau;
    for (tau = 2; tau < MAX; tau++) {
        if (yin[tau] < threshold) {
            while (tau + 1 < MAX && yin[tau + 1] < yin[tau]) tau++;
            break;
        }
    }
    if (tau >= MAX || yin[tau] >= threshold) return null;
    const x0 = tau < 1 ? tau : tau - 1;
    const x2 = tau + 1 < MAX ? tau + 1 : tau;
    let better = tau;
    if (x0 !== tau && x2 !== tau) {
        const s0 = yin[x0], s1 = yin[tau], s2 = yin[x2];
        const denom = 2 * (2 * s1 - s2 - s0);
        if (denom !== 0) better = tau + (s2 - s0) / denom;
    }
    return sampleRate / better;
}

// ---------- The app ----------

class HarmonySinger {
    constructor() {
        this.params = new URLSearchParams(window.location.search);

        // Audio nodes
        this.mic = null;            // Tone.Gain wrapping the input
        this.micSource = null;      // native source node (mic or test oscillator)
        this.mediaStream = null;
        this.testOsc = null;
        this.analyser = null;       // Tone waveform analyser (visualizer)
        this.pitchAnalyser = null;  // native analyser for YIN
        this.pitchShifters = {};    // voice -> shifter node (Tone.PitchShift or Stretch AudioNode)
        this.gains = {};            // voice -> Tone.Gain
        this.voiceAnalysers = {};   // voice -> native AnalyserNode tapping the shifter output
        this.voiceShifts = {};      // voice -> current semitone shift
        this.voiceTargets = {};     // voice -> current target midi (for display)
        this.reverb = null;
        this.chorus = null;
        this.masterGain = null;
        this.dryGain = null;

        // State
        this.isRunning = false;
        // Signalsmith Stretch is the default: it keeps formants and (measured) stays within
        // ~4 cents of the target, where Tone.PitchShift lands ~30 cents flat on downward shifts.
        const requested = this.params.get('engine');
        const stretchAvailable = typeof SignalsmithStretch === 'function';
        this.engine = requested === 'granular' ? 'granular'
            : requested === 'stretch' ? 'stretch'
            : (stretchAvailable ? 'stretch' : 'granular');
        this.currentMode = this.params.get('mode') || 'thirds';
        this.currentScale = this.params.get('scale') || 'major';
        this.keyRoot = this.params.get('key') || 'auto';   // 'auto' or note name
        this.detectedKey = null;                            // {root, type, score}
        this.harmonyVolume = 0.7;
        this.dryVolume = 0.8;
        this.reverbAmount = 0.3;
        this.chorusAmount = 0.3;
        this.smoothing = 0.5;
        this.speakerMode = false;
        this.harmonyPosition = 'both';
        this.choirVoices = { soprano: true, alto: true, tenor: true, bass: true };

        // Pitch tracking
        this.audioContext = null;
        this.lastPitch = null;
        this.smoothedPitch = null;
        this.stableMidi = null;      // quantized input note currently driving the harmony
        this.candidateMidi = null;
        this.candidateFrames = 0;
        this.pitchClassHist = new Float32Array(12);
        this.lastKeyScan = 0;

        this.noteStrings = NOTE_NAMES;
        this.initUI();

        if (this.params.get('autostart') === '1') {
            setTimeout(() => this.start(), 50);
        }
    }

    // ---------- UI ----------

    initUI() {
        document.getElementById('startBtn').addEventListener('click', () => this.toggle());

        document.querySelectorAll('.mode-btn:not(.scale-btn):not(.position-btn)').forEach(btn => {
            btn.addEventListener('click', (e) => this.setMode(e.target.dataset.mode));
        });
        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setScale(e.target.dataset.scale));
        });
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setPosition(e.target.dataset.position));
        });

        const keySelect = document.getElementById('keyRoot');
        if (keySelect) {
            keySelect.value = this.keyRoot;
            keySelect.addEventListener('change', (e) => this.setKey(e.target.value));
        }
        const engineSelect = document.getElementById('engineSelect');
        if (engineSelect) {
            engineSelect.value = this.engine;
            engineSelect.addEventListener('change', (e) => this.setEngine(e.target.value));
        }

        this.bindSlider('harmonyVolume', 'volumeValue', v => { this.harmonyVolume = v; this.updateGains(); });
        this.bindSlider('dryVolume', 'dryValue', v => { this.dryVolume = v; this.updateGains(); });
        this.bindSlider('reverbAmount', 'reverbValue', v => { this.reverbAmount = v; if (this.reverb) this.reverb.wet.value = v; });
        this.bindSlider('chorusAmount', 'chorusValue', v => { this.chorusAmount = v; if (this.chorus) this.chorus.wet.value = v; });
        this.bindSlider('smoothing', 'smoothValue', v => { this.smoothing = v; });

        document.querySelectorAll('.toggle[data-voice]').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const voice = e.target.dataset.voice;
                this.choirVoices[voice] = !this.choirVoices[voice];
                e.target.classList.toggle('on', this.choirVoices[voice]);
                this.updateGains();
            });
        });

        const speakerToggle = document.getElementById('speakerModeToggle');
        if (speakerToggle) speakerToggle.addEventListener('click', () => this.toggleSpeakerMode());

        // Reflect URL-driven state in the buttons
        this.setMode(this.currentMode, { silent: true });
        this.setScale(this.currentScale);
        this.updateKeyStatus();
        this.setupCanvas();
    }

    bindSlider(id, valueId, cb) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            document.getElementById(valueId).textContent = `${e.target.value}%`;
            cb(e.target.value / 100);
        });
    }

    setPosition(position) {
        this.harmonyPosition = position;
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.position === position);
        });
        this.updateGains();
    }

    setKey(root) {
        this.keyRoot = root;
        const keySelect = document.getElementById('keyRoot');
        if (keySelect && keySelect.value !== root) keySelect.value = root;
        this.stableMidi = null; // force re-evaluation of every voice
        this.updateKeyStatus();
    }

    setScale(scale) {
        if (!SCALES[scale]) return;
        this.currentScale = scale;
        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.scale === scale);
        });
        this.stableMidi = null;
        this.updateKeyStatus();
    }

    setEngine(engine) {
        if (engine === this.engine) return;
        this.engine = engine;
        const sel = document.getElementById('engineSelect');
        if (sel && sel.value !== engine) sel.value = engine;
        if (this.isRunning) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }
    }

    toggleSpeakerMode() {
        this.speakerMode = !this.speakerMode;
        const toggle = document.getElementById('speakerModeToggle');
        if (toggle) toggle.classList.toggle('on', this.speakerMode);
        const statusText = document.getElementById('speakerModeStatus');
        if (statusText) statusText.textContent = this.speakerMode ? 'Speaker Mode (AEC On)' : 'Headphone Mode';
        if (this.isRunning) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }
    }

    setMode(mode, opts = {}) {
        if (!DEGREE_MODES[mode]) return;
        this.currentMode = mode;
        document.querySelectorAll('.mode-btn:not(.scale-btn):not(.position-btn)').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        const simpleHarmony = document.getElementById('simpleHarmony');
        const choirLayout = document.getElementById('choirLayout');
        if (FOUR_VOICE_MODES.includes(mode)) {
            simpleHarmony.style.display = 'none';
            choirLayout.classList.add('visible');
        } else {
            simpleHarmony.style.display = 'flex';
            choirLayout.classList.remove('visible');
        }
        if (this.isRunning && !opts.silent) {
            this.rebuildVoices();
        }
    }

    setupCanvas() {
        this.canvas = document.getElementById('waveform');
        this.canvasCtx = this.canvas.getContext('2d');
        this.canvas.width = this.canvas.offsetWidth * 2;
        this.canvas.height = this.canvas.offsetHeight * 2;
        this.canvasCtx.scale(2, 2);
    }

    updateUI() {
        const btn = document.getElementById('startBtn');
        const status = document.getElementById('status');
        if (this.isRunning) {
            btn.textContent = 'Stop';
            btn.classList.add('active');
            status.textContent = this.testOsc
                ? `Test tone input (${this.params.get('freq') || 220} Hz) – engine: ${this.engine}`
                : `Listening... Sing something! (engine: ${this.engine})`;
            status.className = 'status listening';
        } else {
            btn.textContent = 'Start Singing';
            btn.classList.remove('active');
            status.textContent = 'Click to begin';
            status.className = 'status idle';
            document.getElementById('currentNote').textContent = '--';
            document.getElementById('currentNote').classList.remove('singing');
            document.getElementById('frequency').textContent = 'Waiting for input...';
        }
    }

    updateKeyStatus() {
        const el = document.getElementById('keyStatus');
        if (!el) return;
        const k = this.effectiveKey();
        if (this.currentScale === 'chromatic') {
            el.textContent = 'Chromatic: fixed parallel intervals';
        } else if (this.keyRoot === 'auto') {
            el.textContent = this.detectedKey
                ? `Auto key: ${NOTE_NAMES[k.root]} ${k.type} (confidence ${this.detectedKey.score.toFixed(2)})`
                : 'Auto key: listening…';
        } else {
            el.textContent = `Key: ${NOTE_NAMES[k.root]} ${k.type}`;
        }
    }

    // ---------- Key handling ----------

    /** Returns {root (0-11), type ('major'|'minor'|'chromatic')} currently in force. */
    effectiveKey() {
        const type = this.currentScale;
        if (this.keyRoot !== 'auto') {
            return { root: Math.max(0, NOTE_NAMES.indexOf(this.keyRoot)), type };
        }
        if (this.detectedKey) return { root: this.detectedKey.root, type };
        return { root: 0, type };
    }

    accumulateKeyEvidence(midi, now) {
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        for (let i = 0; i < 12; i++) this.pitchClassHist[i] *= 0.998; // slow forgetting
        this.pitchClassHist[pc] += 1;
        if (now - this.lastKeyScan < 500) return;
        this.lastKeyScan = now;
        const allowed = this.currentScale === 'minor' ? ['minor'] : this.currentScale === 'major' ? ['major'] : ['major', 'minor'];
        const res = detectKeyFromHistogram(Array.from(this.pitchClassHist), allowed);
        if (!res || res.total < 40) return; // need ~2/3 s of voiced frames
        const margin = res.best.score - res.second.score;
        if (!this.detectedKey || res.best.root !== this.detectedKey.root) {
            // only switch when clearly better than the incumbent
            if (!this.detectedKey || margin > 0.03 || res.best.score > this.detectedKey.score + 0.05) {
                this.detectedKey = { ...res.best };
                this.stableMidi = null;
                this.updateKeyStatus();
            }
        } else {
            this.detectedKey.score = res.best.score;
            this.updateKeyStatus();
        }
    }

    // ---------- Audio graph ----------

    async toggle() {
        if (this.isRunning) this.stop(); else await this.start();
    }

    async start() {
        try {
            await Tone.start();
            this.audioContext = Tone.getContext().rawContext;

            const useTestTone = this.params.get('input') === 'tone';
            if (useTestTone) {
                const freq = parseFloat(this.params.get('freq') || '220');
                const osc = this.audioContext.createOscillator();
                osc.type = this.params.get('wave') || 'sawtooth';
                osc.frequency.value = freq;
                const lp = this.audioContext.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = 2500;
                const g = this.audioContext.createGain();
                g.gain.value = 0.25;
                osc.connect(lp).connect(g);
                osc.start();
                this.testOsc = osc;
                this.micSource = g;
            } else {
                const audioConstraints = {
                    echoCancellation: this.speakerMode,
                    noiseSuppression: this.speakerMode,
                    autoGainControl: this.speakerMode,
                    sampleRate: this.audioContext.sampleRate
                };
                this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                const track = this.mediaStream.getAudioTracks()[0];
                console.log('Actual audio settings:', track.getSettings());
                this.micSource = this.audioContext.createMediaStreamSource(this.mediaStream);
            }

            this.mic = new Tone.Gain(1);
            this.micSource.connect(this.mic.input);

            this.analyser = new Tone.Analyser('waveform', 2048);
            this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: this.chorusAmount });
            this.chorus.start();
            this.reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: this.reverbAmount });
            await this.reverb.generate();
            this.masterGain = new Tone.Gain(1);
            this.dryGain = new Tone.Gain(this.dryVolume);

            // dry: mic -> dryGain -> chorus -> reverb -> master -> out
            this.mic.connect(this.analyser);
            this.mic.connect(this.dryGain);
            this.dryGain.connect(this.chorus);
            this.chorus.connect(this.reverb);
            this.reverb.connect(this.masterGain);
            this.masterGain.toDestination();

            // native analyser for YIN on the input
            this.pitchAnalyser = this.audioContext.createAnalyser();
            this.pitchAnalyser.fftSize = 2048;
            this.micSource.connect(this.pitchAnalyser);

            try {
                await this.createPitchShifters();
            } catch (engineErr) {
                if (this.engine === 'stretch') {
                    console.warn('Signalsmith engine failed, falling back to granular:', engineErr);
                    this.engine = 'granular';
                    const sel = document.getElementById('engineSelect');
                    if (sel) sel.value = 'granular';
                    await this.createPitchShifters();
                } else {
                    throw engineErr;
                }
            }

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

    voiceNames() {
        return FOUR_VOICE_MODES.includes(this.currentMode) ? SATB : ['lower', 'upper'];
    }

    async createPitchShifters() {
        this.disposeVoices();
        const voices = this.voiceNames();
        for (const voice of voices) {
            const gain = new Tone.Gain(0);
            const tap = this.audioContext.createAnalyser();
            tap.fftSize = 4096;
            let shifter;
            if (this.engine === 'stretch') {
                if (typeof SignalsmithStretch !== 'function') {
                    throw new Error('Signalsmith Stretch engine not loaded (vendor/SignalsmithStretch.js)');
                }
                // Pass the Tone.js Context so the worklet lives in the same (standardized) graph.
                shifter = await SignalsmithStretch(Tone.getContext(), {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
                });
                const blockMs = parseFloat(this.params.get('blockMs') || '60');
                if (shifter.configure) shifter.configure({ blockMs, intervalMs: blockMs / 4 });
                shifter.schedule({ semitones: 0, formantCompensation: true, formantBaseHz: 0 });
                shifter.start();
                this.micSource.connect(shifter);
                shifter.connect(tap);
                Tone.connect(shifter, gain);
            } else {
                shifter = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0 });
                this.mic.connect(shifter);
                shifter.connect(tap);
                shifter.connect(gain);
            }
            gain.connect(this.chorus); // harmonies go through chorus + reverb
            this.pitchShifters[voice] = shifter;
            this.gains[voice] = gain;
            this.voiceAnalysers[voice] = tap;
            this.voiceShifts[voice] = 0;
        }
        this.stableMidi = null;
        this.updateGains();
    }

    disposeVoices() {
        Object.values(this.pitchShifters).forEach(ps => {
            try { if (ps.stop) ps.stop(); } catch (e) { /* ignore */ }
            try { ps.disconnect(); } catch (e) { /* ignore */ }
            try { if (ps.dispose) ps.dispose(); } catch (e) { /* ignore */ }
        });
        Object.values(this.gains).forEach(g => { try { g.dispose(); } catch (e) { /* ignore */ } });
        Object.values(this.voiceAnalysers).forEach(a => { try { a.disconnect(); } catch (e) { /* ignore */ } });
        this.pitchShifters = {};
        this.gains = {};
        this.voiceAnalysers = {};
        this.voiceShifts = {};
        this.voiceTargets = {};
    }

    async rebuildVoices() {
        await this.createPitchShifters();
    }

    updateGains() {
        if (this.dryGain) this.dryGain.gain.value = this.dryVolume;
        const four = FOUR_VOICE_MODES.includes(this.currentMode);
        Object.keys(this.gains).forEach(key => {
            let level;
            if (four) {
                level = this.choirVoices[key] ? this.harmonyVolume * 0.5 : 0;
            } else {
                let play = true;
                if (this.harmonyPosition === 'above' && key === 'lower') play = false;
                if (this.harmonyPosition === 'below' && key === 'upper') play = false;
                level = play ? this.harmonyVolume * 0.6 : 0;
            }
            this.gains[key].gain.value = level;
        });
    }

    setVoiceShift(voice, semitones) {
        if (this.voiceShifts[voice] === semitones) return;
        this.voiceShifts[voice] = semitones;
        const ps = this.pitchShifters[voice];
        if (!ps) return;
        if (this.engine === 'stretch') {
            ps.schedule({ semitones, formantCompensation: true, formantBaseHz: 0 });
        } else {
            ps.pitch = semitones;
        }
    }

    /** Recompute every harmony voice for the quantized input note. */
    applyHarmonyForMidi(inputMidi) {
        const key = this.effectiveKey();
        const degreeMode = DEGREE_MODES[this.currentMode];
        const semiMode = SEMITONE_MODES[this.currentMode];
        for (const voice of this.voiceNames()) {
            let shift;
            if (key.type === 'chromatic') {
                shift = semiMode[voice];
            } else {
                shift = harmonyShiftInKey(inputMidi, key.root, SCALES[key.type], degreeMode[voice]);
            }
            this.voiceTargets[voice] = inputMidi + shift;
            this.setVoiceShift(voice, shift);
        }
    }

    stop() {
        this.isRunning = false;
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        if (this.testOsc) {
            try { this.testOsc.stop(); } catch (e) { /* ignore */ }
            this.testOsc = null;
        }
        if (this.micSource) { try { this.micSource.disconnect(); } catch (e) { /* ignore */ } this.micSource = null; }
        if (this.mic) { this.mic.dispose(); this.mic = null; }
        if (this.pitchAnalyser) { this.pitchAnalyser.disconnect(); this.pitchAnalyser = null; }
        this.disposeVoices();
        if (this.chorus) this.chorus.dispose();
        if (this.reverb) this.reverb.dispose();
        if (this.masterGain) this.masterGain.dispose();
        if (this.dryGain) this.dryGain.dispose();
        if (this.analyser) this.analyser.dispose();
        this.smoothedPitch = null;
        this.stableMidi = null;
        this.updateUI();
    }

    // ---------- Pitch detection loop ----------

    startPitchDetection() {
        const buf = new Float32Array(this.pitchAnalyser.fftSize);
        const detect = () => {
            if (!this.isRunning) return;
            this.pitchAnalyser.getFloatTimeDomainData(buf);
            const pitch = yinPitch(buf, this.audioContext.sampleRate);

            if (pitch && pitch > 60 && pitch < 2000) {
                this.smoothedPitch = this.smoothedPitch === null
                    ? pitch
                    : this.smoothedPitch * this.smoothing + pitch * (1 - this.smoothing);
                const midi = Math.round(freqToMidi(this.smoothedPitch));

                // Debounce the quantized note so harmonies don't flutter at note boundaries.
                if (midi === this.candidateMidi) {
                    this.candidateFrames++;
                } else {
                    this.candidateMidi = midi;
                    this.candidateFrames = 1;
                }
                if (this.candidateFrames >= 2 && midi !== this.stableMidi) {
                    this.stableMidi = midi;
                    this.applyHarmonyForMidi(midi);
                }
                if (this.keyRoot === 'auto') this.accumulateKeyEvidence(midi, performance.now());
                this.updatePitchDisplay(this.smoothedPitch, midi);
            } else {
                this.candidateFrames = 0;
                if (this.lastPitch !== null) document.getElementById('currentNote').classList.remove('singing');
            }
            requestAnimationFrame(detect);
        };
        detect();
    }

    updatePitchDisplay(frequency, midi) {
        this.lastPitch = frequency;
        const noteNum = freqToMidi(frequency);
        const cents = Math.round((noteNum - midi) * 100);
        const noteDisplay = document.getElementById('currentNote');
        noteDisplay.textContent = midiToName(midi);
        noteDisplay.classList.add('singing');
        document.getElementById('frequency').textContent =
            `${frequency.toFixed(1)} Hz | ${cents >= 0 ? '+' : ''}${cents} cents`;

        if (FOUR_VOICE_MODES.includes(this.currentMode)) {
            SATB.forEach(v => {
                const el = document.getElementById(`${v}Note`);
                if (el && this.voiceTargets[v] !== undefined) el.textContent = midiToName(this.voiceTargets[v]);
            });
        } else {
            const low = document.getElementById('lowNote');
            const you = document.getElementById('youNote');
            const high = document.getElementById('highNote');
            if (this.voiceTargets.lower !== undefined) low.textContent = midiToName(this.voiceTargets.lower);
            you.textContent = midiToName(midi);
            if (this.voiceTargets.upper !== undefined) high.textContent = midiToName(this.voiceTargets.upper);
        }
        document.querySelectorAll('.voice-indicator').forEach(vi => vi.classList.add('active'));
    }

    // ---------- Test hooks ----------

    /** Change the synthetic input frequency (test mode only). */
    setTestFrequency(hz) {
        if (this.testOsc) this.testOsc.frequency.setTargetAtTime(hz, this.audioContext.currentTime, 0.01);
    }

    /** Measure the pitch actually coming out of each harmony voice. */
    measureVoices() {
        const out = { engine: this.engine, key: this.effectiveKey(), detectedKey: this.detectedKey, input: null, voices: {} };
        if (this.smoothedPitch) {
            out.input = { hz: this.smoothedPitch, midi: Math.round(freqToMidi(this.smoothedPitch)), note: midiToName(freqToMidi(this.smoothedPitch)) };
        }
        for (const [voice, tap] of Object.entries(this.voiceAnalysers)) {
            const buf = new Float32Array(tap.fftSize);
            tap.getFloatTimeDomainData(buf);
            let rms = 0;
            for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
            rms = Math.sqrt(rms / buf.length);
            const hz = yinPitch(buf, this.audioContext.sampleRate, 0.25);
            out.voices[voice] = {
                hz, rms,
                midi: hz ? freqToMidi(hz) : null,
                note: hz ? midiToName(freqToMidi(hz)) : null,
                shift: this.voiceShifts[voice],
                targetMidi: this.voiceTargets[voice] ?? null,
                targetNote: this.voiceTargets[voice] !== undefined ? midiToName(this.voiceTargets[voice]) : null
            };
        }
        return out;
    }

    /** Engine-reported live-input latency in seconds (Signalsmith engine only; granular ~ windowSize). */
    async engineLatency() {
        if (this.engine === 'stretch') {
            const any = Object.values(this.pitchShifters)[0];
            if (any && any.latency) return await any.latency();
            return null;
        }
        return 0.1; // Tone.PitchShift windowSize
    }

    // ---------- Visualizer ----------

    drawWaveform() {
        if (!this.isRunning) {
            this.canvasCtx.clearRect(0, 0, this.canvas.width / 2, this.canvas.height / 2);
            return;
        }
        requestAnimationFrame(() => this.drawWaveform());
        const width = this.canvas.width / 2;
        const height = this.canvas.height / 2;
        const waveform = this.analyser.getValue();
        this.canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.canvasCtx.fillRect(0, 0, width, height);
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.strokeStyle = '#e94560';
        this.canvasCtx.beginPath();
        const sliceWidth = width / waveform.length;
        let x = 0;
        for (let i = 0; i < waveform.length; i++) {
            const y = (waveform[i] + 1) / 2 * height;
            if (i === 0) this.canvasCtx.moveTo(x, y); else this.canvasCtx.lineTo(x, y);
            x += sliceWidth;
        }
        this.canvasCtx.stroke();
        this.canvasCtx.shadowBlur = 15;
        this.canvasCtx.shadowColor = '#e94560';
        this.canvasCtx.stroke();
        this.canvasCtx.shadowBlur = 0;
    }
}

window.HarmonyTheory = { harmonyShiftInKey, detectKeyFromHistogram, yinPitch, midiToName, freqToMidi, midiToFreq, SCALES, DEGREE_MODES, SEMITONE_MODES };

window.addEventListener('DOMContentLoaded', () => {
    window.harmonySinger = new HarmonySinger();
});
