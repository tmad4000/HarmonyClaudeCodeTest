"""Explicit playback-reference cancellation and independently auditable protection.

A calibrated FIR is intentionally frozen during double-talk. An adaptive filter
cannot identify a new room path from perfectly correlated singer/unison output
without risking singer cancellation. This prototype reports that limitation.
"""

import numpy as np
from scipy import signal
from dsp import SR, rms


def estimate_path(reference, microphone, taps=8192):
    """Regularized frequency-domain system identification from independent probe.

    Must contain playback-only calibration, including a zero tail of >= taps.
    Fit on first half; caller validates on a separate held-out probe.
    """
    x, y = np.asarray(reference), np.asarray(microphone)
    if len(x) != len(y) or len(x) < 4 * taps or rms(x) < 1e-5:
        raise ValueError(
            "Calibration requires equal, sufficiently long non-silent signals"
        )
    n = 1 << (len(x) + taps - 1).bit_length()
    X, Y = np.fft.rfft(x, n), np.fft.rfft(y, n)
    power = abs(X) ** 2
    H = Y * np.conj(X) / (power + max(float(np.mean(power)) * 1e-5, 1e-12))
    h = np.fft.irfft(H, n)[:taps]
    # Suppress identification noise, not microphone content.
    h[np.abs(h) < max(np.max(abs(h)) * 1e-4, 1e-8)] = 0
    return h.astype(np.float32)


class ReferenceCanceller:
    def __init__(self, impulse):
        self.h = np.asarray(impulse, dtype=np.float32)
        if self.h.ndim != 1 or not len(self.h) or not np.isfinite(self.h).all():
            raise ValueError("Invalid calibrated impulse")
        self.history = np.zeros(len(self.h) - 1, dtype=np.float32)
        self.state = "calibrated_frozen"

    def process(self, microphone, playback_reference):
        mic, ref = np.asarray(microphone), np.asarray(playback_reference)
        if mic.shape != ref.shape or mic.ndim != 1:
            raise ValueError("Reference and microphone must share sample timeline")
        if not np.isfinite(mic).all() or not np.isfinite(ref).all():
            raise FloatingPointError("Nonfinite input/reference")
        joined = np.r_[self.history, ref]
        predicted = signal.fftconvolve(joined, self.h)[
            len(self.h) - 1 : len(self.h) - 1 + len(ref)
        ]
        if len(self.history):
            self.history = joined[-len(self.history) :]
        return (mic - predicted).astype(np.float32), predicted.astype(np.float32)


class Safety:
    """Hard output ceiling and latching mute; NOT an echo quality metric."""

    def __init__(self, ceiling=0.18, max_rms=0.11):
        self.ceiling, self.max_rms = ceiling, max_rms
        self.state = "ready"
        self.reason = None
        self.limited_samples = 0
        self.high_blocks = 0

    def trip(self, reason):
        self.state = "muted"
        self.reason = reason

    def process(self, x):
        x = np.asarray(x, dtype=np.float32)
        if self.state == "muted":
            return np.zeros_like(x)
        if not np.isfinite(x).all():
            self.trip("nonfinite_output")
            return np.zeros_like(x)
        self.high_blocks = (
            self.high_blocks + 1
            if rms(x) > self.max_rms
            else max(0, self.high_blocks - 1)
        )
        if self.high_blocks >= 8:
            self.trip("sustained_output_overload")
            return np.zeros_like(x)
        self.limited_samples += int(np.count_nonzero(abs(x) > self.ceiling))
        return np.clip(x, -self.ceiling, self.ceiling)


class ReferenceTimeline:
    """Actual post-limiter DAC PCM indexed by device host timestamps.

    Fractional interpolation corrects sample-clock drift between ADC and DAC.
    Missing/stale data are surfaced. No assumption that requested playback was
    actually submitted, or that device latencies equal the callback period.
    """

    def __init__(self, sample_rate=SR, seconds=3):
        self.sr = sample_rate
        self.capacity = int(sample_rate * seconds)
        self.times = np.zeros(0)
        self.samples = np.zeros(0, dtype=np.float32)
        self.last_end = None
        self.discontinuities = 0

    def write(self, pcm, dac_time):
        pcm = np.asarray(pcm, dtype=np.float32)
        if self.last_end is not None and abs(dac_time - self.last_end) > 2 / self.sr:
            self.discontinuities += 1
        t = dac_time + np.arange(len(pcm)) / self.sr
        if len(self.times) and t[0] <= self.times[-1]:
            self.discontinuities += 1
            keep = self.times < t[0]
            self.times = self.times[keep]
            self.samples = self.samples[keep]
        self.times = np.r_[self.times, t][-self.capacity :]
        self.samples = np.r_[self.samples, pcm][-self.capacity :]
        self.last_end = dac_time + len(pcm) / self.sr

    def read(self, adc_time, n):
        target = adc_time + np.arange(n) / self.sr
        if not len(self.times):
            return np.zeros(n, dtype=np.float32), False
        covered = bool(
            target[0] >= self.times[0] and target[-1] <= self.times[-1] + 1e-8
        )
        return np.interp(target, self.times, self.samples, left=0, right=0).astype(
            np.float32
        ), covered
