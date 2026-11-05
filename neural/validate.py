"""Reproducible singing A/B and recursive closed-loop tests. Never plays audio."""

import argparse
import datetime
import hashlib
import json
import platform
import resource
import time
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal
from dsp import SR, HOP, rms, db
from echo import estimate_path
from engine import Engine
from vocoder import NeuralVocoder

ROOT = Path(__file__).parent


def singing_fixture(seconds=4):
    files = sorted((ROOT / "fixtures/vocadito").rglob("*.wav"))
    if not files:
        files = sorted(
            p for p in (ROOT / "fixtures").rglob("*.wav") if "__MACOSX" not in str(p)
        )
    if not files:
        raise FileNotFoundError(
            "Download licensed vocadito fixtures via setup.py first"
        )
    x, sr = sf.read(files[0])
    x = x.mean(axis=1) if x.ndim > 1 else x
    if sr != SR:
        x = signal.resample_poly(x, SR, sr)
    # Start at first audible section, retaining actual human voice.
    active = np.flatnonzero(abs(x) > 0.02)
    start = max(0, int(active[0]) - SR // 10) if len(active) else 0
    x = x[start : start + int(seconds * SR)]
    x = np.pad(x, (0, max(0, int(seconds * SR) - len(x))))
    x = x * min(1, 0.045 / rms(x))
    return x.astype(np.float32), {
        "file": str(files[0].relative_to(ROOT)),
        "sha256": hashlib.sha256(files[0].read_bytes()).hexdigest(),
        "crop_start_samples": start,
        "license": "CC BY 4.0",
        "record": "https://zenodo.org/records/5578807",
    }


def room_impulse():
    h = np.zeros(8192, dtype=np.float32)
    for delay, gain in [(900, 0.65), (1270, 0.22), (2700, -0.13), (5700, 0.06)]:
        h[delay] = gain
    return h


def calibrate(h):
    rng = np.random.default_rng(91)
    x = np.r_[rng.normal(0, 0.012, SR * 2), np.zeros(len(h))]
    mic = signal.fftconvolve(x, h)[: len(x)] + rng.normal(0, 1e-6, len(x))
    fitted = estimate_path(x, mic, len(h))
    test = np.r_[rng.normal(0, 0.012, SR), np.zeros(len(h))]
    actual = signal.fftconvolve(test, h)[: len(test)]
    predicted = signal.fftconvolve(test, fitted)[: len(test)]
    return fitted, db(rms(actual) / rms(actual - predicted))


def run_case(
    name,
    kind,
    aec,
    voice,
    model,
    seconds=8,
    safety=True,
    profile="original",
    oracle=False,
):
    n = int(np.ceil(seconds * SR / HOP)) * HOP
    near = np.zeros(n, dtype=np.float32)
    near[SR : SR + len(voice)] = voice
    shift = 0 if name == "unison" else 12 if name == "octave" else 4
    if name == "sustained_vibrato":
        t = np.arange(len(voice)) / SR
        phase = (
            2
            * np.pi
            * np.cumsum(196 * 2 ** (0.35 * np.sin(2 * np.pi * 5.4 * t) / 12))
            / SR
        )
        near[SR : SR + len(voice)] = sum(
            0.025 / k * np.sin(k * phase) for k in range(1, 10)
        )
    if name == "playback_only":
        near[:] = 0
    h = room_impulse()
    if name == "high_loop_gain":
        h = h * 4
    if name == "singer_only" or oracle:
        h[:] = 0
        fitted = h.copy()
        cal_erle = None
    else:
        fitted, cal_erle = calibrate(h)
    engine = Engine(
        kind,
        fitted if aec else None,
        shift=shift,
        model=model,
        safety=safety,
        profile=profile,
    )
    out = np.zeros(n, dtype=np.float32)
    raw = np.zeros(n, dtype=np.float32)
    clean = np.zeros(n, dtype=np.float32)
    echo = np.zeros(n, dtype=np.float32)
    ref = np.zeros(n, dtype=np.float32)
    pred = np.zeros(n, dtype=np.float32)
    # Actual closed loop: generated output becomes future mic echo each iteration.
    taps = np.flatnonzero(h)
    changed_at = 4 * SR
    for i in range(0, n, HOP):
        idx = np.arange(i, i + HOP)
        pathgain = 1.65 if name == "gain_change" and i >= changed_at else 1
        extra = 500 if name == "delay_change" and i >= changed_at else 0
        drift = (idx * 100e-6) if name == "clock_drift_100ppm" else 0
        e = np.zeros(HOP)
        if name != "singer_only":
            for t in taps:
                pos = idx - t - extra - drift
                # Only past playback is accessible; interpolated drift exercises mismatch.
                e += (
                    pathgain
                    * h[t]
                    * np.interp(pos, np.arange(i), out[:i], left=0, right=0)
                    if i
                    else 0
                )
        if name == "nonlinear_speaker":
            e = np.tanh(e * 12) / 12
        mic = near[i : i + HOP] + e
        # All room delays exceed a block. Reference at current time is previous
        # engine output already staged in out; the acoustic impulse supplies delay.
        reference = out[i : i + HOP].copy()
        # process uses ref from same time; new output cannot affect THIS mic block.
        # Stage generated output one callback block later (actual duplex causality).
        y, c, p = engine.process(mic, reference)
        if name == "playback_only" and i < 3 * SR:
            y = np.clip(
                0.04 * np.sin(2 * np.pi * 277 * np.arange(i, i + HOP) / SR), -0.18, 0.18
            ).astype(np.float32)
        if i + 2 * HOP <= n:
            out[i + HOP : i + 2 * HOP] = y
        raw[i : i + HOP] = mic
        clean[i : i + HOP] = c
        echo[i : i + HOP] = e
        ref[i : i + HOP] = reference
        pred[i : i + HOP] = p
    engine.close()
    active = slice(SR, SR + len(voice))
    tail = slice(SR + len(voice) + SR, n)
    error = clean - near
    metrics = {
        "scenario": name,
        "stream_profile": profile,
        "oracle_clean_input": oracle,
        "engine": kind,
        "aec": aec,
        "safety_enabled": safety,
        "calibration_holdout_erle_db": cal_erle,
        "active_clean_error_dbfs": db(rms(error[active])),
        "active_near_error_snr_db": db(rms(near[active]) / rms(error[active]))
        if rms(near[active]) > 1e-8
        else None,
        "echo_reduction_db": db(rms(echo) / rms(error)),
        "post_singer_output_dbfs": db(rms(out[tail])),
        "output_peak": float(abs(out).max()),
        "safety_mute": engine.safety.reason if engine.safety else None,
        "limited_samples": engine.safety.limited_samples if engine.safety else 0,
        "processing_ms": {
            str(q): float(np.percentile(engine.timings, q) * 1000) for q in (50, 95, 99)
        },
        "rtf": float(sum(engine.timings) / (n / SR)),
        "max_output_queue_samples": engine.max_queue,
        "linear_projection_gain": float(
            np.dot(clean[active], near[active])
            / (np.dot(near[active], near[active]) + 1e-12)
        ),
        "note": "Aggregate echo reduction is residual-to-known-near error, NOT pure far-end ERLE during double-talk; no gate. Mute separately reported.",
    }
    stem = f"{name}_{kind}_{'reference' if aec else 'noaec'}" + (
        "" if safety else "_unguarded"
    )
    if profile != "original":
        stem += "_" + profile
    if oracle:
        stem += "_oracle"
    for label, data in [("output", out), ("clean", clean), ("mic", raw)]:
        sf.write(ROOT / f"artifacts/{stem}_{label}.wav", data, SR, subtype="PCM_16")
    metrics["audio_stem"] = stem
    return metrics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--case", action="append")
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args()
    ROOT.joinpath("artifacts").mkdir(exist_ok=True)
    voice, source = singing_fixture()
    sf.write(
        ROOT / "artifacts/singer.wav", np.r_[np.zeros(SR), voice, np.zeros(SR * 3)], SR
    )
    model = NeuralVocoder(threads=2)
    # Warmup recorded separately, not hidden in latency claims.
    model.synthesize(np.zeros(7168, dtype=np.float32))
    warmup = model.timings[-1]
    cases = args.case or (
        ["doubletalk", "unison"]
        if args.quick
        else [
            "singer_only",
            "playback_only",
            "doubletalk",
            "unison",
            "octave",
            "sustained_vibrato",
            "gain_change",
            "delay_change",
            "nonlinear_speaker",
            "clock_drift_100ppm",
            "high_loop_gain",
        ]
    )
    report = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "host": platform.node(),
        "baseline_commit": "fb46d29",
        "source": source,
        "model_warmup_ms": warmup * 1000,
        "sample_rate": SR,
        "block_size": HOP,
        "cases": [],
        "limitations": [
            "Signalsmith comparison runs exact vendored core at 60ms, not Chrome device AEC/gate/notch graph. No claim about full baseline room behavior.",
            "Synthetic room impulses; human room acceptance still pending.",
            "PC-NSF-HiFiGAN is noncausal; bounded overlap streaming is experimental.",
            "Matched calibration is measured from independent noise; changing path intentionally not adapted during singing.",
            "No learned harmony decisions: pitch and intervals are DSP/rules.",
        ],
    }
    if args.append and (ROOT / "artifacts/measurements.json").exists():
        previous = json.loads((ROOT / "artifacts/measurements.json").read_text())
        report["cases"] = [x for x in previous["cases"] if x["scenario"] not in cases]
    start = time.perf_counter()
    for case in cases:
        for kind, aec in [("signalsmith", False), ("neural", False), ("neural", True)]:
            result = run_case(case, kind, aec, voice, model)
            report["cases"].append(result)
            report["peak_rss_mib"] = (
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2
            )
            report["elapsed_seconds"] = time.perf_counter() - start
            (ROOT / "artifacts/measurements.json").write_text(
                json.dumps(report, indent=2)
            )
            print(
                json.dumps(
                    {
                        k: result[k]
                        for k in [
                            "scenario",
                            "engine",
                            "aec",
                            "active_near_error_snr_db",
                            "post_singer_output_dbfs",
                            "safety_mute",
                            "rtf",
                        ]
                    }
                ),
                flush=True,
            )


if __name__ == "__main__":
    main()
