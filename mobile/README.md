# Harmony iOS beta

Capacitor 7.4.3 wraps the same `../claude` web app. `scripts/bundle-web.py` packages it without changing engine bytes. The native adapter prepares and reapplies AVAudioSession around WebKit capture, reports routes and stops on route changes/background/interruption. Stops never resume automatically. Bluetooth uses A2DP output and built-in microphone; no HFP or mixing. Actual routing/latency/audibility remain physical-iPhone tests.

`npm ci && npm run sync` produces the offline core app. Piano backing samples still require network (existing web behavior). Neural experiment and feedback open in Safari. No OTA code updates. Beta audio/diagnostics upload follows the same visible Recording control and privacy disclosure as the web; turning Recording off stops sending. No claim of “no data collected.”

Team JESMXK96LG; bundle com.ideaflow.harmony; version0.1.0. Existing distribution certificate300FAAFC only. One App Store profile4e2a7999-ec7c-4dad-8d58-b15daa19882d (BMFTQBUTM4), created2026-11-15. No new certs, automatic provisioning, login/2FA or keychain changes. Release uses a finite task-owned Aqua launchd job on M5 under shared nonbreaking lease. Source must be exact clean revision. Archive/export manual signing with profile scoped to app target; strict altool positive marker required, even if tool exit code0.

Export is not internal-only because this task explicitly includes later external beta review. Internal testing comes first. External group is private with no public link. Website app record is Jacob-only. Do not publish an App Store release.
