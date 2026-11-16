## 2026-11-16-session-fence-1

An older open tab can no longer revive a locally lost payload or complete a new byte-backed session before its chunks. The entire session now carries a format fence, including JSON metadata. Lost payload tasks leave the runnable queue; their bounded loss summary remains with the session, with delivery unconfirmed. No empty replacement chunks are sent.

On startup, pending legacy work is promoted atomically while preserving its original consent generation, epoch, payload, MIME, remote session/chunk IDs and request limits. Local queue IDs are renewed so a late acknowledgement from an old tab cannot erase protected work. The current uploader can replay the same immutable request and establish acknowledgement proof. Off, removal, backoff, authentication failures and deletion tasks retain their existing rules. No credential, browser identity or database-version reset.

Compatibility tests use the actual historical uploader with real IndexedDB, repeated Retry, held old acknowledgements and intercepted requests. Already-dispatched old requests may still reach the server; the fence prevents new claims, and does not promise retroactive network cancellation. No engine, gain or codec change, new public upload pilot, physical iPhone proof or native build is claimed. The original frozen native byte-storage bundle is unchanged; this fix has a separate reviewed handoff.

## 2026-11-16-capture-readings-2

If audio recording cannot be constructed, started or continued, technical readings remain in the same song session and the page says audio is unavailable. Audio check reports recorder support, selected MIME, state and a fixed error class/stage. A constructor failure creates one readings-only song session; later failure preserves the existing ID and previously captured bytes, with no second encoder.

This integrates the reviewed fallback onto byte-recordings-1. Immediate live Blob reads, byte-backed local/outbox persistence, ordinary Stop final data, Off cancellation, legacy NotFound recovery and older-tab integrity guards remain intact. Failure finalization waits for already captured bytes before writing audio-ended metadata. The regular heartbeat can still send readings while binary uploads fail.

Independent review covers pending-byte errors, Stop, rapid Off→On, new-session ownership, storage errors and no codec/gain/auth changes; generated sandboxed full-app encoder-fault tests cover the notice, one mock enrollment/session, continued readings, Off and confirmed removal. No actual user recording, public test upload or physical iPhone fix is claimed. Native build 5 remains frozen on the earlier e33e84a byte-storage patch; this web follow-up does not replace that handoff.

## 2026-11-16-byte-recordings-1

Debug audio is materialized immediately from each live MediaRecorder callback and persisted as owned bytes with its MIME type, rather than retaining WebKit file-backed Blobs in IndexedDB. JSON event chunks are byte-backed too. Ordered writes and Stop finalization preserve the last chunk; Turning Recording off invalidates pending reads even if it is turned back on before they finish. Upload creates a temporary Blob from those bytes and verifies the same exact size and SHA-256 acknowledgement. Local exports support both new byte chunks and older valid Blob chunks. No codec or audio-engine change.

An older queued Blob that fails with NotFoundError is permanently marked lost on this device, with delivery unconfirmed: an earlier request may have reached the server without its acknowledgement. That part is not retried or replaced with empty audio. A bounded, once-per-session loss report uses the already accepted metadata path. Other parts and later sessions continue. Generic Retry cannot revive lost payloads; authentication/rate limits, Recording off, notice, deletion/epoch fences, immutable chunk names and storage caps still apply. Loss summaries survive later metadata updates.

New byte tasks use a queue marker older open tabs do not consume; the updated reader merges old and new tasks in their original priority order. No database, device or credential reset is performed. The shared store change adds byte-backed audio reads only; Keep/retention semantics are unchanged.

Validation uses generated data, real IndexedDB, an actual generated-input MediaRecorder, exact byte/MIME/hash round trips, a persistent-only legacy-Blob NotFoundError fault, and independent cancellation/Off/removal/retry review. All network traffic is intercepted; no new public pilot, real microphone or private recording is used. This targets Jacob's reported build-4 browser-storage failure; physical iPhone confirmation remains with the next native build. The separate recorder-start-failure fallback follows this release; gain/feedback work remains paused.

