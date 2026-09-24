---
name: OpenAPI path nesting
description: Guard against codegen accepting semantically misnested path operations.
---

A valid OpenAPI document may still produce successful code generation when indentation attaches operations to the wrong path. After path edits, inspect generated URLs for both the new operation and affected existing operations.

**Why:** A schedule-share path edit accidentally attached existing PATCH and DELETE operations to a new Game On path, while code generation still exited successfully.

**How to apply:** When adding sibling paths, verify the surrounding YAML indentation, rerun code generation, and check generated paths for GET, PATCH, DELETE, and the new endpoint.