---
name: Family-facing save messages
description: Plain-language iOS notices for offline saves and Prep conflicts.
---

Family-facing iOS notices should omit implementation details such as revision mismatches, sync queues, server hostnames, and HTTP codes. For saves, state whether the change is saved on the iPhone or in PIXL, and explain any action that could remove a local change. For failures, describe the affected action and what to try next.

**Why:** The user said families do not need behind-the-scenes details and found technical save and request errors confusing.

**How to apply:** Map request failures to concise, operation-specific messages at the app boundary; do not display raw server data. Preserve explicit confirmation before discarding local changes or replacing saved content.

Routine successful Stat Tracker saves should be silent, without a "Saved to PIXL" banner or success announcement. Keep offline, pending, and actionable failure information inline without shifting the controls or leaving a large empty banner space.

**Why:** The user found recurring save feedback distracting during tracking and questioned the need for the success notification.

**How to apply:** Preserve actual local saves and server acknowledgements; simplify only their presentation. Keep retries and explanations available when a save needs attention.
