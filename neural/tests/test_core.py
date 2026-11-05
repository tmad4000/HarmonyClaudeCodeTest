import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from scipy import signal
from dsp import SR, pitch, features, target_f0, rms
from echo import ReferenceCanceller, ReferenceTimeline, Safety, estimate_path


class CoreTests(unittest.TestCase):
    def test_pitch_sustained_vibrato_and_octaves(self):
        for f in (82.4, 110, 220, 440, 880):
            t = np.arange(4096) / SR
            x = sum(0.1 / k * np.sin(2 * np.pi * f * k * t) for k in range(1, 5))
            self.assertLess(abs(1200 * np.log2(pitch(x) / f)), 8)

    def test_feature_contract(self):
        m, f = features(np.zeros(8192))
        self.assertEqual(m.shape, (16, 128))
        self.assertEqual(f.shape, (16,))
        self.assertTrue(np.isfinite(m).all())
        self.assertTrue((f == 0).all())

    def test_diatonic_third_preserves_vibrato(self):
        f = 440 * 2 ** ((np.array([60.0, 62.1, 64.0, 65.0]) - 69) / 12)
        self.assertTrue(
            np.allclose(target_f0(f, key=0) / f, 2 ** (np.array([4, 3, 3, 4]) / 12))
        )

    def test_fir_doubletalk_correlated_unison(self):
        rng = np.random.default_rng(42)
        ref = rng.normal(0, 0.05, 32000)
        h = np.zeros(2048)
        h[400] = 0.5
        h[1400] = -0.2
        near = 0.7 * ref  # Worst case: singer perfectly correlated with reference.
        echo = signal.fftconvolve(ref, h)[: len(ref)]
        a = ReferenceCanceller(h)
        out = []
        for k in range(0, len(ref), 512):
            out.extend(a.process((near + echo)[k : k + 512], ref[k : k + 512])[0])
        self.assertLess(rms(np.array(out) - near), 1e-7)

    def test_independent_probe_identification(self):
        rng = np.random.default_rng(2)
        x = np.r_[rng.normal(0, 0.02, 44100), np.zeros(8192)]
        h = np.zeros(4096)
        h[123] = 0.6
        h[1700] = -0.2
        y = signal.fftconvolve(x, h)[: len(x)]
        fitted = estimate_path(x, y, 4096)
        self.assertLess(rms(fitted - h), 1e-5)

    def test_timeline_fractional_offset_and_gap(self):
        t = ReferenceTimeline()
        t.write(np.arange(512, dtype=float), 10)
        a, ok = t.read(10 + 0.5 / SR, 100)
        self.assertTrue(ok)
        self.assertAlmostEqual(a[20], 20.5, places=3)
        _, ok = t.read(9, 100)
        self.assertFalse(ok)

    def test_post_limiter_reference_and_latching_mute(self):
        s = Safety()
        a = s.process(np.array([2.0, -2.0]))
        self.assertLessEqual(abs(a).max(), 0.180001)
        s.process(np.array([np.nan]))
        self.assertEqual(s.reason, "nonfinite_output")
        self.assertEqual(s.process(np.ones(32)).sum(), 0)

    def test_reference_shape_and_nonfinite_rejected(self):
        a = ReferenceCanceller([0.1])
        with self.assertRaises(ValueError):
            a.process(np.zeros(3), np.zeros(2))
        with self.assertRaises(FloatingPointError):
            a.process(np.array([np.nan]), np.zeros(1))


if __name__ == "__main__":
    unittest.main()
