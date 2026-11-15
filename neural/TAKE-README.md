# Neural Harmony offline take mode

Noncommercial personal research. Records 10 seconds, uploads mono 16-bit PCM at
44.1 kHz, estimates a major key (or uses an override), generates a diatonic third
and optionally fifth with CPU PC-NSF-HiFiGAN ONNX, and returns a dry + neural mixed
WAV to play/download. Waveform generation is neural; pitch/key estimation and
major-scale harmony decisions are DSP/rules. No live claims. Short-take key
estimation is ambiguous. Human musical acceptance and Mac/iOS behavior remain
unverified.

## Install and run

Task root: `/home/dev/code/neural-harmony-20261115`; source:
`/home/dev/code/neural-harmony-20261115/source`. Python 3.12 virtual environment
at `/home/dev/code/neural-harmony-20261115/venv`. All dependency versions are the
existing engine pins from 2025, unchanged.

```sh
python3 -m venv /home/dev/code/neural-harmony-20261115/venv
/home/dev/code/neural-harmony-20261115/venv/bin/pip install -r /home/dev/code/neural-harmony-20261115/source/neural/requirements.txt
# setup.py downloads a hash-verified model and the licensed singing fixtures:
/home/dev/code/neural-harmony-20261115/venv/bin/python /home/dev/code/neural-harmony-20261115/source/neural/setup.py
OPENBLAS_NUM_THREADS=1 PORT=9918 /home/dev/code/neural-harmony-20261115/venv/bin/python /home/dev/code/neural-harmony-20261115/source/neural/take_service.py
```

Installed user unit: `/home/dev/.config/systemd/user/neural-harmony-take.service`.
Owner: `f7e222be` on behalf of `d3caa262`; persistent trial service, not a temporary
preview. `systemctl --user` requires `XDG_RUNTIME_DIR=/run/user/1002` and
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1002/bus` in this host's tool shell.
The service binds loopback and explicit tailnet IPv4 100.116.136.69 on port 9918.
The HTTP WAV page is peer-verified at http://jacob-dev-1.tailb2a35c.ts.net:9918/:
M4 GET / and /health both return200. This host cannot self-connect to its own
tailnet address; a local refused probe is not a firewall diagnosis. Microphone
recording still requires HTTPS; route A provides browser-only recording/rendering
on the public site once the canonical publisher deploys it. Private HTTPS forwarding needs an authorized
host route; Tailscale Serve/cert are denied to dev as of initial setup. Do not
change operator policy or use Funnel. A remote HTTP address cannot enable browser
microphone recording. Never advertise an unverified HTTPS URL.

Stop/rollback service: `systemctl --user disable --now neural-harmony-take.service`.
Remove only its HTTPS route if one was added; preserve other Serve routes. Site
rollback is the current saved version recorded immediately before publication,
independent of service rollback. No main Harmony engine/UI assets are changed.

## API and limits

- `GET /health`: readiness and sample-rate contract; served only after ONNX loads.
- `POST /take?key=auto&voices=2`: raw WAV body, `Content-Type: audio/wav`.
  `key`: auto or C=0 through B=11; `voices`: 1 (third) or 2 (third+fifth).
- Returns `audio/wav`, original duration, mono PCM16 44100 Hz. Headers:
  `X-Harmony-Key` and `X-Render-Seconds`.
- Maximum 900000 bytes, 0.5–10 seconds, no compressed WAV, stereo or alternate rate.
- Four attempts/minute globally, including invalid audio; HTTP 429 and Retry-After.
  Global limits cannot be bypassed with spoofed forwarding headers. One render at
  a time, 503 while busy. Body-read timeout 20 seconds. Capped model windows.
- Invalid audio/key 422; size 413; foreign browser origins 403. No CORS allowance.
- Audio stays in memory; no request/audio logging, persistence or external API.
  The browser retains the result until navigation/replacement. WAV download is an
  explicit local browser action. The default dry mix is .65, each harmony .35,
  normalized to input RMS (gain boost capped 2x), peak limited to .94.

## Verify

```sh
OPENBLAS_NUM_THREADS=1 /home/dev/code/neural-harmony-20261115/venv/bin/python -m unittest discover -s /home/dev/code/neural-harmony-20261115/source/neural/tests -p test_take_service.py -v
OPENBLAS_NUM_THREADS=1 /home/dev/code/neural-harmony-20261115/venv/bin/python /home/dev/code/neural-harmony-20261115/source/neural/cloud_benchmark.py
```

Tests exercise real ONNX output shape, exact sample rate/duration, finite/nonzero
waveform including neural contribution, clipping bound, malformed/rate/channel/
length/silence rejection, size cap, Origin rejection, contention and rate limits.
Benchmark uses vocadito 1,10,20; ten-second loads repeat two-second singing crops,
which is a load test, not a natural ten-second musical acceptance test. Evidence
lives at `/home/dev/code/neural-harmony-20261115/evidence`. Linux synthetic browser
microphone QA does not establish Mac/iOS physical recording/playback correctness.

## Licence

OpenVPI Community PC-NSF-HiFiGAN 2025.02 weights are unchanged, licensed
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
[Official release](https://github.com/openvpi/vocoders/releases/tag/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02).
The verified archive SHA-256 is
`ba7d43142d41f6900c8264b5662ca7125a50feb8760bb8b9615c61a8f5e6902e`.
Its full NOTICE, acknowledgements and licence link remain alongside the model in
`neural/models/`; weights are not committed or distributed with the page. No paid
services or commercial integration. Model redistribution must retain the complete
upstream notice and licence. Fixtures: Bittner et al., vocadito, CC BY 4.0,
https://zenodo.org/records/5578807 (archive MD5 verified by existing setup).
