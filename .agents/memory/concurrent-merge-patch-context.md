---
name: Concurrent merge patch context
description: How to keep implementation patches aligned when another task merges changes during active work.
---

Treat previously read source snippets as provisional when task merges can update the same files during implementation. If a patch misses or a merge notification arrives, inspect the current source around the exact target before applying again; preserve merged behavior rather than restoring earlier signatures or styles.

**Why:** A concurrent feature merge changed component props and status styles while a UI patch was being prepared, so patch contexts based on earlier reads no longer matched. Rebases can also leave duplicated browser-test setup without conflict markers.

**How to apply:** After receiving a merge update, and before retrying a failed patch, re-read only the affected current sections and adapt the smallest patch to the merged code. After rebasing, inspect changed test sections for duplicate scopes even when conflict markers are gone, then parse and run focused tests before completion.