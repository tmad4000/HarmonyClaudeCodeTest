/**
 * Harmony Singer — reference echo canceller (speaker mode).
 *
 * Why this exists: a browser's built-in echoCancellation is a telephony canceller. It expects
 * people to take turns, and when the far end (our harmonies) and the near end (the singer) are
 * both active all the time it protects the call by attenuating the microphone — which is the
 * singer, which is the very signal the harmonies are made from. This canceller instead knows the
 * exact samples we send to the speakers, models the speaker -> room -> mic path with an adaptive
 * filter, and SUBTRACTS the predicted echo. It never applies a gain to the microphone, so the
 * singer is not ducked; what it cannot predict is left in (and reported), not suppressed.
 *
 * Algorithm: multidelay block frequency-domain adaptive filter (Soo & Pang 1990) with the
 * double-talk-robust learning rate of J.-M. Valin, "On Adjusting the Learning Rate in Frequency
 * Domain Echo Cancellation With Double-Talk", IEEE TASLP 15(3), 2007, plus a foreground /
 * background ("two-path") filter pair so a bad adaptation step is never heard. The structure and
 * tuning constants follow the reference implementation in speexdsp (libspeexdsp/mdf.c, BSD
 * licence, (C) 2003-2008 Jean-Marc Valin); this is an independent JavaScript implementation.
 * Signals are scaled to a 16-bit range internally so those constants keep their meaning.
 *
 * Block = 128 samples = one Web Audio render quantum, so the mic path gains no latency.
 *
 * The same file runs in three places:
 *   - AudioWorkletGlobalScope: registers the 'harmony-echo-canceller' processor
 *       input 0 = microphone, input 1 = playback reference, output 0 = microphone minus echo
 *   - the page (plain <script>): window.HarmonyEchoCanceller.{estimateDelay, makeProbe, ...}
 *   - Node (require): the same API, for the offline tests in test/echo_canceller.test.cjs
 */
