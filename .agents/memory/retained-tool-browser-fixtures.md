---
name: Retained tool browser fixtures
description: Contract coverage for browser fixtures that keep event tools mounted but hidden.
---

When browser fixtures visit multiple retained tools, model the real response shape for every visited tool's queries, including hidden tools.

**Why:** A hidden Live Taps panel keeps its queries active. A generic fixture fallback returned an object for a list endpoint and crashed the entire retained workspace, which initially looked like a missing Record Moments control.

**How to apply:** Use typed empty collections for list endpoints rather than a generic success object. Capture runtime exceptions before attributing a missing control or focus timeout to navigation.
