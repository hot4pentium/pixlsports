---
name: Standalone Clerk browser fixtures
description: Covers Clerk configuration for Vite servers started directly by browser tests.
---

Browser tests that spawn Vite outside the managed artifact workflow must supply a harmless `VITE_CLERK_PUBLISHABLE_KEY` fallback when the test process does not inherit one.

**Why:** a missing build-time Clerk key can leave the fixture page unmounted, which looks like an unrelated React or navigation failure.

**How to apply:** set a non-production test publishable-key fallback in each standalone Vite child-process environment; never print or embed a production credential.
