# Athlete setup completion — Apple runtime checks

The Node source checks only verify wiring. Use an Apple SDK and the native app
to validate actual requests and presentation. Use new test accounts and fictional
athlete details; never delete or repurpose an existing family's account.

1. Sign up with a new iOS test identity and finish athlete setup.
   Confirm the dashboard remains visible after the setup sheet dismisses and the
   post-dismiss refresh completes. Background/foreground and relaunch: the same
   athlete must remain, without another blank setup form.
2. Repeat with a delayed profile GET that captured the pre-save blank profile.
   Release it after the successful PATCH receipt. It must change neither the
   dashboard's profile nor its protected cached profile. Repeat with a delayed
   GET failure: no setup/error screen may replace the successful dashboard.
3. Start with a protected cache containing the old unfinished profile, while the
   server already has completed setup. Launch connected: hold the initial loading
   state until the profile refresh confirms completion; do not reopen setup.
4. After a confirmed setup save, disconnect and relaunch within the offline lease.
   The saved athlete must appear without another setup requirement.
5. Fail the PATCH without a success receipt. Stay in the setup form with the
   entered fields and retry message. Do not mark setup complete or cache an
   optimistic success.
6. Switch or unlink accounts while a profile request is waiting. Its completion
   must not populate the new account or restore its predecessor's cache.
7. Let the server commit setup but drop its PATCH reply. Relaunch connected and
   separately retry Continue. The existing athlete/card must be recovered without
   duplicate cards or a permanent blank setup loop.
