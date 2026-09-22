---
name: Installed startup browser check
description: Durable guidance for measuring the installed Hype Card shell before service-worker readiness.
---

Cold-start checks should measure first visible editor content and the first handled phone-sized tap before waiting for service-worker readiness, while intentionally delaying worker delivery and reporting resource timing entries observed before that tap.

**Why:** A fast service-worker install can hide whether the app shell itself is responsive, and long downstream offline journeys can mask startup regressions with unrelated editor failures.

**How to apply:** Keep startup budgets and resource reporting in the production browser journey, use a fresh browser profile without Clerk authentication, and keep later persistence/export assertions separate from the startup gate.