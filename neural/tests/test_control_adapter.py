import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from control_adapter import FrameControlCache, ControlBoundaryError
from vocoder import StreamingVocoder, STREAM_PROFILES
from test_conditioning import model_stub

FIXTURE = Path(__file__).parent / "fixtures/frame-controls-v1.json"


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.packet = json.loads(FIXTURE.read_text())
        self.cache = FrameControlCache(self.packet["clock_id"])

    def ingest(self, packet=None, cache=None, available=6144):
        (cache or self.cache).ingest(
            self.packet if packet is None else packet,
            available_source_sample=available,
        )

    def assert_code(self, code, fn):
        with self.assertRaises(ControlBoundaryError) as error:
            fn()
        self.assertEqual(error.exception.code, code)

    def test_pinned_controller_packet_preserves_values_and_request_order(self):
        self.ingest()
        out = self.cache.lookup([1792, 256, 1792])
        np.testing.assert_array_equal(
            out.target_f0_hz, np.array(self.packet["target_f0_hz"])[[3, 0, 3]]
        )
        np.testing.assert_array_equal(
            out.gain_multiplier, np.array(self.packet["gain_multiplier"])[[3, 0, 3]]
        )
        a = self.cache([256], np.array([999]), np.array([888]))
        b = self.cache([256], np.array([1]), np.array([2]))
        self.assertEqual(a.target_f0_hz.tobytes(), b.target_f0_hz.tobytes())
        self.assertEqual(a.gain_multiplier.tobytes(), b.gain_multiplier.tobytes())

    def test_input_and_returned_arrays_cannot_mutate_cached_or_queued_values(self):
        self.ingest()
        queued = self.cache.lookup([256])
        original = queued.gain_multiplier.copy()
        self.packet["gain_multiplier"][0] = 0
        self.assertFalse(queued.gain_multiplier.flags.writeable)
        separate = self.cache.lookup([256])
        separate.gain_multiplier.setflags(write=True)
        separate.gain_multiplier[0] = 0
        np.testing.assert_array_equal(queued.gain_multiplier, original)
        np.testing.assert_array_equal(
            self.cache.lookup([256]).gain_multiplier, original
        )

    def test_explicit_preroll_does_not_pad_missing_positive_frames(self):
        out = self.cache.lookup([-768, -256])
        np.testing.assert_array_equal(out.target_f0_hz, [0, 0])
        np.testing.assert_array_equal(out.gain_multiplier, [0, 0])
        self.assert_code("NOT_AVAILABLE", lambda: self.cache.lookup([256]))
        self.ingest()
        self.assert_code("NOT_AVAILABLE", lambda: self.cache.lookup([6400]))

    def test_epoch_causality_grid_and_receiver_availability(self):
        for key, value, code in [
            ("clock_id", "other-epoch", "CLOCK"),
            ("frame_center_samples", [0] * 12, "CAUSALITY"),
            ("observation_end_samples", [0] * 12, "CAUSALITY"),
            ("available_through_sample", 512, "CAUSALITY"),
        ]:
            p = copy.deepcopy(self.packet)
            p[key] = value
            self.assert_code(code, lambda: self.ingest(p))
        self.assert_code("CAUSALITY", lambda: self.ingest(available=5632))
        self.assertEqual(self.cache.available_through_sample, 0)

    def test_invalid_gain_pitch_shape_and_preroll_are_rejected(self):
        for key, value, code in [
            ("gain_multiplier", [float("nan")] * 12, "RANGE"),
            ("gain_multiplier", [True] * 12, "RANGE"),
            ("gain_multiplier", [1.01] * 12, "RANGE"),
            ("target_f0_hz", [49] * 12, "RANGE"),
            ("target_f0_hz", [2501] * 12, "RANGE"),
            ("target_f0_hz", [10**1000] * 12, "RANGE"),
            ("target_f0_hz", [], "SHAPE"),
        ]:
            p = copy.deepcopy(self.packet)
            p[key] = value
            self.assert_code(code, lambda: self.ingest(p))
        p = copy.deepcopy(self.packet)
        p["frame_center_samples"][0] = -256
        p["observation_end_samples"][0] = 0
        self.assert_code("PREROLL", lambda: self.ingest(p))

    def test_revisions_and_watermark_regression_fail_atomically(self):
        self.ingest()
        self.ingest()  # Identical retransmission is harmless, no policy stepping.
        p = copy.deepcopy(self.packet)
        p["gain_multiplier"][-1] = 0
        self.assert_code("REVISION", lambda: self.ingest(p))
        self.assertEqual(
            self.cache.lookup([5888]).gain_multiplier[0],
            self.packet["gain_multiplier"][-1],
        )
        p = copy.deepcopy(self.packet)
        for key in (
            "frame_center_samples",
            "observation_end_samples",
            "target_f0_hz",
            "gain_multiplier",
        ):
            p[key] = p[key][:1]
        p["available_through_sample"] = 512
        self.assert_code("ORDER", lambda: self.ingest(p))

    def test_epoch_and_capacity_cannot_be_rebound_in_place(self):
        self.ingest()
        with self.assertRaises(AttributeError):
            self.cache.clock_id = "another-epoch"
        with self.assertRaises(AttributeError):
            self.cache.max_frames = 1000000
        self.assert_code("CLOCK", lambda: self.cache.lookup([np.int64(-(2**63))]))

    def test_bounded_cache_requires_explicit_release_and_keeps_queued_copy(self):
        cache = FrameControlCache(self.packet["clock_id"], max_frames=12)
        self.ingest(cache=cache)
        queued = cache.lookup([256])
        p = copy.deepcopy(self.packet)
        for key in (
            "frame_center_samples",
            "observation_end_samples",
            "target_f0_hz",
            "gain_multiplier",
        ):
            p[key] = p[key][-1:]
        p["frame_center_samples"] = [6400]
        p["observation_end_samples"] = [6656]
        p["available_through_sample"] = 6656
        self.assert_code("BACKPRESSURE", lambda: self.ingest(p, cache, 6656))
        self.assertEqual(cache.available_through_sample, 6144)
        cache.release_before(768)
        self.ingest(p, cache, 6656)
        self.assert_code("EXPIRED", lambda: cache.lookup([256]))
        self.assert_code("ACK", lambda: cache.release_before(256))
        self.assert_code("ACK", lambda: cache.release_before(7424))
        self.assertEqual(queued.gain_multiplier[0], self.packet["gain_multiplier"][0])

    def test_packet_reaches_overlapping_renderer_without_rms_rescaling(self):
        self.ingest()
        model = model_stub()  # Returns unit waveform; expected gain is exact.
        x = np.full(6144, 0.01, dtype=np.float32)
        y = model.synthesize(x, conditioning=self.cache)
        expected = np.interp(
            np.arange(6144),
            self.packet["frame_center_samples"],
            self.packet["gain_multiplier"],
        )
        np.testing.assert_allclose(y, expected, atol=1e-7)
        np.testing.assert_allclose(
            model.session.feeds[0]["f0"][0], self.packet["target_f0_hz"], rtol=1e-7
        )
        model.session.feeds.clear()
        stream = StreamingVocoder(
            model=model, conditioning=self.cache, **STREAM_PROFILES["responsive"]
        )
        chunks = [stream.push(x[i : i + 512]) for i in range(0, len(x), 512)]
        self.assertEqual(sum(len(y) for y in chunks), 4096)
        self.assertEqual(len(model.session.feeds), 2)
        # First window centers -768..2816, second 1280..4864: exact overlap.
        np.testing.assert_array_equal(
            model.session.feeds[0]["f0"][0][4:], model.session.feeds[1]["f0"][0][:4]
        )

    def test_unavailable_controls_abort_before_onnx_and_do_not_fallback(self):
        model = model_stub()
        stream = StreamingVocoder(
            model=model, conditioning=self.cache, **STREAM_PROFILES["responsive"]
        )
        self.assert_code("NOT_AVAILABLE", lambda: stream.push(np.zeros(3072)))
        self.assertEqual(model.session.feeds, [])
        self.assertEqual(stream.emitted_samples, 0)


if __name__ == "__main__":
    unittest.main()
