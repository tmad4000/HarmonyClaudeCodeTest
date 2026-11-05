"""Bounded latency/quality sweep; one ONNX model, two CPU threads, no audio device."""

import datetime
import json
import platform
import resource
import time
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal
from dsp import SR, HOP, pitch, rms, features
from vocoder import NeuralVocoder, StreamingVocoder

ROOT = Path(__file__).parent
PROFILES = {
    "original": dict(step=4096, context=2048, right=512, overlap=512),
    "responsive": dict(step=2048, context=1024, right=512, overlap=512),
    "short_right": dict(step=2048, context=2048, right=0, overlap=512),
    "short_context": dict(step=2048, context=512, right=0, overlap=512),
    "small_step": dict(step=1024, context=1024, right=0, overlap=512),
}


def envelope(x):
    n = len(x) // HOP
    return np.sqrt(np.mean(x[: n * HOP].reshape(n, HOP) ** 2, axis=1) + 1e-20)


def main():
    model = NeuralVocoder(threads=2)
    model.synthesize(np.zeros(7168, dtype=np.float32))
    report = {
        "host": platform.node(),
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "profiles": PROFILES,
        "rows": [],
        "note": "One worker; two CPU threads. Virtual input schedule uses measured push service times; no hardware audio. Short windows trade context for latency. Same fixture/normalization and fixed +4 semitones.",
    }
    for number in (1, 10, 20):
        x, sr = sf.read(ROOT / f"fixtures/Audio/vocadito_{number}.wav")
        if x.ndim > 1:
            x = x.mean(axis=1)
        if sr != SR:
            x = signal.resample_poly(x, SR, sr)
        ann = np.loadtxt(
            ROOT / f"fixtures/Annotations/F0/vocadito_{number}_f0.csv", delimiter=","
        )
        first = np.flatnonzero(ann[:, 1] > 0)[0]
        start = max(0, int(ann[first, 0] * SR) - SR // 4)
        x = (x[start : start + SR * 4]).astype(np.float32)
        x *= min(1, 0.045 / rms(x))
        x = np.pad(x, (0, (-len(x)) % HOP))
        offline = model.synthesize(x)
        mref, _ = features(offline)
        for name, profile in PROFILES.items():
            stream = StreamingVocoder(model=model, **profile)
            outputs = []
            first_ready = None
            service = []
            render_times = []
            worker_time = 0
            sample_cursor = 0
            max_backlog = 0
            before = len(model.timings)
            begin = time.perf_counter()
            for i in range(0, len(x) + stream.buffering_samples, HOP):
                chunk = x[i : i + HOP]
                chunk = np.pad(chunk, (0, HOP - len(chunk)))
                clock = (i + HOP) / SR
                t = time.perf_counter()
                out = stream.push(chunk)
                elapsed = time.perf_counter() - t
                service.append(elapsed)
                worker_time = max(clock, worker_time) + elapsed
                max_backlog = max(max_backlog, worker_time - clock)
                if len(out):
                    if first_ready is None:
                        first_ready = i + HOP
                    render_times.append(
                        {"source_start_samples": sample_cursor, "ready_s": worker_time}
                    )
                    sample_cursor += len(out)
                    outputs.append(out)
            y = np.concatenate(outputs)[: len(x)]
            total = time.perf_counter() - begin
            timing = model.timings[before:]
            valid = 0
            errs = []
            for i in range(2048, len(x) - 2048, HOP * 2):
                t = (start + i) / SR
                f = np.interp(t, ann[:, 0], ann[:, 1])
                f1 = np.interp(t - 0.04, ann[:, 0], ann[:, 1])
                f2 = np.interp(t + 0.04, ann[:, 0], ann[:, 1])
                if min(f, f1, f2) < 65 or max(f, f1, f2) / min(f, f1, f2) > 1.12:
                    continue
                valid += 1
                estimate = pitch(y[i - 2048 : i + 2048])
                if estimate:
                    errs.append(float(1200 * np.log2(estimate / (f * 2 ** (4 / 12)))))
            mel, _ = features(y)
            e1, e2 = envelope(x), envelope(y)
            corr = signal.correlate(e2 - e2.mean(), e1 - e1.mean())
            lags = signal.correlation_lags(len(e2), len(e1))
            keep = abs(lags) <= 10
            lag = int(lags[keep][np.argmax(corr[keep])])
            seam = np.arange(profile["step"], len(y), profile["step"])
            jumps = abs(y[seam] - y[seam - 1])
            derivative = abs(np.diff(y))
            delays = np.array(
                [t["ready_s"] - t["source_start_samples"] / SR for t in render_times]
            )
            row = {
                "fixture": number,
                "profile": name,
                "rtf": total / (len(x) / SR),
                "inference_ms": {
                    str(q): float(np.percentile(timing, q) * 1000) for q in (50, 95, 99)
                },
                "initial_input_wait_ms": first_ready / SR * 1000,
                "estimated_latency_p95_ms": first_ready / SR * 1000
                + float(np.percentile(timing, 95) * 1000)
                + HOP / SR * 1000,
                "serialized_ready_delay_p95_ms": float(
                    np.percentile(delays, 95) * 1000
                ),
                "max_worker_backlog_ms": max_backlog * 1000,
                "calls_over_step_fraction": float(
                    np.mean(np.array(timing) > profile["step"] / SR)
                ),
                "pitch_median_absolute_cents": float(np.median(abs(np.array(errs)))),
                "pitch_gross_error_fraction": float(np.mean(abs(np.array(errs)) > 100)),
                "voiced_coverage": len(errs) / max(1, valid),
                "stream_offline_logmel_mae": float(
                    np.mean(abs(mel - mref[: len(mel)]))
                ),
                "content_envelope_lag_ms": lag * HOP / SR * 1000,
                "seam_jump_p95": float(np.percentile(jumps, 95)),
                "all_sample_step_p95": float(np.percentile(derivative, 95)),
            }
            report["rows"].append(row)
            report["peak_rss_mib"] = (
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2
            )
            (ROOT / "artifacts/responsiveness-sweep.json").write_text(
                json.dumps(report, indent=2)
            )
            sf.write(ROOT / f"artifacts/responsive_{number}_{name}.wav", y, SR)
            print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
