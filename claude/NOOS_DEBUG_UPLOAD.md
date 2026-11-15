# Noos beta debug uploader — activation pending

This source prepares the existing Harmony debug recorder for the write-only
Noos drop-box at `https://globalbr.ai/api/ingest/harmony/v1`.
`debug-endpoint.js` deliberately retains an empty endpoint and
`HARMONY_DEBUG_UPLOAD_ENABLED = false`. This branch is not a claim that the
backend or public uploads are live. The existing local Export remains available.

The uploader reuses the existing encoder. It persists immutable event/audio tasks
in its own IndexedDB outbox, validates upload acknowledgements, and retries the
same chunk IDs and bytes after uncertain responses. Device credentials authorize
only writes and deletion; the client never requests session lists or audio.
Recording off aborts transfers and removes queued payloads across tabs. Explicit
deletion requests remain durable until the server confirms cleanup, including
after reload, local upload-history expiry, or a partial `202` response.

Client bounds are 100 MiB and 200 sessions, with 30-day offline expiry. Server
bounds are 2 MiB per chunk, 30 MiB and 256 chunks per session. The chunk count can
be reached before the local ten-minute audio cap: the indicator must report that
limit and retain the local Export. Server expiry includes Keep; local Keep does
not extend server retention.

Focused tests on this cloud host, with Chromium's sandbox enabled and all Noos
traffic intercepted (no production enrollment or audio writes):

```
node claude/test/noos-transfer-browser.cjs
node claude/test/noos-transfer-edges-browser.cjs
node claude/test/noos-transfer-contract-browser.cjs
node claude/test/noos-transfer-notice-browser.cjs
node claude/test/noos-transfer-recovery-browser.cjs
```

Independent security review approved transfer module SHA256
`8c06e3814b19bc3f4355545259b6fefe0bf364d07f509f7b16533083d193baae`.
The reviewed display-only follow-up is
`1a2a9055832f08bda2306b616cfc938a83c29975d5b2c0115a1de560c4f8c9e8`.
Separate instrumentation counted exactly one MediaRecorder. These are Linux
browser checks, not physical iPhone acceptance.

Before activation: obtain the accepted backend release; verify one synthetic
public save, private owner byte/hash readback, unauthorized read denial, exact
Harmony CORS and confirmed deletion; finish Fable's notice/indicator/privacy
review, including truthful provider recovery retention. Then set the endpoint
and enable flag in a distinct reviewed release. Preserve the stable rollback and
the isolated Neural page. No port 8392 proxy, Funnel or separate public ingest
hosting is part of this implementation.
