---
name: Workspace selection precedence
description: How an explicitly chosen schedule event competes with automatic week recommendations across tools.
---

An explicit Calendar selection takes precedence over automatic week recommendations for workspace tool destinations. Prep may use either a selected game or practice; Stats uses the selected event only if it is a game. Keep legacy date and opponent URL fields alongside the selected event ID for existing links.

**Why:** A browser journey selecting a later game exposed Prep and Stats links that silently went to the first recommended game. Hype also needs its event prefill to run after asynchronous signed-in project loading, independently of the one-time athlete profile seed.

**How to apply:** When changing workspace links or onboarding, verify a non-default game through navigation and reload in all tools, and check that private checklist content stays out of Hype and public request bodies.