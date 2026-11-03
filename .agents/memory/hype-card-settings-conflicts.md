---
name: HYPE Card settings conflicts
description: Why iPhone and PIXL HYPE Card settings use a settings-scoped version check.
---

Use optimistic concurrency based only on the editable HYPE Card settings, and preserve the iPhone draft when a newer PIXL version is detected. Do not use a generic invite timestamp that changes for unrelated card activity.

**Why:** A new database revision field is unnecessary, and unrelated invite updates should not block a settings save. The settings themselves provide a stable version for the exact fields being edited.

**How to apply:** When adding or changing HYPE Card settings, include them in the version calculation and keep conflict resolution explicit so neither device silently overwrites the other.
