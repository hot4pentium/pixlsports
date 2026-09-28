---
name: Push display receipts
description: Web Push can acknowledge OS display acceptance from the service worker, but cannot prove the user saw or read the notification.
---

Planner push payloads may carry a delivery identifier. After `showNotification()` resolves, the service worker can post a receipt tied to its exact subscription endpoint; the server should record this as display acceptance, not user engagement.

**Why:** Web Push has no server-side read or visible-screen confirmation. A service-worker receipt is the strongest practical signal while the app is closed, and endpoint matching prevents unrelated subscriptions from claiming a delivery. A production iPhone Home Screen check eventually displayed a Game On alert after the provider had accepted it, despite an earlier successful test alert and no immediate Game On banner.

**How to apply:** Keep receipt handling unauthenticated but bound to the opaque delivery ID and registered subscription endpoint, retry briefly for send/insert races, and keep user-click confirmation separate through `notificationclick` if needed. When diagnosing a missing alert, account for queue batching and delayed OS presentation before calling an accepted push a delivery failure; never blindly resend a possibly delivered notification.