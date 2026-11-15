# Route B contract — DRAFT, awaiting 96cbf9fa agreement

Root has rejected browser inference/model distribution. Do not publish browser
assets, model shards or the old iframe patch. No public changes by this session.
Private WAV service stays running on port9918. M4 peer verifies / and /health200;
self-curl refusal is a host quirk. Private HTTPS Serve remains Jacob's decision.

## Minimal proposed integration

Public HTTPS Harmony page records10 seconds using existing capture worklet and
resamples to mono PCM16 WAV44100Hz. On explicit render action it uploads once to
an HTTPS endpoint owned by96cbf9fa. That owner authenticates and validates the
request, calls the existing private renderer on the same host, and returns WAV.
Neither model weights nor inference runtime are downloaded by the public page.
This is a noncommercial research experiment; server-side use does not remove the
model's CC BY-NC-SA4.0 restriction. Keep attribution/noncommercial scope visible.

Proposed path under the owner's EXISTING origin: POST /v1/neural/take.
This path is NOT assigned, exposed or implemented in the owner's endpoint yet.
- Reuse current exact Harmony Origin and device bearer authentication. Tokens
  belong only in Authorization headers; do not forward them to the renderer.
- Query: key=auto or integer0..11(C=0); voices=1(third) or2(third+fifth).
- Body: Content-Type audio/wav; known Content-Length; mono PCM16LE44100Hz,
  0.5–10s; <=900000 bytes. No MediaRecorder webm/mp4 without local PCM conversion.
- Existing public-edge request/rate caps remain. Renderer itself permits one
  concurrent render and four attempts/min globally, returning503/429 when busy.
- Success200 audio/wav; mono PCM16LE44100Hz, exact input frame count, peak<=.94.
  Content-Disposition: attachment; filename=neural-harmony.wav.
  Expose X-Harmony-Key and X-Render-Seconds to the allowed browser origin.
- Errors:422 validation,413 size,429 rate with Retry-After,503 busy; auth and Origin
  errors remain the owner's401/403. No retry storm or automatic replay of takes.

## Same-host bridge

Current owner's ingest docs identify loopback8392, this renderer loopback9918.
If that remains the hosting arrangement, the public process invokes
http://127.0.0.1:9918/take?key=...&voices=... directly. It forwards WAV only and
known renderer headers, not Authorization, browser Origin, cookies or arbitrary
upstream URL/query headers. No browser access to private-network addresses.
No new public listener, public inference origin or Funnel from this service.

Rendering measured19–81 seconds under shared load. The synchronous contract is
minimal ONLY IF the owner's public proxy supports >=130s request duration; the
bridge read timeout is125s and browser deadline should be150s. If its platform
cannot support that, agree a bounded202 job/poll/result contract before writing
integration. Do not assume a long request survives edge platform timeouts.

## Information needed from owner

1. Confirm existing verified HTTPS origin and whether its hosting process is on
   this host. Current ingest/HOSTING-HANDOFF.md says public origin unassigned;
   that is a readiness question, not permission to provision a new origin here.
2. Confirm synchronous bridge timeout support, or choose202 job lifecycle.
3. Confirm endpoint path, auth reuse and response header exposure. Owner adds
   routing/CORS; this session supplies renderer adapter, fixtures and tests.
4. Owner reviews experiment's noncommercial/audience scope before public launch.

## Review and release boundary

No main audio behavior or debug ingest storage semantics change here. Neural
raw/mixed audio should remain memory-only for the render unless owner explicitly
chooses retention. No enrollment credentials or private-data are inspected or
bundled. Public endpoint readiness, actual Harmony-origin upload/result and
unauthorized/rate/busy checks precede canonical publication by96cbf9fa. Capture
its current rollback immediately before publish. MAC/iOS acceptance is separate.
