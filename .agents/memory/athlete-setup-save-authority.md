---
name: Athlete setup save authority
description: Prevent unfinished cached profiles and late reads from reopening completed native setup.
---

A confirmed athlete-profile write must update the protected profile cache before
setup dismisses. Cache hydration must not replace an already resolved in-memory
profile, and profile downloads started before that write must not overwrite its
receipt in memory or storage.

**Why:** A new-account setup briefly reached the dashboard, then reopened a blank
form because the post-dismiss refresh restored the earlier unfinished profile.
Invalidating only the screen request is insufficient: the transport can still
cache a late pre-save response.

**How to apply:** Fence both profile response application and cache writes against
successful mutations. Check an unfinished startup cache against the server before
presenting setup again. Continue using real server setup eligibility; never hide
the bug by globally suppressing onboarding or merging identities.
