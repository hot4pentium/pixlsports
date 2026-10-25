---
name: Installed startup browser check
description: Durable guidance for measuring the installed Hype Card shell before service-worker readiness.
---

Cold-start checks should measure first visible editor content and the first handled phone-sized tap before waiting for service-worker readiness, while intentionally delaying worker delivery and reporting resource timing entries observed before that tap.

**Why:** A fast service-worker install can hide whether the app shell itself is responsive, and long downstream offline journeys can mask startup regressions with unrelated editor failures.

**How to apply:** Keep startup budgets and resource reporting in the production browser journey, use a fresh browser profile without Clerk authentication, and keep later persistence/export assertions separate from the startup gate.

Development preview recovery must be available before the app entry module loads, and must preserve production offline behavior and user data.

**Why:** A startup screen can appear while the entry module is unavailable; recovery implemented only inside that module is then unreachable. A slow development module graph should not be reported as a failed connection after only seven seconds.

**How to apply:** Keep dev-only shell recovery independent of React. Scope worker removal to the artifact and cache removal to the offline shell; never clear local storage, account data, or other apps' caches.

Dynamic entry loading can finish after the window's load event. Offline worker registration must handle an already-complete document as well as a future load.

**Why:** Splitting public startup exposed an event-order race that left a fully rendered production app with no registered worker.

**How to apply:** When changing startup timing, check both event orders. In browser checks, poll registrations rather than awaiting the potentially never-resolving service-worker ready promise.