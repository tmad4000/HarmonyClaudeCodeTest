"""Local native duplex demo. No network audio; no audio device opens on import.

Explicit --speakers-calibrate emits a quiet calibration probe. Never run this
unattended on another user's machine. --headphones avoids calibration playback.
"""

import argparse
import datetime
import json
import queue
import threading
import time
from pathlib import Path
import numpy as np
import sounddevice as sd
from scipy import signal
from dsp import SR, HOP, rms, db
from echo import ReferenceTimeline, ReferenceCanceller, Safety, estimate_path
from vocoder import NeuralVocoder, StreamingVocoder

ROOT = Path(__file__).parent


class LiveSession:
    def __init__(
        self,
        device=None,
        shift=4,
        gain=0.35,
        seconds=60,
        speakers=False,
        status_file=None,
        key=None,
    ):
        self.key = key
        self.device = device
        self.shift = shift
        self.gain = gain
        self.seconds = seconds
        self.speakers = speakers
        self.status_file = status_file or ROOT / "artifacts/live-status.json"
        self.timeline = ReferenceTimeline()
        self.safety = Safety()
        self.inq = queue.Queue(maxsize=32)
        self.outq = queue.Queue(maxsize=32)
        self.stop = threading.Event()
        self.state = "warming_model"
        self.started_output = False
        self.underruns = 0
        self.timings = []
        self.status_flags = []
        self.callback_count = 0
        self.cal_ref = []
        self.cal_mic = []
        self.probe_pos = 0
        self.calibration_erle = None
        self.probe = None
        self.cancel = None
        self.worker_error = None

    def status(self):
        return {
            "state": self.state,
            "mute_reason": self.safety.reason,
            "underruns": self.underruns,
            "input_queue": self.inq.qsize(),
            "output_queue": self.outq.qsize(),
            "callback_count": self.callback_count,
            "reference_discontinuities": self.timeline.discontinuities,
            "calibration_holdout_erle_db": self.calibration_erle,
            "worker_error": self.worker_error,
            "inference_ms_p95": float(np.percentile(self.timings, 95) * 1000)
            if self.timings
            else None,
            "gain": self.gain,
            "output_peak_limit": self.safety.ceiling,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    def publish(self):
        self.status_file.parent.mkdir(exist_ok=True, parents=True)
        tmp = self.status_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.status(), indent=2))
        tmp.replace(self.status_file)

    def callback(self, indata, outdata, frames, clock, status):
        outdata.fill(0)
        self.callback_count += 1
        if status:
            self.status_flags.append(str(status))
            self.safety.trip("audio_device_dropout")
            self.state = "muted"
        if frames != HOP:
            self.safety.trip("unexpected_callback_size")
            return
        if self.state == "calibrating":
            chunk = self.probe[self.probe_pos : self.probe_pos + frames]
            outdata[: len(chunk), 0] = chunk
            self.probe_pos += frames
        elif self.state == "running":
            try:
                outdata[:, 0] = self.outq.get_nowait()
                self.started_output = True
                self.underruns = 0
            except queue.Empty:
                if self.started_output:
                    self.underruns += 1
                    if self.underruns >= 4:
                        self.safety.trip("inference_output_starvation")
                        self.state = "muted"
        outdata[:, 0] = self.safety.process(outdata[:, 0])
        # Tap exactly what was submitted to DAC, after all gain/limit/mute operations.
        self.timeline.write(outdata[:, 0].copy(), clock.outputBufferDacTime)
        reference, covered = self.timeline.read(clock.inputBufferAdcTime, frames)
        if self.state in ("calibrating", "validating"):
            self.cal_ref.append(reference)
            self.cal_mic.append(indata[:, 0].copy())
        elif self.state == "running":
            if not covered:
                self.safety.trip("reference_timeline_gap")
                self.state = "muted"
            else:
                try:
                    self.inq.put_nowait((indata[:, 0].copy(), reference))
                except queue.Full:
                    self.safety.trip("input_overload")
                    self.state = "muted"

    def work(self):
        try:
            while not self.stop.is_set():
                try:
                    mic, ref = self.inq.get(timeout=0.1)
                except queue.Empty:
                    continue
                if self.safety.state == "muted":
                    continue
                clean = self.cancel.process(mic, ref)[0] if self.cancel else mic
                start = time.perf_counter()
                result = self.synth.push(clean)
                if len(result):
                    self.timings.append(time.perf_counter() - start)
                    if self.timings[-1] > 0.5:
                        self.safety.trip("inference_deadline_exceeded")
                        self.state = "muted"
                        continue
                    for i in range(0, len(result), HOP):
                        try:
                            self.outq.put_nowait(result[i : i + HOP] * self.gain)
                        except queue.Full:
                            self.safety.trip("output_overload")
                            self.state = "muted"
                            break
        except Exception as e:
            self.worker_error = f"{type(e).__name__}: {e}"
            self.safety.trip("worker_exception")
            self.state = "muted"

    def run(self):
        self.publish()
        model = NeuralVocoder(threads=2)
        model.synthesize(np.zeros(7168, dtype=np.float32))
        self.synth = StreamingVocoder(model=model, semitones=self.shift, key=self.key)
        # Single full-duplex device uses common host timestamps; reject absent timestamps.
        stream = sd.Stream(
            samplerate=SR,
            blocksize=HOP,
            channels=1,
            dtype="float32",
            device=self.device,
            callback=self.callback,
            latency="low",
        )
        worker = threading.Thread(target=self.work, name="neural-inference")
        worker.start()
        try:
            if self.speakers:
                rng = np.random.default_rng(1729)
                # Two independent probes with silent tails; normal output ceiling applies.
                train = np.r_[rng.normal(0, 0.008, SR * 2), np.zeros(SR // 2)]
                test = np.r_[rng.normal(0, 0.008, SR), np.zeros(SR // 2)]
                self.probe = np.r_[
                    np.zeros(SR // 2), train, test, np.zeros(SR // 2)
                ].astype(np.float32)
                self.state = "calibrating"
            else:
                self.state = "running"
            with stream:
                if self.speakers:
                    print(
                        "CALIBRATING: stay silent; quiet probe, then held-out check.",
                        flush=True,
                    )
                    calibration_deadline = time.monotonic() + 15
                    while self.probe_pos < len(self.probe):
                        if time.monotonic() > calibration_deadline:
                            raise RuntimeError("Calibration callback timeout")
                        if self.safety.state == "muted":
                            raise RuntimeError(self.safety.reason)
                        time.sleep(0.05)
                    # Keep silent output while collecting DAC/ADC latency tail.
                    self.state = "validating"
                    time.sleep(0.5)
                    ref = np.concatenate(self.cal_ref)
                    mic = np.concatenate(self.cal_mic)
                    # Split according to captured reference first/second probe periods.
                    split = int(3.05 * SR)
                    h = estimate_path(ref[:split], mic[:split], 8192)
                    prediction = signal.fftconvolve(ref, h)[: len(ref)]
                    self.calibration_erle = db(
                        rms(mic[split:]) / rms(mic[split:] - prediction[split:])
                    )
                    if self.calibration_erle < 15:
                        raise RuntimeError(
                            f"Calibration rejected: held-out cancellation {self.calibration_erle:.1f} dB. Stay silent, lower speaker volume, and retry."
                        )
                    self.cancel = ReferenceCanceller(h)
                    # Initialize convolution history with actual most recent reference.
                    self.cancel.history = ref[-len(self.cancel.history) :].copy()
                    self.state = "running"
                start = time.monotonic()
                while (
                    time.monotonic() - start < self.seconds
                    and self.safety.state != "muted"
                ):
                    self.publish()
                    print(json.dumps(self.status()), flush=True)
                    time.sleep(0.5)
        finally:
            self.stop.set()
            worker.join(timeout=3)
            self.state = "muted" if self.safety.state == "muted" else "stopped"
            self.publish()
        return self.status()


def main():
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--devices", action="store_true")
    mode.add_argument("--headphones", action="store_true")
    mode.add_argument("--speakers-calibrate", action="store_true")
    p.add_argument(
        "--key",
        choices=["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
        help="Diatonic third in this major key; otherwise use fixed --shift",
    )
    p.add_argument("--device", type=int)
    p.add_argument("--shift", type=float, default=4)
    p.add_argument("--gain", type=float, default=0.35)
    p.add_argument("--seconds", type=float, default=60)
    a = p.parse_args()
    if a.devices:
        print(sd.query_devices())
        return
    if not (-12 <= a.shift <= 12 and 0 <= a.gain <= 0.7 and 0 < a.seconds <= 600):
        p.error("shift ±12, gain 0–0.7, duration 0–600 seconds")
    session = LiveSession(
        a.device,
        a.shift,
        a.gain,
        a.seconds,
        a.speakers_calibrate,
        key=(
            ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].index(
                a.key
            )
            if a.key
            else None
        ),
    )
    try:
        session.run()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        session.safety.trip("startup_or_calibration_failure")
        session.state = "muted"
        session.worker_error = str(e)
        session.publish()
        raise


if __name__ == "__main__":
    main()
