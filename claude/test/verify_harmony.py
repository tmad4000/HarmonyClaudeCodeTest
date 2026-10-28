#!/usr/bin/env python3
"""
Headless verification for Harmony Singer (claude/).

Feeds a synthetic sawtooth "voice" instead of a microphone, then reads the pitch of
every harmony voice at its own output tap and checks it against the diatonic target.
No microphone, speakers, or human needed.

Usage:
    python3 test/verify_harmony.py            # serves ../ on a free port itself
    PORT=8471 python3 test/verify_harmony.py  # reuse an already-running server rooted at repo root

Requires the pipx/pip `playwright` package with a Chromium build installed.
"""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent  # HarmonyClaudeCodeTest/
A4 = 440.0


def midi_to_freq(m):
    return A4 * 2 ** ((m - 69) / 12)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def cents(a, b):
    import math
    return 1200 * math.log2(a / b)


class Runner:
    def __init__(self):
        self.failures = []
        self.rows = []

    def check(self, label, got_hz, want_midi, tol_cents=35):
        want_hz = midi_to_freq(want_midi)
        if got_hz is None:
            ok = False
            diff = None
        else:
            diff = cents(got_hz, want_hz)
            ok = abs(diff) <= tol_cents
        self.rows.append((label, want_hz, got_hz, diff, ok))
        if not ok:
            self.failures.append(label)
        return ok


def run(page, runner, url, label, expect, freq=None, settle=2.5, key_change=None, retries=3):
    """Load url, wait for audio to settle, measure, compare expected {voice: midi}."""
    page.goto(url)
    page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
    if key_change:
        page.wait_for_timeout(800)
        page.evaluate(f"window.harmonySinger.setKey({json.dumps(key_change)})")
    if freq:
        page.evaluate(f"window.harmonySinger.setTestFrequency({freq})")
    page.wait_for_timeout(int(settle * 1000))
    best = None
    for _ in range(retries):
        m = page.evaluate("window.harmonySinger.measureVoices()")
        best = m
        if all(m["voices"].get(v, {}).get("hz") for v in expect):
            break
        page.wait_for_timeout(500)
    m = best
    inp = m.get("input") or {}
    print(f"\n== {label}  (engine={m['engine']}, key={m['key']}, input={inp.get('note')} {inp.get('hz') and round(inp['hz'],1)} Hz)")
    for voice, want in expect.items():
        v = m["voices"].get(voice, {})
        runner.check(f"{label}: {voice}", v.get("hz"), want)
        r = runner.rows[-1]
        status = "OK " if r[4] else "FAIL"
        got = f"{r[2]:.1f} Hz" if r[2] else "no pitch"
        d = f"{r[3]:+.0f}c" if r[3] is not None else "-"
        print(f"  {status} {voice:8s} want {r[1]:.1f} Hz ({v.get('targetNote')}) got {got} {d}  shift={v.get('shift')} rms={v.get('rms') and round(v['rms'],3)}")
    lat = page.evaluate("window.harmonySinger.engineLatency()")
    if lat is not None:
        print(f"  engine-reported latency: {lat*1000:.0f} ms")
    return m


