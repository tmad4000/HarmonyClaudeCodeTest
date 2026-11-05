"""Neural singing pitch/streaming metrics on three licensed real singers."""

import json
import time
import resource
import platform
import datetime
import hashlib
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal
from dsp import SR, HOP, pitch, features, rms
from vocoder import NeuralVocoder, StreamingVocoder
from engine import Signalsmith

ROOT = Path(__file__).parent


def main():
    model = NeuralVocoder(threads=2)
    rows = []
    for number in (1, 10, 20):
        file = ROOT / f"fixtures/Audio/vocadito_{number}.wav"
        x, sr = sf.read(file)
        x = x.mean(axis=1) if x.ndim > 1 else x
        if sr != SR:
            x = signal.resample_poly(x, SR, sr)
        annotation = np.loadtxt(
            ROOT / f"fixtures/Annotations/F0/vocadito_{number}_f0.csv", delimiter=","
        )
        voiced = np.flatnonzero(annotation[:, 1] > 0)
        start = max(0, int(annotation[voiced[0], 0] * SR) - SR // 4)
        x = x[start : start + SR * 5]
        x = (x * min(1, 0.045 / rms(x))).astype(np.float32)
        x = np.pad(x, (0, (-len(x)) % HOP))
        st = StreamingVocoder(model=model)
        pieces = []
        first_ready = None
        previous = len(model.timings)
        began = time.perf_counter()
        for i in range(0, len(x) + st.buffering_samples, HOP):
            part = x[i : i + HOP]
            part = np.pad(part, (0, HOP - len(part)))
            result = st.push(part)
            if len(result):
                if first_ready is None:
                    first_ready = i + HOP
                pieces.append(result)
        streamed = np.concatenate(pieces)[: len(x)]
        elapsed = time.perf_counter() - began
        infer = model.timings[previous:]
        offline = model.synthesize(x)[: len(x)]
        base = Signalsmith(4)
        b = []
        for i in range(0, len(x) + base.latency + HOP, HOP):
            part = x[i : i + HOP]
            part = np.pad(part, (0, HOP - len(part)))
            b.extend(base.push(part))
        baseline = np.array(b)[base.latency : base.latency + len(x)]
        base.close()
        errors = {
            "streamed": [],
            "offline": [],
            "signalsmith": [],
            "input_detector": [],
        }
        voiced_count = 0
        for i in range(2048, len(x) - 2048, HOP * 2):
            t = (start + i) / SR
            f = float(np.interp(t, annotation[:, 0], annotation[:, 1]))
            before = float(np.interp(t - 0.04, annotation[:, 0], annotation[:, 1]))
            after = float(np.interp(t + 0.04, annotation[:, 0], annotation[:, 1]))
            if (
                min(f, before, after) < 65
                or max(f, before, after) / min(f, before, after) > 1.12
            ):
                continue
            voiced_count += 1
            for name, y in [
                ("streamed", streamed),
                ("offline", offline),
                ("signalsmith", baseline),
                ("input_detector", x),
            ]:
                est = pitch(y[i - 2048 : i + 2048])
                target = f if name == "input_detector" else f * 2 ** (4 / 12)
                if est > 0:
                    errors[name].append(float(1200 * np.log2(est / target)))
        metrics = {
            k: {
                "median_absolute_cents": float(np.median(abs(np.array(v))))
                if v
                else None,
                "gross_error_over_100c_fraction": float(np.mean(abs(np.array(v)) > 100))
                if v
                else None,
                "voiced_coverage": len(v) / max(voiced_count, 1),
            }
            for k, v in errors.items()
        }
        m1, _ = features(streamed)
        m2, _ = features(offline)
        row = {
            "fixture": file.name,
            "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
            "source_start_samples": start,
            "duration_s": len(x) / SR,
            "rtf": elapsed / (len(x) / SR),
            "first_chunk_input_wait_ms": first_ready / SR * 1000,
            "inference_ms": {
                str(q): float(np.percentile(infer, q) * 1000) for q in (50, 95, 99)
            },
            "estimated_live_latency_ms": first_ready / SR * 1000
            + float(np.percentile(infer, 95) * 1000)
            + HOP / SR * 1000,
            "latency_note": "Conservative buffering + measured p95 compute + one callback; not hardware loopback latency.",
            "stream_offline_logmel_mae": float(np.mean(abs(m1 - m2))),
            "pitch_metrics": metrics,
        }
        rows.append(row)
        for name, data in [
            ("input", x),
            ("streamed", streamed),
            ("offline", offline),
            ("signalsmith", baseline),
        ]:
            sf.write(ROOT / f"artifacts/quality_{number}_{name}.wav", data, SR)
        print(json.dumps(row), flush=True)
    result = {
        "host": platform.node(),
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2,
        "rows": rows,
        "limitations": [
            "Pitch references are human-annotated vocadito F0; estimate uses DSP YIN, discards fast-changing/unvoiced frames.",
            "No perceptual/MOS or physical-room acceptance claimed.",
            "Model windows have independently initialized excitation; crossfading mitigates but does not eliminate phase/timbre artifacts.",
        ],
    }
    (ROOT / "artifacts/quality.json").write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
