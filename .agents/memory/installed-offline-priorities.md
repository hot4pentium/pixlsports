---
name: Installed offline priorities
description: User-approved offline readiness for installed Pixl Sports.
---

Prioritize the Hub, schedule/checklist, and local Stat Tracker for immediate offline readiness. Other tool assets should cache when used rather than all being downloaded at installation.

**Why:** The user selected “Day-of tools first” when choosing between core readiness, core plus editors, and preloading every tool.

**How to apply:** Preserve local/account-scoped data and cached schedules while reducing install downloads. Do not restore broad editor/model precaching without revisiting this tradeoff.

New Event Card drafts may be saved locally while offline, but remain private until the owner explicitly publishes them online; reconnect must never publish them automatically. Existing public-card edits remain connection-dependent unless separately scoped.

**Why:** The user requested local Event Card drafts until publication. Keeping publication explicit prevents an offline draft from becoming public unexpectedly.

**How to apply:** Keep offline drafts account-scoped on the device, identify them as unpublished, and remove them only after the server confirms publication.
