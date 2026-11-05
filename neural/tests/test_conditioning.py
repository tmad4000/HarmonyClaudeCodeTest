import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from dsp import HOP
from vocoder import (
    NeuralVocoder,
    StreamingVocoder,
    FrameControls,
    validate_controls,
    STREAM_PROFILES,
)
from continuity import compare


class SessionStub:
    def __init__(self):
        self.feeds = []

    def run(self, _, feed):
        self.feeds.append(feed)
        return [np.ones((1, feed["f0"].shape[1] * HOP), dtype=np.float32)]


def model_stub():
    model = NeuralVocoder.__new__(NeuralVocoder)
    model.session = SessionStub()
    model.timings = []
    return model


class ConditioningTests(unittest.TestCase):
    def test_external_pitch_and_gain_reach_renderer_with_sample_clock(self):
        model = model_stub()
        calls = []

        def provider(positions, observed, default):
            calls.append((positions.copy(), observed.copy(), default.copy()))
            return FrameControls(
                np.full(len(positions), 330), np.full(len(positions), 0.5)
            )

        y = model.synthesize(
            np.zeros(4096), conditioning=provider, source_start_sample=1024
        )
        np.testing.assert_array_equal(calls[0][0], 1024 + 256 + np.arange(8) * 512)
        self.assertTrue(np.all(model.session.feeds[0]["f0"] == 330))
        np.testing.assert_array_equal(y, np.full(4096, 0.5))

    def test_control_validation_rejects_bad_units_and_values(self):
        for f, g in [
            (np.zeros(2), np.zeros(3)),
            ([np.nan, 330], [1, 1]),
            ([330, 330], [0.065, 2]),
            ([330, -1], [1, 1]),
            ([330, 3000], [1, 1]),
        ]:
            with self.assertRaises(ValueError):
                validate_controls(FrameControls(np.array(f), np.array(g)), 2)

    def test_stream_reports_absolute_source_positions_without_controller_decisions(
        self,
    ):
        model = model_stub()
        starts = []

        def provider(positions, observed, default):
            starts.append(int(positions[0]))
            return FrameControls(default, np.ones_like(default))

        s = StreamingVocoder(
            model=model, conditioning=provider, **STREAM_PROFILES["responsive"]
        )
        for _ in range(16):
            s.push(np.zeros(HOP, dtype=np.float32))
        self.assertEqual(starts, [-768, 1280, 3328])
        self.assertEqual(s.emitted_samples, 6144)

    def test_invalid_stream_configuration_or_input_is_rejected(self):
        with self.assertRaises(ValueError):
            StreamingVocoder(model=model_stub(), step=10)
        with self.assertRaises(ValueError):
            StreamingVocoder(model=model_stub(), context=0)
        s = StreamingVocoder(model=model_stub())
        with self.assertRaises(ValueError):
            s.push(np.array([np.nan]))
        with self.assertRaises(ValueError):
            s.push(np.zeros(s.buffering_samples + 1))

    def test_silence_cannot_pass_audible_continuity_metric(self):
        oracle = np.full(4096, 0.05)
        metrics = compare(np.zeros(4096), oracle)
        self.assertEqual(metrics["audible_retention_fraction"], 0)
        self.assertGreater(metrics["longest_dropout_ms"], 90)


if __name__ == "__main__":
    unittest.main()
