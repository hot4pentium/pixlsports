---
name: TSX test JSX runtime
description: Runtime compatibility rule for TSX modules loaded directly by the project's Node test runner.
---

TSX modules that emit JSX and can be loaded by the Node test suite must import the default React binding, not only named React hooks.

**Why:** The project preserves JSX during type-checking, and Vite supplies the browser transform, but the direct `tsx --test` path can otherwise compile JSX to calls that expect `React` at runtime.

**How to apply:** When adding or extracting a `.tsx` feature module, use a default React import alongside any named hooks if tests may import or lazy-load that module.