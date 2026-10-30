---
name: Signed-out auth fixture updates
description: Keep delayed-auth browser fixtures reactive when an unresolved and signed-out user are both null.
---

An auth fixture backed by `useSyncExternalStore` must expose a changing snapshot for auth loading-state transitions, not only the user object. An unresolved user and a confirmed signed-out user both have `user: null`; subscribers will not rerender if the snapshot is just that null value.

**Why:** Returning-home coverage remained blank after confirming sign-out because React saw the same store snapshot even though the fixture's `isLoaded` value had changed.

**How to apply:** When changing auth fixture identity or loading state, increment a revision or use a stable state snapshot with a new identity before notifying subscribers. Cover delayed signed-out resolution as well as delayed sign-in.
