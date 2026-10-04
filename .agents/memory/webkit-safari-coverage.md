---
name: WebKit engine validation
description: Limits when validating Safari behavior from the Linux workspace.
---

Use Firefox through geckodriver and WebKitGTK's MiniBrowser through WebKitWebDriver for Linux browser coverage. WebKitGTK exercises Safari's underlying engine, but it is not Apple's Safari application.

**Why:** This Linux workspace cannot run the macOS or iOS Safari application, so WebKitGTK test results must not be reported as an exact Safari app or device check.

**How to apply:** Name Linux coverage as Firefox and WebKit/WebKitGTK. Keep actual macOS or iOS Safari testing distinct when a task requires that platform specifically.

Treat a WebKitGTK failure with `EGL_BAD_PARAMETER` as a local browser-environment failure, not evidence of an app or iPhone crash.

**Why:** The workspace's MiniBrowser aborted while creating its default EGL display. Software rendering and disabling compositing alone did not resolve it; an inherited Mesa vendor from a different Nix environment was the problem.

**How to apply:** Inspect driver stderr before attributing an invalid WebDriver session to application code. Match the EGL vendor JSON and DRI directory to the project's installed Mesa package, not an inherited host vendor. Discover the installed paths instead of pinning Nix store hashes. Use Xvfb for a fresh display. If rendering still fails, report WebKit verification as unavailable rather than passing or failing the app.

MiniBrowser's desktop window has a minimum width larger than the smallest phone widths. Test narrow CSS viewports in a same-origin iframe and verify the document's client width; do not label a requested window size as the actual viewport.

**Why:** A requested 390px desktop window rendered a roughly 428px viewport. A 320px iframe supplied the intended CSS viewport, though `innerWidth` sometimes rounded one pixel below the document client width.

**How to apply:** Keep the iframe's width explicit and allow only a one-pixel rounding difference in `innerWidth`. This validates responsive WebKit layout, not iOS browser chrome, viewport behavior, or Apple touch input. The GTK driver's accepted touch pointer actions did not activate controls; use native mouse/keyboard checks there and keep Chromium touch checks separately labeled.