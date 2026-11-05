"""Small explicit DSP front end. No learned pitch or harmony claims."""

import numpy as np
from scipy import signal

SR = 44100
HOP = 512
NFFT = 2048


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x, dtype=np.float64) ** 2) + 1e-20))


def db(x):
    return float(20 * np.log10(max(float(x), 1e-10)))


def mel_basis():
    # Slaney auditory scale, area normalization; matches released vocoder.yaml.
    def hzmel(f):
        f = np.asarray(f, dtype=float)
        return np.where(
            f < 1000,
            f / (200 / 3),
            15 + np.log(np.maximum(f, 1) / 1000) / (np.log(6.4) / 27),
        )

    def melhz(m):
        return np.where(
            m < 15, m * (200 / 3), 1000 * np.exp((m - 15) * (np.log(6.4) / 27))
        )

    edges = melhz(np.linspace(hzmel(40), hzmel(16000), 130))
    frequencies = np.fft.rfftfreq(NFFT, 1 / SR)
    lower = (frequencies[None, :] - edges[:-2, None]) / np.diff(edges)[:-1, None]
    upper = (edges[2:, None] - frequencies[None, :]) / np.diff(edges)[1:, None]
    return (
        np.maximum(0, np.minimum(lower, upper))
        * (2 / (edges[2:] - edges[:-2]))[:, None]
    ).astype(np.float32)


MEL = mel_basis()
WINDOW = signal.windows.hann(NFFT, sym=False).astype(np.float32)


def features(audio):
    x = np.asarray(audio, dtype=np.float32)
    if len(x) < NFFT:
        x = np.pad(x, (0, NFFT - len(x)))
    p = (NFFT - HOP) // 2
    frames = np.lib.stride_tricks.sliding_window_view(
        np.pad(x, (p, p), mode="reflect"), NFFT
    )[::HOP]
    spec = np.abs(np.fft.rfft(frames * WINDOW, axis=-1))
    mel = np.log(
        np.maximum(np.einsum("tf,mf->tm", spec, MEL, optimize=False), 1e-5)
    ).astype(np.float32)
    # 4096-sample YIN window, centered on the same mel frame centers.
    extended = np.pad(x, (2048, 2048), mode="reflect")
    f0 = np.array(
        [
            pitch(extended[i * HOP + HOP // 2 : i * HOP + HOP // 2 + 4096])
            for i in range(len(mel))
        ],
        dtype=np.float32,
    )
    return mel, f0


def pitch(x, low=65, high=1100):
    x = np.asarray(x, dtype=float)
    if rms(x) < 1e-4:
        return 0.0
    # YIN difference function via FFT cross-correlation and cumulative energy.
    x = x - np.mean(x)
    n = len(x) // 2
    a = x[:n]
    corr = signal.correlate(x, a, mode="valid", method="fft")
    squares = np.r_[0.0, np.cumsum(x * x)]
    diff = np.maximum(
        np.sum(a * a) + squares[n : n + len(corr)] - squares[: len(corr)] - 2 * corr, 0
    )
    cmnd = np.ones(len(diff))
    cmnd[1:] = diff[1:] * np.arange(1, len(diff)) / (np.cumsum(diff[1:]) + 1e-12)
    lo, hi = max(2, int(SR / high)), min(int(SR / low), len(cmnd) - 2)
    minima, _ = signal.find_peaks(-cmnd[lo : hi + 1])
    if not len(minima):
        return 0.0
    candidates = minima + lo
    best = float(np.min(cmnd[candidates]))
    valid = candidates[cmnd[candidates] < max(0.16, best * 1.5)]
    if not len(valid) or best > 0.35:
        return 0.0
    tau = int(valid[0])
    y0, y1, y2 = cmnd[tau - 1 : tau + 2]
    offset = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-12)
    return float(SR / (tau + np.clip(offset, -0.5, 0.5)))


def target_f0(f0, semitones=4, key=None):
    """Fixed semitones, or a diatonic third in the specified major key (C=0)."""
    f0 = np.asarray(f0)
    if key is None:
        return f0 * 2 ** (semitones / 12)
    notes = 69 + 12 * np.log2(np.maximum(f0, 1) / 440)
    scale = np.array(
        [key + 12 * o + s for o in range(-1, 12) for s in (0, 2, 4, 5, 7, 9, 11)]
    )
    nearest = np.argmin(abs(notes[:, None] - scale[None, :]), axis=1)
    delta = scale[np.minimum(nearest + 2, len(scale) - 1)] - scale[nearest]
    return np.where(f0 > 0, f0 * 2 ** (delta / 12), 0)