def main():
    port = os.environ.get("PORT")
    server = None
    if not port:
        port = str(free_port())
        server = subprocess.Popen(
            [sys.executable, "-m", "http.server", port, "--bind", "127.0.0.1"],
            cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(0.8)
    base = f"http://127.0.0.1:{port}/claude/index.html"
    runner = Runner()
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                  "--autoplay-policy=no-user-gesture-required"],
        )
        ctx = browser.new_context(permissions=["microphone"])
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        # Pure theory unit checks (no audio)
        page.goto(base + "?input=tone")
        theory = page.evaluate("""() => {
            const T = window.HarmonyTheory;
            return {
              a3_up3_C:  T.harmonyShiftInKey(57, 0, T.SCALES.major, 2),   // A3 in C major -> C4 (+3)
              a3_dn3_C:  T.harmonyShiftInKey(57, 0, T.SCALES.major, -2),  // -> F3 (-4)
              a3_up3_D:  T.harmonyShiftInKey(57, 2, T.SCALES.major, 2),   // A3 in D major -> C#4 (+4)
              c4_up3_C:  T.harmonyShiftInKey(60, 0, T.SCALES.major, 2),   // C4 -> E4 (+4)
              e4_up3_C:  T.harmonyShiftInKey(64, 0, T.SCALES.major, 2),   // E4 -> G4 (+3)
              cs4_up3_C: T.harmonyShiftInKey(61, 0, T.SCALES.major, 2),   // C#4 (out of key) snaps to C4 -> E4 (+3)
              a3_up3_Am: T.harmonyShiftInKey(57, 9, T.SCALES.minor, 2),   // A3 in A minor -> C4 (+3)
              a3_up5_C:  T.harmonyShiftInKey(57, 0, T.SCALES.major, 4),   // -> E4 (+7)
              b3_up5_C:  T.harmonyShiftInKey(59, 0, T.SCALES.major, 4),   // B3 -> F4 (+6, diminished 5th in key)
              a3_oct_C:  T.harmonyShiftInKey(57, 0, T.SCALES.major, 7),   // +12
            };
        }""")
        want = dict(a3_up3_C=3, a3_dn3_C=-4, a3_up3_D=4, c4_up3_C=4, e4_up3_C=3, cs4_up3_C=3, a3_up3_Am=3, a3_up5_C=7, b3_up5_C=6, a3_oct_C=12)
        print("== theory unit checks")
        for k, w in want.items():
            ok = theory[k] == w
            print(f"  {'OK ' if ok else 'FAIL'} {k:10s} want {w:+d} got {theory[k]:+d}")
            if not ok:
                runner.failures.append("theory:" + k)

        # Krumhansl key detection on a C-major histogram
        kd = page.evaluate("""() => {
            const hist = [10,0,6,0,7,5,0,8,0,6,0,4];
            const r = window.HarmonyTheory.detectKeyFromHistogram(hist, ['major','minor']);
            return r.best;
        }""")
        ok = kd["root"] == 0 and kd["type"] == "major"
        print(f"  {'OK ' if ok else 'FAIL'} key-detect C-major histogram -> root={kd['root']} type={kd['type']} score={kd['score']:.2f}")
        if not ok:
            runner.failures.append("theory:keydetect")

        # Live audio checks. A3 = 220 Hz = midi 57.
        q = "?input=tone&freq=220&autostart=1&mode=thirds&scale=major"
        run(page, runner, base + q + "&key=C&engine=granular", "granular thirds, C major, A3",
            {"upper": 60, "lower": 53})
        run(page, runner, base + q + "&key=D&engine=granular", "granular thirds, D major, A3",
            {"upper": 61, "lower": 54})
        run(page, runner, base + "?input=tone&freq=220&autostart=1&mode=thirds&scale=chromatic&key=C&engine=granular",
            "granular thirds, chromatic, A3", {"upper": 61, "lower": 54})
        run(page, runner, base + q + "&key=C&engine=granular", "granular key switch C->D at runtime (A3)",
            {"upper": 61, "lower": 54}, key_change="D")
        run(page, runner, base + "?input=tone&freq=261.63&autostart=1&mode=choir&scale=major&key=C&engine=granular",
            "granular Classic Choir, C major, C4", {"soprano": 72, "alto": 64, "tenor": 57, "bass": 48})
        run(page, runner, base + q + "&key=C&engine=stretch", "stretch thirds, C major, A3",
            {"upper": 60, "lower": 53}, settle=3.5)
        run(page, runner, base + q + "&key=D&engine=stretch", "stretch thirds, D major, A3",
            {"upper": 61, "lower": 54}, settle=3.5)

        # Auto key detection: play a C-major scale, expect root C.
        page.goto(base + "?input=tone&freq=261.63&autostart=1&mode=thirds&scale=major&key=auto&engine=granular")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        for m in [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]:
            page.evaluate(f"window.harmonySinger.setTestFrequency({midi_to_freq(m)})")
            page.wait_for_timeout(450)
        page.wait_for_timeout(700)
        m = page.evaluate("window.harmonySinger.measureVoices()")
        dk = m.get("detectedKey")
        ok = bool(dk) and dk["root"] == 0 and dk["type"] == "major"
        print(f"\n== auto key after C-major scale: {dk}")
        print(f"  {'OK ' if ok else 'FAIL'} detected root 0 (C) major")
        if not ok:
            runner.failures.append("auto-key")
        # And the harmony on the final C4 should be E4 (+4) in detected C major
        page.wait_for_timeout(1200)
        m = page.evaluate("window.harmonySinger.measureVoices()")
        runner.check("auto key: upper third on C4 -> E4", m["voices"]["upper"]["hz"], 64)
        r = runner.rows[-1]
        print(f"  {'OK ' if r[4] else 'FAIL'} upper want {r[1]:.1f} got {r[2] and round(r[2],1)} ({r[3] and round(r[3])}c)")

        # ---- Speaker mode: feedback guard and harmony gate
        print("\n== speaker mode: rising 3 kHz howl on top of a sung A3")
        page.goto(base + "?input=tone&freq=220&autostart=1&speaker=1&howl=3000&key=C&scale=major&mode=thirds&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        page.wait_for_timeout(5000)
        g = page.evaluate("window.harmonySinger.measureGuard(3000)")
        notch_ok = any(abs(n["hz"] - 3000) / 3000 < 0.04 for n in g["notches"])
        atten = (g["preDb"] - g["postDb"]) if (g["preDb"] is not None and g["postDb"] is not None) else None
        atten_ok = atten is not None and atten >= 12
        print(f"  {'OK ' if notch_ok else 'FAIL'} notch within 4% of 3000 Hz: {g['notches']}")
        print(f"  {'OK ' if atten_ok else 'FAIL'} attenuation at 3 kHz pre->post notch bank: {atten and round(atten,1)} dB (pre {g['preDb'] and round(g['preDb'])}, post {g['postDb'] and round(g['postDb'])})")
        print(f"  {'OK ' if g['gateOpen'] else 'FAIL'} gate open while a harmonic voice is present (harmonicVoice={g['harmonicVoice']})")
        print(f"  peaks seen: {g['peaks']}")
        if not notch_ok: runner.failures.append("guard:notch")
        if not atten_ok: runner.failures.append("guard:attenuation")
        if not g["gateOpen"]: runner.failures.append("guard:gate-open")
        m = page.evaluate("window.harmonySinger.measureVoices()")
        runner.check("guard: upper third still C4 with notch engaged", m["voices"]["upper"]["hz"], 60)
        r = runner.rows[-1]
        print(f"  {'OK ' if r[4] else 'FAIL'} upper want {r[1]:.1f} got {r[2] and round(r[2],1)} ({r[3] is not None and round(r[3])}c)")

        print("\n== speaker mode: plain sung sawtooth must not trigger any notch")
        page.goto(base + "?input=tone&freq=220&autostart=1&speaker=1&key=C&scale=major&mode=thirds&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        page.wait_for_timeout(5000)
        g = page.evaluate("window.harmonySinger.measureGuard(220)")
        ok = len(g["notches"]) == 0 and g["guardEvents"] == 0
        print(f"  {'OK ' if ok else 'FAIL'} no notches on a harmonic voice: notches={g['notches']} events={g['guardEvents']} harmonicVoice={g['harmonicVoice']}")
        if not ok: runner.failures.append("guard:false-positive")
        m = page.evaluate("window.harmonySinger.measureVoices()")
        runner.check("speaker mode: upper third C4 (gated path)", m["voices"]["upper"]["hz"], 60)
        r = runner.rows[-1]
        print(f"  {'OK ' if r[4] else 'FAIL'} upper want {r[1]:.1f} got {r[2] and round(r[2],1)} ({r[3] is not None and round(r[3])}c)")

        print("\n== speaker mode: a lone pure tone (no harmonics) keeps the harmony gate closed")
        page.goto(base + "?input=tone&wave=sine&freq=220&autostart=1&speaker=1&key=C&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        page.wait_for_timeout(2500)
        g = page.evaluate("window.harmonySinger.measureGuard(220)")
        ok = not g["gateOpen"] and not g["harmonicVoice"]
        print(f"  {'OK ' if ok else 'FAIL'} gateOpen={g['gateOpen']} harmonicVoice={g['harmonicVoice']} peaks={g['peaks'][:3]}")
        if not ok: runner.failures.append("guard:gate-closed-on-pure-tone")

        print("\n== headphone mode: guard inactive, dry monitor on")
        page.goto(base + "?input=tone&freq=220&autostart=1&key=C&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        page.wait_for_timeout(1500)
        st = page.evaluate("({speaker: window.harmonySinger.speakerMode, gate: window.harmonySinger.gateOpen, dry: window.harmonySinger.dryGain.gain.value, notches: window.harmonySinger.notchNodes.length})")
        ok = (not st["speaker"]) and st["gate"] and st["dry"] > 0.5 and st["notches"] == 0
        print(f"  {'OK ' if ok else 'FAIL'} {st}")
        if not ok: runner.failures.append("headphone-mode-state")

        # ---- Instrumental backing
        print("\n== backing: chord theory")
        ch = page.evaluate("""() => { const T = window.HarmonyTheory; return {
            c4_C: T.chordForNote(60, 0, 'major', null),
            a4_C: T.chordForNote(69, 0, 'major', null),
            g4_C_afterV: T.chordForNote(67, 0, 'major', 4),
            a3_Am: T.chordForNote(57, 9, 'minor', null) }; }""")
        exp = {"c4_C": ("C (I)", [48, 52, 55]), "a4_C": ("F (IV)", [53, 57, 60]),
               "g4_C_afterV": ("G (V)", [55, 59, 62]), "a3_Am": ("Am (I)", [45, 48, 52])}
        for k, (name, notes) in exp.items():
            got = ch[k]
            ok = got["name"] == name and got["notes"] == notes
            print(f"  {'OK ' if ok else 'FAIL'} {k:12s} want {name} {notes} got {got['name']} {got['notes']}")
            if not ok: runner.failures.append("chord:" + k)

        print("\n== backing: pad plays in-key chords under C4 (voice shifters muted)")
        page.goto(base + "?input=tone&freq=261.63&autostart=1&backing=pad&backingStyle=chords&key=C&scale=major&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        page.wait_for_timeout(3500)
        b = page.evaluate("window.harmonySinger.measureBacking()")
        ok = b["chord"] == "C (I)" and b["notes"] == ["C3", "E3", "G3"] and (b["instRms"] or 0) > 0.005 and all(v == 0 for v in b["voiceGains"].values())
        print(f"  {'OK ' if ok else 'FAIL'} chord={b['chord']} notes={b['notes']} instRms={b['instRms'] and round(b['instRms'],3)} voiceGains={b['voiceGains']}")
        if not ok: runner.failures.append("backing:pad-chords")

        print("\n== backing: pad plays the single upper harmony voice (A3 -> C4) in tune")
        page.goto(base + "?input=tone&freq=220&autostart=1&backing=pad&backingStyle=voices&key=C&scale=major&mode=thirds&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=15000)
        page.evaluate("window.harmonySinger.setPosition('above')")
        page.evaluate("window.harmonySinger.updateInstrumentNotes(57, true)")
        page.wait_for_timeout(2500)
        b = page.evaluate("window.harmonySinger.measureBacking()")
        runner.check("backing: pad upper voice C4", b["instHz"], 60)
        r = runner.rows[-1]
        print(f"  {'OK ' if r[4] else 'FAIL'} notes={b['notes']} want 261.6 got {b['instHz'] and round(b['instHz'],1)} ({r[3] is not None and round(r[3])}c)")

        print("\n== backing: piano (sampled) chords + voice+piano keeps the shifted voice")
        page.goto(base + "?input=tone&freq=261.63&autostart=1&backing=voice%2Bpiano&backingStyle=chords&key=C&scale=major&engine=stretch")
        page.wait_for_function("window.harmonySinger && window.harmonySinger.isRunning", timeout=30000)
        try:
            page.wait_for_function("window.harmonySinger.measureBacking().notes.length > 0", timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        b = page.evaluate("window.harmonySinger.measureBacking()")
        ok = b["kind"] == "piano" and b["chord"] == "C (I)" and (b["instRms"] or 0) > 0.002 and any(v > 0 for v in b["voiceGains"].values()) and (b["instGain"] or 0) > 0
        print(f"  {'OK ' if ok else 'FAIL'} kind={b['kind']} chord={b['chord']} notes={b['notes']} instRms={b['instRms'] and round(b['instRms'],4)} instGain={b['instGain']} voiceGains={b['voiceGains']}")
        if not ok: runner.failures.append("backing:piano-voice+piano")

        print("\n== backing: instrument releases when the voice stops")
        page.evaluate("window.harmonySinger.testOsc.disconnect()")
        page.wait_for_timeout(900)
        b = page.evaluate("window.harmonySinger.measureBacking()")
        ok = (not b["voicePresent"]) and b["notes"] == []
        print(f"  {'OK ' if ok else 'FAIL'} voicePresent={b['voicePresent']} notes={b['notes']}")
        if not ok: runner.failures.append("backing:release")

        browser.close()

    if server:
        server.terminate()

    print("\n== summary")
    print(f"  checks: {len(runner.rows) + len(want) + 2 + 7 + 7}, failures: {len(runner.failures)}")
    for f in runner.failures:
        print("   -", f)
    if errors:
        print("  page errors/console errors:")
        for e in errors[:10]:
            print("   !", e[:200])
    sys.exit(1 if runner.failures else 0)


if __name__ == "__main__":
    main()
