---
name: HYPE Card follow layout
description: Mobile layout and scrolling behavior for shared-card follow controls.
---

The shared HYPE Card follow dialog should stay organized and stable on phones, with vertical-only scrolling and clearly aligned alert choices.

**Why:** The user asked for a clearer follow page that scrolls up and down without the form moving sideways.

**How to apply:** Keep the dialog width-constrained, let only its content area scroll vertically, and verify narrow phone sizes and the on-screen keyboard.

Keyboard regression checks must keep the layout viewport tall while independently shrinking and panning the visual viewport. Ordinary phone-height resizing is not equivalent to opening the iOS keyboard.

**Why:** Mobile Safari can change the visible area without changing layout-viewport dimensions; a height-only responsive test can pass while the real form remains covered.

**How to apply:** Exercise focused-input scrolling, pointer activation of Save, visual-viewport resize and offset changes, and restoration after dismissal. Label these as simulated keyboard checks; only an actual iPhone run confirms Apple keyboard behavior.
