---
name: Photo storage readiness
description: Why upload verification must include real private storage rather than only injected test doubles.
---

Verify a real private storage write, readback, access policy, and cleanup before considering an upload flow ready. Existing storage code and passing mocked service tests do not establish that a bucket is provisioned and available.

**Why:** Native photo state and authentication requests succeeded while actual uploads failed because private storage had never been configured. Injected storage tests correctly covered application logic but missed the missing infrastructure.

**How to apply:** Use the object-storage setup workflow when provisioning is missing, restart the affected API after configuration changes, and use a tiny synthetic image and temporary fixture to check the real photo service. Remove the fixture and object afterward. Never use an athlete's real image for readiness testing or print credentials and private object paths.

Keep API liveness independent from photo-storage readiness. Routine readiness
checks should be cached and read-only; explicit operator smoke checks must verify
write access and private readback separately.

**Why:** A photo-storage outage must not disable schedule or tracking features.
Repeated synthetic writes on public health requests would create unnecessary
objects and cleanup risks, while a successful read-only probe cannot prove write
permission.

**How to apply:** Gate photo selection on the photo-specific readiness check,
and run the private-image smoke check after provisioning or permission changes.
Verify both application ACLs and denial of unauthenticated storage access; a
private custom ACL alone does not establish that the bucket is not public.
