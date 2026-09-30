---
name: Help page phone width
description: Keep centered Help-page content from widening a narrow viewport inside the shared flex-column page shell.
---

For centered main content inside the flex-column page shell, pair `mx-auto max-w-*` with an explicit `w-full`. Auto width and horizontal auto margins can otherwise resolve to the content's intrinsic minimum width on narrow screens.

**Why:** The Help page expanded the document beyond a phone viewport even though its outer max-width looked responsive. Constraining only the parent did not resolve the intrinsic-width behavior; making the centered main content fill available width did.

**How to apply:** When a centered page section is a flex item, set its width to the available space before applying the max width. Verify document and body scroll widths against the intended phone viewport, while allowing scrollbars to reduce the document client width slightly on desktop.