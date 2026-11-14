/**
 * Offline closed-loop simulator for speaker mode. No browser, no sound card, nothing audible.
 *
 *   synthetic singer ──┐
 *                      ▼
 *   room echo ──────► mic ──► echo canceller ──► [gate/trim] ──► pitch shifter(s) ──► limiter ──► speaker
 *        ▲                                                                                │
 *        └──────────────── bulk delay + room impulse response (+ distortion) ◄────────────┘
 *
 * Everything the real app cannot know (the clean singer, the true echo) is known here, so the
 * tests can measure what matters: is the singer preserved, do the harmonies keep sounding, and
 * does the loop die away when the singer stops.
 *
 * This is a model. It says nothing about how a real room, a real laptop or a real voice behave.
 */
'use strict';

const path = require('path');
const { EchoCancellerCore } = require(path.join(__dirname, '..', '..', 'echo-canceller.js'));

const N = 128;

function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * Sung vowel: harmonics under a fixed formant envelope, vibrato, slow pitch drift, breath noise.
 * notes: [{ midi, start, end }] in seconds. steady=true removes vibrato/drift (worst case for bias).
 */
function synthSinger(sr, seconds, notes, opts = {}) {
    const n = Math.round(sr * seconds), out = new Float32Array(n);
    const rand = rng(opts.seed || 7);
    const level = opts.level ?? 0.12;
    const formants = [[650, 90, 1], [1100, 110, 0.6], [2700, 170, 0.25], [3500, 250, 0.1]];
    const env = (f) => {
        let g = 0;
        for (const [fc, bw, a] of formants) g += a / (1 + Math.pow((f - fc) / bw, 2));
        return g + 0.02;
    };
    const vibHz = 5.4, vibCents = opts.steady ? 0 : (opts.vibratoCents ?? 28);
    let drift = 0, phase = 0, amp = 0;
    const attack = 1 / (0.03 * sr), release = 1 / (0.06 * sr);
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        const note = notes.find(x => t >= x.start && t < x.end);
        const target = note ? 1 : 0;
        amp += (target - amp) * (target > amp ? attack : release) * 4;
        if (!note && amp < 1e-4) { out[i] = (rand() - 0.5) * 2e-4; continue; }
        const midi = note ? note.midi : synthSinger.lastMidi;
        synthSinger.lastMidi = midi;
        if (!opts.steady) drift += (rand() - 0.5) * 0.002 - drift * 0.0002;
        const cents = vibCents * Math.sin(2 * Math.PI * vibHz * t) + drift * 100;
        const f0 = 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
        phase += 2 * Math.PI * f0 / sr;
        if (phase > 2 * Math.PI * 64) phase -= 2 * Math.PI * 64;
        let v = 0;
        const maxH = Math.min(40, Math.floor(0.45 * sr / f0));
        for (let h = 1; h <= maxH; h++) v += env(h * f0) / h * Math.sin(h * phase);
        out[i] = amp * (level * v * 0.9 + (rand() - 0.5) * level * 0.02);
    }
    return out;
}
synthSinger.lastMidi = 60;

/** Speaker -> mic path: direct sound, a few early reflections, exponentially decaying tail. */
function makeRoom(sr, opts = {}) {
    const rt60 = opts.rt60 ?? 0.3, len = Math.round(sr * (opts.lengthS ?? Math.min(0.3, rt60)));
    const h = new Float32Array(len), rand = rng(opts.seed || 11);
    h[0] = 1;
    for (const [ms, g] of [[1.3, -0.5], [3.1, 0.35], [7.7, -0.28], [12.4, 0.2]]) h[Math.round(sr * ms / 1000)] += g;
    const tailGain = opts.tailGain ?? 0.25, tau = rt60 / 6.91;
    // sparse tail (every 5th tap) keeps the simulation fast; density does not matter to the canceller
    for (let i = Math.round(sr * 0.004); i < len; i += 5) h[i] += tailGain * (rand() - 0.5) * 2 * Math.exp(-i / sr / tau) * 0.4;
    let e = 0;
    for (let i = 0; i < len; i++) e += h[i] * h[i];
    const g = (opts.gain ?? 1) / Math.sqrt(e);
    for (let i = 0; i < len; i++) h[i] *= g;      // unit-energy path times `gain`
    return h;
}