## 2026-11-16-audio-check-telemetry-1

Audio-check readings are included automatically in debug events and session metadata: raw pre-canceller mic and post-limiter output level, processed level, gate/master/trim/voice gains, input makeup, browser family, AudioSession type/state, context, reported route and permitted microphone constraints. Stop retains the last active reading with its original timestamp. Fresh start and Recording off clear that in-memory cache; off-state reads cannot restore it. The route is a browser description, not proof of the physical speaker.

One bounded metadata heartbeat per active eligible session, no faster than every five seconds and only after its begin acknowledgement, can carry current readings when audio/event chunks fail. It uses the existing write-only session path and credential, preserves all queue/metadata caps, omits complete/pinned flags and never enrolls merely to report. Heartbeat acknowledgements preserve unresolved chunk errors and backoff; metadata success does not mean audio arrived. Off/deletion/epoch/notice fences are retained. Active lightweight events and readings continue after the audio cap.

These are sampled diagnostics. Delivery still requires a working metadata connection and the existing global backoff; not every sample is a new server write. A queued final metadata write can carry an older timestamp than a later heartbeat, so readers must inspect the timestamp rather than assume exact final-state ordering. The new snapshot is not a physical iPhone playback test or a quiet-level fix. No engine, encoder, gain, route selection, consent or codec preference changes.

Validation: independent five transport groups plus snapshot/lifecycle and last-active retention checks passed with real IndexedDB and mocked networking; generated-input full-app heartbeat/Off/removal tests passed. Existing stage, strict protocol and crash-recovery regressions also pass. Chrome sandbox stayed enabled; no real microphone, private audio or public upload used.

## 2026-11-16-task-diagnostics-1

Failure details now identify the queued task kind (including begin metadata), task and chunk bytes, actual Content-Type, persisted tracked attempt count, when tracking began, and task age at the reported failure. Legacy tasks do not invent an earlier retry count. These fields join the existing sanitized error and preparation/fetch stage.

Audio/events reports still use only their already acknowledged session metadata path. A begin that has never been acknowledged can only report locally; the diagnostic never creates another session or enrols again. Reports remain bounded and deduplicated snapshots, not continuously refreshed retry totals. Queue ordering, retry/backoff, credentials, chunk bytes, consent/Off, deletion and epoch protections remain unchanged.

Validation: four independently reviewed sandboxed mocked-browser groups cover audio/events/begin failures, durable counters and age across reload, legacy uncertainty, authorization renewals, blocked/leased/stale attempts, caps, Off and deletion. Eight existing stage groups and five existing contract/notice/edge/recovery/timeout suites also pass. No real enrollment, microphone, encoder, or public upload was used.

A separate, unimplemented parking proposal considers whether repeated deterministic local preparation failures should park one session while later sessions continue. It requires its own reviewed release, including incomplete-session and deletion tests. This diagnostic release neither enables parking nor claims the physical iPhone failure is fixed.

## 2026-11-16-browser-runtime-1

Audio check now identifies the reported browser family/version and engine, distinguishing Chrome iOS (CriOS) from Safari and the native app. The engine label explicitly comes from the User-Agent; it is not an engine-build measurement. Actual AudioSession access and session selection remain feature-detected.

A fixed three-byte generated sample checks Blob.arrayBuffer and SHA-256 once locally, without microphone input, an encoder, permissions or network traffic. The Audio check readout and first session metadata include its result and API availability. Passing this tiny sample does not prove a recorded MediaRecorder Blob, a larger allocation, network PUT, or physical audio output works. The existing upload-stage diagnostic still tests real queued chunks and remains unchanged.

Chrome iOS uses a WKWebView-based layer, but API exposure and routing cannot be assumed identical across Safari, Chrome iOS and a native embedder. This release reports observed runtime capabilities rather than claiming physical-device parity. No audio graph, gate, gain, uploader protocol, credentials, consent or native code changes.

