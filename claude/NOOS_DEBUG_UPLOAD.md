# Noos beta debug uploader

This release configures the write-only Noos drop-box at
`https://globalbr.ai/api/ingest/harmony/v1` and enables beta transfer by default,
respecting a prior Recording off choice. Root explicitly chose the disclosed
option(a), then accepted backend .46/source09181c6 pilot receipt SHA256
`66f92f8d576ad591912081784d37b5e38956437b79fed0c0e2a89f9952c51e54`.
The notice names Ideaflow, and Privacy identifies Jacob/team including AI assistants.
Removal ends access; inaccessible backup copies may persist with no verified
maximum. No immediate or complete physical-purge promise is made.

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

Backend activation gates have been accepted by root. The release verification checklist remains: verify one synthetic
public save, private owner byte/hash readback, unauthorized read denial, exact
Harmony CORS and confirmed deletion; finish Fable's notice/indicator/privacy
review, including truthful provider recovery retention. Then set the endpoint
and enable flag in a distinct reviewed release. Preserve the stable rollback and
the isolated Neural page. No port 8392 proxy, Funnel or separate public ingest
hosting is part of this implementation.

## Confirmed removals and policy provenance

The additive deletion receipt may include `sessionCount` and `deletedCount`.
A pending202 is not a completed removal; keep its task and original epoch.
Only confirmed cleanup can produce “Removed N recordings. They can no longer
be opened.” The count describes scoped session tombstones, including retries;
it is not proof that historical storage generations were physically purged.
The current storage assessment has no verified recovery-copy maximum. Public
activation therefore also needs root/Jacob’s explicit disclosed-beta decision.
No bucket policy, credentials or provider configuration are changed here.

Metadata includes appVersion, the existing version/build, a random browser install
ID, purpose=debug and a recording-policy version. These fields are provenance,
not authorization or verified personal identity. The backend binds recipient,
app and the anonymous device. No IP or account identity is added by this client.

Independent follow-up review approved module SHA256 `966798c1b17cb5f1a05d1524b5b85daca6dcc6ee0bba3beb117a694ebd8d6b26`: updated sandboxed contract/count tests passed, including pending202, confirmed scoped counts, old-epoch replay and access-based summaries. This does not approve public activation.

The indicator follow-up SHA256 `17f265fff199d003b66452a2283eb806eabc42968b24a3e26b2895580784c760` is independently approved. Server413/429/507 classification uses a short limit label without inventing a daily reset; the429 contract test verifies Retry-After and recovery. Request/backoff and activation gates are unchanged.

Final launch copy/layout delta94c5fdd6 is independently approved. Standard, notice and contract/recovery mock tests passed;390px one-line and320px short-screen notice checks made zeroNoosrequests. A real public one-session verification and scoped removal follow publication; do not claim their result before its receipt.

Launch delta4481d630 is independently approved: Ideaflow identity disclosure, grouped notice controls, short-screen layout and polite stateful button labels. The enabled endpoint is exactly the accepted Noos URL. Root accepted the backend pilot receipt and authorized publication; the distinct release still requires its public one-session verification receipt.