/** Granular (two-tap crossfaded delay-line) pitch shifter: crude, but the frequencies are right. */
class GrainShifter {
    constructor(sr, semitones, windowMs = 50, extraDelayMs = 30) {
        this.ratio = Math.pow(2, semitones / 12);
        this.win = Math.round(sr * windowMs / 1000);
        this.extra = Math.round(sr * extraDelayMs / 1000);
        this.size = 1;
        while (this.size < this.win * 2 + this.extra + 4 * N) this.size <<= 1;
        this.buf = new Float32Array(this.size);
        this.pos = 0;
        this.phase = 0;
    }

    setSemitones(st) { this.ratio = Math.pow(2, st / 12); }

    process(x) {
        const mask = this.size - 1, W = this.win;
        this.buf[this.pos & mask] = x;
        const rate = (1 - this.ratio) / W;         // delay sweep per sample, in window units
        this.phase += rate;
        this.phase -= Math.floor(this.phase);
        let y = 0;
        for (let k = 0; k < 2; k++) {
            let p = this.phase + k * 0.5;
            p -= Math.floor(p);
            const d = p * W + this.extra;
            const i0 = Math.floor(d), fr = d - i0;
            const a = this.buf[(this.pos - i0) & mask], b = this.buf[(this.pos - i0 - 1) & mask];
            y += (a + (b - a) * fr) * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
        }
        this.pos++;
        return y;
    }
}

function rms(a, from = 0, to = a.length) {
    let s = 0;
    for (let i = from; i < to; i++) s += a[i] * a[i];
    return Math.sqrt(s / Math.max(1, to - from));
}
const db = (x) => 20 * Math.log10(x + 1e-12);

/**
 * Run the loop.
 * @param {object} o
 *   near        Float32Array   the clean singer at the mic
 *   sr          sample rate
 *   shifts      semitone shifts of the harmony voices, e.g. [4, -3]
 *   harmonyGain linear gain per voice from cleaned mic to speaker
 *   room        impulse response from makeRoom (already includes the coupling gain)
 *   delayMs     bulk output+input latency of the round trip
 *   canceller   'on' | 'off'
 *   refDelay    bulk delay handed to the canceller (samples); default = true delay minus 2 ms
 *   distortion  drive of an asymmetric soft clipper standing in for a small speaker (0 = linear)
 *   control     optional (state) => { gate, trim, adapt } called once per block for gate/trim logic
 *   probe       optional Float32Array played before the singer starts (speaker check)
 *   pathChange  optional { at: seconds, room: Float32Array, delayMs } to swap the echo path mid-run
 */
