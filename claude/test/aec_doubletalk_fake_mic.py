#!/usr/bin/env python3
"""
Does the harmony output make Chrome's echo canceller suppress the singer? (double-talk test)

Feeds a sung-tone WAV to Chrome as a FAKE MICROPHONE (--use-file-for-fake-audio-capture). The
browser's audio processing (AEC/NS) still runs on that capture with the page's output as the
far-end reference, but unlike playing the tone through the speakers, the "singer" is not system
output, so the canceller cannot simply cancel it. If the mic path still collapses only when the
harmonies are audible in speaker mode, the canceller is treating our pitch-shifted copy of the
voice as echo and suppressing the voice (double-talk suppression).

Cases (all headless, silent):
  A  speaker mode, harmony voice backing          (AEC on, correlated far-end)
  B  speaker mode, harmony volume 0               (AEC on, no far-end)
  C  headphone mode, harmony voice backing        (AEC off)
  D  speaker mode, piano backing, chords          (AEC on, uncorrelated far-end)

Usage: PORT=8471 python3 claude/test/aec_doubletalk_fake_mic.py
"""
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sustained_tone_realistic import make_wav, PATTERN  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = os.environ.get("PORT", "8471")
BASE = f"http://127.0.0.1:{PORT}/claude/index.html"

CASES = [
    ("A speaker+voice harmony", "?autostart=1&speaker=1&key=G&scale=major&mode=thirds&engine=stretch", None),
    ("B speaker, harmony muted", "?autostart=1&speaker=1&key=G&scale=major&mode=thirds&engine=stretch", "mute"),
    ("C headphones+voice harmony", "?autostart=1&speaker=0&key=G&scale=major&mode=thirds&engine=stretch", None),
    ("D speaker+piano chords", "?autostart=1&speaker=1&key=G&scale=major&mode=thirds&engine=stretch&backing=pad&backingStyle=chords", None),
]


def singing_windows():
    out, t = [], 0.0
    for dur, on in PATTERN:
        if on:
            out.append((t + 0.3, t + dur - 0.15))
        t += dur
    return out


def run_case(p, wav, total, name, query, tweak):
    browser = p.chromium.launch(headless=True, args=[
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        f"--use-file-for-fake-audio-capture={wav}%noloop",
        "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(permissions=["microphone"])
    page = ctx.new_page()
    t0 = time.time()
    page.goto(BASE + query)
    page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=20000)
    if tweak == "mute":
        page.evaluate("window.harmonySinger.harmonyVolume = 0; window.harmonySinger.updateGains()")
    start = page.evaluate("window.harmonySinger.getLog().find(e => e.type === 'start')")
    rows = []
    while time.time() - t0 < total + 1.0:
        g = page.evaluate("window.harmonySinger.measureGuard(0)")
        st = page.evaluate("({pitch: window.harmonySinger.smoothedPitch, present: window.harmonySinger.voicePresent, out: window.harmonySinger.measureBacking().instRms})")
        rows.append((time.time() - t0, g["inputRms"], st["pitch"], g["harmonicVoice"], g["gateOpen"], len(g["notches"]), st["present"]))
        time.sleep(0.1)
    log = page.evaluate("window.harmonySinger.getLog()")
    browser.close()
    wins = singing_windows()
    sing = [r for r in rows if any(a <= r[0] <= b for a, b in wins)]
    rms = sorted(r[1] for r in sing if r[1] is not None)
    res = {
        "case": name,
        "mic": {k: (start or {}).get("actual", {}).get(k) for k in ("echoCancellation", "noiseSuppression", "autoGainControl")},
        "gate_open_pct": round(100 * sum(1 for r in sing if r[4]) / max(1, len(sing))),
        "present_pct": round(100 * sum(1 for r in sing if r[6]) / max(1, len(sing))),
        "rms_median": round(rms[len(rms) // 2], 4) if rms else None,
        "rms_p10": round(rms[len(rms) // 10], 4) if rms else None,
        "rms_min": round(rms[0], 4) if rms else None,
        "gate_events": sum(1 for e in log if e["type"] == "gate"),
        "note_changes": sum(1 for e in log if e["type"] == "note"),
        "notches": [e["hz"] for e in log if e["type"] == "notch"],
    }
    return res, rows


def main():
    wav = os.path.join(tempfile.gettempdir(), "harmony-fakemic.wav")
    total = make_wav(wav)
    results = []
    with sync_playwright() as p:
        for name, query, tweak in CASES:
            res, rows = run_case(p, wav, total, name, query, tweak)
            results.append(res)
            print(f"\n== {res['case']}  mic={res['mic']}")
            print(f"   gate open {res['gate_open_pct']}% · voice present {res['present_pct']}% · input rms median {res['rms_median']} p10 {res['rms_p10']} min {res['rms_min']}")
            print(f"   gate events {res['gate_events']} · note re-targets {res['note_changes']} · notches {res['notches']}")
            print("   t   rms     pitch gate")
            for r in rows[2::6]:
                print(f"   {r[0]:4.1f} {r[1] if r[1] is None else f'{r[1]:.4f}'} {str(round(r[2])) if r[2] else '-':>5} {str(r[4])[0]}")
    out = os.path.join(tempfile.gettempdir(), "harmony-doubletalk.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=1)
    print("\nsummary written to", out)


if __name__ == "__main__":
    main()
