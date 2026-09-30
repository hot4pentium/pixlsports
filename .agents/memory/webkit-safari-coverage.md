---
name: WebKit engine validation
description: Limits when validating Safari behavior from the Linux workspace.
---

Use Firefox through geckodriver and WebKitGTK's MiniBrowser through WebKitWebDriver for Linux browser coverage. WebKitGTK exercises Safari's underlying engine, but it is not Apple's Safari application.

**Why:** This Linux workspace cannot run the macOS or iOS Safari application, so WebKitGTK test results must not be reported as an exact Safari app or device check.

**How to apply:** Name Linux coverage as Firefox and WebKit/WebKitGTK. Keep actual macOS or iOS Safari testing distinct when a task requires that platform specifically.