---
name: Native supporter event source
description: Authorization boundary for the native iPhone schedule and Event Card details.
---

The native Supporter Home and Event Card details use the signed-in supporter’s verified Clerk account to read their private schedule. Do not call private schedule endpoints without that authenticated account context.

**Why:** The private schedule contains account-linked Event Cards and must stay behind the existing native account authorization flow.

**How to apply:** Preserve authenticated schedule and detail fetches, and keep loading and recoverable error states when changing native supporter screens. Public HYPE Card and Live Taps requests remain separate public flows.

The linked owner may preview a hidden HYPE Card in the native app, but private preview content and photos must remain behind the verified native account link. Do not return a public invite token or public photo URL for a hidden card; keep public sharing explicit and available only for cards the owner has made public.

**Why:** Families need to review their athlete’s card without changing its visibility or making it available to other accounts.

**How to apply:** Resolve the selected athlete from the linked account on the server, return only the owner-preview fields, and recheck the active account link before serving private photo bytes.
