---
name: Vite JSX generic instrumentation
description: Source instrumentation can rewrite generic component parameters inside TSX into invalid markup.
---

Avoid supplying explicit generic arguments directly on JSX components in this Vite-instrumented app when inference works. Generic JSX such as `<Segmented<ValueType> ... />` may be rewritten with metadata attributes inserted before the type argument and then fail Babel parsing, even when `tsc` passes. Prefer inferred generics; if callback variance needs help, cast the callback value to the component's domain type.

**Why:** The Vite development transform produced invalid TSX markup from explicit generic JSX syntax, while the TypeScript typecheck passed.

**How to apply:** When a component works under `tsc` but Vite/Babel reports an unexpected token near a generic JSX invocation, remove the explicit JSX type argument and preserve type safety through inference or a typed callback.
