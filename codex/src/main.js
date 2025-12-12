const el = (id) => document.getElementById(id);

// Default to a local copy to avoid gated/blocked hosts. Drop your ONNX at /models/...
const PESTO_MODEL_URL = "models/mir-1k_g7_44100_1024.onnx";

const ORT_WASM_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/";
const SOUNDTOUCH_WORKLET =
  "https://cdn.jsdelivr.net/npm/@soundtouchjs/audio-worklet@0.2.1/dist/soundtouch-worklet.js";

const ui = {
  start: el("start-btn"),
  interval: el("interval"),
  mix: el("mix"),
  formant: el("formant"),
  dry: el("dry"),
  pitchReadout: el("pitch-readout"),
  confReadout: el("conf-readout"),
  latencyReadout: el("latency-readout"),
};

let audioCtx;
let sourceNode;
let harmonizerNode;
let dryGain;
let wetGain;
let captureNode;
let session;
let cacheTensor;
let pestoInputName;
let pestoCacheName;
let pestoOutName;
let pestoConfName;

const pestoBuffer = [];
const PESTO_WINDOW = 1024;
const PESTO_HOP = 256; // 256 @ 48 kHz ≈ 5.3 ms

const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

const freqToNote = (freq) => {
  if (!freq || freq <= 0) return "--";
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = noteNames[(rounded + 1200) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave} (${freq.toFixed(1)} Hz, ${cents}¢)`;
};

async function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  audioCtx = new AudioContext({ latencyHint: "interactive" });
  return audioCtx;
}

async function loadPesto() {
  if (session) return session;
  if (!window.ort) {
    throw new Error("onnxruntime-web failed to load (global `ort` missing).");
  }
  // Point ONNX Runtime to CDN-hosted WASM binaries.
  ort.env.wasm.wasmPaths = ORT_WASM_BASE;
  session = await ort.InferenceSession.create(PESTO_MODEL_URL, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  pestoInputName =
    session.inputNames.find((n) => n.toLowerCase().includes("audio")) || session.inputNames[0];
  pestoCacheName = session.inputNames.find((n) => n.toLowerCase().includes("cache"));
  const cacheShape = pestoCacheName
    ? session.inputMetadata[pestoCacheName]?.dimensions || [1, 1]
    : [1, 1];
  cacheTensor = new ort.Tensor("float32", new Float32Array(cacheShape.reduce((a, b) => a * b)), cacheShape);

  pestoOutName =
    session.outputNames.find((n) => n.toLowerCase().includes("pred")) ||
    session.outputNames.find((n) => n.toLowerCase().includes("pitch")) ||
    session.outputNames[0];
  pestoConfName = session.outputNames.find((n) => n.toLowerCase().includes("conf"));
  return session;
}

async function runPesto(chunk) {
  if (!session) return null;
  const audioTensor = new ort.Tensor("float32", chunk, [1, chunk.length]);
  const feeds = { [pestoInputName]: audioTensor };
  if (pestoCacheName) feeds[pestoCacheName] = cacheTensor;

  const outputs = await session.run(feeds);
  const f0 = outputs[pestoOutName]?.data?.[0] || 0;
  const conf = pestoConfName ? outputs[pestoConfName]?.data?.[0] : 0;
  const cacheOut =
    outputs[pestoCacheName] ||
    outputs.cache ||
    outputs.cache_out ||
    outputs[session.outputNames.find((n) => n.toLowerCase().includes("cache"))];
  if (cacheOut) cacheTensor = cacheOut;
  return { f0, conf };
}

async function setupGraph() {
  await ensureAudioContext();
  await audioCtx.audioWorklet.addModule(SOUNDTOUCH_WORKLET);
  await audioCtx.audioWorklet.addModule("src/pcm-capture-worklet.js");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  sourceNode = audioCtx.createMediaStreamSource(stream);

  harmonizerNode = new AudioWorkletNode(audioCtx, "soundtouch-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });

  dryGain = audioCtx.createGain();
  wetGain = audioCtx.createGain();

  sourceNode.connect(dryGain).connect(audioCtx.destination);
  sourceNode.connect(harmonizerNode).connect(wetGain).connect(audioCtx.destination);

  // Capture branch for PESTO (no audio output).
  captureNode = new AudioWorkletNode(audioCtx, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  sourceNode.connect(captureNode);
  captureNode.port.onmessage = ({ data }) => handleCapture(data);

  applyUIToGraph();
}

function applyUIToGraph() {
  if (!harmonizerNode) return;
  const semitones = parseFloat(ui.interval.value);
  harmonizerNode.parameters.get("pitchSemitones").value = semitones;

  // Formant is not directly supported by SoundTouch; emulate by tiny rate/tempo skew.
  const formantCents = parseFloat(ui.formant.value);
  const formantRatio = Math.pow(2, formantCents / 1200);
  harmonizerNode.parameters.get("rate").value = formantRatio;
  harmonizerNode.parameters.get("tempo").value = 1 / formantRatio;

  wetGain.gain.value = parseFloat(ui.mix.value);
  dryGain.gain.value = parseFloat(ui.dry.value);
}

async function handleCapture(frame) {
  pestoBuffer.push(...frame);
  while (pestoBuffer.length >= PESTO_WINDOW) {
    const chunk = pestoBuffer.slice(0, PESTO_WINDOW);
    pestoBuffer.splice(0, PESTO_HOP);
    try {
      await loadPesto();
      const result = await runPesto(Float32Array.from(chunk));
      if (result) {
        ui.pitchReadout.textContent = freqToNote(result.f0);
        ui.confReadout.textContent = (result.conf * 100).toFixed(1) + " %";
      }
    } catch (err) {
      ui.pitchReadout.textContent = "PESTO error";
      ui.confReadout.textContent = err.message;
    }
  }
}

async function start() {
  ui.start.disabled = true;
  ui.start.textContent = "Loading…";
  try {
    await setupGraph();
    await loadPesto(); // preload model so first detection is quick
    await audioCtx.resume();
    ui.start.textContent = "Running";
    ui.latencyReadout.textContent = "Budget: keep buffers ≤40 ms (hop 256 @48k ≈ 5.3 ms)";
  } catch (err) {
    ui.start.textContent = "Start";
    ui.start.disabled = false;
    alert("Failed to start audio: " + err.message);
  }
}

ui.start.addEventListener("click", start);
ui.interval.addEventListener("change", applyUIToGraph);
ui.mix.addEventListener("input", applyUIToGraph);
ui.formant.addEventListener("input", applyUIToGraph);
ui.dry.addEventListener("input", applyUIToGraph);