function runLoop(o) {
    const sr = o.sr, total = o.near.length;
    const delay = Math.round(sr * (o.delayMs ?? 40) / 1000);
    let room = o.room, roomDelay = delay;
    const histSize = 1 << 17, hmask = histSize - 1;
    const hist = new Float32Array(histSize);                // speaker signal history (after distortion)
    const core = new EchoCancellerCore({ sampleRate: sr, tailMs: o.tailMs, ...(o.coreOptions || {}) });
    const refDelay = o.refDelay ?? Math.max(0, delay - Math.round(sr * 0.002) - N);
    core.setDelay(refDelay);
    core.bypass = o.canceller === 'off';
    const shifters = (o.shifts || [4]).map(st => new GrainShifter(sr, st));
    const mic = new Float32Array(total), cleaned = new Float32Array(total), speaker = new Float32Array(total), echo = new Float32Array(total);
    const micBlk = new Float32Array(N), refBlk = new Float32Array(N), outBlk = new Float32Array(N), prevSpk = new Float32Array(N);
    const rand = rng(o.noiseSeed || 3);
    const noise = o.micNoise ?? 3e-4;
    const dist = o.distortion || 0;
    const trace = [];
    let gateGain = 1, trim = 1, gateTarget = 1;
    const probe = o.probe || null;
    // sparse room taps for speed
    let taps = sparse(room);
    function sparse(h) { const idx = [], val = []; for (let i = 0; i < h.length; i++) if (Math.abs(h[i]) > 1e-6) { idx.push(i); val.push(h[i]); } return { idx: Int32Array.from(idx), val: Float32Array.from(val) }; }

    for (let p = 0; p + N <= total; p += N) {
        if (o.pathChange && p <= o.pathChange.at * sr && p + N > o.pathChange.at * sr) {
            room = o.pathChange.room; taps = sparse(room);
            if (o.pathChange.delayMs != null) roomDelay = Math.round(sr * o.pathChange.delayMs / 1000);
        }
        // microphone = singer + echo of everything the speaker has played + noise floor
        for (let i = 0; i < N; i++) {
            const t = p + i;
            let ech = 0;
            const base = t - roomDelay;
            const idx = taps.idx, val = taps.val;
            for (let k = 0; k < idx.length; k++) ech += val[k] * hist[(base - idx[k]) & hmask];
            echo[t] = ech;
            micBlk[i] = o.near[t] + ech + (rand() - 0.5) * 2 * noise;
            mic[t] = micBlk[i];
        }
        // the Web Audio graph hands the canceller the previous block of the speaker feed
        refBlk.set(prevSpk);
        core.processFrame(micBlk, refBlk, outBlk);
        const st = core.stats();
        if (o.control) {
            const c = o.control({ t: p / sr, stats: st, cleanedRms: rms(outBlk), nearRms: rms(o.near, p, p + N) });
            if (c) { if (c.gate != null) gateTarget = c.gate ? 1 : 0; if (c.trim != null) trim = c.trim; if (c.adapt != null) core.adaptEnabled = c.adapt; }
        }
        for (let i = 0; i < N; i++) {
            const t = p + i;
            cleaned[t] = outBlk[i];
            gateGain += (gateTarget - gateGain) * (gateTarget > gateGain ? 0.02 : 0.004);
            let h = 0;
            for (const s of shifters) h += s.process(outBlk[i]);
            let spk = h * (o.harmonyGain ?? 1) * gateGain * trim;
            if (probe && t < probe.length) spk += probe[t];
            spk = Math.tanh(spk);                                   // limiter stand-in
            if (spk < 1e-12 && spk > -1e-12) spk = 0;
            speaker[t] = spk;
            prevSpk[i] = spk;
            // small-speaker distortion: asymmetric soft clipper, `dist` = drive (0 = perfectly linear)
            hist[t & hmask] = dist ? (Math.tanh(dist * spk + 0.25) - 0.24491866) / (dist * 0.94001515) : spk;
        }
        if ((p / N) % 8 === 0) trace.push({ t: p / sr, erleDb: st.erleDb, leak: st.leak, adapted: st.adapted, micDb: st.micDb, outDb: st.outDb, echoDb: st.echoDb, gate: gateTarget, trim });
    }
    return { mic, cleaned, speaker, echo, trace, core, refDelay, sr };
}

/** The harmonies an ideal echo-free system would have produced from the clean singer. */
function idealSpeaker(o) {
    const shifters = (o.shifts || [4]).map(st => new GrainShifter(o.sr, st));
    const out = new Float32Array(o.near.length);
    for (let i = 0; i < out.length; i++) {
        let h = 0;
        for (const s of shifters) h += s.process(o.near[i]);
        out[i] = Math.tanh(h * (o.harmonyGain ?? 1));
    }
    return out;
}

/** Short-time level track in dB (hop = 1024 samples). */
function levelTrack(a, hop = 1024) {
    const out = [];
    for (let p = 0; p + hop <= a.length; p += hop) out.push(db(rms(a, p, p + hop)));
    return out;
}

module.exports = { N, rng, synthSinger, makeRoom, GrainShifter, runLoop, idealSpeaker, levelTrack, rms, db };
