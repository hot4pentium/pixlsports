# PIXL Sports

PIXL Sports helps youth-sports families manage schedules, game-day tools, athlete stats, and HYPE Cards across the web app and native iPhone app.

## Run & Operate

- Replit manages the Studio preview and API workflows. Use `artifacts/league-matrix-studio: web` for the web app and `artifacts/api-server: API Server` for its API.
- `pnpm install --frozen-lockfile` — install workspace dependencies
- `pnpm run typecheck` — canonical full-workspace typecheck
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `DATABASE_URL` is provided by Replit for the development PostgreSQL database; do not copy its value into project files.
- Web account-linking page: `/connect/iphone`
- The development database schema has been initialized for `iOS-supporter-home`. Never run the development schema push against production.
- `NATIVE_IOS_CLERK_ISSUER` is configured for development in `.replit`; it must point to the dedicated iOS Clerk instance, not the PWA's Replit-managed Clerk instance.
- Native iOS builds and simulator testing require Xcode on a Mac. Follow `ios/README.md` to configure the local `ClerkConfig.plist`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite for web artifacts; esbuild for the API server

## Where things live

- `ios/` — native SwiftUI iPhone app and Mac setup/verification instructions
- `artifacts/league-matrix-studio/src/pages/NativeAccountLinkPage.tsx` — web-side iPhone connection and approval flow
- `artifacts/api-server/src/routes/nativeAccountLink.ts` and `src/lib/nativeAccountLink.ts` — native/web link API and service
- `lib/db/src/schema/nativeAccountLinks.ts` — account-link database schema
- `lib/api-spec/` and `lib/api-zod/` — API contract and generated validation/client types

## Architecture decisions

- Web and Android continue to use the Replit-managed Clerk tenant; the native iPhone app uses a separate Clerk instance.
- Account linking requires explicit approval on the web and confirmation on the iPhone. Do not match accounts by email or silently replace a link.
- Disconnecting removes the identity link only; it does not delete either account or its saved data.
- First-time iPhone signup verifies the dedicated iOS Clerk user through the server-side Clerk connector. It creates a new backing managed-tenant owner only for an unused verified email, then commits free supporter access and its native mapping together. Existing or deliberately disconnected accounts still require explicit linking; email matching is never permission to attach existing data.
- Development schema changes are applied to the development database. Production schema changes follow Replit's Publish flow.

## Product

The web app supports youth-sports family planning and athlete tools. The native iPhone app has its own sign-in, Supporter Home, private Event Cards, and athlete tools. New iPhone users can create their PIXL account and complete athlete setup without visiting the PWA. Existing accounts retain the approved two-sided linking flow.

## User preferences

Keep the existing PWA sign-in and build native iOS sign-in separately; do not migrate the web app's authentication.

## Gotchas

- The iPhone app's `ClerkConfig.plist` needs the dedicated iOS publishable key and a debug API origin. Keep the key out of chat and do not use the PWA Clerk key.
- Replit runs Linux, not Xcode or an iOS simulator; complete native build and device-flow verification on a Mac.
- The full typecheck currently stops on syntax errors in the unrelated `artifacts/api-server/src/routes/supportTicketEmailReplies.test.ts` file.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `ios/README.md` for native iPhone configuration, account-linking steps, and Mac verification