(function (root) {
    'use strict';

    // ---------------------------------------------------------------- FFT

    /** Radix-2 complex FFT used as a real FFT. forward() scales by 1/L, inverse() is unscaled. */
    class RealFFT {
        constructor(size) {
            if (size & (size - 1)) throw new Error('FFT size must be a power of two');
            this.L = size;
            this.half = size >> 1;
            this.re = new Float64Array(size);
            this.im = new Float64Array(size);
            this.rev = new Uint32Array(size);
            let bits = 0;
            while ((1 << bits) < size) bits++;
            for (let i = 0; i < size; i++) {
                let r = 0;
                for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
                this.rev[i] = r;
            }
            this.cos = new Float64Array(this.half);
            this.sin = new Float64Array(this.half);
            for (let i = 0; i < this.half; i++) {
                this.cos[i] = Math.cos(2 * Math.PI * i / size);
                this.sin[i] = Math.sin(2 * Math.PI * i / size);
            }
        }

        transform() {
            const L = this.L, re = this.re, im = this.im, cos = this.cos, sin = this.sin;
            for (let size = 2; size <= L; size <<= 1) {
                const halfSize = size >> 1, step = L / size;
                for (let start = 0; start < L; start += size) {
                    for (let k = 0, t = 0; k < halfSize; k++, t += step) {
                        const a = start + k, b = a + halfSize;
                        const wr = cos[t], wi = -sin[t];
                        const xr = re[b] * wr - im[b] * wi;
                        const xi = re[b] * wi + im[b] * wr;
                        re[b] = re[a] - xr; im[b] = im[a] - xi;
                        re[a] += xr; im[a] += xi;
                    }
                }
            }
        }

        /** x: real[L] -> outRe/outIm: [L/2+1] (offset `o`), scaled by 1/L. */
        forward(x, outRe, outIm, o = 0) {
            const L = this.L, re = this.re, im = this.im, rev = this.rev, s = 1 / L;
            for (let i = 0; i < L; i++) { re[rev[i]] = x[i]; im[rev[i]] = 0; }
            this.transform();
            for (let k = 0; k <= this.half; k++) { outRe[o + k] = re[k] * s; outIm[o + k] = im[k] * s; }
        }

        /** inRe/inIm: [L/2+1] (offset `o`) -> out: real[L], unscaled. */
        inverse(inRe, inIm, out, o = 0) {
            const L = this.L, H = this.half, re = this.re, im = this.im, rev = this.rev;
            // real ifft(X) = Re(fft(conj(X))) for a Hermitian spectrum
            for (let k = 0; k <= H; k++) { const r = rev[k]; re[r] = inRe[o + k]; im[r] = -inIm[o + k]; }
            for (let k = H + 1; k < L; k++) { const r = rev[k]; re[r] = inRe[o + L - k]; im[r] = inIm[o + L - k]; }
            this.transform();
            for (let i = 0; i < L; i++) out[i] = re[i];
        }
    }

    // ---------------------------------------------------------------- adaptive canceller

    const SCALE = 32768;
    const MIN_LEAK = 0.005;        // "we don't really hope to get better than 33 dB attenuation"
    const VAR1_UPDATE = 0.5, VAR2_UPDATE = 0.25, VAR_BACKTRACK = 4;

    class EchoCancellerCore {
        /**
         * @param {object} o
         * @param {number} o.sampleRate
         * @param {number} [o.tailMs=110]   echo path the filter can model, after the bulk delay
         * @param {number} [o.maxDelayMs=700] longest bulk delay the reference line can hold
         * @param {number} [o.delaySamples=0] bulk delay applied to the reference
         */
        constructor(o) {
            const sr = this.sampleRate = o.sampleRate || 48000;
            const N = this.N = 128;
            this.tailMs = o.tailMs || 110;
            this.muMax = o.muMax ?? 0.5;
            const M = this.M = Math.max(4, Math.ceil(this.tailMs / 1000 * sr / N));
            const K = this.K = N + 1;
            this.fft = new RealFFT(2 * N);

            this.preemph = 0.9;
            // DC blocker only (corner ~25 Hz at 48 kHz); speexdsp uses .992 here, which starts to shave low bass notes
            this.notchRadius = sr < 12000 ? 0.9 : sr < 24000 ? 0.982 : 0.997;
            this.specAverage = N / sr;
            this.beta0 = 2 * N / sr;
            this.betaMax = 0.5 * N / sr;

            this.ringSize = 1;
            const need = Math.ceil((o.maxDelayMs || 700) / 1000 * sr) + 4 * N;
            while (this.ringSize < need) this.ringSize <<= 1;
            this.ring = new Float32Array(this.ringSize);
            this.ringPos = 0;
            this.delay = 0;

            this.x = new Float64Array(2 * N);
            this.input = new Float64Array(N);
            this.dRaw = new Float64Array(N);
            this.e = new Float64Array(2 * N);
            this.y = new Float64Array(2 * N);
            this.wtmp = new Float64Array(2 * N);
            this.Xre = new Float64Array((M + 1) * K); this.Xim = new Float64Array((M + 1) * K);
            // Float64 on purpose: Float32 weights decay into denormals in unused partitions and stall the audio thread
            this.Wre = new Float64Array(M * K); this.Wim = new Float64Array(M * K);
            this.Fre = new Float64Array(M * K); this.Fim = new Float64Array(M * K);
            this.Yre = new Float64Array(K); this.Yim = new Float64Array(K);
            this.Ere = new Float64Array(K); this.Eim = new Float64Array(K);
            this.power = new Float64Array(K); this.power1 = new Float64Array(K);
            this.Eh = new Float64Array(K); this.Yh = new Float64Array(K);
            this.Xf = new Float64Array(K);
            this.prop = new Float64Array(M);
            this.window = new Float64Array(2 * N);
            for (let i = 0; i < 2 * N; i++) this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (2 * N));

            this.adaptEnabled = true;
            this.bypass = false;
            this.resets = 0;
            this.relearns = 0;
            this.worseLimit = Math.max(8, Math.round(0.12 * sr / N));   // ~120 ms
            this.frames = 0;
            this.setDelay(o.delaySamples || 0);
        }

        /** Forget the echo path (keeps the bulk delay and the reference history). */
        reset() {
            const M = this.M;
            this.Xre.fill(0); this.Xim.fill(0);
            this.Wre.fill(0); this.Wim.fill(0); this.Fre.fill(0); this.Fim.fill(0);
            this.Ere.fill(0); this.Eim.fill(0);
            this.power.fill(0); this.power1.fill(1); this.Eh.fill(0); this.Yh.fill(0);
            this.x.fill(0); this.e.fill(0); this.y.fill(0);
            this.xHead = 0;
            const decay = Math.exp(-2.4 / M);
            let sum = 0;
            for (let j = 0; j < M; j++) { this.prop[j] = j === 0 ? 0.7 : this.prop[j - 1] * decay; sum += this.prop[j]; }
            for (let j = 0; j < M; j++) this.prop[j] = 0.8 * this.prop[j] / sum;
            this.memX = 0; this.memD = 0; this.memE = 0;
            this.notchMem0 = 0; this.notchMem1 = 0;
            this.adapted = false; this.sumAdapt = 0; this.saturated = 0; this.screwedUp = 0; this.activeFrames = 0;
            this.cancelCount = 0;
            this.worseFrames = 0; this.sffS = 0; this.sddS = 0; this.syyS = 0;
            this.Pey = 1; this.Pyy = 1; this.leak = 0;
            this.Davg1 = 0; this.Davg2 = 0; this.Dvar1 = 0; this.Dvar2 = 0;
            // smoothed linear powers in full-scale units (not the 16-bit domain)
            this.micPow = 0; this.outPow = 0; this.echoPow = 0; this.refPow = 0;
            this.micPowSlow = 0; this.outPowSlow = 0; this.echoPowSlow = 0; this.refPowSlow = 0;
        }

        /** Drop the learned path but keep signal history: used when the model is making things worse. */
        relearn() {
            this.Wre.fill(0); this.Wim.fill(0); this.Fre.fill(0); this.Fim.fill(0);
            this.Ere.fill(0); this.Eim.fill(0); this.Eh.fill(0); this.Yh.fill(0);
            this.adapted = false; this.sumAdapt = 0; this.screwedUp = 0; this.activeFrames = 0;
            this.Pey = 1; this.Pyy = 1; this.leak = 0;
            this.Davg1 = 0; this.Davg2 = 0; this.Dvar1 = 0; this.Dvar2 = 0;
            this.worseFrames = 0; this.sffS = 0; this.sddS = 0; this.syyS = 0;
            this.relearns++;
        }

        setDelay(samples) {
            const d = Math.max(0, Math.min(this.ringSize - 4 * this.N, Math.round(samples)));
            this.delay = d;
            this.reset();
        }

        /**
         * One 128-sample block. mic/ref/out are array-likes of length 128 in [-1, 1].
         * out = mic - estimated echo (a DC-blocked copy of mic when bypassed).
         */
        processFrame(mic, ref, out) {
            const N = this.N, M = this.M, K = this.K, fft = this.fft;
            const x = this.x, input = this.input, dRaw = this.dRaw, e = this.e, y = this.y;
            const ring = this.ring, mask = this.ringSize - 1;
            this.frames++;

            // -- reference into the delay line, delayed + pre-emphasised reference out
            let rp = this.ringPos;
            for (let i = 0; i < N; i++) { const v = ref ? ref[i] : 0; ring[(rp + i) & mask] = (v < 1e-15 && v > -1e-15) ? 0 : v; }
            const readBase = rp - this.delay;
            let Sxx = 0, refRaw = 0;
            for (let i = 0; i < N; i++) {
                x[i] = x[i + N];
                const r = ring[(readBase + i) & mask] * SCALE;
                refRaw += r * r;
                const v = r - this.preemph * this.memX;
                this.memX = r;
                x[i + N] = v;
                Sxx += v * v;
            }
            this.ringPos = (rp + N) & mask;

            // -- microphone: DC notch, then pre-emphasis
            const radius = this.notchRadius;
            const den2 = radius * radius + 0.7 * (1 - radius) * (1 - radius);
            let micRaw = 0, clipped = false;
            for (let i = 0; i < N; i++) {
                const m = mic ? mic[i] : 0;
                if (m >= 0.98 || m <= -0.98) clipped = true;
                const vin = m * SCALE + 1e-9;
                const vout = this.notchMem0 + vin;
                this.notchMem0 = this.notchMem1 + 2 * (-vin + radius * vout);
                this.notchMem1 = vin - den2 * vout;
                const d = radius * vout;
                dRaw[i] = d;
                micRaw += d * d;
                input[i] = d - this.preemph * this.memD;
                this.memD = d;
            }
            if (clipped && this.saturated === 0) this.saturated = 1;

            if (this.bypass) {
                for (let i = 0; i < N; i++) out[i] = dRaw[i] / SCALE;
                this.trackPowers(micRaw, micRaw, 0, refRaw);
                return;
            }

            // -- newest reference spectrum into the history (circular)
            this.xHead = (this.xHead + M) % (M + 1);
            const h = this.xHead;
            fft.forward(x, this.Xre, this.Xim, h * K);
            const Xre = this.Xre, Xim = this.Xim, Xf = this.Xf;
            for (let k = 0, o = h * K; k < K; k++, o++) Xf[k] = Xre[o] * Xre[o] + Xim[o] * Xim[o];

            // -- foreground filter response (this is what the listener hears subtracted)
            const Yre = this.Yre, Yim = this.Yim;
            this.filterResponse(this.Fre, this.Fim, e);
            let Sff = 0, SyyF = 0, SddNow = 0;
            for (let i = 0; i < N; i++) {
                const v = input[i] - e[i + N];
                SyyF += e[i + N] * e[i + N]; SddNow += input[i] * input[i];
                e[i] = v; Sff += v * v;
            }
            // Health: a correct echo estimate can only take energy OUT of the microphone. If, for longer
            // than a beat between neighbouring partials, subtracting it leaves MORE energy than the mic
            // had, the model no longer matches the room (the delay jumped, the laptop moved): stop
            // subtracting at once and re-learn, rather than play a wrong "anti-echo" into the loop.
            this.sffS += 0.1 * (Sff - this.sffS); this.sddS += 0.1 * (SddNow - this.sddS); this.syyS += 0.1 * (SyyF - this.syyS);
            if (this.sffS > this.sddS + 0.5 * this.syyS && this.syyS > 0.02 * this.sddS && this.syyS > N * 25) {
                if (++this.worseFrames >= this.worseLimit) { this.relearn(); Sff = SddNow; for (let i = 0; i < N; i++) { e[i] = input[i]; e[i + N] = 0; } }
            } else {
                this.worseFrames = 0;
            }

            // -- adapt the background filter with the previous block's error
            const Wre = this.Wre, Wim = this.Wim, Ere = this.Ere, Eim = this.Eim, power1 = this.power1;
            if (this.adapted) this.adjustProp();
            if (this.saturated === 0) {
                if (this.adaptEnabled) {
                    for (let j = M - 1; j >= 0; j--) {
                        const xo = ((h + j + 1) % (M + 1)) * K, wo = j * K, pj = this.prop[j];
                        for (let k = 0; k < K; k++) {
                            const xr = Xre[xo + k], xi = Xim[xo + k], er = Ere[k], ei = Eim[k];
                            const g = power1[k] * pj;
                            Wre[wo + k] += g * (xr * er + xi * ei);
                            Wim[wo + k] += g * (xr * ei - xi * er);
                        }
                    }
                }
            } else {
                this.saturated--;
            }

            // -- keep the filter causal/finite: constrain partition 0 always, one other per block
            const wtmp = this.wtmp;
            for (let j = 0; j < M; j++) {
                if (j === 0 || this.cancelCount % (M - 1) === j - 1) {
                    fft.inverse(Wre, Wim, wtmp, j * K);
                    for (let i = N; i < 2 * N; i++) wtmp[i] = 0;
                    fft.forward(wtmp, Wre, Wim, j * K);
                }
            }
            this.cancelCount++;

            // -- background filter response
            this.filterResponse(Wre, Wim, y);
            let Dbf = 10, See = 0;
            for (let i = 0; i < N; i++) { const v = e[i + N] - y[i + N]; Dbf += v * v; }
            for (let i = 0; i < N; i++) { const v = input[i] - y[i + N]; e[i] = v; See += v * v; }

            // -- two-path logic: promote the background filter only when it is reliably better
            const diff = Sff - See;
            this.Davg1 = 0.6 * this.Davg1 + 0.4 * diff;
            this.Davg2 = 0.85 * this.Davg2 + 0.15 * diff;
            this.Dvar1 = 0.36 * this.Dvar1 + 0.16 * Sff * Dbf;
            this.Dvar2 = 0.7225 * this.Dvar2 + 0.0225 * Sff * Dbf;
            let update = false;
            if (diff * Math.abs(diff) > Sff * Dbf) update = true;
            else if (this.Davg1 * Math.abs(this.Davg1) > VAR1_UPDATE * this.Dvar1) update = true;
            else if (this.Davg2 * Math.abs(this.Davg2) > VAR2_UPDATE * this.Dvar2) update = true;
            if (update) {
                this.Davg1 = this.Davg2 = 0; this.Dvar1 = this.Dvar2 = 0;
                this.Fre.set(Wre); this.Fim.set(Wim);
                const win = this.window;
                for (let i = 0; i < N; i++) e[i + N] = win[i + N] * e[i + N] + win[i] * y[i + N];
            } else {
                let resetBg = false;
                if (-diff * Math.abs(diff) > VAR_BACKTRACK * Sff * Dbf) resetBg = true;
                if (-this.Davg1 * Math.abs(this.Davg1) > VAR_BACKTRACK * this.Dvar1) resetBg = true;
                if (-this.Davg2 * Math.abs(this.Davg2) > VAR_BACKTRACK * this.Dvar2) resetBg = true;
                if (resetBg) {
                    Wre.set(this.Fre); Wim.set(this.Fim);
                    for (let i = 0; i < N; i++) y[i + N] = e[i + N];
                    for (let i = 0; i < N; i++) e[i] = input[i] - y[i + N];
                    See = Sff;
                    this.Davg1 = this.Davg2 = 0; this.Dvar1 = this.Dvar2 = 0;
                }
            }

            // -- output: mic minus foreground echo estimate, de-emphasised
            let outPow = 0, echoPow = 0;
            for (let i = 0; i < N; i++) {
                const v = (input[i] - e[i + N]) + this.preemph * this.memE;
                this.memE = v;
                out[i] = v / SCALE;
                outPow += v * v;
                const ech = dRaw[i] - v;
                echoPow += ech * ech;
            }

            // -- error and echo spectra for the next adaptation step
            let Sey = 0, Syy = 0, Sdd = 0;
            for (let i = 0; i < N; i++) {
                e[i + N] = e[i]; e[i] = 0;
                Sey += e[i + N] * y[i + N];
                Syy += y[i + N] * y[i + N];
                Sdd += input[i] * input[i];
                y[i] = 0;
            }
            fft.forward(e, Ere, Eim, 0);
            fft.forward(y, Yre, Yim, 0);

            // -- sanity: if the canceller is adding echo, start again rather than fight the singer
            if (!(Syy >= 0 && Sxx >= 0 && See >= 0) || !isFinite(outPow)) {
                this.screwedUp += 50;
                for (let i = 0; i < N; i++) out[i] = dRaw[i] / SCALE;
                outPow = micRaw; echoPow = 0;
            } else if (Sff > Sdd + N * 10000) {
                this.screwedUp++;
            } else {
                this.screwedUp = 0;
            }
            if (this.screwedUp >= 50) {
                this.resets++;
                const memE = this.memE, memD = this.memD, n0 = this.notchMem0, n1 = this.notchMem1;
                this.reset();
                // keep the microphone-side filter memories so the output does not click
                this.memE = isFinite(memE) ? memE : 0; this.memD = memD; this.notchMem0 = n0; this.notchMem1 = n1;
                this.trackPowers(micRaw, outPow, echoPow, refRaw);
                return;
            }
            if (See < N * 100) See = N * 100;

            // -- learning rate (Valin 2007)
            const power = this.power, Eh = this.Eh, Yh = this.Yh;
            const ss = 0.35 / M, ss1 = 1 - ss;
            let Pey = 0, Pyy = 0;
            const sa = this.specAverage, sa1 = 1 - sa;
            for (let k = 0; k < K; k++) {
                power[k] = ss1 * power[k] + 1 + ss * Xf[k];
                const Rf = Ere[k] * Ere[k] + Eim[k] * Eim[k];
                const Yf = Yre[k] * Yre[k] + Yim[k] * Yim[k];
                const EhCur = Rf - Eh[k], YhCur = Yf - Yh[k];
                Pey += EhCur * YhCur;
                Pyy += YhCur * YhCur;
                Eh[k] = sa1 * Eh[k] + sa * Rf;
                Yh[k] = sa1 * Yh[k] + sa * Yf;
                Xf[k] = Rf;          // reuse as scratch: error power
                wtmp[k] = Yf;        // reuse as scratch: echo power
            }
            Pyy = Math.sqrt(Pyy);
            Pey = Pyy > 0 ? Pey / Pyy : 0;
            let tmp = this.beta0 * Syy;
            if (tmp > this.betaMax * See) tmp = this.betaMax * See;
            const alpha = tmp / See, alpha1 = 1 - alpha;
            this.Pey = alpha1 * this.Pey + alpha * Pey;
            this.Pyy = alpha1 * this.Pyy + alpha * Pyy;
            if (this.Pyy < 1) this.Pyy = 1;
            if (this.Pey < MIN_LEAK * this.Pyy) this.Pey = MIN_LEAK * this.Pyy;
            if (this.Pey > this.Pyy) this.Pey = this.Pyy;
            this.leak = this.Pey / this.Pyy;
            let RER = (0.0001 * Sxx + 3 * this.leak * Syy) / See;
            const lower = Sey * Sey / (1 + See * Syy);
            if (RER < lower) RER = lower;
            if (RER > this.muMax) RER = this.muMax;
            if (!this.adapted && this.sumAdapt > M && this.leak * Syy > 0.03 * Syy) this.adapted = true;
            // speexdsp assumes the far end is alone for a moment after start. A singer may never give us
            // that: with the near end louder than the echo the bootstrap rate stays tiny and "adapted"
            // would never come. After ~1 s of playback, hand over to the double-talk-robust rate anyway.
            if (!this.adapted && this.activeFrames > 8 * M && this.sumAdapt > 1) this.adapted = true;
            if (this.adapted) {
                for (let k = 0; k < K; k++) {
                    let r = this.leak * wtmp[k];
                    const ee = Xf[k] + 1;
                    if (r > this.muMax * ee) r = this.muMax * ee;
                    r = 0.7 * r + 0.3 * (RER * ee);
                    power1[k] = r / (ee * (power[k] + 10));
                }
            } else {
                let adaptRate = 0;
                // (speexdsp: N * 1000, sized for 16-bit capture noise; float capture can learn from quieter playback)
                if (Sxx > N * 30) {
                    this.activeFrames++;
                    tmp = 0.25 * Sxx;
                    if (tmp > 0.25 * See) tmp = 0.25 * See;
                    adaptRate = tmp / See;
                }
                for (let k = 0; k < K; k++) power1[k] = adaptRate / (power[k] + 10);
                this.sumAdapt += adaptRate;
            }

            this.trackPowers(micRaw, outPow, echoPow, refRaw);
        }

        /** y[N..2N) = time-domain response of filter (Fre,Fim) to the reference history. */
        filterResponse(Fre, Fim, dst) {
            const M = this.M, K = this.K, h = this.xHead, Xre = this.Xre, Xim = this.Xim;
            const Yre = this.Yre, Yim = this.Yim;
            Yre.fill(0); Yim.fill(0);
            for (let j = 0; j < M; j++) {
                const xo = ((h + j) % (M + 1)) * K, wo = j * K;
                for (let k = 0; k < K; k++) {
                    const xr = Xre[xo + k], xi = Xim[xo + k], wr = Fre[wo + k], wi = Fim[wo + k];
                    Yre[k] += wr * xr - wi * xi;
                    Yim[k] += wr * xi + wi * xr;
                }
            }
            this.fft.inverse(Yre, Yim, dst, 0);
        }

        /** Proportionate adaptation: partitions that already carry echo energy learn faster. */
        adjustProp() {
            const M = this.M, K = this.K, Wre = this.Wre, Wim = this.Wim, prop = this.prop;
            let maxSum = 1, propSum = 1;
            for (let j = 0; j < M; j++) {
                let t = 1;
                for (let k = 0, o = j * K; k < K; k++, o++) t += Wre[o] * Wre[o] + Wim[o] * Wim[o];
                prop[j] = Math.sqrt(t);
                if (prop[j] > maxSum) maxSum = prop[j];
            }
            for (let j = 0; j < M; j++) { prop[j] += 0.1 * maxSum; propSum += prop[j]; }
            for (let j = 0; j < M; j++) prop[j] = 0.99 * prop[j] / propSum;
        }

        trackPowers(mic, out, echo, ref) {
            const n = this.N * SCALE * SCALE;
            const a = 0.12, b = 0.012;   // ~22 ms and ~220 ms at 48 kHz / 128
            mic /= n; out /= n; echo /= n; ref /= n;
            this.micPow += a * (mic - this.micPow); this.outPow += a * (out - this.outPow);
            this.echoPow += a * (echo - this.echoPow); this.refPow += a * (ref - this.refPow);
            this.micPowSlow += b * (mic - this.micPowSlow); this.outPowSlow += b * (out - this.outPowSlow);
            this.echoPowSlow += b * (echo - this.echoPowSlow); this.refPowSlow += b * (ref - this.refPowSlow);
        }

        /** Energy of the foreground filter per 128-sample partition (where the echo path lives). */
        tapProfile() {
            const M = this.M, K = this.K, out = new Array(M);
            for (let j = 0; j < M; j++) {
                let t = 0;
                for (let k = 0, o = j * K; k < K; k++, o++) t += this.Fre[o] * this.Fre[o] + this.Fim[o] * this.Fim[o];
                out[j] = t;
            }
            return out;
        }

        stats() {
            const db = (p) => 10 * Math.log10(p + 1e-12);
            return {
                adapted: this.adapted, suspect: this.worseFrames > 2, leak: this.leak, resets: this.resets, relearns: this.relearns, delay: this.delay,
                micPow: this.micPow, outPow: this.outPow, echoPow: this.echoPow, refPow: this.refPow,
                micDb: db(this.micPowSlow), outDb: db(this.outPowSlow), echoDb: db(this.echoPowSlow), refDb: db(this.refPowSlow),
                // how much of the microphone level the canceller removed (only meaningful while the speakers are sounding)
                erleDb: db(this.micPowSlow) - db(this.outPowSlow),
                // speaker -> mic coupling: echo level at the mic relative to what we sent to the speakers
                couplingDb: db(this.echoPowSlow) - db(this.refPowSlow)
            };
        }
    }

    // ---------------------------------------------------------------- calibration helpers

    /** Deterministic noise burst used by the speaker check: band-limited, faded, ~ -23 dBFS RMS. */
    function makeProbe(sampleRate, seconds, level) {
        const n = Math.round(sampleRate * seconds);
        const out = new Float32Array(n);
        let s = 0x2545F491;
        const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 - 0.5; };
        // white noise -> one-pole low-pass (~7 kHz) and DC-blocking high-pass (~150 Hz): gentle "shh"
        const lpA = Math.exp(-2 * Math.PI * 7000 / sampleRate), hpA = Math.exp(-2 * Math.PI * 150 / sampleRate);
        let lp = 0, hpIn = 0, hpOut = 0, sum = 0;
        for (let i = 0; i < n; i++) {
            const w = rnd();
            lp = (1 - lpA) * w + lpA * lp;
            hpOut = hpA * (hpOut + lp - hpIn); hpIn = lp;
            out[i] = hpOut; sum += hpOut * hpOut;
        }
        const g = (level || 0.07) / Math.sqrt(sum / n || 1);
        const fade = Math.min(n >> 1, Math.round(sampleRate * 0.03));
        for (let i = 0; i < n; i++) {
            let f = 1;
            if (i < fade) f = 0.5 - 0.5 * Math.cos(Math.PI * i / fade);
            else if (i >= n - fade) f = 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / fade);
            out[i] *= g * f;
        }
        return out;
    }

    /**
     * Bulk delay of `ref` inside `mic` by PHAT-weighted cross-correlation.
     * Returns { lag (samples, >= 0), confidence (peak / RMS of the correlation), gainDb }.
     */
    function estimateDelay(mic, ref, maxLag) {
        const n = Math.min(mic.length, ref.length);
        let L = 1;
        while (L < 2 * n) L <<= 1;
        const fft = new RealFFT(L), H = L >> 1;
        const a = new Float64Array(L), b = new Float64Array(L);
        for (let i = 0; i < n; i++) { a[i] = mic[i]; b[i] = ref[i]; }
        const Are = new Float64Array(H + 1), Aim = new Float64Array(H + 1), Bre = new Float64Array(H + 1), Bim = new Float64Array(H + 1);
        fft.forward(a, Are, Aim); fft.forward(b, Bre, Bim);
        let refE = 0, crossE = 0, maxMag = 0;
        const Cre = new Float64Array(H + 1), Cim = new Float64Array(H + 1), mag = new Float64Array(H + 1);
        for (let k = 0; k <= H; k++) {
            const re = Are[k] * Bre[k] + Aim[k] * Bim[k];
            const im = Aim[k] * Bre[k] - Are[k] * Bim[k];
            Cre[k] = re; Cim[k] = im;
            mag[k] = Math.hypot(re, im);
            if (mag[k] > maxMag) maxMag = mag[k];
            refE += Bre[k] * Bre[k] + Bim[k] * Bim[k];
        }
        const floor = maxMag * 1e-3 + 1e-30;
        for (let k = 0; k <= H; k++) { const w = 1 / (mag[k] + floor); Cre[k] *= w; Cim[k] *= w; }
        const c = new Float64Array(L);
        fft.inverse(Cre, Cim, c);
        const top = Math.min(maxLag || n - 1, n - 1);
        let best = 0, bestV = -Infinity, sq = 0;
        for (let i = 0; i <= top; i++) { sq += c[i] * c[i]; if (c[i] > bestV) { bestV = c[i]; best = i; } }
        const rms = Math.sqrt(sq / (top + 1)) || 1e-30;
        // echo gain at that lag from the plain (unweighted) correlation
        for (let i = 0; i + best < n; i++) crossE += mic[i + best] * ref[i];
        let refT = 0;
        for (let i = 0; i < n; i++) refT += ref[i] * ref[i];
        const g = refT > 0 ? Math.abs(crossE) / refT : 0;
        return { lag: best, confidence: bestV / rms, gainDb: 20 * Math.log10(g + 1e-12) };
    }


    // ---------------------------------------------------------------- gate + level control (page side)

    /**
     * Decides, from the canceller's own measurements, (a) whether the singer is really there and
     * (b) whether the speakers are so loud at the mic that the part of the echo the canceller could
     * not remove is getting close to the singer's level.
     *
     *  - gate: harmonies sound only while a voice is detected AND the cleaned mic is clearly above
     *    the estimated residual echo. Without the second test the app's own harmony tail counts
     *    as "someone singing" and the loop keeps itself alive.
     *  - trim: instead of a fixed gain cut, harmony level is reduced only as far as needed to keep
     *    the residual echo well below the singer, and comes back when there is room.
     *
     * Pure logic, no audio: the offline loop tests drive the same class the page uses.
     */
    class SpeakerLoopControl {
        constructor(o = {}) {
            this.holdMs = o.holdMs ?? 600;          // keep harmonies through short gaps (consonants, breaths)
            this.nearMargin = o.nearMargin ?? 2;    // singer must be this many times the residual echo power
            this.trimHigh = o.trimHigh ?? 0.25;     // residual/singer power above which we back off
            this.trimLow = o.trimLow ?? 0.17;       // ... and below which we give level back
            this.leakFloor = o.leakFloor ?? 0.02;   // never believe the canceller is better than -17 dB
            this.minTrim = o.minTrim ?? 0.08;
            this.hotPow = o.hotPow ?? 0.126;        // speaker feed above -9 dBFS RMS for a while = something is wrong
            this.coupling = o.coupling ?? 1;        // speaker -> mic power gain; 1 (0 dB) until measured
            this.couplingKnown = false;
            this.appGain = o.appGain ?? 1;          // speaker feed power per unit of cleaned-mic power at trim 1
            this.reset();
        }

        reset() {
            this.gateOpen = false;
            this.lastNearAt = -Infinity;
            this.lastUpdate = null;
            this.trim = 1;
            this.nearRef = 0;
            this.residualRatio = 0;
            this.nearOk = true;
            this.hotMs = 0;
            this.emergencies = 0;
            this.bound = 1;
        }

        /** Tell the controller what the speaker check measured (power gain, e.g. 10^(dB/10)). */
        setCoupling(powerGain) {
            if (powerGain > 0 && isFinite(powerGain)) { this.coupling = powerGain; this.couplingKnown = true; }
        }

        /**
         * @param {object} s  { now: ms, voiced: bool, stats: canceller stats | null }
         * @returns {{ gateOpen: boolean, trim: number, nearOk: boolean, residualRatio: number }}
         */
        update(s) {
            const now = s.now, st = s.stats;
            const dt = this.lastUpdate === null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastUpdate) / 1000));
            this.lastUpdate = now;
            let nearOk = true;
            if (st) {
                // Keep our own estimate of how loud the speakers are at the mic, from moments when the
                // canceller is converged; it is what we fall back on when the canceller is not.
                if (st.adapted && st.leak < 0.1 && st.refPow > 1e-7 && st.echoPow > 0) {
                    const c = st.echoPow / st.refPow;
                    this.coupling += (c - this.coupling) * Math.min(1, dt * (this.couplingKnown ? 0.5 : 4));
                    this.couplingKnown = true;
                }
                // Residual echo left in the cleaned mic = (what the speakers put into the mic) x (the part
                // the canceller misses). An unconverged canceller misses all of it.
                const trusted = st.adapted && !st.suspect;
                const leak = trusted ? Math.max(st.leak, this.leakFloor) : 1;
                const residual = leak * Math.max(this.coupling * st.refPow, trusted ? st.echoPow : 0);
                const near = Math.max(st.outPow - residual, 0);
                nearOk = st.outPow > (1 + this.nearMargin) * residual + 1e-9;
                this.residualRatio = residual / (near + 1e-10);
                if (s.voiced && nearOk) this.nearRef = Math.max(st.outPow, this.nearRef * Math.exp(-dt / 2));
                const singerStillThere = s.voiced && st.outPow > 0.3 * this.nearRef && this.nearRef > 0;
                if (this.gateOpen && singerStillThere && this.residualRatio > this.trimHigh) {
                    this.trim *= Math.pow(10, -30 * dt / 20);            // back off 30 dB/s
                } else if (this.gateOpen && nearOk && this.residualRatio < this.trimLow) {
                    this.trim *= Math.pow(10, 4 * dt / 20);              // recover 4 dB/s
                }
                // How much speaker level the app makes out of a unit of singer, measured while all is well.
                if (trusted && this.gateOpen && s.voiced && nearOk && near > 1e-7) {
                    const t = Math.max(this.minTrim, Math.min(this.trim, this.bound));
                    const a = st.refPow / (near * t * t);
                    if (isFinite(a) && a > 0) this.appGain += (Math.min(a, 100) - this.appGain) * Math.min(1, dt * 3);
                }
                // Feed-forward bound: loop gain = coupling x app gain x trim^2 x (what the canceller misses).
                // It applies at once, so when the canceller reports trouble the level is already safe
                // before the loop has gone round a second time; it lifts again as soon as trust returns.
                this.bound = Math.min(1, Math.sqrt(this.trimHigh / (leak * this.coupling * this.appGain + 1e-12)));
                // Last line of defence: nobody sings so loudly that the speaker feed sits at the limiter.
                this.hotMs = st.refPow > this.hotPow ? this.hotMs + dt * 1000 : 0;
                if (this.hotMs > 300) { this.trim *= 0.5; this.hotMs = 0; this.emergencies++; }
            }
            this.trim = Math.min(1, Math.max(this.minTrim, this.trim));
            if (!st) { this.trim = 1; this.bound = 1; }
            const applied = Math.max(this.minTrim, Math.min(this.trim, this.bound));
            this.nearOk = nearOk;
            if (s.voiced && nearOk) this.lastNearAt = now;
            this.gateOpen = now - this.lastNearAt < this.holdMs;
            return { gateOpen: this.gateOpen, trim: applied, nearOk, residualRatio: this.residualRatio };
        }
    }

    const api = { RealFFT, EchoCancellerCore, SpeakerLoopControl, makeProbe, estimateDelay, PROCESSOR_NAME: 'harmony-echo-canceller' };

    // ---------------------------------------------------------------- AudioWorklet processor

    if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
        class HarmonyEchoCancellerProcessor extends AudioWorkletProcessor {
            constructor(options) {
                super();
                const po = (options && options.processorOptions) || {};
                // `sampleRate` is a global in AudioWorkletGlobalScope
                this.core = new EchoCancellerCore({ sampleRate, tailMs: po.tailMs, maxDelayMs: po.maxDelayMs, delaySamples: po.delaySamples });
                this.core.bypass = !!po.bypass;
                this.N = this.core.N;
                this.zero = new Float32Array(this.N);
                this.fifoMic = new Float32Array(this.N); this.fifoRef = new Float32Array(this.N); this.fifoOut = new Float32Array(this.N);
                this.fifoFill = 0;
                this.statEvery = 8; this.statCount = 0;
                this.capture = null;
                this.alive = true;
                this.port.onmessage = (ev) => this.onMessage(ev.data || {});
            }

            onMessage(m) {
                const c = this.core;
                if (m.type === 'config') {
                    if (typeof m.bypass === 'boolean') c.bypass = m.bypass;
                    if (typeof m.adapt === 'boolean') c.adaptEnabled = m.adapt;
                    if (typeof m.delaySamples === 'number') c.setDelay(m.delaySamples);
                } else if (m.type === 'reset') {
                    c.reset();
                } else if (m.type === 'capture') {
                    const n = Math.max(this.N, Math.min(m.samples | 0, 4 * sampleRate));
                    this.capture = { mic: new Float32Array(n), ref: new Float32Array(n), pos: 0, id: m.id };
                } else if (m.type === 'profile') {
                    this.port.postMessage({ type: 'profile', id: m.id, taps: c.tapProfile(), stats: c.stats() });
                } else if (m.type === 'stop') {
                    this.alive = false;
                }
            }

            process(inputs, outputs) {
                const mic = (inputs[0] && inputs[0][0]) || this.zero;
                const ref = (inputs[1] && inputs[1][0]) || this.zero;
                const out = outputs[0] && outputs[0][0];
                if (!out) return this.alive;
                const n = out.length;
                if (this.capture) {
                    const cap = this.capture, room = cap.mic.length - cap.pos, take = Math.min(room, n);
                    cap.mic.set(mic.subarray ? mic.subarray(0, take) : mic.slice(0, take), cap.pos);
                    cap.ref.set(ref.subarray ? ref.subarray(0, take) : ref.slice(0, take), cap.pos);
                    cap.pos += take;
                    if (cap.pos >= cap.mic.length) {
                        this.capture = null;
                        this.port.postMessage({ type: 'capture', id: cap.id, mic: cap.mic, ref: cap.ref }, [cap.mic.buffer, cap.ref.buffer]);
                    }
                }
                if (n === this.N) {
                    this.core.processFrame(mic, ref, out);
                } else {
                    // non-standard render quantum: run through a 128-sample FIFO (adds one block of latency)
                    for (let i = 0; i < n; i++) {
                        this.fifoMic[this.fifoFill] = mic[i] || 0; this.fifoRef[this.fifoFill] = ref[i] || 0;
                        out[i] = this.fifoOut[this.fifoFill];
                        if (++this.fifoFill === this.N) { this.core.processFrame(this.fifoMic, this.fifoRef, this.fifoOut); this.fifoFill = 0; }
                    }
                }
                if (++this.statCount >= this.statEvery) {
                    this.statCount = 0;
                    const s = this.core.stats();
                    s.type = 'stats';
                    this.port.postMessage(s);
                }
                return this.alive;
            }
        }
        registerProcessor(api.PROCESSOR_NAME, HarmonyEchoCancellerProcessor);
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else if (root) root.HarmonyEchoCanceller = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
