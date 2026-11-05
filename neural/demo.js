"use strict";
const $ = (s) => document.querySelector(s);
const descriptions = {
  high_loop_gain:
    "Fourfold calibrated room gain. Tests whether a safety mute, rather than separation, stops the loop.",
  singer_only: "Singer without room echo; tests preservation.",
  playback_only: "No singer. Playback must not become a persistent voice.",
  doubletalk:
    "A real singer and recursively generated harmony share the microphone.",
  unison: "Singer and harmony at the same pitch: correlated-input stress test.",
  octave: "Octave harmony with shared harmonic structure.",
  sustained_vibrato:
    "Synthetic sustained harmonic vowel with vibrato; separate from real singing.",
  gain_change: "Room gain increases after calibration. Frozen-path limitation.",
  delay_change: "Room delay changes by 500 samples. Frozen-path limitation.",
  nonlinear_speaker:
    "Saturating loudspeaker distortion is outside a linear FIR model.",
  clock_drift_100ppm:
    "Uncompensated 100 ppm path time warp; drift sensitivity stress test.",
};
let report;
function stop() {
  document.querySelectorAll("audio").forEach((a) => a.pause());
}
$("#stop").onclick = stop;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") stop();
});
function volumes() {
  document
    .querySelectorAll("audio")
    .forEach((a) => (a.volume = +$("#volume").value));
  $("#volume-label").textContent = Math.round(+$("#volume").value * 100) + "%";
}
$("#volume").oninput = volumes;
document.addEventListener(
  "play",
  (e) => {
    if (e.target.tagName === "AUDIO")
      document.querySelectorAll("audio").forEach((a) => {
        if (a !== e.target) a.pause();
      });
  },
  true,
);
const fmt = (n, suffix = "", digits = 1) =>
  n == null ? "—" : n.toFixed(digits) + suffix;
