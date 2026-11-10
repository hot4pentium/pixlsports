# Native menu verification on iPhone

## Verification status
Source checks run on Linux. Xcode compilation, menu rendering, VoiceOver, and physical-iPhone behavior have **not** been verified here. Run the checks below on a Mac/iPhone before release.

## Scope and system limits
- Standard context menus, confirmation dialogs, pickers, and the iOS share sheet are retained.
- App-controlled changes are action labels, SF Symbols, grouping, ordering, accessibility hints/actions, and accent tint on light settings surfaces.
- iOS controls menu geometry, font scaling, animation, destructive red, and whether symbols are shown in a particular confirmation dialog. No custom menu background or global UIKit appearance override is used.
- Prep task deletion still happens immediately, as before. Discarding edits, replacing saved Prep, publishing, sign-out with pending work, and account removal retain their existing safeguards.

## Checks
1. Build the iOS app in Xcode. Run the existing `SupporterEventDetailUITests.testMainPrepCheckoffRowEditsAndDeletesWithoutOpeningManage` test to exercise native Edit/Delete actions and cancellation of a task edit.
2. In both the quick Prep checklist and Manage view, long-press a task. Confirm Edit (pencil) appears before a separated, red Delete (trash) action. Dismiss the menu without choosing; task text and checkoff state must not change.
3. Edit a checked task and cancel; then edit and save. Confirm checkoff state remains unchanged. Delete that task and verify other tasks remain.
4. With VoiceOver enabled, focus each quick and full task row. Confirm named Edit task and Delete task actions are available without long-pressing. Confirm unavailable editing cannot be invoked.
5. Repeat menu opening, selection, and dismissal at the largest accessibility text size, portrait and landscape. Check readable labels and reachable cancellation actions.
6. In Settings and new-account alert onboarding, open Event-day time zone. Confirm the device zone appears once under On this iPhone; other zones appear separately. Select a different zone, return, and verify the saved selection after reopening.
7. Review Settings action icons and blue accents on the light surface. Destructive sign-out/removal actions must remain red. Turn on Increase Contrast and verify labels remain readable.
8. Open Share for a public active HYPE Card. Confirm Share HYPE Card appears before Review HYPE Card and opens the real share sheet. Review opens Player Showcase. Private/paused cards must not become public or gain a share action.
9. Open each publish/identity/recovery/leave/sign-out confirmation that is available. Cancel each first and verify no action occurs. Confirm intended operations only with disposable test data; never delete a real account just to check styling.
