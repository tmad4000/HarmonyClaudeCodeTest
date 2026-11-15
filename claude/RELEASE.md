# 2026-11-15-noos-debug-1

Updated 2026-11-15T14:57:09Z.

Beta debug sessions are sent automatically to Ideaflow (Jacob Cole and those working on Harmony with him, including AI assistants) after Sing and the recording notice. Recording turns capture and transfer off in one click; a prior Off stays off. Old local-only sessions are never uploaded.

Per-session Delete and Delete my recordings remove access, with pending state until confirmed cleanup. Inaccessible backup copies may remain longer; no immediate or complete physical deletion is promised. Normal server access expires after30days. Local Export remains available. Personal Saves are separate.

Uses the existing single debug encoder, a durable bounded outbox, immutable write-only chunk retries, device-scoped removal and the accepted Noos .46 backend. The first-run notice fits390px; grouped controls and the notice remain accessible on320px short screens. Canvas-ready recovery, local Tone and the isolated Neural page are preserved.

Validation: independent client security reviews, sandboxed mocked notice/Off/retry/ACK/count/epoch/quota/recovery suites; accepted backend pilot SHA25666f92f8d576ad591912081784d37b5e38956437b79fed0c0e2a89f9952c51e54 and explicit root option(a) GO. Live one-session acceptance follows publication. Physical iPhone and real-room audio quality remain unverified.

---

# 2026-11-15-canvas-ready-1

Updated 2026-11-15T14:12:24Z.

Fix cold-start pitch visualization when stylesheet colours arrive late: refresh colours on load and while the palette is empty; skip trace drawing until its colour exists. Late CSS no longer leaves the picture blank for the visit.

Validation: a fresh-profile, delayed nonblocking stylesheet fixture reproduces the old repeated CanvasGradient error and verifies nonempty harmony traces recover without page errors in light and dark themes. This controlled fixture forces late CSS application; ordinary parser-blocking stylesheet delivery can hide the race. Audio/DSP, local diagnostics and upload-disabled state are unchanged. Physical iPhone and real-room singing remain unverified.

---

# 2026-11-15-local-polish-1

Updated 2026-11-15T13:58:06Z.

- The corner reads “Recording on” while idle, “Recording” only while a debug recorder is running, and “Recording off” when disabled.
- Tone.js 14.8.49 is served locally with the same bytes and licences as the previously loaded pinned CDN build.
- Staff note labels sit above their lines with a clear background in dark and light themes.

Debug sessions remain local with Export visible; automatic upload is disabled pending the reviewed Noos service. Singing on physical phones and real speakers remains unverified.

---

# 2026-11-15-phone-gate-1

Updated 2026-11-15T12:19:00.451Z. Stable v2-1 base; no Saves, boost or later output crossfade.

- Quiet phone voices use an adaptive noise floor, separate open/close levels and 450 ms hold. Stable, fundamental-dominant notes can continue when near-end evidence is strong; confirmed feedback remains excluded. Decisions and thresholds are logged. iOS gets bounded digital microphone makeup (up to 4x), while raw diagnostics stay before that gain. Browser AGC/NS behavior is unchanged.
- Fresh users start with Third above only; saved settings win. Speaker check is off unless requested, and remains available in Settings with its sound warning.
- Mobile-only dismissible experimental notice. Recording has a persistent off choice; raw microphone counters, track/context/route/visibility events are stored locally every 250 ms. Export debug session is visible below Sing. Upload remains disabled; privacy text says so.
- Network-only update worker uses skipWaiting/clients.claim, plus idle-only fresh-version checks. It defers reload while audio or recording finalization is active. Previously loaded old tabs need one refresh to receive this guard; a service worker was not present in the old v2 source.
- Suggestion box keeps the same board and loads only after a tap. Updated replaces Built.

Validation: quiet-tone/noise/feedback/silence regression; private iPhone event replay corrected held-tone gate decisions from 42% to 100%; raw audio replay through sandboxed Chrome at 48 kHz improved quiet output (Linux Chrome with iPhone UA is not a physical iPhone test). Root's exported audio remains private and is never included in the site/repo. Real phone validation is still required.

---

# Speaker/debug release — 2026-11-15

Canonical GitHub source is tmad4000/HarmonyClaudeCodeTest; candidate branch claude/speaker-harmony-overhaul. The separately configured Sites source project appgprj_6af7d8fbba108191a3478ee36e1f9fda publishes claude/ as dist/. Preserve the existing neural experiment, settings restoration, version checks and relative build-time formatter.

