#!/usr/bin/env python3
"""
Realistic "someone humming a steady note" test on the REAL mic and speakers.

Generates a voice-like sustained tone (sawtooth with vibrato and a vowel-ish low-pass, sung in
bursts with short gaps), plays it through the speakers with `afplay` (outside the browser, so the
echo canceller cannot see it as its own output), while the app runs in speaker mode on the real
microphone. Polls the app's debug log and prints a timeline of: input RMS, detected pitch, voiced,
harmonicVoice, gate state, active notches. Then summarises how steady the harmony gate was.

Run twice: once with harmonies audible (the default) and once with harmony volume 0 (control), to
see whether the harmony output itself is what makes the microphone path drop out (AEC double-talk).

CAVEAT (found 2026-10-28): the tone is played through the laptop speakers, i.e. it IS system
output, and macOS/Chrome echo cancellation cancels it from the mic as if it were echo. So the
input level dips this rig shows in speaker mode are partly the canceller eating the test signal
itself, which a real singer would not suffer. Use aec_doubletalk_fake_mic.py for the question
"does our harmony output make the canceller suppress the singer"; use this rig for gate/pitch
robustness on a real acoustic path.

Usage: PORT=8471 python3 claude/test/sustained_tone_realistic.py [--control] [--ns]   (--ns keeps browser noise suppression on; default off)
"""
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import wave

from playwright.sync_api import sync_playwright

PORT = os.environ.get("PORT", "8471")
BASE = f"http://127.0.0.1:{PORT}/claude/index.html"
SR = 44100
F0 = float(os.environ.get("F0", "196"))   # G3-ish
LEVEL = float(os.environ.get("LEVEL", "0.35"))
PATTERN = [(3.0, True), (0.7, False), (4.0, True), (0.7, False), (3.0, True)]  # (seconds, singing?)


def make_wav(path):
    frames = []
    y1 = y2 = 0.0
    t = 0.0
    ph = 0.0
    for dur, on in PATTERN:
        n = int(dur * SR)
        for i in range(n):
            if on:
                vib = 1 + 0.012 * math.sin(2 * math.pi * 5.5 * t)   # ~ +/- 20 cents vibrato at 5.5 Hz
                ph = (ph + F0 * vib / SR) % 1.0                    # integrate phase (NOT t*f, which sweeps)
                x = 2 * ph - 1                                     # sawtooth
                env = min(1.0, i / (0.08 * SR), (n - i) / (0.12 * SR))
                x *= env
            else:
                x = 0.0
            # two-pole low-pass ~ 1.8 kHz for a vowel-ish timbre
            a = 0.22
            y1 += a * (x - y1)
            y2 += a * (y1 - y2)
            frames.append(y2 * LEVEL)
            t += 1 / SR
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in frames))
    return sum(d for d, _ in PATTERN)


def main():
    control = "--control" in sys.argv
    ns = "--ns" in sys.argv
    wav = os.path.join(tempfile.gettempdir(), "harmony-sustained-test.wav")
    total = make_wav(wav)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False,
                                    args=["--autoplay-policy=no-user-gesture-required", "--window-size=900,700"])
        ctx = browser.new_context(permissions=["microphone"], viewport={"width": 900, "height": 700})
        page = ctx.new_page()
        url = BASE + "?autostart=1&speaker=1&key=G&scale=major&mode=thirds&engine=stretch" + ("" if ns else "&ns=0")
        page.goto(url)
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=20000)
        if control:
            page.evaluate("window.harmonySinger.harmonyVolume = 0; window.harmonySinger.updateGains()")
        page.wait_for_timeout(800)
        start_ev = page.evaluate("window.harmonySinger.getLog().find(e => e.type === 'start')")
        print("mic settings:", json.dumps((start_ev or {}).get("actual")))
        print(f"playing {total:.1f}s of sustained tone bursts at {F0} Hz via afplay (control={control}, ns={ns})")
        t0 = time.time()
        proc = subprocess.Popen(["afplay", wav])
        rows = []
        while proc.poll() is None and time.time() - t0 < total + 2:
            g = page.evaluate("window.harmonySinger.measureGuard(0)")
            st = page.evaluate("({pitch: window.harmonySinger.smoothedPitch, stable: window.harmonySinger.stableMidi, present: window.harmonySinger.voicePresent})")
            rows.append((time.time() - t0, g["inputRms"], st["pitch"], g["harmonicVoice"], g["gateOpen"], len(g["notches"]), st["present"]))
            time.sleep(0.1)
        proc.wait()
        log = page.evaluate("window.harmonySinger.getLog()")
        browser.close()

    print("\n t(s)  rms     pitch   harm  gate  notch present")
    for r in rows[::3]:
        pitch = str(round(r[2])) if r[2] else "-"
        rms = f"{r[1]:.4f}" if r[1] is not None else "  -   "
        print(f"{r[0]:5.1f}  {rms}  {pitch:>5}   {str(r[3])[0]}     {str(r[4])[0]}     {r[5]}    {str(r[6])[0]}")

    # expected singing windows
    sing = []
    t = 0.0
    for dur, on in PATTERN:
        if on:
            sing.append((t + 0.25, t + dur - 0.15))
        t += dur
    def singing_at(ts):
        return any(a <= ts <= b for a, b in sing)
    in_sing = [r for r in rows if singing_at(r[0])]
    gate_open_frac = sum(1 for r in in_sing if r[4]) / max(1, len(in_sing))
    voiced_frac = sum(1 for r in in_sing if r[2]) / max(1, len(in_sing))
    toggles = sum(1 for a, b in zip(rows, rows[1:]) if a[4] != b[4])
    gate_events = [e for e in log if e["type"] == "gate"]
    notch_events = [e for e in log if e["type"] == "notch"]
    print(f"\nwhile the tone was sounding: gate open {gate_open_frac*100:.0f}% of samples, pitch detected {voiced_frac*100:.0f}%")
    print(f"gate toggles observed: {toggles} (log gate events: {len(gate_events)}), notches engaged: {len(notch_events)} {[e['hz'] for e in notch_events]}")
    rms_sing = [r[1] for r in in_sing if r[1] is not None]
    if rms_sing:
        print(f"input rms during tone: median {sorted(rms_sing)[len(rms_sing)//2]:.4f}, min {min(rms_sing):.4f}, max {max(rms_sing):.4f}")
    out = os.path.join(tempfile.gettempdir(), f"harmony-sustained-{'control' if control else 'harmony'}{'-ns' if ns else ''}.json")
    with open(out, "w") as f:
        json.dump({"rows": rows, "log": log}, f)
    print("full log:", out)


if __name__ == "__main__":
    main()
