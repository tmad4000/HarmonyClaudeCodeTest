/* Focused diagnostics checks. All HTTP is intercepted; no Noos writes or server. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/dev/agent-worktrees/paseo-tab-local-splits-20261114/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');

function meterAndGateChecks() {
    let now = 1000;
    const sandbox = { Tone:{getDestination:()=>({mute:false,volume:{value:0}})}, window: { addEventListener() {} }, navigator: {}, performance: { now: () => now }, URLSearchParams, Float32Array, console };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'harmony-app.js'), 'utf8') + '\nglobalThis.TestSinger=HarmonySinger;', sandbox);
    const h = Object.create(sandbox.TestSinger.prototype);
    Object.assign(h, { debugContinuous: false, isRunning: true, speakerMode: true, calibrating: false,
        audioContext: { state: 'running', sampleRate: 48000 }, gateOpen: false,
        loopControl: { lastNearAt: -Infinity, holdMs: 450 }, aecNode: {}, speakerTrim: 0.5,
        gateGain: { gain: { rampTo(value) { this.value = value; } } },
        debugMeterBuffers: new WeakMap(), debugMeterAt: -Infinity, debugMeterValue: null,
        duckUntil: 1800, usingCanceller: () => true, updateGains() {}, updateGuardStatus() {}, logEvent() {} });
    let rawReads = 0, outputReads = 0;
    h.debugRawAnalyser = { fftSize: 16, getFloatTimeDomainData(b) { rawReads++; b.fill(0.1); } };
    h.outTap = { fftSize: 16, getFloatTimeDomainData(b) { outputReads++; b.fill(0); } };
    const aec = h.aecNode, controller = h.loopControl;
    h.setDebugContinuous(true);
    assert.equal(h.gateOpen, true);
    assert.equal(h.gateGain.gain.value, 1);
    assert.equal(h.aecNode, aec);
    assert.equal(h.loopControl, controller);
    const first = h.debugAudioLevels();
    assert(Math.abs(first.rawMicRms - 0.1) < 1e-6);
    assert.equal(first.outputRms, 0);
    assert.equal(first.outputDb, -120);
    now += 50;
    assert.equal(h.debugAudioLevels(), first);
    assert.equal(rawReads, 1);
    assert.equal(outputReads, 1);
    now += 51;
    h.debugAudioLevels();
    assert.equal(rawReads, 2);
    h.setDebugContinuous(false);
    assert.equal(h.gateOpen, false);
    assert.equal(h.gateGain.gain.value, 0);
    assert.equal(h.duckUntil, 1800, 'live normal duck timer must survive the diagnostic bypass');
    h.audioContext.state = 'suspended';
    const suspended = h.debugAudioLevels();
    assert.equal(suspended.rawMicRms, null, 'do not present stale samples as live input');
    assert.equal(suspended.outputRms, null);
    assert.equal(rawReads, 2);
    console.log(JSON.stringify({ unit: true, honestRawTap: true, boundedMeterCadence: true, zeroOutputNotInvented: true, normalGateRestored: true, safetyNodesRetained: true }));
}

(async () => {
    meterAndGateChecks();
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true,
        executablePath: process.env.CHROME_BIN || '/opt/google/chrome/chrome',
        args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
            '--use-file-for-fake-audio-capture=/home/dev/code/vocal-harmony-next-20261115/regression/continuous-voice.wav'] });
    try {
        const cases = [];
        for (const speaker of [0, 1]) {
            const context = await browser.newContext({ permissions: ['microphone'], serviceWorkers: 'block' });
            const page = await context.newPage(), errors = [];
            let backendAttempts = 0;
            page.on('pageerror', e => errors.push(e.message));
            await context.addInitScript(() => {
                window.__micCalls = 0; window.__encoders = 0;
                const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = (...args) => { __micCalls++; return get(...args); };
                if (window.MediaRecorder) { const Native = MediaRecorder; window.MediaRecorder = class extends Native { constructor(...args) { super(...args); __encoders++; } }; }
            });
            await context.route('**/*', route => {
                const u = new URL(route.request().url());
                if (u.origin !== 'https://harmony.jacobcole.net') { backendAttempts++; return route.abort(); }
                const name = u.pathname.slice(1) || 'index.html';
                if (name === 'debug-endpoint.js') return route.fulfill({ contentType: 'application/javascript', body: "window.HARMONY_DEBUG_ENDPOINT='';window.HARMONY_DEBUG_UPLOAD_ENABLED=false;" });
                const file = path.resolve(ROOT, name);
                if (!file.startsWith(ROOT + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
                return route.fulfill({ path: file });
            });
            await page.goto(`https://harmony.jacobcole.net/?speaker=${speaker}&check=0&debug=0`);
            if(speaker)await page.getByRole('button',{name:'Use speaker anyway',exact:true}).click();
            await page.locator('#startBtn').click();
            await page.waitForFunction(() => harmonySinger.isRunning && Number.isFinite(harmonySinger.stableMidi));
            const before = await page.evaluate(() => {
                const h = harmonySinger;
                h.reverb.wet.value = 0; h.chorus.wet.value = 0; h.dryVolume = 0;
                const original = h.quietVoiceGate.update.bind(h.quietVoiceGate);
                h.quietVoiceGate.update = args => ({ ...original(args), voiced: false, open: false, reason: 'qa-vad-suppressed' });
                h.lastVoicedAt = -Infinity;
                if (h.loopControl) h.loopControl.lastNearAt = -Infinity;
                h.duckUntil = performance.now() + 10000;
                h.updateGains();
                window.__identity = { context: h.audioContext, source: h.micSource, stream: h.mediaStream, aec: h.aecNode, limiter: h.limiter, encoders: __encoders };
                return { micCalls: __micCalls, encoders: __encoders, gains: Object.fromEntries(Object.entries(h.gains).map(([key, node]) => [key, node.gain.value])) };
            });
            await page.waitForTimeout(600);
            await page.evaluate(() => harmonySinger.setDebugContinuous(true));
            await page.waitForTimeout(500);
            const active = await page.evaluate(() => {
                const h = harmonySinger, old = __identity;
                return { ...h.debugAudioLevels(), sameGraph: h.audioContext === old.context && h.micSource === old.source && h.mediaStream === old.stream && h.aecNode === old.aec && h.limiter === old.limiter,
                    micCalls: __micCalls, encoders: __encoders, originalEncoders: old.encoders,
                    gains: Object.fromEntries(Object.entries(h.gains).map(([key, node]) => [key, node.gain.value])) };
            });
            assert.equal(active.debugContinuous, true);
            assert.equal(active.gate, true);
            assert.equal(active.ducking, false);
            assert(active.rawMicRms > 0, 'raw meter must observe the real fake-mic stream before AEC');
            assert.equal(active.rawTap, speaker ? 'pre-canceller' : 'raw-guard');
            assert.equal(active.sameGraph, true);
            assert.equal(active.micCalls, 1);
            assert.equal(active.encoders, before.encoders);
            for (const key of Object.keys(before.gains)) assert(Math.abs(active.gains[key] - before.gains[key] * (speaker ? 2 : 1)) < 1e-6, 'only diagnostic duck is bypassed; voice level policy stays intact');
            await page.evaluate(() => harmonySinger.setDebugContinuous(false));
            const normal = await page.evaluate(() => ({ ...harmonySinger.debugAudioLevels(), gains: Object.fromEntries(Object.entries(harmonySinger.gains).map(([key, node]) => [key, node.gain.value])) }));
            assert.equal(normal.gate, !speaker, 'Off restores the normal speaker gate immediately');
            assert.equal(normal.debugContinuous, false);
            assert.equal(normal.ducking, !!speaker);
            for (const key of Object.keys(before.gains)) assert(Math.abs(normal.gains[key] - before.gains[key]) < 1e-6, 'Off immediately restores normal duck gain');
            await page.evaluate(() => { harmonySinger.setDebugContinuous(true); harmonySinger.mediaStream.getAudioTracks()[0].enabled = false; });
            await page.waitForTimeout(1800);
            const silent = await page.evaluate(() => harmonySinger.debugAudioLevels());
            assert.equal(silent.rawMicRms, 0);
            assert(silent.outputRms < 1e-5, 'holding the gate open must not generate sound with zero mic input: '+JSON.stringify({speaker,...silent}));
            await page.locator('#startBtn').click();
            assert.equal(await page.evaluate(() => harmonySinger.debugContinuous), false);
            assert.equal(backendAttempts, 0);
            assert.deepEqual(errors, []);
            cases.push({ speaker, before, active, restored: normal, silent });
            await context.close();
        }
        console.log(JSON.stringify({ passed: true, sandbox: true, sameMicAndGraph: true, noExtraEncoder: true, noBackendRequests: true, cases }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
