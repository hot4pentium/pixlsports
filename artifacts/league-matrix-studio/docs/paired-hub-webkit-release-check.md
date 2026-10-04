# Paired mobile Hub cards: browser checks

## Reproduce

The Nix environment needs `webkitgtk_4_1`, `mesa`, and `xorg.xorgserver`.
Chromium is used for the existing paired-card regression and native touch checks.

```sh
pnpm --filter @workspace/league-matrix-studio exec tsx --test \
  --test-name-pattern='paired mobile Hub cards|mobile Calendar and saved HYPE Card' \
  src/features/supporter-dashboard.browser.test.ts
pnpm --filter @workspace/league-matrix-studio typecheck
```

## Coverage and platform limits

- Linux WebKitGTK/MiniBrowser 2.48.3, not Apple Safari.
- Same-origin fixture iframe with actual CSS client widths of 320, 360, 390,
  and 430px. GTK's desktop window minimum is too wide for these checks.
  Only a one-pixel `innerWidth` rounding difference is accepted.
- Classic, Gallery, Spotlight, and Breakout: equal paired columns, no horizontal
  page overflow, 5:7 card proportions, and native HTML/SVG artwork.
- Premium SVG viewBox proportions and maximum-scale/upward-offset cutouts:
  images extend above the SVG; their enclosing wrappers must not clip them.
- Classic container-unit names scale with card width; container units are
  supported, without falling back to the full-card viewport-sized typography.
- Long event opponent and location details wrap inside the Calendar column.
- Loading, empty, wrong-athlete, paused, hidden, and failed-fetch states
  preserve the row at each width and do not show stale artwork.
- A native retry click recovers the failed-fetch state.
- WebKit native keyboard Enter opens Calendar details and the HYPE destination;
  Escape closes Calendar details. Native mouse clicks also open both.
- Chromium native touch events open Calendar details and the HYPE destination.
  GTK accepted touch pointer actions without activating the controls, so those
  actions are **not** claimed as WebKit touch verification.
- Actual iPhone Safari was not available. Apple touch behavior, device viewport
  handling, and Safari-specific browser UI remain unverified.

## Authentication and evidence

The isolated WebKit fixture uses the existing account-lifecycle browser auth
alias with an explicit fictional owner. It never modifies the managed app's
Clerk provider, access checks, routes, or API authentication. These are component
fixture results, not screenshots of a real signed-in account.

The tests save 320px and 390px WebKit screenshots for all four designs under
`/tmp/supporter-hub-webkit-{design}-{width}.png`. These are local test evidence,
not published customer media.

The long fixture athlete name can extend beyond premium artwork nameplates.
That is a separate native-artwork text-fit issue, rather than unequal Hub
columns or clipped cutouts, and should receive its own regression coverage.