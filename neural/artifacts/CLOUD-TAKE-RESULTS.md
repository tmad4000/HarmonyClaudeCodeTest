# GCP offline trial and live decision — 2026-11-15

Host: jacob-dev-1, CPUExecutionProvider, two ONNX threads, existing pinned model
and dependencies. Shared-host load average was 24–28; these are deployed-host
measurements under that load, not isolated hardware maximum performance.

Five new service tests pass. A full test discovery ran 39 entries: 38 passed,
one module import failed because the pre-existing local-device runtime imports
sounddevice/PortAudio and the host lacks the PortAudio native library. No claim
that the full original device suite passes on this host.

Sandboxed Linux Chrome using vocadito_1 as a synthetic microphone recorded 10 s,
resampled/encoded PCM, uploaded and received a playable/downloadable neural mix
in 19.999 s render time. No page errors or 390px viewport overflow. This used
loopback's browser secure-context exception. It does **not** establish remote
HTTPS, real microphone quality, Mac/iOS permission/recording, or physical audio.

Ten-second two-voice loads (two-second singing crops repeated solely for timing):
49.025 s, 81.147 s, 19.175 s for vocadito 1,10,20. Output is exactly 441000 mono
PCM16 samples at 44100 Hz; generated WAVs are private local evidence files.

## Live decision: do not prototype WebSocket streaming yet

| Profile | Buffering | p95 compute per window | Real-time factor | p95 source-to-worker-ready |
|---|---:|---:|---:|---:|
| Original | 116.1 ms | 184.7–497.1 ms | 1.49–4.15 | 1108–6263 ms |
| Responsive | 69.7 ms | 98.1–458.8 ms | 1.78–5.18 | 1567–8180 ms |

Real-time factor must be below 1 just to avoid accumulating backlog; ideally
below .7 to leave jitter/load headroom. A provisional live target is <=150 ms
source-to-playout p95 (not a validated perceptual acceptance threshold).
Responsive minimum nominal budget on the best compute run is already
69.7 + 98.1 = 167.8 ms, before network transport, browser capture, jitter buffer,
playout and device latency. Two voices add further work. The virtual schedule
measured rapidly growing backlog, even in the best fixture. Network/device
latency is unmeasured because the host route is not available; zero network
delay is already insufficient. No WebSocket prototype or live-ready claim.

Next live work: a licensed causal/stateful singing renderer or substantially
faster isolated CPU inference; rerun sustained multi-voice RTF and only then
measure browser/host RTT, WebSocket queueing, jitter and physical loopback p95.
Do not infer cloud live feasibility from earlier M4/M5 engine-only numbers.

## Delivery status

User service is installed/enabled, loopback health passes. Direct tailnet socket
bind succeeds but connection probes are refused. Tailscale Serve and certificate
operations are denied to dev. No sudo, firewall, operator-policy, public exposure
or GCP admin change was made. HTTPS and canonical page publication remain pending
coordination with root and main app owner Sol 96cbf9fa. Page patch is outside the
main app at /home/dev/code/neural-harmony-20261115/site-patch/neural-experiment.html.


Peer-route correction (2026-11-15): root identified a host self-tailnet connection
quirk. Independently verified with read-only curl from existing M4 bridge: GET /
and /health both200, health ready:true. Private HTTP WAV test page is reachable:
http://jacob-dev-1.tailb2a35c.ts.net:9918/. Do not diagnose firewall from self-curl.
The inference unit remains enabled per root, separate from browser route A.
