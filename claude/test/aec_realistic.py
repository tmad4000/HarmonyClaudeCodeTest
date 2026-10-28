#!/usr/bin/env python3
"""
Realistic echo-cancellation check on the machine's REAL microphone and speakers.

Launches the installed Google Chrome (headed, its own temp profile), opens the app with the
real mic, plays a short 1 kHz tone through the speakers from inside the page, and measures how
much of that tone the (pre-guard) microphone path still contains:
  - Headphone mode  (echoCancellation off)  -> expect the tone clearly in the mic
  - Speaker mode    (echoCancellation on)   -> expect it attenuated by the browser AEC
The difference is the cancellation depth. Also reports whether Chrome actually honoured the
echoCancellation constraint (track.getSettings()).

A brief tone will come out of the speakers (moderate level, ~2 s, twice). Run in a quiet room.

Usage: PORT=8471 python3 claude/test/aec_realistic.py
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

PORT = os.environ.get("PORT", "8471")
BASE = f"http://127.0.0.1:{PORT}/claude/index.html"
TONE_HZ = 1000
TONE_GAIN = float(os.environ.get("TONE_GAIN", "0.15"))
TONE_SEC = float(os.environ.get("TONE_SEC", "2.0"))

PLAY_TONE_JS = """
([hz, gain, sec]) => new Promise(resolve => {
  const hs = window.harmonySinger;
  const ctx = hs.audioContext;
  const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = hz;
  const g = ctx.createGain(); g.gain.value = gain;
  osc.connect(g); g.connect(ctx.destination);
  osc.start();
  const samples = [];
  const iv = setInterval(() => samples.push(hs.measureGuard(hz).preDb), 100);
  setTimeout(() => { clearInterval(iv); osc.stop(); setTimeout(() => resolve(samples), 150); }, sec * 1000);
})
"""

def level_stats(samples):
    vals = [s for s in samples if s is not None and s > -200]
    if not vals:
        return None, None
    vals.sort()
    return vals[len(vals) // 2], vals[-1]


def run_mode(page, speaker):
    page.goto(BASE + f"?autostart=1&speaker={'1' if speaker else '0'}&key=C&engine=stretch&log=1")
    page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=20000)
    page.wait_for_timeout(1500)
    start_ev = page.evaluate("window.harmonySinger.getLog().find(e => e.type === 'start')")
    actual = (start_ev or {}).get("actual", {})
    # baseline (room) level at the tone frequency
    base = []
    for _ in range(10):
        base.append(page.evaluate(f"window.harmonySinger.measureGuard({TONE_HZ}).preDb"))
        page.wait_for_timeout(100)
    base_med, _ = level_stats(base)
    tone = page.evaluate(PLAY_TONE_JS, [TONE_HZ, TONE_GAIN, TONE_SEC])
    tone_med, tone_max = level_stats(tone)
    rms = page.evaluate("window.harmonySinger.measureGuard(0).inputRms")
    guard = page.evaluate(f"window.harmonySinger.measureGuard({TONE_HZ})")
    return {
        "speakerMode": speaker,
        "track": {k: actual.get(k) for k in ("echoCancellation", "noiseSuppression", "autoGainControl", "sampleRate", "channelCount")},
        "label": (start_ev or {}).get("label"),
        "room_dB_at_1k": base_med,
        "tone_in_mic_median_dB": tone_med,
        "tone_in_mic_max_dB": tone_max,
        "mic_rms_after": rms,
        "notches": guard["notches"],
        "gateOpen": guard["gateOpen"],
    }


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False,
                                    args=["--autoplay-policy=no-user-gesture-required", "--window-size=900,700"])
        ctx = browser.new_context(permissions=["microphone"], viewport={"width": 900, "height": 700})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        results = []
        for speaker in (False, True):
            try:
                results.append(run_mode(page, speaker))
            except Exception as e:  # noqa: BLE001
                results.append({"speakerMode": speaker, "error": str(e)[:300]})
            page.wait_for_timeout(800)
        browser.close()

    print(json.dumps(results, indent=1))
    hp, sp = results
    if "error" in hp or "error" in sp:
        print("\nCould not complete both modes.")
        sys.exit(2)
    pickup = (hp["tone_in_mic_median_dB"] or -200) - (hp["room_dB_at_1k"] or -200)
    depth = (hp["tone_in_mic_median_dB"] or -200) - (sp["tone_in_mic_median_dB"] or -200)
    print(f"\nHeadphone mode: tone raised the mic level at 1 kHz by {pickup:.1f} dB over the room (acoustic path {'present' if pickup > 6 else 'weak/absent'}).")
    print(f"Speaker mode:   echoCancellation honoured = {sp['track']['echoCancellation']}; tone in mic {sp['tone_in_mic_median_dB'] and round(sp['tone_in_mic_median_dB'],1)} dB vs {hp['tone_in_mic_median_dB'] and round(hp['tone_in_mic_median_dB'],1)} dB without AEC -> cancellation depth {depth:.1f} dB.")
    if errors:
        print("page errors:", errors[:5])


if __name__ == "__main__":
    main()
