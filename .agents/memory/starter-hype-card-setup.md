---
name: Starter HYPE Card setup
description: Product intent for assigning an editable card during supporter onboarding, including softball.
---

New supporter setup should include an assigned HYPE Card so the owner edits a starter rather than having to create one separately. Softball must retain its own sport, not silently fall back to baseball or basketball.

**Why:** The user requested automatic assignment for new accounts and explicitly approved adding softball support so those accounts receive the same starter-card experience.

**How to apply:** Preserve existing owner cards when setup is retried. Automatically created starters remain private until the parent chooses to share; automatic assignment must not send invitations or publish on their behalf.

During interrupted or concurrent setup, retain the existing unique owner card's athlete identity for the completed profile, even if a retry form supplies different athlete details. Supporter-name changes can still be saved.

**Why:** There is no durable provenance that safely distinguishes an automatic starter from a card the owner has already authored. Rewriting a card during recovery could destroy authored identity or settings; letting profile identity diverge would associate the account with the wrong athlete.

**How to apply:** Explain the reuse policy in setup. Treat the owner card as authoritative for athlete, team, sport, and season during recovery; later explicit owner edits remain separate from automatic setup.

Native setup completion must be based on both the saved profile and a committed
owner card, not on a saved athlete name alone. Recovery should be visible and
require Continue; ordinary startup reads must not create or publish a card.

**Why:** Legacy linked owners' managed Clerk and PostgreSQL do not share a transaction. Clerk can
persist the profile and lose its response while PostgreSQL rolls back starter
creation. On a cold launch there is no local failed-save state to distinguish
this from completed setup. Independent new iPhone profiles save their details
and card in one database transaction; preserve that atomic boundary rather
than reintroducing a managed Clerk backing identity.

**How to apply:** Preserve the remotely saved details for the recovery form and
check database card existence when resolving setup. Do not solve this by
overwriting an existing card or by relying on another metadata completion flag
written in the same remote operation.
