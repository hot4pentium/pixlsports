---
name: HYPE Card settings conflicts
description: How iPhone HYPE Card edits stay local and merge safely with PIXL.
---

Keep the iPhone as the working copy. Persist an explicit save intent in the signed-in account's encrypted local vault before sending it. If PIXL has newer settings, merge field by field: retain iPhone changes to fields the owner edited and keep remote-only changes. Retry with PIXL's latest settings revision; do not offer a choice between an "iPhone version" and a "PIXL version." Unsubmitted local drafts stay on the phone and are not sent until the owner taps Save.

The browser Showcase follows the same field-by-field rule with an account-and-invite-scoped local queue. Before retrying, refresh the owner invite and apply only fields explicitly changed by the queued save. An automatic retry must not turn a currently hidden or paused card public; that transition requires the owner to confirm a save while online.

**Why:** The owner wants all HYPE Card features on iPhone without choosing between separate versions, while concurrent edits still must not silently erase one another.

**How to apply:** On native, use settings-only revisions for stale-write protection. On the browser Showcase, scope queued saves to the authenticated owner and invite, refresh before retry, retain the queue through offline periods, relaunches, and uncertain network results, and clear it only after PIXL confirms the requested settings.
