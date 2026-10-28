/**
 * Harmony Singer - Real-time AI Backup Vocalist
 *
 * Audio:   Signalsmith Stretch (formant-preserving WASM worklet, default) or Tone.js granular PitchShift
 * Pitch:   YIN detector on the (guarded) mic signal
 * Harmony: key-aware. The detected note is mapped onto the selected scale and each harmony voice
 *          is shifted by a *scale-degree* interval, so a "third" is major or minor depending on
 *          where you are in the key (like a real backup singer). Chromatic = fixed semitones.
 * Speaker mode (laptop open, no headphones): browser echo cancellation + dry monitor muted +
 *          harmony gate (only sings while you sing) + high/low-pass + limiter + an automatic
 *          feedback guard that spots howling spectral lines and drops notch filters on them.
 * Debug:   optional audio recording (output, or input/output as L/R) and a JSON event log.
 *
 * Agent-testable: ?input=tone&freq=220&autostart=1 replaces the microphone with a synthetic
 * sawtooth; ?howl=3000 adds a rising pure tone to provoke the feedback guard; then call
 * window.harmonySinger.measureVoices() / measureGuard(hz) / getLog(). See test/verify_harmony.py.
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

// Feedback guard tuning
const GUARD = {
    maxNotches: 8,
    notchQ: 25,
    minHz: 150,
    maxHz: 8000,
    peakPapr: 12,          // dB above the surrounding spectrum to count as a "line"
    minLevelDb: -45,       // ignore quiet lines
    confirmFrames: 5,      // ~0.5 s persistent ...
    riseDb: 3,             // ... and rising by this much, or
    sustainFrames: 12,     // ... persistent for ~1.2 s
    releaseMs: 20000,      // let a notch go after this long without re-detection
    duckMs: 2000,          // duck harmonies briefly when a howl is caught
    analyseEveryFrames: 6  // ~100 ms at 60 fps
};

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

/** Find spectral lines: local maxima that stand well above their neighbourhood. */
function findSpectralPeaks(spec, binHz, minHz, maxHz, minPapr, minDb) {
    const lo = Math.max(1, Math.floor(minHz / binHz));
    const hi = Math.min(spec.length - 2, Math.floor(maxHz / binHz));
    const peaks = [];
    for (let i = lo; i <= hi; i++) {
        const v = spec[i];
        if (v < minDb || !(v >= spec[i - 1] && v > spec[i + 1])) continue;
        let sum = 0, c = 0;
        for (let j = i - 40; j <= i + 40; j++) {
            if (j < 1 || j >= spec.length || Math.abs(j - i) <= 3) continue;
            sum += spec[j]; c++;
        }
        const papr = v - sum / Math.max(1, c);
        if (papr < minPapr) continue;
        const a = spec[i - 1], b = v, cc = spec[i + 1];
        const denom = a - 2 * b + cc;
        const frac = denom !== 0 ? 0.5 * (a - cc) / denom : 0;
        peaks.push({ bin: i, hz: (i + frac) * binHz, db: v, papr });
    }
    peaks.sort((p, q) => q.db - p.db);
    return peaks.slice(0, 12);
}

// ---------- The app ----------