async function wave(canvas, url) {
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const view = new DataView(bytes);
    let offset = 12,
      data;
    while (offset + 8 < bytes.byteLength) {
      const id = String.fromCharCode(...new Uint8Array(bytes, offset, 4)),
        len = view.getUint32(offset + 4, true);
      if (id === "data") {
        data = new Int16Array(bytes, offset + 8, len / 2);
        break;
      }
      offset += 8 + len + (len % 2);
    }
    if (!data) return;
    canvas.width = 700;
    canvas.height = 100;
    const c = canvas.getContext("2d");
    c.strokeStyle = "#f08090";
    c.beginPath();
    for (let i = 0; i < 700; i++) {
      let m = 0;
      const step = Math.ceil(data.length / 700);
      for (let j = i * step; j < Math.min((i + 1) * step, data.length); j++)
        m = Math.max(m, Math.abs(data[j]) / 32768);
      c.moveTo(i, 50 - m * 230);
      c.lineTo(i, 50 + m * 230);
    }
    c.stroke();
  } catch (e) {
    canvas.setAttribute("aria-label", "Waveform unavailable; use audio player");
  }
}
function render() {
  stop();
  const scenario = $("#scenario").value;
  $("#description").textContent = descriptions[scenario] || scenario;
  $("#comparison").replaceChildren();
  const rows = report.cases.filter((x) => x.scenario === scenario);
  rows.forEach((r, i) => {
    const article = document.createElement("article");
    article.className = "card" + (r.aec ? " referenced" : "");
    const title =
      r.engine === "signalsmith"
        ? "Signalsmith core"
        : r.aec
          ? "Neural + reference"
          : "Neural, no reference";
    const subtitle =
      r.engine === "signalsmith"
        ? "Conventional waveform shifting. Browser AEC is not simulated."
        : r.aec
          ? "Neural waveform, with a measured playback path subtracted."
          : "Neural waveform alone does not cancel acoustic feedback.";
    const path = "artifacts/" + r.audio_stem;
    article.innerHTML = `<div class="card-head"><span class="letter">${String.fromCharCode(65 + i)} / ${r.aec ? "REFERENCE CONTROL" : "COMPARISON"}</span><h2>${title}</h2><p>${subtitle}</p></div><canvas aria-label="Output waveform"></canvas><div class="metrics"><div class="metric"><small>Clean-singer error SNR</small><strong>${fmt(r.active_near_error_snr_db)}</strong> <span>dB ↑</span></div><div class="metric"><small>Output after singer stops</small><strong>${fmt(r.post_singer_output_dbfs)}</strong> <span>dBFS ↓</span></div><div class="metric"><small>Processing / audio duration</small><strong>${fmt(r.rtf, "", 2)}</strong> <span>RTF</span></div><div class="metric"><small>Block processing p95</small><strong>${fmt(r.processing_ms["95"])}</strong> <span>ms</span></div></div><div class="audio-controls"><label>Hear generated harmony</label><audio controls preload="metadata" src="${path}_output.wav"></audio><label>Hear microphone after cancellation</label><audio controls preload="metadata" src="${path}_clean.wav"></audio></div><div class="status ${r.safety_mute ? "warning" : ""}">${r.safety_mute ? "Safety muted: " + r.safety_mute : "No safety mute"} · ${r.limited_samples} limited samples</div>`;
    $("#comparison").append(article);
    wave(article.querySelector("canvas"), path + "_output.wav");
  });
  volumes();
}
(async () => {
  try {
    const response = await fetch("artifacts/measurements.json");
    if (!response.ok)
      throw Error("Run validate.py to generate measurements and audio.");
    report = await response.json();
    const scenarios = [...new Set(report.cases.map((x) => x.scenario))];
    $("#scenario").replaceChildren(
      ...scenarios.map((s) => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s.replaceAll("_", " ");
        return o;
      }),
    );
    $("#scenario").disabled = false;
    $("#scenario").value = scenarios.includes("doubletalk")
      ? "doubletalk"
      : scenarios[0];
    $("#scenario").onchange = render;
    $("#source-description").textContent =
      report.source.file + " · CC BY 4.0 · four-second crop + silence";
    $("#run-info").textContent =
      report.host +
      " · " +
      report.cases.length +
      " runs · peak RSS " +
      fmt(report.peak_rss_mib) +
      " MiB · " +
      new Date(report.generated_at).toLocaleString();
    for (const r of report.cases) {
      const tr = document.createElement("tr");
      for (const value of [
        r.scenario,
        r.engine + (r.aec ? " + reference" : ""),
        fmt(r.active_near_error_snr_db, " dB"),
        fmt(r.post_singer_output_dbfs),
        fmt(r.rtf, "", 2),
        r.safety_mute || "none",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      $("#results").append(tr);
    }
    render();
    volumes();
  } catch (e) {
    $("#error").hidden = false;
    $("#error").textContent = e.message;
    $("#run-info").textContent = "Measurements unavailable";
  }
})();

(async () => {
  try {
    const q = await (await fetch("artifacts/quality.json")).json();
    const delays = q.rows.map((r) => r.estimated_live_latency_ms);
    $("#latency-note").textContent =
      `Measured M4 estimate: ${Math.round(Math.min(...delays))}–${Math.round(Math.max(...delays))} ms live delay. Faster-than-playback throughput does not guarantee glitch-free monitoring. Hardware latency remains unmeasured.`;
    for (const r of q.rows) {
      const number = r.fixture.match(/_(\d+)/)[1];
      const row = document.createElement("section");
      row.className = "quality-row";
      const title = document.createElement("h2");
      title.textContent = r.fixture + " · target +4 semitones";
      row.append(title);
      const items = document.createElement("div");
      items.className = "quality-items";
      for (const [key, label] of [
        ["input", "Original singer"],
        ["signalsmith", "Signalsmith"],
        ["streamed", "Neural streaming"],
        ["offline", "Neural whole-clip"],
      ]) {
        const l = document.createElement("label");
        l.textContent = label;
        const a = document.createElement("audio");
        a.controls = true;
        a.preload = "metadata";
        a.src = `artifacts/quality_${number}_${key}.wav`;
        a.volume = +$("#volume").value;
        l.append(a);
        items.append(l);
      }
      row.append(items);
      $("#quality-clips").append(row);
    }
  } catch (e) {
    $("#latency-note").textContent =
      "Quality benchmark not yet generated; run benchmark.py for measured latency and singing A/B clips.";
  }
})();

(async () => {
  try {
    const q = await (await fetch("artifacts/responsiveness-sweep.json")).json();
    $("#responsive-note").textContent =
      "Measured source-to-worker-ready p95: original 171–175 ms; responsive 103–110 ms in this M4 sweep. Device/playout delay is additional. Clips are source-aligned for timbre comparison, not a simulated monitoring delay. Smaller context changes the sound; listening acceptance remains open.";
    for (const number of [1, 10, 20]) {
      const section = document.createElement("section");
      section.className = "quality-row";
      const title = document.createElement("h2");
      title.textContent =
        "vocadito_" + number + " · same singer, same +4 semitones";
      section.append(title);
      const items = document.createElement("div");
      items.className = "quality-items";
      for (const profile of ["original", "responsive"]) {
        const r = q.rows.find(
          (r) => r.fixture === number && r.profile === profile,
        );
        const label = document.createElement("label");
        label.textContent =
          profile +
          " · " +
          Math.round(r.serialized_ready_delay_p95_ms) +
          " ms worker-ready p95";
        const a = document.createElement("audio");
        a.controls = true;
        a.preload = "metadata";
        a.volume = +$("#volume").value;
        a.src = `artifacts/responsive_${number}_${profile}.wav`;
        label.append(a);
        items.append(label);
      }
      section.append(items);
      $("#responsive-clips").append(section);
    }
  } catch (e) {
    $("#responsive-note").textContent =
      "Run sweep.py to generate the response-time comparison.";
  }
})();
