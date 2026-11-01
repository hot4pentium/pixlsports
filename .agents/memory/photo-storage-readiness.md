---
name: Photo storage readiness
description: Why upload verification must include real private storage rather than only injected test doubles.
---

Verify a real private storage write, readback, access policy, and cleanup before considering an upload flow ready. Existing storage code and passing mocked service tests do not establish that a bucket is provisioned and available.

**Why:** Native photo state and authentication requests succeeded while actual uploads failed because private storage had never been configured. Injected storage tests correctly covered application logic but missed the missing infrastructure.

**How to apply:** Use the object-storage setup workflow when provisioning is missing, restart the affected API after configuration changes, and use a tiny synthetic image and temporary fixture to check the real photo service. Remove the fixture and object afterward. Never use an athlete's real image for readiness testing or print credentials and private object paths.
