# Owner HYPE Card offline checks

Run on an Apple simulator/device with the configured native account. These are
device checks, not checks that the Linux source-test runner can perform.

1. Load the owner's HYPE Card once while PIXL is reachable, including its photo.
   Close the app, disable networking, and reopen it. Open HYPE Card: the complete
   saved card and photo should appear without waiting for a network request.
2. Repeat with both a public card and a hidden/paused private card. Private
   preview access must not publish the card or create a share link.
3. Offline, change settings and tap Save. Expect a saved-on-this-iPhone message,
   not a false cloud-save confirmation. Close/relaunch and verify the choices
   remain editable. Reconnect and tap Save to sync them.
4. Change the server settings from a second device before syncing the first.
   The first device must retain its choices and request an explicit conflict
   choice rather than overwrite the second device's changes.
5. With networking enabled, make the API unreachable. A previously saved card
   and photo must remain visible. An unconfirmed in-flight save must still
   require checking saved status before another cloud write.
6. Sign out or switch accounts. The old owner's card/photo/settings must not
   appear for the new account. A public recipient route must not read the
   signed-in owner's private offline preview.
7. On a fresh install with no saved card, offline mode should explain that a
   first successful connected load is needed; it must not fabricate a card.
