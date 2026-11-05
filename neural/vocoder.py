"""Actual pitch-controlled neural waveform generation, never a DSP fallback."""

from dataclasses import dataclass
from pathlib import Path
import time
import numpy as np
import onnxruntime as ort
from dsp import HOP, NFFT, features, target_f0

DEFAULT_MODEL = (
    Path(__file__).parent / "models/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx"
)


STREAM_PROFILES = {
    "original": dict(step=4096, context=2048, right=512, overlap=512),
    "responsive": dict(step=2048, context=1024, right=512, overlap=512),
}


@dataclass(frozen=True)
class FrameControls:
    """Rendering values only; no musical decisions or recurrent state.

    Arrays correspond to the provided absolute source-frame centers. gain_multiplier
    is unitless [0,1], NOT a requested RMS or additive oscillator amplitude.
    """

    target_f0_hz: np.ndarray
    gain_multiplier: np.ndarray


def validate_controls(controls, frames):
    if not isinstance(controls, FrameControls):
        raise ValueError("Conditioner must return FrameControls")
    f0 = np.asarray(controls.target_f0_hz, dtype=np.float32)
    gain = np.asarray(controls.gain_multiplier, dtype=np.float32)
    if f0.shape != (frames,) or gain.shape != (frames,):
        raise ValueError("Exactly one pitch/gain per requested frame is required")
    if not np.isfinite(f0).all() or not np.isfinite(gain).all():
        raise ValueError("Nonfinite conditioning")
    if np.any((f0 != 0) & ((f0 < 50) | (f0 > 2500))):
        raise ValueError("Target pitch must be unvoiced 0 or 50–2500 Hz")
    if np.any((gain < 0) | (gain > 1)):
        raise ValueError("gain_multiplier must be in [0,1]")
    return f0, gain


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

    def synthesize(
        self, x, semitones=4, key=None, *, conditioning=None, source_start_sample=0
    ):
        started = time.perf_counter()
        mel, f0 = features(x)
        observed_f0 = f0
        f0 = target_f0(observed_f0, semitones, key)
        gains = None
        if conditioning is not None:
            positions = (
                source_start_sample
                + np.arange(len(f0), dtype=np.int64) * HOP
                + HOP // 2
            )
            # A pure lookup into already-computed controller output. Do not step a
            # recurrent controller here: overlapping windows repeat old timestamps.
            f0, gains = validate_controls(
                conditioning(positions.copy(), observed_f0.copy(), f0.copy()), len(f0)
            )
        y = self.session.run(
            None, {"mel": mel[None], "f0": f0[None].astype(np.float32)}
        )[0].reshape(-1)
        if gains is not None:
            centers = np.arange(len(gains)) * HOP + HOP // 2
            y = y * np.interp(np.arange(len(y)), centers, gains)
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
        conditioning=None,
    ):
        values = (step, context, right, overlap)
        if any(not isinstance(v, int) or v % HOP != 0 for v in values):
            raise ValueError("Stream dimensions must be integer multiples of HOP")
        if (
            step <= 0
            or context <= 0
            or right < 0
            or not 0 < overlap <= step
            or sum(values) < NFFT
        ):
            raise ValueError("Invalid streaming dimensions")
        self.model = model or NeuralVocoder()
        self.conditioning = conditioning
        self.emitted_samples = 0
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

    def push(self, x):
        x = np.asarray(x, dtype=np.float32)
        if x.ndim != 1 or len(x) > self.buffering_samples or not np.isfinite(x).all():
            raise ValueError("Push requires a bounded finite mono block")
        self.pending = np.r_[self.pending, x]
        chunks = []
        while len(self.pending) >= self.step + self.right + self.overlap:
            size = self.step + self.right + self.overlap
            window = np.r_[self.history, self.pending[:size]]
            kwargs = {}
            if self.conditioning is not None:
                kwargs = dict(
                    conditioning=self.conditioning,
                    source_start_sample=self.emitted_samples - self.context,
                )
            y = self.model.synthesize(window, self.semitones, self.key, **kwargs)
            out = y[self.context : self.context + self.step + self.overlap].copy()
            ramp = np.linspace(0, 1, self.overlap, endpoint=False, dtype=np.float32)
            out[: self.overlap] = self.tail * (1 - ramp) + out[: self.overlap] * ramp
            self.tail = out[self.step :].copy()
            chunks.append(out[: self.step])
            self.history = np.r_[self.history, self.pending[: self.step]][
                -self.context :
            ]
            self.pending = self.pending[self.step :]
            self.emitted_samples += self.step
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)

    @property
    def buffering_samples(self):
        return self.step + self.right + self.overlap
