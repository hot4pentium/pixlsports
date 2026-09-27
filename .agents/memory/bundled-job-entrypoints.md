---
name: Bundled job entrypoints
description: Why one-off database jobs need a separate CLI module from API startup imports.
---

Keep manually invoked cleanup entrypoints separate from reusable job modules imported by the API server.

**Why:** The API server bundles imported modules into its main entrypoint. A standalone job's `import.meta.url === process.argv[1]` guard can become true in that bundle, unexpectedly running the CLI branch and closing the server's shared database pool.

**How to apply:** Put reusable job logic in a module with no top-level execution or pool shutdown. Put one-off execution and `pool.end()` in a separate CLI module that the server never imports. Verify an API route after restarting, not only the listener log.