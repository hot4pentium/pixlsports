# PWA and iPhone alignment

The iPhone experience is the reference for shared mobile journeys. Browser-only capabilities, desktop layouts, public links, and separate account boundaries must remain intact.

## Current alignment

| Journey | Shared direction | Verification boundary |
| --- | --- | --- |
| Onboarding and profile | One athlete, editable identity and season, saved time zone | Existing flows retained; no identity or account migration |
| Supporter Hub | Light textured mobile canvas, navy containers, Event Card beside HYPE Card, Game Record followed by Season Stats | Responsive dashboard browser check passes narrow-screen geometry; the later offline-draft failure exposed a missing local-list refresh, now corrected |
| Fan Base | Simple button below HYPE Card opens a separate owner-only details page | Requested tokens must be in the signed-in account’s owned-card list; ambiguous automatic matching requires a choice |
| Player Showcase | One portrait HYPE Card, mobile-style action order, Edit Athlete Details, bounded desktop presentation | Saved renderer, privacy gates and public links retained |
| Prep | Immediate local task changes and background collaborator updates; no routine saving/saved text | Error and retry states remain visible; persistence behavior unchanged |
| Track Stats / Live Taps | Shared tracking terminology and separate athlete/team attribution | Existing game and permission safeguards retained |
| Share | Event details and HYPE Card sharing preserve existing public-link contracts | PWA still uses its existing sharing controls |
| Mobile Event Card tools | Persistent Prep / Track Stats / Share navigation; initial timing-based recommendation with independent selected state | Chromium fixture verifies draft retention, focus, completion gating, and 320–767px reflow; native camera/save behavior still needs a physical-device check |
| Season Stats | Private season history, trends and comparisons available from the dashboard | Existing privacy and attribution boundaries unchanged |

## Remaining differences

- PWA HYPE Card management still has separate Showcase, appearance, and publishing-settings steps; the native owner screen is more consolidated.
- Installed Android offline/relaunch behavior needs a device-level pass. The desktop offline-draft visibility fix has code-level regression coverage, but its complete browser journey has not been rerun.

These are not claims of complete 1:1 parity or of physical Android/iPhone verification.
