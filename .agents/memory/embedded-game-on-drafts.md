---
name: Embedded Game On drafts
description: Prevent state-sync loops when a Game On editor mirrors draft fields into a parent collection preview.
---

The embedded editor must keep its creation-session identity stable while the parent receives updated draft-preview props. If the editor resets local state whenever the mirrored draft's event ID changes, the reset can feed a different ID back to the parent and create a render/update loop.

**Why:** The collection face needs live draft values, but those same values return as props to the editor. Treating preview updates as a new editor selection caused repeated React updates and blocked later input.

**How to apply:** Use a stable identity for one fresh-draft session. Read parent draft values when mounting or restoring after a responsive remount, but do not reset the live editor merely because its preview changed.