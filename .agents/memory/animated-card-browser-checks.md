---
name: Animated HYPE Card browser checks
description: Reliable pointer-driven browser coverage for consecutive HYPE Card side changes.
---

When a Chromium test drives several HYPE Card sides in sequence, wait until the card's computed 3D transform reaches its settled face before dispatching the next pointer click. The side and pressed-state attributes update before the flip animation finishes.

**Why:** A fast sequence of CDP clicks could leave the card on the prior side; waiting for the settled transform made each section change reliable.

**How to apply:** In browser tests for the shared living card, wait for the final transform matrix after each side selection before measuring layout or clicking another control.

For owner previews, wait for the flip container to report that it is no longer busy. An animation-disabled flag alone is not a settled-state signal: it is also false during the preparatory render of a section-to-section flip.

**Why:** The preparatory render already contains the next section, so waiting for its content and a false animation flag can dispatch the next click while the flip still rejects input.

**How to apply:** Wait for the owner flip's busy state to clear after each side change before selecting another side.