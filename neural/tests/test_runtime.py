import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from live import LiveSession
from dsp import HOP, SR
from vocoder import StreamingVocoder


class FakeModel:
    def synthesize(self, x, *args):
        return np.asarray(x)


class RuntimeTests(unittest.TestCase):
    def session(self):
        s = LiveSession()
        s.state = "running"
        s.timeline.write(np.zeros(SR), 9)
        return s

    def test_stream_buffer_is_bounded_and_no_whole_song_needed(self):
        s = StreamingVocoder(model=FakeModel())
        total = 0
        for _ in range(100):
            out = s.push(np.ones(HOP, dtype=np.float32))
            total += len(out)
            self.assertLess(len(s.pending), s.buffering_samples)
            self.assertEqual(len(s.history), s.context)
        self.assertGreater(total, 40000)

    def test_reference_is_exact_final_output(self):
        s = self.session()
        s.outq.put(np.full(HOP, 0.3))
        out = np.zeros((HOP, 1), dtype=np.float32)
        clock = SimpleNamespace(outputBufferDacTime=10.0, inputBufferAdcTime=9.8)
        s.callback(np.zeros_like(out), out, HOP, clock, False)
        ref, ok = s.timeline.read(10, HOP)
        self.assertTrue(ok)
        np.testing.assert_array_equal(ref, out[:, 0])
        self.assertLess(abs(ref).max(), 0.181)

    def test_device_dropout_mutes_and_records_zero_reference(self):
        s = self.session()
        s.outq.put(np.ones(HOP))
        out = np.ones((HOP, 1), dtype=np.float32)
        s.callback(
            np.zeros_like(out),
            out,
            HOP,
            SimpleNamespace(outputBufferDacTime=10, inputBufferAdcTime=9.8),
            "output underflow",
        )
        self.assertEqual(s.safety.reason, "audio_device_dropout")
        self.assertEqual(out.sum(), 0)
        self.assertEqual(s.timeline.samples[-HOP:].sum(), 0)

    def test_output_starvation_latches(self):
        s = self.session()
        s.started_output = True
        for i in range(4):
            out = np.zeros((HOP, 1), dtype=np.float32)
            s.callback(
                out.copy(),
                out,
                HOP,
                SimpleNamespace(
                    outputBufferDacTime=10 + i * HOP / SR,
                    inputBufferAdcTime=9.8 + i * HOP / SR,
                ),
                False,
            )
        self.assertEqual(s.safety.reason, "inference_output_starvation")

    def test_reference_gap_latches(self):
        s = self.session()
        out = np.zeros((HOP, 1), dtype=np.float32)
        s.callback(
            out.copy(),
            out,
            HOP,
            SimpleNamespace(outputBufferDacTime=10, inputBufferAdcTime=8),
            False,
        )
        self.assertEqual(s.safety.reason, "reference_timeline_gap")

    def test_input_queue_overload_latches(self):
        s = self.session()
        for _ in range(32):
            s.inq.put((np.zeros(HOP), np.zeros(HOP)))
        out = np.zeros((HOP, 1), dtype=np.float32)
        s.callback(
            out.copy(),
            out,
            HOP,
            SimpleNamespace(outputBufferDacTime=10, inputBufferAdcTime=9.8),
            False,
        )
        self.assertEqual(s.safety.reason, "input_overload")


if __name__ == "__main__":
    unittest.main()
