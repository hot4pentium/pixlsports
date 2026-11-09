---
name: PostgreSQL privacy race tests
description: Deterministic ordering and atomic visibility checks for concurrent privacy writes.
---

Use real PostgreSQL blocking dependencies to establish concurrent request order in privacy tests, rather than request launch order or fixed delays.

**Why:** Starting a request first does not prove it acquired the authorization lock first. A passing timing-based race test can miss a privacy regression.

**How to apply:** Hold a downstream row lock, observe the first request blocked in PostgreSQL, then observe the competing request blocked behind it before releasing the gate. To check atomic privacy visibility, stop the settings transaction after its writes but before commit and read the state from a separate connection. Polling deadlines bound failures; they must not decide ordering.
