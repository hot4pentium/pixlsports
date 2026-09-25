---
name: Game On share identity
description: Why Game On cards cannot be inferred from the shape of a schedule share.
---

Only explicitly marked shares should appear in the owner’s Game On collection. A locally saved older card may still be opened from its known token and upgraded when edited; do not automatically classify every one-event share as a card. Public legacy card links stay valid, and the internal marker must never appear in public responses.

**Why:** The Calendar can publish a one-event game or practice through the same share storage. Treating that shape as a card would make the card editor overwrite Calendar notes, snacks, and drinks, or revoke the wrong public link. An internal marker preserves this distinction without requiring a schema migration.

**How to apply:** Keep owner listing, card editing, and Calendar-deletion revocation limited to explicitly marked shares or locally known legacy card tokens. If deletion cannot check for a remote linked card, leave the event in place and offer a retry instead of potentially orphaning a public link.

For a card linked to a Calendar event, edit the original Calendar event in place and keep its card share token stable. Event-specific Prep remains private and device-local unless the owner deliberately shares through Prep; creating or updating a public Game On link must never include those notes or checklist items.

**Why:** A second Calendar event or an automatic Prep publication would separate the owner's schedule from the card or expose private planning details. An independent card, by contrast, has no Calendar record to mutate.

**How to apply:** Reconcile a linked card's display details from the current Calendar event, save Calendar changes before updating its public card, and report partial failures explicitly so an owner can retry without creating another share.