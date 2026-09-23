---
name: Standalone Vite builds
description: The difference between managed workflow builds and manual shell builds in this workspace.
---

Ad-hoc Vite builds launched from a shell need both a port and a base path supplied explicitly. A missing value fails configuration loading before application code is checked.

**Why:** Managed Replit workflows provide the routing environment, but a bare package build command does not inherit those workflow-only values. This caused two separate configuration failures before the actual build could run.

**How to apply:** When verifying a production build manually, provide a valid port and the artifact's intended base path in that shell invocation rather than treating a configuration-loading failure as an application build failure.