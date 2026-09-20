---
name: Vite artifact entrypoints
description: The HTML module entry must work when an artifact is served at either root or a preview subpath.
---

Use a relative module entry in an artifact's HTML shell instead of an absolute `/src/...` URL or a `%BASE_URL%` source URL.

**Why:** An absolute root entry can escape the artifact when a full-size preview is opened under a path, while Vite can treat a `%BASE_URL%` source entry as external during a subpath production build.

**How to apply:** Keep runtime asset links base-aware, but let Vite resolve the source module from a relative HTML path; verify clean builds at both `/` and a representative subpath.