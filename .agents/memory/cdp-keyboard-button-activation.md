---
name: CDP keyboard button activation
description: Reliable native button activation in the project's lightweight Chromium DevTools browser tests.
---

When checking keyboard activation of a native button via Chromium DevTools, focus the button and dispatch both Space key-down and key-up with `key: ' '`, `code: 'Space'`, and virtual key code 32. Synthetic Enter key-down/up without additional text parameters did not activate the button in this harness.

**Why:** A card-flip browser check timed out twice on a second activation with synthetic Enter even though the same button reacted to Space; switching all activations to Space made the two-viewport flow reliable.

**How to apply:** Use actual `Input.dispatchKeyEvent` events, not a DOM `.click()` or synthetic `KeyboardEvent`, when proving keyboard access. Re-focus the target after rerenders and check both accessible state and the resulting visible face.