---
name: HYPE Card settings conflicts
description: How iPhone HYPE Card edits stay local and merge safely with PIXL.
---

Keep the iPhone as the working copy. Persist an explicit save intent in the signed-in account's encrypted local vault before sending it. If PIXL has newer settings, merge field by field: retain iPhone changes to fields the owner edited and keep remote-only changes. Retry with PIXL's latest settings revision; do not offer a choice between an "iPhone version" and a "PIXL version." Unsubmitted local drafts stay on the phone and are not sent until the owner taps Save.

**Why:** The owner wants all HYPE Card features on iPhone without choosing between separate versions, while concurrent edits still must not silently erase one another.

**How to apply:** Use settings-only revisions for stale-write protection. Preserve queued intent through offline periods, relaunches, and uncertain network results; clear it only after PIXL confirms the requested settings.
