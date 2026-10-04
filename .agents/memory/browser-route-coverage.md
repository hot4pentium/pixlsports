---
name: Browser route coverage
description: Durable guidance for browser tests that follow persisted local work across application routes.
---

Cross-route browser checks should wait on stable `data-testid` or semantic state markers, and normalize casing and whitespace when matching presentation copy that uses CSS transforms or line breaks.

Premium artwork can uppercase the actual SVG identity text, not just its CSS presentation. Compare athlete/team identity case-insensitively while keeping saved colors, placement, media URLs and destination checks exact.

**Why:** The real-owner saved-card check initially treated an uppercase premium front as an identity mismatch, although it represented the correct owner invite.

**How to apply:** Normalize identity text assertions for classic/premium front parity; do not relax persistence assertions to accommodate stale or wrong-owner data.

**Why:** The supporter Hype Card flow exposes the same user-visible state in different casing and changes which editor step is visible after reopening; title-text waits were brittle even when the route and behavior were correct.

**How to apply:** For persisted local work, cover the full user path in one browser flow: create, export, navigate, assert the hub entry, reopen through its link, select the relevant editor section, and verify the saved fields. Keep cloud-route assertions separate from local-storage assertions. Prefer semantic attributes for exact copy, and normalize `innerText`/`textContent` before checking visual headings or labels.