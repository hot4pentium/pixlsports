---
name: Animated HYPE Card browser checks
description: Reliable pointer-driven browser coverage for consecutive HYPE Card side changes.
---

When a Chromium test drives several HYPE Card sides in sequence, wait until the card's computed 3D transform reaches its settled face before dispatching the next pointer click. The side and pressed-state attributes update before the flip animation finishes.

**Why:** A fast sequence of CDP clicks could leave the card on the prior side; waiting for the settled transform made each section change reliable.

**How to apply:** In browser tests for the shared living card, wait for the final transform matrix after each side selection before measuring layout or clicking another control.