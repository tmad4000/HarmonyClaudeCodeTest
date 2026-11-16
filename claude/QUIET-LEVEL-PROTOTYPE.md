# Quiet level prototype — NOT APPROVED FOR RELEASE

Preservation checkpoint from `099576b`, using generated synthetic input only.
Physical iPhone behavior is unverified. This branch must not be deployed merely
because its basic unit tests pass.

The prototype adds at most 4× voice gain after the detectors, with independent
near-end proof and an audio-clock expiry. It leaves other harmony modes at unity
gain. Generated quiet input around −73 dBFS becomes roughly −59 dBFS at output;
this is a limited improvement, not full normalization.

The strong-room test exposed a feedback/pitch-chasing transient after the new
quiet bootstrap, even when extra gain had already returned to unity. Strict
late-tail checks alone do not establish safety. Stronger containment and
adversarial crescendo/pitch-step controls remain required before approval.

Focused tests: `test/voice-level-normalizer.cjs`,
`test/voice-level-normalizer-browser.cjs`,
`test/voice-level-normalizer-review-browser.cjs`,
`test/quiet-bootstrap-positive-controls-browser.cjs`, and
`test/near-end-room-browser.cjs`. These tests use generated signals, sandboxed
Chromium and intercepted networking; they do not use private recordings.
