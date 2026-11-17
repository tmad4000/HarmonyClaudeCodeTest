// Actual start/stop methods with deterministic Audio API stubs. No iOS/audio claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'harmony-app.js'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture(phase) {
    const entered = deferred(), release = deferred(), events = [], counts = { captures: 0, sources: 0, worklets: 0, noos: 0, debugStarts: 0 };
    const tracks = [];
    const makeStream = () => { const track = { readyState: 'live', getSettings: () => ({sampleRate: 48000}), stop() { this.readyState = 'ended'; } }; tracks.push(track); return {getTracks: () => [track], getAudioTracks: () => [track]}; };
    const node = { connect() {}, disconnect() {} };
    const context = { state: 'running', sampleRate: 48000, addEventListener() {},
        createMediaStreamSource() { counts.sources++; return node; }, createAnalyser: () => ({}) };
    node.context = context;
    context.__harmonyAecModule = phase === 'aec' ? { then(resolve, reject) { entered.resolve(); release.promise.then(resolve, reject); } } : Promise.resolve();
    const toneContext = { rawContext: context, createAudioWorkletNode() { counts.worklets++; throw new Error('Cancelled startup must not create a worklet'); } };
    const box = { window: { addEventListener() {}, HarmonyEchoCanceller: {PROCESSOR_NAME: 'stub'}, harmonyDebug: { stop() {}, start() { counts.debugStarts++; }, write() { counts.noos++; } } },
        navigator: {mediaDevices: {async getUserMedia() { counts.captures++; const stream = makeStream(); if (phase === 'gum') { entered.resolve(); await release.promise; } return stream; }}},
        document: {getElementById: () => ({value: ''})}, Tone: {start: async () => {}, getContext: () => toneContext},
        fetch() { counts.noos++; throw new Error('No network allowed'); }, console: {log() {}, warn() {}, error() {}}, setTimeout, clearTimeout };
    vm.createContext(box); vm.runInContext(source + '\nglobalThis.TestSinger=HarmonySinger;', box);
    const h = Object.create(box.TestSinger.prototype);
    Object.assign(h, { starting: false, isRunning: false, params: {get: () => null}, speakerMode: true, echoMode: 'canceller', engine: 'stretch',
        outputDefaultPending: false, notchNodes: [], notches: [], instruments: {}, testExtra: [], roomNodes: [], usingCanceller: () => true,
        readOutputLabel: () => { if (phase === 'label') { entered.resolve(); return release.promise; } return Promise.resolve('Speaker'); },
        logEvent: (type, data) => events.push({type, ...data}), isRecording: () => false, disposeVoices() {}, renderCheckResult() {}, updateUI() {}, renderSpeakerMode() {}, setStatus() {} });
    return {h, entered, release, tracks, node, counts, events};
}
(async () => {
    const results = [];
    for (const phase of ['gum', 'label', 'aec']) {
        const f = fixture(phase), first = f.h.start(); await f.entered.promise;
        if (phase !== 'gum') assert.equal(f.h.micSource, f.node, 'factory assigned a non-null source');
        f.h.stop();
        // Startup is serialized until the canceled promise drains; this call must not recapture.
        await f.h.start(); assert.equal(f.counts.captures, 1); assert.equal(f.h.starting, true);
        f.release.resolve('Speaker'); await first;
        assert.equal(f.h.lastError, null); assert.equal(f.h.isRunning, false); assert.equal(f.h.starting, false);
        assert.equal(f.tracks[0].readyState, 'ended'); assert.equal(f.counts.worklets, 0);
        assert.equal(f.counts.noos, 0); assert.equal(f.counts.debugStarts, 0);
        assert(f.events.some(e => e.type === 'startup-cancelled'));
        assert(!f.events.some(e => e.type === 'warning'), 'cancellation must not enter AEC fallback');
        // A subsequent attempt is not reset by the old catch/finally.
        const nextEntered = deferred(), nextRelease = deferred();
        f.h.readOutputLabel = () => { nextEntered.resolve(); return nextRelease.promise; };
        const next = f.h.start(); await nextEntered.promise; await first;
        assert.equal(f.h.starting, true); assert.equal(f.counts.captures, 2); assert.equal(f.tracks[1].readyState, 'live'); assert.equal(f.h.lastError, null);
        f.h.stop(); nextRelease.resolve('Speaker'); await next;
        assert.equal(f.h.starting, false); assert.equal(f.h.isRunning, false); assert.equal(f.counts.noos, 0); assert(f.tracks.every(track => track.readyState === 'ended'));
        results.push({phase, captures: f.counts.captures, noStaleGraph: true, noFallback: true, noNoos: true, lateTracksEnded: true, nextAttemptPreserved: true});
    }
    console.log(JSON.stringify({passed: true, actualMethods: true, stubAudioAPIs: true, limits: 'No browser, native, iOS, or audible-audio claim', results}, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
