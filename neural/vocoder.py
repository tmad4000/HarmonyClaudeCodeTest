"""Actual pitch-controlled neural waveform generation, never a DSP fallback."""

from pathlib import Path
import time
import numpy as np
import onnxruntime as ort
from dsp import features, target_f0

DEFAULT_MODEL = (
    Path(__file__).parent / "models/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx"
)


class NeuralVocoder:
    def __init__(self, model=DEFAULT_MODEL, threads=2):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(
            str(model), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        self.timings = []

    def synthesize(self, x, semitones=4, key=None):
        started = time.perf_counter()
        mel, f0 = features(x)
        f0 = target_f0(f0, semitones, key)
        y = self.session.run(
            None, {"mel": mel[None], "f0": f0[None].astype(np.float32)}
        )[0].reshape(-1)
        self.timings.append(time.perf_counter() - started)
        if not np.isfinite(y).all():
            raise FloatingPointError("Nonfinite neural waveform")
        return y.astype(np.float32)


class StreamingVocoder:
    """Bounded overlapping windows; model is NOT natively causal/stateful.

    Emits one step after right context has arrived. Crossfades independent neural
    excitation phases; listen for timbre/phase artifacts. No whole-song buffering.
    """

    def __init__(
        self,
        model=None,
        step=4096,
        context=2048,
        right=512,
        overlap=512,
        semitones=4,
        key=None,
    ):
        self.model = model or NeuralVocoder()
        self.step, self.context, self.right, self.overlap = (
            step,
            context,
            right,
            overlap,
        )
        self.semitones, self.key = semitones, key
        self.history = np.zeros(context, dtype=np.float32)
        self.pending = np.zeros(0, dtype=np.float32)
        self.tail = np.zeros(overlap, dtype=np.float32)
        self.first = True

    def push(self, x):
        self.pending = np.r_[self.pending, np.asarray(x, dtype=np.float32)]
        chunks = []
        while len(self.pending) >= self.step + self.right + self.overlap:
            size = self.step + self.right + self.overlap
            window = np.r_[self.history, self.pending[:size]]
            y = self.model.synthesize(window, self.semitones, self.key)
            out = y[self.context : self.context + self.step + self.overlap].copy()
            ramp = np.linspace(0, 1, self.overlap, endpoint=False, dtype=np.float32)
            out[: self.overlap] = self.tail * (1 - ramp) + out[: self.overlap] * ramp
            self.tail = out[self.step :].copy()
            chunks.append(out[: self.step])
            self.history = np.r_[self.history, self.pending[: self.step]][
                -self.context :
            ]
            self.pending = self.pending[self.step :]
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)

    @property
    def buffering_samples(self):
        return self.step + self.right + self.overlap
