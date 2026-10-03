---
name: Browser-native control testing
description: Use browser-native interactions for file, color, and range controls in Chromium tests.
---

For real Chromium tests, attach files through the DevTools file-input API, use the native input value setter plus input/change events for controlled text or color inputs, and drag or keyboard-operate range sliders. Synthetic property changes alone may not update React state. For controls disabled by a fieldset, use `matches(':disabled')`; a descendant's `.disabled` property may remain false.

**Why:** React state depends on the events emitted by native controls, while inherited disabled state is reflected by HTML semantics rather than the descendant property.

**How to apply:** When testing native editor controls in a browser, drive them through their expected browser interaction and assert their effective state, not just their DOM property.