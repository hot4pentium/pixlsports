---
name: Browser route coverage
description: Durable guidance for browser tests that follow persisted local work across application routes.
---

Cross-route browser checks should wait on stable `data-testid` or semantic state markers, and use case-insensitive matching only for presentation copy.

**Why:** The supporter Hype Card flow exposes the same user-visible state in different casing and changes which editor step is visible after reopening; title-text waits were brittle even when the route and behavior were correct.

**How to apply:** For persisted local work, cover the full user path in one browser flow: create, export, navigate, assert the hub entry, reopen through its link, select the relevant editor section, and verify the saved fields. Keep cloud-route assertions separate from local-storage assertions.