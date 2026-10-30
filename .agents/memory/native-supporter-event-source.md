---
name: Native supporter event source
description: Authorization boundary for the native iPhone schedule and Event Card details.
---

The native Supporter Home and Event Card details use the signed-in supporter’s verified Clerk account to read their private schedule. Do not call private schedule endpoints without that authenticated account context.

**Why:** The private schedule contains account-linked Event Cards and must stay behind the existing native account authorization flow.

**How to apply:** Preserve authenticated schedule and detail fetches, and keep loading and recoverable error states when changing native supporter screens. Public HYPE Card and Live Taps requests remain separate public flows.
