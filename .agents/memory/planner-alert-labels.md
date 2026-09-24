---
name: Planner alert labels
description: The visible naming convention for schedule push notifications.
---

Planner push notification titles identify the event type and timing, such as `GAME DAY · IN 1 HOUR`, `PRACTICE · TODAY`, or `TEAM MEETING · CAPTURE OPEN`.

**Why:** The internal reminder type is useful for delivery deduplication but is otherwise invisible to the recipient; the notification must explain its category at a glance.

**How to apply:** Keep the label in the server-generated notification title so the existing service worker, display receipt, click URL, and tag behavior remain unchanged.