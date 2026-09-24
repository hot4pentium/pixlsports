---
name: First tracker project on Hype Pages
description: How an Athlete Hype Page should find tracker data when it predates the first saved Stat Tracker project.
---

An Athlete Hype Page may exist before the first Stat Tracker save creates a cloud project. When its explicit tracker link is empty, finalized stats can resolve from the latest same-owner Stat Tracker project containing a matching-sport finalized game.

**Why:** The first completed scheduled game can be saved successfully while the page’s tracker link remains empty, otherwise making the first stats invisible even though the cloud payload is correct.

**How to apply:** Preserve owner scoping and sport/status matching for this compatibility path; an explicitly linked tracker project remains authoritative.