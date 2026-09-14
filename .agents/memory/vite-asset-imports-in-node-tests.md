---
name: Vite asset imports in Node tests
description: Runtime constraint when unit-testing SVG and export helpers outside Vite.
---

Node's test runner cannot load SVG builder modules that import Vite asset URLs such as `.webp?url&inline`.

**Why:** Those imports are transformed by Vite in the browser build, but `tsx --test` sees the raw binary asset extension and fails before the test runs.

**How to apply:** Keep Node-focused export tests on pure markup helpers and browser API fakes; reserve full asset-backed SVG rendering checks for a Vite/browser test harness.