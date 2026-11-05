"""Bounded, immutable consumer for harmony-frame-controls/v1; no musical policy.

Ingest packets on delivery, not from a synthesis callback. Source availability
must come from capture/AEC alignment, never from a packet's own assertion.
"""

import math
from numbers import Integral, Real
from threading import RLock

import numpy as np
from vocoder import FrameControls

SCHEMA = "harmony-frame-controls/v1"
MAX_SAFE_INTEGER = 2**53 - 1
ARRAY_KEYS = (
    "frame_center_samples",
    "observation_end_samples",
    "target_f0_hz",
    "gain_multiplier",
)
KEYS = set(ARRAY_KEYS) | {
    "schema",
    "clock_id",
    "sample_rate_hz",
    "frame_hop_samples",
    "available_through_sample",
}


class ControlBoundaryError(ValueError):
    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code


def fail(code, message):
    raise ControlBoundaryError(code, message)


def integer(value):
    return (
        isinstance(value, Integral)
        and not isinstance(value, (bool, np.bool_))
        and abs(value) <= MAX_SAFE_INTEGER
    )


def center_valid(value):
    return integer(value) and (value - 256) % 512 == 0


def watermark_valid(value):
    return integer(value) and value >= 0 and value % 512 == 0


def finite(value):
    return (
        isinstance(value, Real)
        and not isinstance(value, (bool, np.bool_))
        and math.isfinite(value)
    )


class FrameControlCache:
    """Pure callable lookup plus explicit packet delivery and consumer release ACK.

    Instances bind one capture epoch. Reset requires a new instance and explicit
    renderer queue recovery. No I/O, state stepping or fallback occurs in lookup.
    Each returned array is an independent read-only copy, safe for queued jobs.
    """

    def __init__(self, clock_id, max_frames=2048):
        if not isinstance(clock_id, str) or not 1 <= len(clock_id) <= 128:
            fail("FORMAT", "Provide a capture epoch ID")
        if not integer(max_frames) or not 1 <= max_frames <= 8192:
            fail("FORMAT", "Cache capacity must be 1..8192 frames")
        self.clock_id = clock_id
        self.max_frames = max_frames
        self._frames = {}
        self._available = 0
        self._released_before = 256
        self._lock = RLock()

    @property
    def available_through_sample(self):
        with self._lock:
            return self._available

    def ingest(self, packet, *, available_source_sample):
        """Atomically accept a bounded packet; reject revisions and silent eviction.

        available_source_sample is the receiver's exclusive complete-frame source
        watermark. Packet causality cannot prove how producer features were made.
        """
        if not isinstance(packet, dict) or set(packet) != KEYS:
            fail("FORMAT", "Expected exactly the v1 packet fields")
        if (
            packet["schema"] != SCHEMA
            or packet["sample_rate_hz"] != 44100
            or packet["frame_hop_samples"] != 512
        ):
            fail("FORMAT", "Unsupported schema, sample rate or hop")
        if packet["clock_id"] != self.clock_id:
            fail("CLOCK", "Packet belongs to a different capture epoch")
        arrays = [packet[k] for k in ARRAY_KEYS]
        if (
            any(not isinstance(a, list) for a in arrays)
            or not 1 <= len(arrays[0]) <= 8192
            or any(len(a) != len(arrays[0]) for a in arrays)
        ):
            fail("SHAPE", "Equal nonempty bounded arrays required")
        available = packet["available_through_sample"]
        if not watermark_valid(available) or not watermark_valid(
            available_source_sample
        ):
            fail("CLOCK", "Invalid source availability watermark")
        if available > available_source_sample:
            fail("CAUSALITY", "Producer claims observations beyond received source")
        incoming = {}
        for center, end, f0, gain in zip(*arrays):
            if (
                not center_valid(center)
                or not watermark_valid(end)
                or end != max(0, center + 256)
                or end > available
            ):
                fail("CAUSALITY", "Frame is off-grid or unavailable")
            if (
                not finite(f0)
                or (f0 != 0 and not 50 <= f0 <= 2500)
                or not finite(gain)
                or not 0 <= gain <= 1
            ):
                fail("RANGE", "Pitch or gain outside v1 bounds")
            if center < 0:
                if f0 != 0 or gain != 0:
                    fail("PREROLL", "Negative startup context must be zero")
                continue
            value = (int(end), float(f0), float(gain))
            if center in incoming and incoming[center] != value:
                fail("REVISION", "Conflicting copies of one frame")
            incoming[int(center)] = value
        with self._lock:
            if available < self._available:
                fail("ORDER", "Availability watermark cannot regress")
            for center, value in incoming.items():
                if center < self._released_before:
                    fail("EXPIRED", "Cannot reintroduce released frames")
                if center in self._frames and self._frames[center] != value:
                    fail("REVISION", "Previously received controls are immutable")
            if len(self._frames.keys() | incoming.keys()) > self.max_frames:
                fail(
                    "BACKPRESSURE", "Explicit context release required before delivery"
                )
            self._frames.update(incoming)
            self._available = int(available)

    def lookup(self, frame_centers):
        if not isinstance(frame_centers, (list, tuple, np.ndarray)):
            fail("SHAPE", "Provide a bounded vector of source-frame centers")
        if isinstance(frame_centers, np.ndarray) and frame_centers.ndim != 1:
            fail("SHAPE", "Provide a one-dimensional vector")
        if not 1 <= len(frame_centers) <= 8192:
            fail("SHAPE", "Provide 1..8192 source-frame centers")
        values = []
        with self._lock:
            for center in frame_centers:
                if not center_valid(center):
                    fail("CLOCK", "Centers must lie on 256+k*512")
                if center < 0:
                    values.append((0.0, 0.0))
                elif center < self._released_before:
                    fail("EXPIRED", "Requested context was explicitly released")
                elif center not in self._frames:
                    fail("NOT_AVAILABLE", "Required controller frame has not arrived")
                else:
                    values.append(self._frames[center][1:])
        f0, gain = np.array(values, dtype=np.float64).T.copy()
        f0.setflags(write=False)
        gain.setflags(write=False)
        return FrameControls(f0, gain)

    def __call__(self, frame_centers, observed_f0_hz, default_target_f0_hz):
        # Source RMS/pitch/defaults are deliberately not used to revise controls.
        return self.lookup(frame_centers)

    def release_before(self, center):
        """Consumer ACK: no pending/future render may need an earlier center.

        Never call automatically from lookup. Coordinate producer releaseBefore
        separately; this method acknowledges only this receiver's cache.
        """
        with self._lock:
            if (
                not center_valid(center)
                or center < self._released_before
                or center > self._available + 256
            ):
                fail("ACK", "Invalid or regressing context release")
            self._frames = {c: v for c, v in self._frames.items() if c >= center}
            self._released_before = int(center)