class HarmonySinger {
    constructor() {
        this.params = new URLSearchParams(window.location.search);

        // Audio nodes
        this.mic = null;            // Tone.Gain: the guarded input every voice and the monitor read from
        this.micSource = null;      // native/standardized source node (mic or test oscillator)
        this.mediaStream = null;
        this.testOsc = null;
        this.howlOsc = null;
        this.analyser = null;       // Tone waveform analyser (visualizer)
        this.pitchAnalyser = null;  // analyser on the guarded input for YIN
        this.guardAnalyser = null;  // analyser on the raw input for howl detection
        this.postGuardAnalyser = null;
        this.hpFilter = null;
        this.notchNodes = [];       // BiquadFilter notch bank (speaker mode)
        this.notches = [];          // [{hz, lastSeen, active}] parallel to notchNodes
        this.pitchShifters = {};
        this.gains = {};
        this.voiceAnalysers = {};
        this.voiceShifts = {};
        this.voiceTargets = {};
        this.gateGain = null;
        this.lpFilter = null;
        this.reverb = null;
        this.chorus = null;
        this.masterGain = null;
        this.limiter = null;
        this.dryGain = null;

        // State
        this.isRunning = false;
        const requested = this.params.get('engine');
        const stretchAvailable = typeof SignalsmithStretch === 'function';
        this.engine = requested === 'granular' ? 'granular'
            : requested === 'stretch' ? 'stretch'
            : (stretchAvailable ? 'stretch' : 'granular');
        this.currentMode = this.params.get('mode') || 'thirds';
        this.currentScale = this.params.get('scale') || 'major';
        this.keyRoot = this.params.get('key') || 'auto';
        this.detectedKey = null;
        this.harmonyVolume = 0.7;
        this.dryVolume = 0.8;
        this.reverbAmount = 0.3;
        this.chorusAmount = 0.3;
        this.smoothing = 0.5;
        this.speakerMode = this.params.get('speaker') === '1';
        this.harmonyPosition = 'both';
        this.choirVoices = { soprano: true, alto: true, tenor: true, bass: true };

        // Pitch tracking
        this.audioContext = null;
        this.lastPitch = null;
        this.smoothedPitch = null;
        this.stableMidi = null;
        this.candidateMidi = null;
        this.candidateFrames = 0;
        this.pitchClassHist = new Float32Array(12);
        this.lastKeyScan = 0;

        // Guard / gate state
        this.frameCounter = 0;
        this.lastPeaks = [];
        this.harmonicVoice = false;  // input looks like a voice (f0 with harmonics), not a pure line
        this.guardCandidates = [];   // [{hz, frames, firstDb, lastDb, lastSeen}]
        this.gateOpen = true;
        this.lastVoicedAt = 0;
        this.duckUntil = 0;
        this.guardEvents = 0;
        this.lastInputRms = 0;

        // Debug log + recording
        this.log = [];
        this.logLimit = 20000;
        this.verboseLog = this.params.get('log') === '1';
        this.lastStatLog = 0;
        this.recorder = null;
        this.recordChunks = [];
        this.recordStream = null;
        this.recordNodes = [];
        this.recordMode = this.params.get('recordmode') || 'both';  // 'output' | 'input' | 'both' (L=input, R=output)
        this.lastRecordingUrl = null;

        this.noteStrings = NOTE_NAMES;
        this.initUI();

        if (this.params.get('autostart') === '1') {
            setTimeout(() => this.start(), 50);
        }
    }

    // ---------- Logging ----------

    logEvent(type, data) {
        const entry = { t: Math.round(performance.now()), type, ...(data || {}) };
        this.log.push(entry);
        if (this.log.length > this.logLimit) this.log.splice(0, this.log.length - this.logLimit);
        if (this.verboseLog) console.log('[harmony]', type, data || '');
        return entry;
    }

    getLog() { return this.log; }

    downloadLog() {
        const blob = new Blob([JSON.stringify({
            exportedAt: new Date().toISOString(),
            userAgent: navigator.userAgent,
            settings: this.snapshotSettings(),
            events: this.log
        }, null, 1)], { type: 'application/json' });
        this.triggerDownload(blob, `harmony-log-${this.stamp()}.json`);
    }

    snapshotSettings() {
        return {
            engine: this.engine, mode: this.currentMode, scale: this.currentScale, keyRoot: this.keyRoot,
            detectedKey: this.detectedKey, speakerMode: this.speakerMode, harmonyVolume: this.harmonyVolume,
            dryVolume: this.dryVolume, reverbAmount: this.reverbAmount, chorusAmount: this.chorusAmount,
            smoothing: this.smoothing, harmonyPosition: this.harmonyPosition, choirVoices: { ...this.choirVoices },
            sampleRate: this.audioContext ? this.audioContext.sampleRate : null,
            notches: this.notches.filter(n => n.active).map(n => Math.round(n.hz))
        };
    }

    stamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    }

    triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // ---------- Recording ----------

    isRecording() { return !!(this.recorder && this.recorder.state === 'recording'); }

    startRecording(mode) {
        if (!this.isRunning) throw new Error('Start the harmonizer before recording');
        if (this.isRecording()) return;
        if (mode) this.recordMode = mode;
        const ctx = this.audioContext;
        const dest = ctx.createMediaStreamDestination();
        this.recordNodes = [dest];
        if (this.recordMode === 'both') {
            // Left = guarded input (what the engine hears), Right = what goes to the speakers.
            const merger = ctx.createChannelMerger(2);
            const inMono = ctx.createGain();
            const outMono = ctx.createGain();
            this.mic.connect(inMono);
            Tone.connect(this.limiter, outMono);
            inMono.connect(merger, 0, 0);
            outMono.connect(merger, 0, 1);
            merger.connect(dest);
            this.recordNodes.push(merger, inMono, outMono);
        } else if (this.recordMode === 'input') {
            this.mic.connect(dest);
        } else {
            Tone.connect(this.limiter, dest);
        }
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
        this.recorder = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
        this.recordChunks = [];
        this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.recordChunks.push(e.data); };
        this.recorder.onstop = () => {
            const blob = new Blob(this.recordChunks, { type: this.recorder.mimeType || 'audio/webm' });
            this.lastRecordingBlob = blob;
            this.logEvent('recording-stopped', { bytes: blob.size, mode: this.recordMode });
            if (blob.size > 0 && !this.params.get('nodownload')) {
                this.triggerDownload(blob, `harmony-${this.recordMode}-${this.stamp()}.webm`);
            }
            this.recordNodes.forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
            this.recordNodes = [];
            this.renderRecording();
        };
        this.recorder.start(1000);
        this.logEvent('recording-started', { mode: this.recordMode, mime });
        this.renderRecording();
    }

    stopRecording() {
        if (!this.isRecording()) return;
        this.recorder.stop();
    }

    renderRecording() {
        const btn = document.getElementById('recordBtn');
        const st = document.getElementById('recordStatus');
        if (btn) {
            btn.textContent = this.isRecording() ? '■ Stop recording' : '● Record';
            btn.classList.toggle('active', this.isRecording());
        }
        if (st) {
            st.textContent = this.isRecording()
                ? `Recording ${this.recordMode === 'both' ? 'input (L) + output (R)' : this.recordMode}…`
                : (this.lastRecordingBlob ? `Last recording: ${(this.lastRecordingBlob.size / 1024).toFixed(0)} KB (downloaded)` : '');
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
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) {
            recordBtn.addEventListener('click', () => {
                try {
                    if (this.isRecording()) this.stopRecording(); else this.startRecording();
                } catch (err) {
                    document.getElementById('recordStatus').textContent = err.message;
                }
            });
        }
        const recordMode = document.getElementById('recordMode');
        if (recordMode) {
            recordMode.value = this.recordMode;
            recordMode.addEventListener('change', (e) => { this.recordMode = e.target.value; });
        }
        const logBtn = document.getElementById('logBtn');
        if (logBtn) logBtn.addEventListener('click', () => this.downloadLog());

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

        this.setMode(this.currentMode, { silent: true });
        this.setScale(this.currentScale);
        this.updateKeyStatus();
        this.renderSpeakerMode();
        this.renderRecording();
        this.setupCanvas();
    }

    bindSlider(id, valueId, cb) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            document.getElementById(valueId).textContent = `${e.target.value}%`;
            cb(e.target.value / 100);
            this.logEvent('setting', { id, value: e.target.value });
        });
    }

    setPosition(position) {
        this.harmonyPosition = position;
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.position === position);
        });
        this.updateGains();
        this.logEvent('position', { position });
    }

    setKey(root) {
        this.keyRoot = root;
        const keySelect = document.getElementById('keyRoot');
        if (keySelect && keySelect.value !== root) keySelect.value = root;
        this.stableMidi = null;
        this.updateKeyStatus();
        this.logEvent('key', { root });
    }

    setScale(scale) {
        if (!SCALES[scale]) return;
        this.currentScale = scale;
        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.scale === scale);
        });
        this.stableMidi = null;
        this.updateKeyStatus();
        this.logEvent('scale', { scale });
    }

    setEngine(engine) {
        if (engine === this.engine) return;
        this.engine = engine;
        const sel = document.getElementById('engineSelect');
        if (sel && sel.value !== engine) sel.value = engine;
        this.logEvent('engine', { engine });
        this.restartIfRunning();
    }

    restartIfRunning() {
        if (this.isRunning) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }
    }

    toggleSpeakerMode() {
        this.setSpeakerMode(!this.speakerMode);
    }

    setSpeakerMode(on) {
        this.speakerMode = !!on;
        this.logEvent('speaker-mode', { on: this.speakerMode });
        this.renderSpeakerMode();
        this.restartIfRunning();
    }

    renderSpeakerMode() {
        const toggle = document.getElementById('speakerModeToggle');
        if (toggle) toggle.classList.toggle('on', this.speakerMode);
        const statusText = document.getElementById('speakerModeStatus');
        if (statusText) {
            statusText.textContent = this.speakerMode
                ? 'Speaker Mode: echo cancellation, harmony gate, feedback guard on; your own voice is not monitored'
                : 'Headphone Mode: full monitoring, no feedback processing';
        }
        const dryNote = document.getElementById('dryNote');
        if (dryNote) dryNote.textContent = this.speakerMode ? 'Muted in Speaker Mode (you hear yourself in the room)' : '';
        this.updateGuardStatus();
    }

    updateGuardStatus() {
        const el = document.getElementById('guardStatus');
        if (!el) return;
        if (!this.speakerMode) { el.textContent = ''; return; }
        const active = this.notches.filter(n => n.active);
        const list = active.map(n => `${n.hz >= 1000 ? (n.hz / 1000).toFixed(2) + ' kHz' : Math.round(n.hz) + ' Hz'}`).join(', ');
        el.textContent = `Feedback guard: ${active.length} notch${active.length === 1 ? '' : 'es'}${list ? ' (' + list + ')' : ''}` +
            (this.isRunning ? ` · gate ${this.gateOpen ? 'open' : 'closed'}` : '');
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
        if (!opts.silent) this.logEvent('mode', { mode });
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
            status.textContent = (this.testOsc
                ? `Test tone input (${this.params.get('freq') || 220} Hz)`
                : 'Listening... Sing something!') + ` · engine: ${this.engine} · ${this.speakerMode ? 'speakers' : 'headphones'}`;
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
        this.updateGuardStatus();
        this.renderRecording();
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
        for (let i = 0; i < 12; i++) this.pitchClassHist[i] *= 0.998;
        this.pitchClassHist[pc] += 1;
        if (now - this.lastKeyScan < 500) return;
        this.lastKeyScan = now;
        const allowed = this.currentScale === 'minor' ? ['minor'] : this.currentScale === 'major' ? ['major'] : ['major', 'minor'];
        const res = detectKeyFromHistogram(Array.from(this.pitchClassHist), allowed);
        if (!res || res.total < 40) return;
        const margin = res.best.score - res.second.score;
        if (!this.detectedKey || res.best.root !== this.detectedKey.root) {
            if (!this.detectedKey || margin > 0.03 || res.best.score > this.detectedKey.score + 0.05) {
                this.detectedKey = { ...res.best };
                this.stableMidi = null;
                this.updateKeyStatus();
                this.logEvent('auto-key', { root: NOTE_NAMES[res.best.root], type: res.best.type, score: +res.best.score.toFixed(3) });
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
            const ctx = this.audioContext;

            // ---- input source
            if (this.params.get('input') === 'tone') {
                const freq = parseFloat(this.params.get('freq') || '220');
                const osc = ctx.createOscillator();
                osc.type = this.params.get('wave') || 'sawtooth';
                osc.frequency.value = freq;
                const lp = ctx.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = 2500;
                const g = ctx.createGain();
                g.gain.value = 0.25;
                osc.connect(lp).connect(g);
                osc.start();
                this.testOsc = osc;
                this.micSource = g;
                const howlHz = parseFloat(this.params.get('howl') || '0');
                if (howlHz > 0) {
                    // a pure line that fades in and keeps rising, like a speaker->mic howl building up
                    const h = ctx.createOscillator();
                    h.type = 'sine';
                    h.frequency.value = howlHz;
                    const hg = ctx.createGain();
                    hg.gain.value = 0.0001;
                    hg.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 2.5);
                    h.connect(hg).connect(g);
                    h.start();
                    this.howlOsc = h;
                }
                this.logEvent('start', { input: 'tone', freq, wave: osc.type, howl: howlHz || null, engine: this.engine, speakerMode: this.speakerMode, sampleRate: ctx.sampleRate });
            } else {
                const audioConstraints = {
                    echoCancellation: this.speakerMode,
                    noiseSuppression: this.speakerMode,
                    autoGainControl: this.speakerMode,
                    sampleRate: ctx.sampleRate
                };
                this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                const track = this.mediaStream.getAudioTracks()[0];
                const settings = track.getSettings();
                console.log('Actual audio settings:', settings);
                this.logEvent('start', { input: 'microphone', requested: audioConstraints, actual: settings, label: track.label, engine: this.engine, speakerMode: this.speakerMode, sampleRate: ctx.sampleRate });
                if (this.speakerMode && settings.echoCancellation === false) {
                    this.logEvent('warning', { message: 'Browser did not apply echo cancellation; relying on gate + feedback guard only' });
                }
                this.micSource = ctx.createMediaStreamSource(this.mediaStream);
            }

            // ---- raw-input analyser for the feedback guard
            this.guardAnalyser = ctx.createAnalyser();
            this.guardAnalyser.fftSize = 4096;
            this.guardAnalyser.smoothingTimeConstant = 0.2;
            this.micSource.connect(this.guardAnalyser);

            // ---- guarded input: [highpass -> notch bank] in speaker mode, straight through otherwise
            this.mic = new Tone.Gain(1);
            this.notchNodes = [];
            this.notches = [];
            if (this.speakerMode) {
                this.hpFilter = ctx.createBiquadFilter();
                this.hpFilter.type = 'highpass';
                this.hpFilter.frequency.value = 120;
                this.hpFilter.Q.value = 0.7;
                let last = this.hpFilter;
                for (let i = 0; i < GUARD.maxNotches; i++) {
                    const n = ctx.createBiquadFilter();
                    n.type = 'notch';
                    n.frequency.value = 20;  // parked: inaudible
                    n.Q.value = GUARD.notchQ;
                    last.connect(n);
                    last = n;
                    this.notchNodes.push(n);
                    this.notches.push({ hz: 20, lastSeen: 0, active: false });
                }
                this.micSource.connect(this.hpFilter);
                last.connect(this.mic.input);
            } else {
                this.micSource.connect(this.mic.input);
            }

            // ---- analysers on the guarded input
            this.pitchAnalyser = ctx.createAnalyser();
            this.pitchAnalyser.fftSize = 2048;
            this.mic.connect(this.pitchAnalyser);
            this.postGuardAnalyser = ctx.createAnalyser();
            this.postGuardAnalyser.fftSize = 4096;
            this.postGuardAnalyser.smoothingTimeConstant = 0.2;
            this.mic.connect(this.postGuardAnalyser);
            this.analyser = new Tone.Analyser('waveform', 2048);
            this.mic.connect(this.analyser);

            // ---- effects and output
            this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: this.chorusAmount });
            this.chorus.start();
            this.reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: this.reverbAmount });
            await this.reverb.generate();
            this.masterGain = new Tone.Gain(1);
            this.limiter = new Tone.Limiter(-3);
            this.dryGain = new Tone.Gain(this.speakerMode ? 0 : this.dryVolume);
            this.gateGain = new Tone.Gain(1);
            this.lpFilter = new Tone.Filter({ type: 'lowpass', frequency: this.speakerMode ? 6000 : 20000, rolloff: -12 });

            // dry: mic -> dryGain -> chorus -> reverb -> master -> limiter -> out
            this.mic.connect(this.dryGain);
            this.dryGain.connect(this.chorus);
            // harmonies: voices -> gateGain -> lpFilter -> chorus
            this.gateGain.connect(this.lpFilter);
            this.lpFilter.connect(this.chorus);
            this.chorus.connect(this.reverb);
            this.reverb.connect(this.masterGain);
            this.masterGain.connect(this.limiter);
            this.limiter.toDestination();

            try {
                await this.createPitchShifters();
            } catch (engineErr) {
                if (this.engine === 'stretch') {
                    console.warn('Signalsmith engine failed, falling back to granular:', engineErr);
                    this.logEvent('engine-fallback', { error: String(engineErr && engineErr.message) });
                    this.engine = 'granular';
                    const sel = document.getElementById('engineSelect');
                    if (sel) sel.value = 'granular';
                    await this.createPitchShifters();
                } else {
                    throw engineErr;
                }
            }

            this.gateOpen = !this.speakerMode;
            if (this.speakerMode) this.gateGain.gain.value = 0;
            this.guardCandidates = [];
            this.isRunning = true;
            this.updateUI();
            this.startPitchDetection();
            this.drawWaveform();
            if (this.params.get('record') === '1') this.startRecording();
        } catch (err) {
            console.error('Error starting:', err);
            this.logEvent('error', { message: String(err && err.message), name: err && err.name });
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
                this.mic.connect(shifter);
                shifter.connect(tap);
                Tone.connect(shifter, gain);
            } else {
                shifter = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0 });
                this.mic.connect(shifter);
                shifter.connect(tap);
                shifter.connect(gain);
            }
            gain.connect(this.gateGain);
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
        if (this.dryGain) this.dryGain.gain.value = this.speakerMode ? 0 : this.dryVolume;
        const four = FOUR_VOICE_MODES.includes(this.currentMode);
        const cap = this.speakerMode ? 0.7 : 1;                       // less gain before feedback
        const duck = (this.speakerMode && performance.now() < this.duckUntil) ? 0.5 : 1;
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
            this.gains[key].gain.value = level * cap * duck;
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

    applyHarmonyForMidi(inputMidi) {
        const key = this.effectiveKey();
        const degreeMode = DEGREE_MODES[this.currentMode];
        const semiMode = SEMITONE_MODES[this.currentMode];
        const shifts = {};
        for (const voice of this.voiceNames()) {
            let shift;
            if (key.type === 'chromatic') {
                shift = semiMode[voice];
            } else {
                shift = harmonyShiftInKey(inputMidi, key.root, SCALES[key.type], degreeMode[voice]);
            }
            this.voiceTargets[voice] = inputMidi + shift;
            this.setVoiceShift(voice, shift);
            shifts[voice] = shift;
        }
        this.logEvent('note', { input: midiToName(inputMidi), midi: inputMidi, key: `${NOTE_NAMES[key.root]} ${key.type}`, shifts });
    }

    stop() {
        if (this.isRecording()) this.stopRecording();
        this.isRunning = false;
        this.logEvent('stop', {});
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        for (const o of [this.testOsc, this.howlOsc]) {
            if (o) { try { o.stop(); } catch (e) { /* ignore */ } }
        }
        this.testOsc = null;
        this.howlOsc = null;
        const nativeNodes = [this.micSource, this.guardAnalyser, this.pitchAnalyser, this.postGuardAnalyser, this.hpFilter, ...this.notchNodes];
        nativeNodes.forEach(n => { if (n) { try { n.disconnect(); } catch (e) { /* ignore */ } } });
        this.micSource = null; this.guardAnalyser = null; this.pitchAnalyser = null; this.postGuardAnalyser = null; this.hpFilter = null;
        this.notchNodes = [];
        this.notches = [];
        this.disposeVoices();
        [this.mic, this.gateGain, this.lpFilter, this.chorus, this.reverb, this.masterGain, this.limiter, this.dryGain, this.analyser]
            .forEach(n => { if (n) { try { n.dispose(); } catch (e) { /* ignore */ } } });
        this.mic = null; this.gateGain = null; this.lpFilter = null; this.chorus = null; this.reverb = null;
        this.masterGain = null; this.limiter = null; this.dryGain = null; this.analyser = null;
        this.smoothedPitch = null;
        this.stableMidi = null;
        this.guardCandidates = [];
        this.updateUI();
    }

    // ---------- Pitch detection + feedback guard loop ----------

    startPitchDetection() {
        const buf = new Float32Array(this.pitchAnalyser.fftSize);
        const detect = () => {
            if (!this.isRunning) return;
            this.frameCounter++;
            const now = performance.now();
            this.pitchAnalyser.getFloatTimeDomainData(buf);
            let rms = 0;
            for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
            rms = Math.sqrt(rms / buf.length);
            this.lastInputRms = rms;
            const pitch = yinPitch(buf, this.audioContext.sampleRate);
            const voiced = !!(pitch && pitch > 60 && pitch < 2000 && rms > 0.004);

            // Spectral analysis every ~100 ms: classify the input and hunt for howls.
            if (this.frameCounter % GUARD.analyseEveryFrames === 0) {
                this.analyseSpectrum(voiced ? pitch : null, now);
            }

            if (voiced) {
                this.smoothedPitch = this.smoothedPitch === null
                    ? pitch
                    : this.smoothedPitch * this.smoothing + pitch * (1 - this.smoothing);
                const midi = Math.round(freqToMidi(this.smoothedPitch));
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
                if (this.keyRoot === 'auto' && this.harmonicVoice) this.accumulateKeyEvidence(midi, now);
                this.updatePitchDisplay(this.smoothedPitch, midi);
            } else {
                this.candidateFrames = 0;
                if (this.lastPitch !== null) document.getElementById('currentNote').classList.remove('singing');
            }

            // Harmony gate (speaker mode): only sing along while a real voice is present.
            if (this.speakerMode) {
                if (voiced && this.harmonicVoice) this.lastVoicedAt = now;
                const shouldOpen = now - this.lastVoicedAt < 220;
                if (shouldOpen !== this.gateOpen) {
                    this.gateOpen = shouldOpen;
                    this.gateGain.gain.rampTo(shouldOpen ? 1 : 0, shouldOpen ? 0.03 : 0.15);
                    this.updateGuardStatus();
                    this.logEvent('gate', { open: shouldOpen });
                }
                if (this.duckUntil && now > this.duckUntil) { this.duckUntil = 0; this.updateGains(); }
            }

            // Periodic stats for the debug log (2 Hz).
            if (now - this.lastStatLog > 500) {
                this.lastStatLog = now;
                this.logEvent('stats', {
                    rms: +rms.toFixed(4), pitch: pitch ? +pitch.toFixed(1) : null, voiced, harmonicVoice: this.harmonicVoice,
                    gate: this.gateOpen, notches: this.notches.filter(n => n.active).map(n => Math.round(n.hz)),
                    peaks: this.lastPeaks.slice(0, 3).map(p => [Math.round(p.hz), Math.round(p.db)])
                });
            }

            requestAnimationFrame(detect);
        };
        detect();
    }

    /** Peak picking on the raw input; voice/pure-tone classification; howl candidate tracking. */
    analyseSpectrum(f0, now) {
        const spec = new Float32Array(this.guardAnalyser.frequencyBinCount);
        this.guardAnalyser.getFloatFrequencyData(spec);
        const binHz = this.audioContext.sampleRate / this.guardAnalyser.fftSize;
        const peaks = findSpectralPeaks(spec, binHz, GUARD.minHz, GUARD.maxHz, 8, -70);
        this.lastPeaks = peaks;

        // Does the input look like a voice? A sung note carries several harmonics of f0;
        // feedback is a single line. Count harmonics present among the peaks.
        let harmonicsFound = 0;
        const isHarmonicOf = (hz) => {
            if (!f0) return false;
            const k = Math.round(hz / f0);
            return k >= 1 && k <= 16 && Math.abs(hz - k * f0) / (k * f0) < 0.03;
        };
        if (f0) {
            for (let k = 1; k <= 6; k++) {
                if (peaks.some(p => Math.abs(p.hz - k * f0) / (k * f0) < 0.03)) harmonicsFound++;
            }
        }
        this.harmonicVoice = f0 ? harmonicsFound >= 2 : false;
        if (!this.speakerMode) return;

        // Howl candidates: strong, non-harmonic lines (or the lone line of a pure tone).
        const strong = peaks.filter(p => p.papr >= GUARD.peakPapr && p.db >= GUARD.minLevelDb &&
            !(this.harmonicVoice && isHarmonicOf(p.hz)));
        for (const p of strong) {
            let c = this.guardCandidates.find(x => Math.abs(x.hz - p.hz) / p.hz < 0.03);
            if (c) {
                c.frames++; c.lastDb = p.db; c.lastSeen = now; c.hz = 0.8 * c.hz + 0.2 * p.hz;
            } else {
                c = { hz: p.hz, frames: 1, firstDb: p.db, lastDb: p.db, lastSeen: now };
                this.guardCandidates.push(c);
            }
            const rising = c.lastDb - c.firstDb >= GUARD.riseDb;
            if (c.frames >= GUARD.confirmFrames && (rising || c.frames >= GUARD.sustainFrames)) {
                this.engageNotch(c.hz, now);
                c.firstDb = c.lastDb; // re-arm: a further rise re-triggers the duck
            }
        }
        this.guardCandidates = this.guardCandidates.filter(c => now - c.lastSeen < 350);

        // Release notches that have not been needed for a while.
        this.notches.forEach((n, i) => {
            if (n.active && now - n.lastSeen > GUARD.releaseMs) {
                n.active = false;
                this.notchNodes[i].frequency.setTargetAtTime(20, this.audioContext.currentTime, 0.05);
                this.logEvent('notch-released', { hz: Math.round(n.hz) });
                this.updateGuardStatus();
            }
        });
    }

    engageNotch(hz, now) {
        let idx = this.notches.findIndex(n => n.active && Math.abs(n.hz - hz) / hz < 0.04);
        const fresh = idx < 0;
        if (fresh) {
            idx = this.notches.findIndex(n => !n.active);
            if (idx < 0) {
                idx = 0;
                this.notches.forEach((n, i) => { if (n.lastSeen < this.notches[idx].lastSeen) idx = i; });
            }
        }
        const n = this.notches[idx];
        n.hz = fresh ? hz : 0.7 * n.hz + 0.3 * hz;
        n.lastSeen = now;
        n.active = true;
        const node = this.notchNodes[idx];
        node.frequency.setTargetAtTime(n.hz, this.audioContext.currentTime, 0.01);
        node.Q.value = GUARD.notchQ;
        if (fresh) {
            this.guardEvents++;
            this.duckUntil = now + GUARD.duckMs;
            this.updateGains();
            console.log(`Feedback guard: notch ${idx} at ${n.hz.toFixed(0)} Hz`);
            this.logEvent('notch', { slot: idx, hz: Math.round(n.hz) });
        }
        this.updateGuardStatus();
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

    setTestFrequency(hz) {
        if (this.testOsc) this.testOsc.frequency.setTargetAtTime(hz, this.audioContext.currentTime, 0.01);
    }

    /** Measure the pitch actually coming out of each harmony voice. */
    measureVoices() {
        const out = { engine: this.engine, speakerMode: this.speakerMode, gateOpen: this.gateOpen,
            harmonicVoice: this.harmonicVoice, key: this.effectiveKey(), detectedKey: this.detectedKey, input: null, voices: {} };
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

    /** Feedback-guard state plus the input level at `hz` before and after the notch bank. */
    measureGuard(hz) {
        const levelAt = (an, f) => {
            if (!an) return null;
            const spec = new Float32Array(an.frequencyBinCount);
            an.getFloatFrequencyData(spec);
            const binHz = this.audioContext.sampleRate / an.fftSize;
            const b = Math.round(f / binHz);
            let m = -Infinity;
            for (let i = Math.max(0, b - 2); i <= Math.min(spec.length - 1, b + 2); i++) m = Math.max(m, spec[i]);
            return m;
        };
        return {
            speakerMode: this.speakerMode,
            gateOpen: this.gateOpen,
            harmonicVoice: this.harmonicVoice,
            guardEvents: this.guardEvents,
            inputRms: this.lastInputRms,
            notches: this.notches.filter(n => n.active).map(n => ({ hz: n.hz })),
            peaks: this.lastPeaks.slice(0, 6).map(p => ({ hz: Math.round(p.hz), db: Math.round(p.db), papr: Math.round(p.papr) })),
            preDb: hz ? levelAt(this.guardAnalyser, hz) : null,
            postDb: hz ? levelAt(this.postGuardAnalyser, hz) : null
        };
    }

    async engineLatency() {
        if (this.engine === 'stretch') {
            const any = Object.values(this.pitchShifters)[0];
            if (any && any.latency) return await any.latency();
            return null;
        }
        return 0.1;
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

window.HarmonyTheory = { harmonyShiftInKey, detectKeyFromHistogram, yinPitch, findSpectralPeaks, midiToName, freqToMidi, midiToFreq, SCALES, DEGREE_MODES, SEMITONE_MODES, GUARD };

window.addEventListener('DOMContentLoaded', () => {
    window.harmonySinger = new HarmonySinger();
});
