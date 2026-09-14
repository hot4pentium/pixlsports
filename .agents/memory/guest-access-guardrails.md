---
name: Guest access guardrails
description: Guest mode and quota enforcement must remain authoritative and concurrency-safe on the server.
---

Guest access mode is immutable after initial setup; the API must not let a Guest account switch to Full without a separate approved upgrade flow. Quota claims must lock the account row before counting and inserting usage events so concurrent sessions cannot oversubscribe a limit.

**Why:** Browser metadata and client-generated idempotency keys are not trusted boundaries, and simultaneous claims can otherwise both observe available quota.

**How to apply:** Preserve these checks when adding account settings, upgrades, new quota categories, or multi-device workflows.