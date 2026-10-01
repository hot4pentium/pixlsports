---
name: OpenAPI date query strings
description: How generated query clients represent and serialize date-only filter parameters.
---

For date-only query filters, use a validated `YYYY-MM-DD` string rather than OpenAPI `format: date` when the generated client serializes query values with `String(value)`. The date format maps to a JavaScript `Date`, whose default string representation is not the wire format expected by a date-only API.

**Why:** The generated client serializes query parameters directly, while the generated types for `format: date` are `Date`; sending those values produces a non-ISO date string that does not match date input controls or the server contract.

**How to apply:** Define date-only query strings with a format pattern, validate real calendar dates at the API boundary, and convert to UTC timestamp bounds only when querying timestamp columns.