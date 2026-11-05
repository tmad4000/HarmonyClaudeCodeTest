"""Assertions on retained simulation evidence; no substitute for physical tests."""

import json
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / "artifacts/measurements.json"


@unittest.skipUnless(PATH.exists(), "Run validate.py to generate measurement evidence")
class MeasuredTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = json.loads(PATH.read_text())["cases"]

    def find(self, case, kind="neural", aec=True):
        return next(
            x
            for x in self.rows
            if x["scenario"] == case and x["engine"] == kind and x["aec"] == aec
        )

    def test_full_matrix(self):
        self.assertEqual(len(self.rows), 33)
        for x in self.rows:
            self.assertLessEqual(x["output_peak"], 0.180001)
            self.assertGreater(x["rtf"], 0)

    def test_fixed_path_preserves_correlated_singer_without_mute(self):
        for scenario in ("doubletalk", "unison", "octave", "sustained_vibrato"):
            x = self.find(scenario)
            self.assertGreater(x["active_near_error_snr_db"], 60)
            self.assertIsNone(x["safety_mute"])
            self.assertAlmostEqual(x["linear_projection_gain"], 1, places=3)

    def test_high_gain_baselines_require_safety_and_reference_does_not(self):
        for kind in ("neural", "signalsmith"):
            self.assertEqual(
                self.find("high_loop_gain", kind, False)["safety_mute"],
                "sustained_output_overload",
            )
        self.assertIsNone(self.find("high_loop_gain")["safety_mute"])

    def test_mismatch_limit_is_visible_not_hidden_by_a_gate(self):
        for scenario in ("delay_change", "clock_drift_100ppm"):
            x = self.find(scenario)
            self.assertLess(x["active_near_error_snr_db"], 25)
            self.assertIsNone(x["safety_mute"])

    def test_silent_user_tail_with_reference(self):
        for x in self.rows:
            if x["aec"]:
                self.assertLess(x["post_singer_output_dbfs"], -60)

    def test_singer_only_no_phantom_echo_subtraction(self):
        x = self.find("singer_only")
        self.assertGreater(x["active_near_error_snr_db"], 100)


if __name__ == "__main__":
    unittest.main()
