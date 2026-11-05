"""Require audible harmony AND separation/stability; silence cannot pass."""

import datetime
import json
import platform
from pathlib import Path
import numpy as np
import soundfile as sf
from dsp import SR, HOP
from vocoder import NeuralVocoder
from validate import singing_fixture, run_case

ROOT = Path(__file__).parent
CRITERIA = {
    "audible_retention_fraction_min": 1.0,
    "longest_dropout_ms_max": 0.0,
    "median_level_deviation_db_max": 3,
    "near_error_snr_db_min": 20,
    "tail_dbfs_max": -60,
    "safety_mute_allowed": False,
}


def joint_pass(m):
    """All requirements are mandatory; quiet output alone is never success."""
    return bool(
        m["audible_retention_fraction"] is not None
        and m["audible_retention_fraction"]
        >= CRITERIA["audible_retention_fraction_min"]
        and m["longest_dropout_ms"] <= CRITERIA["longest_dropout_ms_max"]
        and abs(m["median_output_level_vs_oracle_db"])
        <= CRITERIA["median_level_deviation_db_max"]
        and m["near_error_snr_db"] >= CRITERIA["near_error_snr_db_min"]
        and m["tail_dbfs"] < CRITERIA["tail_dbfs_max"]
        and m["mute"] is None
    )


def envelope(x):
    return np.sqrt(
        np.mean(x[: len(x) // HOP * HOP].reshape(-1, HOP) ** 2, axis=1) + 1e-20
    )


def compare(actual, oracle):
    a, o = envelope(actual), envelope(oracle)
    mask = o > 0.002
    retention = 20 * np.log10((a + 1e-10) / (o + 1e-10))
    gap = mask & (retention < -12)
    longest = run = 0
    for v in gap:
        run = run + 1 if v else 0
        longest = max(longest, run)
    return {
        "oracle_audible_frames": int(mask.sum()),
        "audible_retention_fraction": float(np.mean(retention[mask] >= -12))
        if mask.any()
        else None,
        "median_output_level_vs_oracle_db": float(np.median(retention[mask]))
        if mask.any()
        else None,
        "longest_dropout_ms": longest * HOP / SR * 1000,
    }


def main():
    voice, source = singing_fixture()
    model = NeuralVocoder(threads=2)
    report = {
        "host": platform.node(),
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": source,
        "criteria": CRITERIA,
        "rows": [],
        "note": "Joint numerical acceptance only, not human musical acceptance. Oracle uses same neural renderer/profile with clean input, no room path; no singer gate. Reference cancellation failures cannot pass via safety silence.",
    }
    for case in [
        "doubletalk",
        "unison",
        "sustained_vibrato",
        "delay_change",
        "high_loop_gain",
    ]:
        for profile in ["original", "responsive"]:
            ideal = run_case(
                case, "neural", True, voice, model, profile=profile, oracle=True
            )
            actual = run_case(case, "neural", True, voice, model, profile=profile)
            a, _ = sf.read(ROOT / f"artifacts/{actual['audio_stem']}_output.wav")
            o, _ = sf.read(ROOT / f"artifacts/{ideal['audio_stem']}_output.wav")
            m = compare(a, o)
            m.update(
                scenario=case,
                profile=profile,
                near_error_snr_db=actual["active_near_error_snr_db"],
                tail_dbfs=actual["post_singer_output_dbfs"],
                mute=actual["safety_mute"],
                audio_stem=actual["audio_stem"],
                oracle_stem=ideal["audio_stem"],
            )
            m["joint_numerical_pass"] = joint_pass(m)
            report["rows"].append(m)
            (ROOT / "artifacts/continuity.json").write_text(
                json.dumps(report, indent=2)
            )
            print(json.dumps(m), flush=True)


if __name__ == "__main__":
    main()
