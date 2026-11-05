"""Pinned controller packet through real ONNX; no devices or musical acceptance."""

import datetime
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
from control_adapter import FrameControlCache
from vocoder import NeuralVocoder, StreamingVocoder, STREAM_PROFILES

ROOT = Path(__file__).parent


class RecordingSession:
    def __init__(self, session):
        self.session = session
        self.pitch_feeds = []

    def run(self, outputs, inputs):
        self.pitch_feeds.append(inputs["f0"].copy())
        return self.session.run(outputs, inputs)


def main():
    path = ROOT / "tests/fixtures/frame-controls-v1.json"
    packet = json.loads(path.read_text())
    cache = FrameControlCache(packet["clock_id"])
    # All source samples are present in this bounded offline fixture. This is
    # not a live causal feature producer, transport or physical latency test.
    cache.ingest(packet, available_source_sample=6144)
    model = NeuralVocoder(threads=2)
    model.session = RecordingSession(model.session)
    stream = StreamingVocoder(
        model=model, conditioning=cache, **STREAM_PROFILES["responsive"]
    )
    t = np.arange(6144) / 44100
    source = (0.06 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    chunks = [stream.push(source[i : i + 512]) for i in range(0, len(source), 512)]
    output = np.concatenate(chunks)
    expected_centers = [np.arange(-768, 3072, 512), np.arange(1280, 5120, 512)]
    exact_feeds = len(model.session.pitch_feeds) == len(expected_centers) and all(
        np.array_equal(feed[0], cache.lookup(centers).target_f0_hz.astype(np.float32))
        for feed, centers in zip(model.session.pitch_feeds, expected_centers)
    )
    overlap = np.array_equal(
        model.session.pitch_feeds[0][0][4:], model.session.pitch_feeds[1][0][:4]
    )
    result = {
        "host": platform.node(),
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "fixture_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "controller_commit": "4aefe8c554de963faa42a404ebc8f0dc74edb884",
        "clock_id": packet["clock_id"],
        "profile": "responsive",
        "source_samples": len(source),
        "output_samples": len(output),
        "onnx_calls": len(model.timings),
        "inference_ms": [x * 1000 for x in model.timings],
        "exact_controller_pitch_feeds": exact_feeds,
        "immutable_overlap_pitch_feeds": overlap,
        "output_rms": float(np.sqrt(np.mean(output**2))),
        "microphone_opened": False,
        "audio_played": False,
        "scope": "Offline packet-to-neural-renderer smoke only. No live producer/transport, physical latency, continuous musical quality or feedback acceptance claimed.",
    }
    result["passed"] = bool(
        exact_feeds
        and overlap
        and len(output) == 4096
        and np.isfinite(output).all()
        and result["output_rms"] > 1e-7
    )
    (ROOT / "artifacts/controller-adapter-smoke.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(json.dumps(result, indent=2))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
