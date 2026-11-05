// Run the EXACT vendored Signalsmith WASM core in Node, without the browser wrapper.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const file = path.join(__dirname, "../claude/vendor/SignalsmithStretch.js");
const text = fs
  .readFileSync(file, "utf8")
  .split("function registerWorkletProcessor")[0];
const factory = new Function(
  "require",
  "__dirname",
  "module",
  "exports",
  text + ";return SignalsmithStretch;",
)(require, path.dirname(file), { exports: {} }, {});
(async () => {
  const m = await factory();
  const sr = 44100,
    block = 512;
  m._configure(1, Math.round(sr * 0.06), Math.round(sr * 0.015), false);
  m._reset();
  const length = Math.max(block, m._inputLatency() + m._outputLatency());
  const ptr = m._setBuffers(1, length);
  m._setFormantSemitones(0, true);
  m._setFormantBase(0);
  process.stdout.write(
    JSON.stringify({ latency: m._inputLatency() + m._outputLatency() }) + "\n",
  );
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const q = JSON.parse(line),
      x = q.input;
    if (x.length > length) throw Error("block too long");
    m._setTransposeSemitones(q.shift || 0, 0);
    const memory = m.exports ? m.exports.memory.buffer : m.HEAP8.buffer;
    new Float32Array(memory, ptr, x.length).set(x);
    m._process(x.length, x.length);
    const mem2 = m.exports ? m.exports.memory.buffer : m.HEAP8.buffer;
    process.stdout.write(
      JSON.stringify(
        Array.from(new Float32Array(mem2, ptr + length * 4, x.length)),
      ) + "\n",
    );
  }
})();
