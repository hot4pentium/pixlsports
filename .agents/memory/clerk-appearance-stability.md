---
name: Clerk appearance stability
description: Why auth-page styling should avoid unpinned structural Clerk selectors.
---

Theme Clerk screens through the provider's appearance variables and element classes before reaching for stylesheet selectors that target Clerk's internal class names.

**Why:** The current Clerk UI emits a structural-CSS warning for selectors targeting its internal classes and says those selectors may break when Clerk updates. The visual theme did not need them.

**How to apply:** Use the existing appearance configuration and app-owned layout classes for colors, fonts, spacing, and surfaces. If a future requirement truly needs internal pseudo-element selectors, consider Clerk's documented UI versioning guidance instead of silently depending on changing internals.

When applying a page-local light theme over a dark provider theme, avoid important text-color classes in the provider appearance. Clerk combines the element classes, and competing important colors can leave white text on a light card.

**Why:** The local card background changed as intended, but its text stayed nearly white until the provider's important text colors were relaxed.

**How to apply:** Keep provider text classes non-important where a local theme may override them, apply the page-local colors through appearance, and verify the rendered result rather than relying on typechecking alone.