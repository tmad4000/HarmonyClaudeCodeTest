# Bounded parking proposal — separate from task-diagnostics-1

Status: design for independent review, not implemented or enabled. The diagnostic release leaves task ordering and global retry behavior unchanged.

One old priority-2 task can repeatedly fail while priority-1 session metadata continues to arrive. Metadata-only server sessions therefore do not establish that every new session independently failed its first chunk. Current ordering is priority then task id, with a global retry deadline. The new diagnostic fields identify the failing task's kind, byte size, MIME, tracked attempt count and age. Counts cover only attempts since tracking began; they do not invent the history of legacy tasks. A report is a snapshot at the reported failure, not a continuously updated retry counter.

Proposed narrow first implementation:

1. Consider parking only repeated untyped local preparation failures at blob-read, digest or request-build for an audio/events task. Require three tracked failures of the same task after tracking starts. Count these actual eligible failures separately from `attemptCount`: authorization may start an attempt that is cancelled before a failure or request. Treat fetch/offline/timeout/429 and known HTTP refusals separately: retain current backoff and refusal behavior. Do not cycle through the queue to evade a server limit or rejected credential.
2. Park the affected session's audio/events tasks **and final metadata** atomically, not only the offending chunk. Use a distinct parked state, not the existing permanent `failed` or `eligible=false` states. Preserve bytes, immutable remote ids, generation, epoch, metadata, and any uncertain remote outcome. Do not mark it complete while chunks remain unsent. New chunks appended to that same parked session also remain parked; accepted-session diagnostic metadata may still report its state under the existing caps and consent fences.
3. Other eligible sessions may then progress after the current global backoff. Deletions retain priority and retry while Recording is off. A parked session never blocks deletion, pruning, Off, or a newer generation. Parked bytes still count toward all existing queue/session caps and expire under existing policy; local Export remains available.
4. Show a bounded plain-language status in Settings: a recording could not be sent and is retained locally; other recordings may still send. Keep the existing corner button's sole action as Recording on/off. Explicit Retry sending may unpark eligible tasks under the current credential/epoch, without clearing hard refusals, bypassing rate deadlines, changing ids, enrolling again, or automatically relabelling an old generation. Keep the lifetime attempt counter; start a separate retry-round budget if needed.
5. No automatic permanent drop, credential reset, enrollment, server read, new diagnostic session, or backend/API change. This proposal does not solve a device-wide preparation failure; queue caps still bound storage, and repeated identical failures should produce one bounded report rather than storms.

Required tests before implementation can ship:

- Two sessions, first with a deterministic bad chunk: bounded failure count, parked session remains incomplete, second session chunks eventually ACK; stable bytes and remote ids throughout.
- Begin/end ordering, append while parked, diagnostic dedup/caps, manual retry round, reload and expired lease across tabs.
- Held prep → Off/Delete/Off→On: no stale request/report, no task resurrection or cross-generation progress.
- Deletion 202→200 and uncertain PUT outcome retain epoch/idempotency barriers; Delete works for parked sessions.
- Offline, timeout, 429, auth/format/size/checksum failures do not become a backoff bypass. No automatic enrollment and no real public upload in tests.

The current release deliberately gathers the missing evidence first. Parking requires its own reviewed implementation and release receipt.
