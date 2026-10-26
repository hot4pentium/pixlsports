---
name: Patch batch recovery
description: Recover safely when a multi-file patch only partly applies.
---

The patch tool can partially apply a batch before reporting a failure; do not assume the operation was atomic.

**Why:** A retry based on stale file contents can undo a successfully applied hunk or place it in the wrong scope.

**How to apply:** After any failed patch batch, inspect repository status and reread each targeted file before preparing a new patch.