Validation: independent review with 12 sandboxed browser cases for UA families, API absence/errors/mismatches, metadata and zero pre-Sing microphone/encoder/network calls. A final copy/screenshot check at 320/390 px verifies the explicit sample qualifier. These are Linux browser checks with selected UA/API mocks, not physical Chrome-iOS/Safari equivalence tests.

## 2026-11-16-upload-stages-1

Upload failures now identify whether the browser failed while reading a chunk, calculating its SHA-256 checksum, constructing a request, or fetching the server response. A failure report includes the error class, a scrubbed and shortened message, chunk size/type and browser API availability. It contains no audio, request headers or credential values. The generic failure text no longer treats every local exception as a server outage.

A small JSON metadata update carries a bounded report through the already acknowledged session path, even if audio/event chunks cannot be prepared. It uses the same device credential, consent/Off, epoch, removal and queue protections; it does not enrol a device or create a session. Reports cannot recursively report themselves. Older queued sessions without a retained acknowledgement snapshot are not reconstructed. Complete/pinned flags are preserved. Retained metadata and reports count toward the existing queue cap, and oversized chunks are rejected before allocating their ArrayBuffer.

This is a diagnostic release. It does not establish or claim to repair the cause of the current iPhone upload failure. Blob MIME, WebCrypto availability, memory pressure and method-specific network failures remain possibilities until the phone's report arrives. No engine, gain, gate, audio-session, encoder, upload consent, endpoint or native code changes. Shared JavaScript is available for the native owner's next build.

Validation: independent source review and eight sandboxed mocked-browser checks passed for all four failure stages, redaction, bounds, acknowledged metadata delivery, final-update preservation and Off/delete/stale-attempt fences. Five existing notice, strict-contract, edge, recovery and timeout suites also passed. No live recording, enrolment or public upload was used for validation.

## 2026-11-15-ios-audio-session-1

Harmony now requests the browser's simultaneous playback-and-recording audio session before resuming Web Audio or asking for the microphone. Previously it only read the browser-selected session type. The request is feature-detected; missing or rejected support leaves microphone startup available. Sing still initiates audio resume synchronously in the same user gesture.

Audio check shows the actual audio session type/state and warns when the app destination is muted. Debug sessions retain the session-selection result, session interruptions, destination mute/volume and gate/master gains alongside the existing digital output meter. The meter is before the system output; nonzero digital samples do not establish which physical speaker or headset is playing. No gain boost, gate/feedback weakening, replacement recorder, silent audio loop or native audio-session override is included.

The browser's audio-session request does not let a web page force the iPhone receiver, speaker, Bluetooth profile, hardware volume or silent switch. The native owner separately controls the app's AVAudioSession. Physical iPhone output remains pending a real-device retest; simultaneous microphone/playback is supported by the platform. Upload reachability is investigated separately; existing queue, credentials, consent and removal fences are unchanged.

Validation: independent review and seven sandboxed Chrome cases passed with the default autoplay policy and genuine button clicks. Tests exercise supported/missing/throwing AudioSession APIs, selection before resume/capture, nonzero shifted output, Continuous gate bypass, cancellation/retry, and local-only telemetry/listener cleanup. No physical iPhone speaker, receiver or silent-switch outcome is claimed.

## 2026-11-15-startup-cancel-1

Stopping while microphone startup waited for a device label or audio module could clear the mic node, then let the old startup continue and throw `inputNode.connect` on null. Startup now has an attempt generation checked after asynchronous acquisition and graph setup. Late microphone streams are stopped, late voice/instrument factories release their local resources, and cancellation does not trigger an echo-canceller fallback or revive a stopped graph.

This starts from the shared engine lifecycle fix in reviewed native source a57bdc794951a1895c76f05a37cc069aee41500c. It also clears a rejected AEC loader cache only while that promise still owns the cache, so cancelling a failed load does not poison the next Sing. No DSP tuning, gain, gate thresholds, recording format, upload policy, Swift or native bridge changes are included. The current native build and the website have separate release provenance.

