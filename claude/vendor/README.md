# Vendored audio engines

## SignalsmithStretch.js

- Source: https://unpkg.com/signalsmith-stretch@1.3.2/SignalsmithStretch.js (npm `signalsmith-stretch` 1.3.2, published 2025-06-27, MIT, by Geraint Luff / Signalsmith Audio).
- Original sha256: `fe0e23b6bb5dbffb231a91e7dc39f9d2a7d10c7f793fb0237d819ca748f7f778`.
- Local patch (search for `LOCAL PATCH`): the node factory also accepts a Tone.js `Context`
  (which wraps the native context with standardized-audio-context) so the worklet can be
  connected directly to Tone nodes. Native `BaseAudioContext` behaviour is unchanged.

## Tone.js 14.8.49

The unchanged build formerly loaded from https://unpkg.com/tone@14.8.49/build/Tone.js is served as `Tone-14.8.49.js`. This is a local copy of the same pinned dependency, not an upgrade. SHA256: `1261cdd3331d826237e7b0b954b5ed7d2381c8df4331d2018acea8c7a64a9a7b`. Package and bundled dependency licences are retained in Tone-LICENSE.md and Tone.js.LICENSE.txt.
