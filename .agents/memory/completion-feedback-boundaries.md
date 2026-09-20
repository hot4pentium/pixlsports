---
name: Completion feedback boundaries
description: Defines when guided progress should animate versus remain a quiet persistent state.
---

Celebrate a completion transiently only when it comes from the current user’s direct action. Remote collaborator updates, restored state, reloads, and ordinary rerenders should update the persistent completed state without replaying the transient effect.

**Why:** Replaying celebrations for background synchronization or restored data makes guidance feel noisy and can incorrectly imply the current user caused the change.

**How to apply:** Keep transient feedback in local interaction handlers, derive persistent completed visuals from saved state, respect reduced-motion preferences, and pair visual feedback with concise accessible status text.