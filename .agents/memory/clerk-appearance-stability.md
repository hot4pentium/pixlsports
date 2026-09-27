---
name: Clerk appearance stability
description: Why auth-page styling should avoid unpinned structural Clerk selectors.
---

Theme Clerk screens through the provider's appearance variables and element classes before reaching for stylesheet selectors that target Clerk's internal class names.

**Why:** The current Clerk UI emits a structural-CSS warning for selectors targeting its internal classes and says those selectors may break when Clerk updates. The visual theme did not need them.

**How to apply:** Use the existing appearance configuration and app-owned layout classes for colors, fonts, spacing, and surfaces. If a future requirement truly needs internal pseudo-element selectors, consider Clerk's documented UI versioning guidance instead of silently depending on changing internals.