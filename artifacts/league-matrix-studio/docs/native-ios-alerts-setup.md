# Native iOS Event Card alerts

The iPhone app uses Apple Push Notification service (APNs). It does not reuse
the PWA's VAPID/browser push subscription. Reminder preferences are shared with
the linked PIXL account: one-hour alerts use the event time zone, and event-day
alerts arrive at 7:00 a.m. in the account's selected alert time zone.

## Apple setup

1. Enable Push Notifications for the `com.pixlsports` app identifier in the
   Apple Developer account.
2. Create an APNs authentication key and keep the downloaded `.p8` file private.
   Apple only offers the file for download once.
3. Add the APNs settings to the Replit environment:
   - `APNS_AUTH_KEY`: the full `.p8` private-key contents, stored as a secret.
   - `APNS_KEY_ID`: the key identifier from Apple Developer.
   - `APNS_TEAM_ID`: the Apple Developer team identifier used for signing.
   - `APNS_TOPIC`: `com.pixlsports`.
4. Use Xcode automatic signing with the same team and refresh the development
   provisioning profile after enabling the Push Notifications capability.

Debug Xcode builds register sandbox tokens; App Store/TestFlight builds register
production tokens. The API selects Apple's matching endpoint for each token.

The settings screen reports when APNs credentials or the scheduled reminder
runner are unavailable. Do not enable a token registration in the app until the
server reports APNs as available.
