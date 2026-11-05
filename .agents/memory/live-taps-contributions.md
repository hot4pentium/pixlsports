---
name: Live Taps contribution celebrations
description: Owner HYPE Card cheer totals and the explicitly approved end-of-session celebration for owners and participating fans.
---

The owner’s HYPE Card should show growing cheer totals as the shared card does. When Live Taps ends, show a celebratory modal for the owner and participating fans.

**Why:** The user requested owner-card parity and explicitly chose “Owner and participating fans” as the celebration audience.

**How to apply:** Distinguish a participant’s confirmed contributions from the combined game tally and the accumulated season record. Keep pending offline cheers separate; never invent personal attribution from a shared family QR.

The Live Taps completion celebration is a scoped exception to the usual rule against celebrating remote changes. A participating fan can see one celebration when their session ends.

**Why:** The owner ends the session remotely for fans, and the user explicitly wants fans included.

**How to apply:** Gate the modal by confirmed session completion and viewer participation, persist once-per-session presentation, and do not replay it for routine refreshes, historical card visits, or unrelated updates. Continue applying the general completion-feedback rule elsewhere.

Treat End Live Taps as terminal for that saved game’s cheer session, even if its stats remain open.

**Why:** A final cheer record and a once-only celebration cannot stay truthful if the same game is silently reopened and its final tally changes.

**How to apply:** Continue allowing stat edits without reopening cheers; start another cheer session with a new game. Preserve the original final aggregate when retrying End or removing a temporary tracker share.

Completed-cheer records must honor Event Card visibility, including dates inferred from completion timestamps.

**Why:** Cheer totals are public engagement data, but a completion's date and opponent can disclose a youth event the owner chose to hide.

**How to apply:** Recipients retain totals and stable receipt matching without hidden event labels, event identifiers or completion dates. Owners retain full records through authenticated responses.

Do not assume a tracker game ID is independent of its Event Card ID.

**Why:** Native tracking legitimately reuses an Event Card ID as the saved game ID. Hiding only the event-ID field can still disclose the same identifier through completion history or receipt recovery.

**How to apply:** Use invite-scoped opaque references to match recipient completions and receipts, including inactive summary fields. Preserve original IDs only for owners and existing active-session contracts. Keep legacy queues deliverable without inventing personal attribution.
