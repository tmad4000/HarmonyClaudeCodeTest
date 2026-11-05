"""Shared streaming engine for live audio and recursive simulation."""

import json
import subprocess
import time
from pathlib import Path
import numpy as np
from echo import ReferenceCanceller, Safety
from vocoder import StreamingVocoder, STREAM_PROFILES


class Signalsmith:
    def __init__(self, shift=4):
        self.p = subprocess.Popen(
            ["node", str(Path(__file__).with_name("baseline.cjs"))],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.latency = json.loads(self.p.stdout.readline())["latency"]
        self.shift = shift

    def push(self, x):
        self.p.stdin.write(
            json.dumps({"input": np.asarray(x).tolist(), "shift": self.shift}) + "\n"
        )
        self.p.stdin.flush()
        return np.array(json.loads(self.p.stdout.readline()), dtype=np.float32)

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=5)


class Engine:
    def __init__(
        self,
        kind="neural",
        impulse=None,
        shift=4,
        gain=0.5,
        model=None,
        safety=True,
        profile="original",
        conditioning=None,
    ):
        self.synth = (
            StreamingVocoder(
                model=model,
                semitones=shift,
                conditioning=conditioning,
                **STREAM_PROFILES[profile],
            )
            if kind == "neural"
            else Signalsmith(shift)
        )
        self.cancel = ReferenceCanceller(impulse) if impulse is not None else None
        self.safety = Safety() if safety else None
        self.gain = gain
        self.kind = kind
        self.queue = np.zeros(0, dtype=np.float32)
        self.timings = []
        self.max_queue = 0

    def process(self, mic, reference):
        start = time.perf_counter()
        clean, predicted = (
            self.cancel.process(mic, reference)
            if self.cancel
            else (mic.copy(), np.zeros_like(mic))
        )
        generated = self.synth.push(clean)
        self.queue = np.r_[self.queue, generated * self.gain]
        self.max_queue = max(self.max_queue, len(self.queue))
        n = len(mic)
        if len(self.queue) >= n:
            output = self.queue[:n].copy()
            self.queue = self.queue[n:]
        else:
            output = np.zeros(n, dtype=np.float32)
        if self.safety:
            output = self.safety.process(output)
        # The caller must reference THIS output, after mixing/gain/limiting/mute.
        self.timings.append(time.perf_counter() - start)
        return output, clean, predicted

    def close(self):
        if hasattr(self.synth, "close"):
            self.synth.close()
