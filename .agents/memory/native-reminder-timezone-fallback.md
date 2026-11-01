---
name: Native reminder timezone fallback
description: Time-zone fallback rules when an account has native push registrations but no browser push subscription.
---

For native-only owners, rechecking a queued one-hour reminder must not assume a web push subscription exists. Use the saved account alert time zone when present; otherwise preserve the event's zone. Day-of reminders still require the saved account zone preference.

**Why:** Native registrations do not carry the per-browser time zone field, so using the web subscription as a required lookup breaks otherwise eligible iPhone-only delivery.

**How to apply:** When adjusting reminder eligibility or rechecks, treat web subscription time zone as a legacy fallback only and keep native-only reminders valid.