The stalled work is preserved in ec3ffe9, pushed before implementation. GitHub main was fb46d29. Production was Sites v4 f379530532262f9acbf0688c5650389a18c42948; its rollback version is appgprj_6af7d8fbba108191a3478ee36e1f9fda~appgver_7e0917bd55108191810a079c82f7ce22. Deploy that saved version through the same Sites project to roll back. No DNS changes are needed.

The speaker path uses the existing reference canceller in AudioWorklet at the actual context sample rate. Browser EC/NS/AGC are off for that path. The same mono, limited speaker signal is the reference, with a128-sample graph-cycle delay. The110ms adaptive tail and60ms Signalsmith block remain unchanged: measurements did not justify blindly changing them. Speex AEC plan was reviewed; no unreviewed compiler toolchain or new DSP dependency was introduced. Browser echo cancellation remains selectable in Settings and is the fallback if the reference module cannot load. A worklet runtime failure stops the graph safely.

Default Speakers keeps full harmony gain; emergency trimming has a6dB floor,4second penalty expiry and4dB/s recovery. Extra feedback protection is off by default and applies a0.7ceiling,8kHz low-pass,600ms gate and at most1second howl duck. Normal speakers use10kHz and800ms gate. Pitch control is bounded30Hz; audio samples remain off the main thread. Worklet telemetry is10Hz; hardware underruns are explicitly unavailable, separately from observed render-frame gaps.

This is an incremental release with the existing v4 layout and output switch. The v2 UI remains preserved in2114f29 on claude/speaker-harmony-overhaul and is not included here. Build time is now11px at the top right. Recording is a tiny corner dot and one short first-run line; details open a native modal. Legacy boolean speaker settings migrate to outputProtection0/1. Existing settings and newer-version refresh are preserved.

Debug sessions stay in IndexedDB in this browser profile; they are not uploaded or separately authenticated from that profile. Raw mic is L, final mono output R. Audio chunks persist every2seconds so reload retains previous chunks. Events include build/browser/mic settings/latency/AEC/gate/pitch/trim/errors. DeviceId/groupId are removed. Off persists; a skipped take stays skipped across automatic graph rebuilds. Mark, local timeline, Keep, Copy summary, audio download and one-file JSON export are provided. Unkept sessions expire after14days when the app opens and are capped at100MB oldest-first. Pinned sessions are never automatically deleted; if pins alone fill100MB, new audio stops and lightweight events continue. Audio caps are10minutes/20MB per take; events continue after either cap. The shared private-session-store.js is copied byte-for-byte from breathe.

Metrics: harmony-on means output envelope within6dB of target during voiced input. A dropout is a>12dB dip lasting30–500ms. Simulator target is known; analysis of a recorded take uses an inferred recent output target and is labelled accordingly. Gate ratio, gate/retarget rates, notch counts and marks come from logged events. Hardware underruns remain null. No synthetic metric proves physical Mac speaker quality.

Validation: node claude/test/speaker-regression.cjs runs44.1/48kHz × room gains0.3/1 with the options actually shipped, checking known-target envelope harmony-on>=97%,<=1dropout/min, no gate dropouts, loop silence after singer stops, variable64/128/256sample worklet quanta and diagnostic gaps. Linux sandboxed installed Chrome verified legacy migration, equal output controls, settings refresh, live extra protection, mic/output recording durability on reload, off persistence, markers and recorder-failure cleanup. A fake microphone produced zero gate dropouts in both old v4 and candidate; the actual reported physical choppiness was not reproduced. In the synthetic room the reference path tracked220Hz while the fallback locked near110Hz and notched. Real singing on Mac/iPhone remains unverified and needs a real debug take.

Known scope limits: no automatic private upload, no20second PCM snapshot ring (a large copy on the audio thread could introduce stalls), no claim of exact hardware underruns or measured output route where the browser does not expose it. Reverb-tail auto-sizing and exhaustive5minute/M5p99 performance remain follow-up measurements. Only the verified context sample rate is used; WebAudio handles capture resampling.

Release metadata identifies the artifact build, never an anticipated publication time. Before packaging, set a unique version and UTC buildTime in version.json, app-features.js and the version meta tag. Keep source/artifact immutable after saving. Publish only after independent code and design review; verify the live manifest, key assets and browser behavior afterwards.


## V2 follow-up
Fable v2 app shell on the already-shipped incremental engine: equal output pills, live actual pitch and target harmonies on the current-key staff, harmony chips, one Sing/Stop action and a native settings sheet. Recording indicator follows actual recorder state; defaultboth selects bothThird chips. Dark/light system themes and reduced-motion rendering are supported. Feedback loads third-party code only after an explicit Send feedback click. Session pruning now occurs at take start/end, not every2second audio chunk. The incrementalv5 remains an additional rollback; originalv4 is retained.
