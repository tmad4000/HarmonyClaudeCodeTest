# 2026-11-15-takes-live-1

Updated 2026-11-15T11:01:05.673Z.

Every song started with Sing is kept locally as a take (2 seconds or longer). Stop offers Play, Download and Keep; Takes opens the local library. No login is needed. AAC/m4a is preferred when supported, otherwise WebM. Takes include voice and harmonies, including the cleaned voice on Speakers, before any output-volume boost. Unkept takes expire after 14 days or 200 MB; kept takes are never automatically deleted. The Settings switch disables automatic takes.

Third above and Third below are independent choices; at least one stays selected. The live Headphones/Speakers control crossfades prebuilt audio paths without restarting the microphone or take. Browser AEC is requested on the same track; if the browser does not apply it the caption says so.

Startup sound was the intentional echo probe: the speaker check is now optional, off by default, with a short Run/Skip prompt and a Settings button. Raw microphone telemetry and the picture now tap before our canceller/gate, with zero-run, track-event and context diagnostics. Updated labels replace Built.

Sandboxed Chromium verified mixed AAC download and decode, same context/input/recorder across output changes, interrupted recovery, pin/delete, encoder-start failure, migration and recording persistence. Synthetic room tests pass at 44.1/48 kHz. Singing on real speakers is unverified until Jacob records a take; Linux does not verify iPhone Safari. Public debug upload and the public privacy update are a separate upcoming release; this version keeps data in the browser.

The World Issue Tracker feedback script loads only after Send feedback is tapped. Tone.js 14.8.49 remains vendored locally.

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


## Local Tone follow-up
Vendor the exact previously loadedTone14.8.49 bytes and licenses; no version upgrade. No CDN request is required on page load. Baseline screenshots are archived in docs/screenshots/2026-11-15 with68 dark/light, phone/desktop, mode and state views. Both themes and the Mix→Speakers settings order were inspected. About now has a small version/build stamp with touch/keyboard exact details; sourcecommit metadata can be supplied in the release manifest. Audio processing unchanged. Real singing on speakers remains unverified until Jacob records a take.


## Quiet startup and speaker-check consent
The reported startup static was reproduced as the intentional speaker-check noise: same noise-first fake microphone, default check output peak0.0713RMS/mean0.0277 versus exactlyzero with checking disabled. Speaker checking is now off by default. First Speakers use offers one short Run/Skip prompt; Settings retains Run speaker check. The manual check starts an idle graph only for the requested test, returns to idle afterwards, caches a confident result for later singing, and can be cancelled without stopping a newer session. AEC captures now reject on Stop instead of hanging. The AEC algorithm is unchanged.
Sustained level tests passed on injected and fake-microphone routes: speaker/headphone mean ratios1.042 and1.183 respectively, both above0.5; gates open throughout measured voice. This does not reproduce a25dB attenuation policy on live. Startup noise test with checking off emittedzero during the measured quiet window. Physical singing in a room remains unverified until Jacob records a take.
