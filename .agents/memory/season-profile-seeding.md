---
name: Season profile seeding
description: How the supporter account's season label maps to athlete-page setup.
---

Use `seasonName` as the canonical free-text profile key for onboarding and new athlete-page defaults. The label may be `Fall 2026`, `2026–27`, or another season name.

**Why:** The athlete invite contract already calls this value `seasonName`; keeping one profile key avoids translating or drifting between signup and page creation. Existing athlete pages remain authoritative for their own saved season.

**How to apply:** Read and write `seasonName` in supporter profile metadata. Use it as a default only when creating a new HYPE Card page; load the saved page's season when editing an existing one.