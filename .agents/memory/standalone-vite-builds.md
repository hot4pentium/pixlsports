---
name: Standalone Vite builds
description: The difference between managed workflow builds and manual shell builds in this workspace.
---

Ad-hoc Vite builds launched from a shell need both a port and a base path supplied explicitly. A missing value fails configuration loading before application code is checked.

**Why:** Managed Replit workflows provide the routing environment, but a bare package build command does not inherit those workflow-only values. This caused two separate configuration failures before the actual build could run.

**How to apply:** When verifying a production build manually, provide a valid port and the artifact's intended base path in that shell invocation rather than treating a configuration-loading failure as an application build failure.

For browser fixtures that render root-relative public assets, set `BASE_PATH` to the artifact's actual mount path; a fixture under an artificial subpath can make `/public-file.png` return 404 even though the asset exists.

**Why:** The account-loading splash fixture initially mounted below a test-only base path while its logo source remained root-relative, so Chromium could not load the logo and the visual assertions never ran.

**How to apply:** Match the fixture's Vite base to the real artifact path when exercising components that reference public assets with leading-slash URLs.