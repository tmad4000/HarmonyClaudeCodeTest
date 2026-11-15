# Vendored audio engines

## SignalsmithStretch.js

- Source: https://unpkg.com/signalsmith-stretch@1.3.2/SignalsmithStretch.js (npm `signalsmith-stretch` 1.3.2, published 2025-06-27, MIT, by Geraint Luff / Signalsmith Audio).
- Original sha256: `fe0e23b6bb5dbffb231a91e7dc39f9d2a7d10c7f793fb0237d819ca748f7f778`.
- Local patch (search for `LOCAL PATCH`): the node factory also accepts a Tone.js `Context`
  (which wraps the native context with standardized-audio-context) so the worklet can be
  connected directly to Tone nodes. Native `BaseAudioContext` behaviour is unchanged.


Tone.js14.8.49 is vendored unchanged from https://unpkg.com/tone@14.8.49/build/Tone.js to remove the page-load CDN dependency. This is the same version previously loaded at runtime, not a dependency upgrade. See Tone-LICENSE.md and Tone.js.LICENSE.txt for package/bundle licenses.
