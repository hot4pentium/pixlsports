# Fan card phone release check

This is a **physical-device release check**, not a preview or browser-emulation test. The development build intentionally disables push. A checklist or automated test is not evidence of phone delivery. Run against the **current published build** after publishing the changes under test. Until the device observations below are recorded, the device result is **NOT RUN**.

## Preparation and privacy

1. Find the current published origin in Publishing; do not use a `.replit.dev` preview, localhost, or a guessed URL. Confirm the published page has **Follow on this device**, **Game Day Live starts**, **A scheduled event begins**, and **How to add to home screen** / **Add to home screen**. If not, publish the intended build before proceeding. Check `GET <origin>/api/notifications/config` returns `available: true` (public key only). If unavailable, stop and record **BLOCKED**; do not treat disabled push as a passing case.
2. Use a disposable signed-in **owner test account**, two distinct test athletes A and B, separate unpaused public fan cards with schedule visibility enabled, and test schedules in the owner's intended IANA time zone. Use harmless test names. Do not use a real family's card. Have a supported Android phone (Chrome with notifications enabled) and an iPhone with a supported iOS version (Safari, installed Home Screen web app, notifications permitted). Record device OS/browser versions and phone time zone; make sure notification settings and Focus/Do Not Disturb will not hide results.
3. Keep the two `/fan/<invite-token>` links, follow tokens, browser push endpoints, device screenshots showing URLs, and owner credentials **off** the run sheet, commits, console output, and issue reports. Share links privately with the device tester; redact tokens before saving evidence. Use a fresh test browser profile if possible. Do not enter the owner account credentials on fan devices.
4. Confirm the published fan manifest for each card on a trusted device or workstation using its private link: `GET /api/athlete-invites/<invite-token>/manifest.webmanifest`. Its `id` and `start_url` must end in `/fan/<that same invite-token>`, and A and B must have **different** IDs. Do not paste the full response or URL into the run record. Check on the current published origin, not only a locally mounted `/preview` route.

## Run record (copy for each published build)

| Field | Observation (no tokens or credentials) |
| --- | --- |
| Date, tester, published build identifier (not private URLs) | |
| Android model, OS, Chrome version / notification settings | |
| iPhone model, iOS version, Safari version / installed-app notification settings | |
| Owner schedule time zone and phone time zones | |
| Published notification config available; distinct manifest IDs and correct starts | |
| Android A/B shortcut opening and iPhone A/B shortcut opening | |
| A/B live choices and observed sends / click destinations | |
| A/B scheduled-event choices, expected local times, observed times / counts | |
| Unfollow, opt-out, pause, live stop, account deletion: expected windows and observed counts | |
| Cleanup (shortcuts removed, test account deleted, test notifications cleared) | |
| PASS / FAIL / BLOCKED / NOT RUN, redacted reproduction details | |

## 1. Install and independent choices

1. Open **A** in Android Chrome and iPhone Safari directly from the private link. Use **Keep this card close** to install/add it to the Home Screen. On iPhone use Safari Share → **Add to Home Screen** → **Add**; open the icon, not the Safari tab. Repeat for **B**. Give icons distinct labels if the OS offers it. Close browser tabs, launch each icon independently, and require A opens A and B opens B, with the corresponding athlete name visible, on **both** phones. A wrong card or a generic landing page is FAIL. If the OS refuses to install, record BLOCKED and why; a bookmark is not an installed-PWA pass.
2. Tap **Follow on this device** for each athlete. Following alone must not request notification permission or deliver anything. On the installed iPhone app and Android browser/app, enable **Game Day Live starts** for A and **A scheduled event begins** for B. Grant the permission prompt deliberately; verify A shows live on/event off, B shows live off/event on. Close and reopen both, including from their shortcuts; the choices must persist separately. Do not accept a permission denial as a delivery pass.
3. From the owner test account, start a new Game Day Live session for A. Require exactly one live notification on each opted-in phone, containing A's name. Tap it: it must open A's fan card, not B or the owner page. B must receive no live notification. Refresh or reconnect the owner page; the same session must not generate a second notification. End the live session before the next case.
4. Set one upcoming B schedule event with a unique ID at least several minutes in the future in the owner's saved schedule and publish/share that schedule to B's fan card. Note the **owner's schedule time zone**, the event's displayed local start, and the equivalent time in each phone's time zone (which may differ). The background job checks once a minute during the first three minutes after local event start; allow normal push-network latency beyond that window. Require exactly one B event notification per opted-in phone at/after the expected instant and no A event notification. Tap it to verify B's card. Keep both phones locked or app in background during the scheduled start; an open tab does not demonstrate OS push delivery. Reopen after the grace window: no duplicates. If testing time-zone conversion, use a phone in a different time zone rather than changing the scheduled event's intended time zone.

## 2. Stop cases (fresh event or session for each case)

Do not count the notification from a previous case as a stale alert. Clear the OS notification tray between cases. Schedule each new event far enough ahead to finish the stop action **before** its start; wait beyond the start plus the three-minute job window and allow for network delay. A notification already handed to the push service before the stop is not proof of a post-stop send: note the action and receipt times.

| Case | Action before send | Expected observation |
| --- | --- | --- |
| Unfollow | On B, turn off following while an event alert is still enabled; reopen B and verify unfollowed. | No B notification at the new event start; A's settings remain unchanged. |
| Opt out | Follow B again, enable event alerts, then uncheck **A scheduled event begins**; reopen and verify off while still following. | No B event notification. A's live setting stays on. |
| Pause | Re-enable B event alerts, then pause B's fan card from the owner controls before a fresh scheduled event. | No B event notification during the pause. Resume only after the window ends. |
| Live stop | With A live alerts enabled, stop A's live session, then refresh/reconnect the owner view; do not start a new session. | No later or repeated notification for that stopped session. Record any notification that arrived before stop separately. |
| Account deletion | With the disposable owner account and an opted-in B event scheduled in the future, use the app's normal **delete account** flow before start. | No notification after deletion; the private test account and its cards are no longer accessible. **Never do this with a real account.** |

For each stop case, record the stop action time, expected send time, last time checked, count, and whether the UI still showed the changed choice after reopening. If the action failed or happened too late, mark the case **NOT RUN** and retry with a new event/session; do not silently claim success. A delivered alert after a confirmed, timely stop is FAIL, with redacted device/OS info, alert title, timestamps/time zones, and exact reproduction steps. Never attach a real fan's push endpoint or credentials.

## Result rule and cleanup

**PASS** requires both physical phone platforms, both athlete-specific shortcuts, opt-in-only once-per-event live and scheduled delivery, independence on one browser, and every stop case. Record **NOT RUN** for any unobserved case, **BLOCKED** for unavailable published push/device/setup, and **FAIL** for an observed mismatch. Local API tests and manifest preflight checks are supporting evidence, not substitutes for phone observations. Delete only disposable test data and remove the test shortcuts/subscriptions when done; redact evidence before sharing.