Validation:12 focused sandboxed Chrome cases passed, including real getUserMedia with fake hardware, cancellation at acquisition/label/module/factory boundaries, late-resource cleanup, successful retry and rejected-loader cache ownership; the native owner separately reports actual WebKit capture checks. The precise event that interrupted Jacob's native build 2 remains under telemetry investigation. Physical iPhone output and the remaining quiet-voice/high-feedback limits are not claimed solved by this lifecycle fix. Rollback to quiet-thirds-1 remains available.

## 2026-11-15-quiet-thirds-1

Quiet singers using Third above, Third below or both with voice backing on speakers can be rejected by an unmeasured room-echo estimate even when pitch tracking accepts their voice. This patch establishes near-end evidence before playback and follows a distinct singer pitch instead of treating the initial room estimate as a measurement. It also distinguishes unknown, speaker-check and learned echo estimates in the debug log.

The change is limited to thirds with voice backing. Other modes preserve the previous classifier and controller behavior. User volume, microphone makeup gain, reverb, encoders and the limiter are unchanged; howl/notch and hot-output safeguards remain.

Validation: independent source review; 20 sandboxed production-classifier room/decay cases passed, including 44.1/48 kHz, above/below/both, reference-only input and strong coupling. A 3,600-frame comparison preserves the excluded modes' previous behavior. Actual private quiet-phone audio replay kept the gate open for about 90–95% of measured held-voice samples at 1x/4x CPU, compared with historical same-mode uncalibrated runs around 71%/64%. Occasional dropouts remain, and replay timing varies. One additional measured-control run started at a different fixture phase and is not an aligned comparator; its pre-observation gap counter did not increase during measurement.

Singing on real speakers and physical iPhone output remain unverified. Strong echo can still suppress singing; the existing strong-coupling unison tail is not fixed in this release. The previous continuous-control-1 release remains available for rollback.

## 2026-11-15-continuous-control-1

- Audio check now has a large explicit Continuous ON/OFF button and visible actual-state confirmation. The main Audio check label also shows ON while active, and clears after Stop even when its panel is closed. Changes and session-start state are logged.
- AudioSession type/state and destination mute/volume are captured in session metadata and post-start readings, so the pre-start event filter cannot omit them. Routing is not forced.
- The current harmony voice, semitone interval and target note/frequency appear beside the meters.

No normal gain or echo-guard behavior changes in this release. The unknown-coupling gate fix remains a separate engine change under quiet-voice and closed-loop testing. Physical iPhone routing is not certified.

## 2026-11-15-phone-audio-check-1

- Prominent phone warning, shown on every visit; dismissal lasts only for that visit.
- Debug recording starts on under a new preference version, including browsers that opted out of the earlier local-debug version. Turn Recording off again to keep it off under this version. The recording notice appears before any upload. Old queued uploads are discarded; pending removals stay protected.
- Audio check on the main screen exposes raw-microphone and final-output levels, context/gate status and a temporary continuous harmony check that bypasses voice gating and ducking. Echo removal and feedback safeguards remain active. Raw silence stays silence; it does not inject a demo voice.
- Sending failures show a plain-language reason and log a sanitized status for diagnosis. Timeout is distinguished from pressing Recording off.
- Remove confirmation now repeats that access ends while backup copies may last longer.

Physical iPhone output/routing and singing on real speakers remain unverified. This release supplies diagnostics; it does not claim the continuing phone gap is fixed.

## 2026-11-15-notice-wrap-1

The beta recording notice keeps its separator with Turn off and Privacy on narrow phones. The approved notice wording and recording behavior are unchanged.

# 2026-11-15-noos-privacy-2

Updated 2026-11-15T15:07:45Z.

The runtime Recording Details text now states that30days is an access limit and that inaccessible backup copies may persist longer with no known cleanup bound. Removing ends access right away. The first-run notice is unchanged.

This is a privacy-copy hotfix; upload, removal, recording and audio behavior are unchanged.

---

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
