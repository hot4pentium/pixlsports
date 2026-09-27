---
name: Vite asset imports in Node tests
description: Runtime constraint when unit-testing components that import Vite-managed styles or assets outside Vite.
---

Node's test runner cannot load SVG builder modules that import Vite asset URLs such as `.webp?url&inline`, or React components that import `.css` directly.

**Why:** Those imports are transformed by Vite in the browser build, but `tsx --test` sees raw asset/style extensions and fails before the test runs.

**How to apply:** Keep Node-focused tests on pure helpers or isolated React hooks that do not import CSS/assets; reserve full CSS/asset-backed rendering checks for a Vite/browser test harness.