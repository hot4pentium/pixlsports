# PIXL Sports: iOS-First Access Model

## Recommendation

Make the native SwiftUI iPhone app the only near-term mobile development target. Use the existing PWA and web workspace as the reference for product behavior, visual direction, content, and API contracts; implement the iPhone experience natively rather than embedding the React site.

Keep the public landing page and signed-in web workspace available while iOS coverage grows. Do not remove PWA installation, web sign-in, or account-link approval as part of this plan. Revisit family-facing web access only after the necessary workflows have native equivalents and the user approves that change. Do not start a separate native Android app now.

## Product surfaces and current responsibilities

| Surface | Current purpose and capabilities |
| --- | --- |
| Public website | Signed-out visitors see the marketing landing page. Signed-in visitors are routed to the Studio. Keep the landing page public. |
| Signed-in web workspace | The existing React/Vite product for setup, creation, and management. It includes Event Card/schedule work, the full Stat Tracker, HYPE Card editing and publishing, and other supporter tools. Its schedule-aware Message Board guides the supporter toward the next preparation, live-event, or post-game task; it is distinct from Shoutouts & Replies. |
| Installable PWA | The same web app, made installable with a web manifest and production service worker. It is not a separate codebase or a third client UI. Its offline shell and browser push behavior are web-specific. |
| Native iPhone app | SwiftUI supporter experience: verified account linking, private schedule, Event Card details, family Live Taps, and the HYPE Card front with its favorite moment. Its home screen already pairs a time-aware game-day Message Board with the HYPE Card. The board’s labels change with event timing, but the selected action still opens Event Card details rather than always taking the supporter directly to the next full task. |

### Web workflows that still matter to iPhone users

- **Create and manage Event Cards:** the iPhone schedule can display existing cards, but creation and broader schedule management remain in the web workspace.
- **Record game statistics:** the full Stat Tracker remains a web flow. Live Taps are cheers and are not a replacement for player stats.
- **Design and publish HYPE Cards:** the native screen displays the card front; editing, publishing, and other creator controls remain on the web.
- **Link the existing PIXL account:** the iPhone starts the verified link request, but approval opens the signed-in PIXL website at `/connect/iphone`. Both sides confirm the link; matching email addresses do not link accounts.
- **Complete the Message Board’s next task:** preserve its schedule-aware preparation/live/post-game guidance, distinct from Shoutouts & Replies. The iPhone hero already represents this guidance; verify that each state routes to the intended action as native Tracker and sharing flows become available.

These are current gaps, not a commitment to rebuild every creator/admin feature in SwiftUI. The web workspace can remain useful for setup and management even if the iPhone app becomes the primary family-facing mobile product.

## Billing and visual maintenance

- A source scan found no checkout or store-billing integration for Stripe, Apple in-app purchases, Google Play Billing, or RevenueCat. Existing access or paid-account checks do not by themselves mean a payment flow is integrated. There are not currently three app billing systems to maintain in this code.
- Do not add native purchases as part of the iOS-first work. If PIXL later sells digital features inside native apps, check the then-current store policies and choose an entitlement model before implementing purchase flows.
- There are currently two interface implementations to consider: the web/PWA interface and the SwiftUI interface. They can share PIXL’s brand, content, assets, information hierarchy, and API behavior, but web React/CSS does not become SwiftUI code.
- Keep the native app recognizable as PIXL without requiring pixel-for-pixel parity. Use iOS navigation, safe areas, accessibility, and Dynamic Type where they improve the native experience. Not building a separate Android client avoids adding a third UI implementation.

## Staged transition

### 1. Focus development on iPhone

- Implement new mobile work in the existing SwiftUI project.
- Use the PWA to understand existing user journeys, terminology, visual direction, and server behavior.
- Keep the landing page, web workspace, PWA installation, sign-in, and account-link approval unchanged.
- Do not add a native Android project or store billing.

### 2. Fill the family-facing native gaps that matter

Prioritize native workflows based on real family use, including the full Tracker handoff, the full HYPE Card viewing experience, and Event Card creation when needed. Preserve the Message Board’s next-task guidance and the separation between cheering and recording stats. Do not move creator/admin tools into iOS merely for visual parity.

### 3. Decide what web access should remain

Before reducing family-facing web access, confirm that the iPhone app supports every required family journey and that account linking no longer depends on an unavailable web approval page. Decide separately whether the Studio remains as a creator/admin workspace.

Keep access unchanged until that review is complete and the user explicitly approves a change. The public landing page can remain even if the future signed-in access model changes.

### 4. Revisit Android only if needed

There is no native Android target in the current repository. If Android becomes a priority, make a separate product decision then; this plan does not add an Android build or treat SwiftUI as portable to Android.

## Change boundary

This document is a product/access plan only. It does not disable PWA installation, remove web routes, change authentication, add payments, or alter any app code.

## Current implementation references

- iOS home and paired game-day/HYPE cards: `ios/PIXL Sports/ContentView.swift`, `ios/PIXL Sports/NativeHomeHeroCards.swift`
- iOS account link, Event Card detail, Live Taps, and HYPE Card: `ios/PIXL Sports/NativeAccountLinkView.swift`, `ios/PIXL Sports/SupporterEventDetailView.swift`, `ios/PIXL Sports/SupporterLiveTapsView.swift`, `ios/PIXL Sports/SupporterHypeCardView.swift`
- Web landing and app routing: `artifacts/league-matrix-studio/src/app-entry.tsx`, `artifacts/league-matrix-studio/src/App.tsx`
- Web Message Board, Tracker, and HYPE editor: `artifacts/league-matrix-studio/src/features/supporter-dashboard.tsx`, `artifacts/league-matrix-studio/src/features/supporter-event-guidance-message-board.tsx`, `artifacts/league-matrix-studio/src/features/stat-tracker-page.tsx`, `artifacts/league-matrix-studio/src/features/hype-card.tsx`
- Web account-link approval and PWA install shell: `artifacts/league-matrix-studio/src/pages/NativeAccountLinkPage.tsx`, `artifacts/league-matrix-studio/public/manifest.webmanifest`, `artifacts/league-matrix-studio/public/sw.js`, `artifacts/league-matrix-studio/src/main.tsx`
