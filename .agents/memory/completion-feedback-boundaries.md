---
name: Completion feedback boundaries
description: Defines when guided progress should animate versus remain a quiet persistent state.
---

Celebrate a completion transiently only when it comes from the current user’s direct action. Remote collaborator updates, restored state, reloads, and ordinary rerenders should update the persistent completed state without replaying the transient effect.

**Why:** Replaying celebrations for background synchronization or restored data makes guidance feel noisy and can incorrectly imply the current user caused the change. Isolated browser fixtures may not mount the app entrypoint, so a component that uses shared celebration classes must import their stylesheet directly. The default `--primary` color can also blend into a primary-tinted celebration panel, hiding most confetti.

**How to apply:** Keep transient feedback in local interaction handlers, derive persistent completed visuals from saved state, respect reduced-motion preferences, and pair visual feedback with concise accessible status text. Import shared celebration styles from each consuming feature and choose a base confetti color that contrasts with the panel. On the supporter dashboard, weekly-path progress follows the recommended event; selecting a historical game changes context without advancing or rewinding that path.