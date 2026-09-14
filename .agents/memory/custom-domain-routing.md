---
name: Custom domain routing
description: Replit custom-domain attachment and apex/www redirect behavior for the public web app.
---

Replit does not automatically redirect an apex domain and its `www` hostname. Each hostname must be connected separately in Publishing → Domains, and the canonical redirect must be configured at the registrar or in the app.

**Why:** The deployment service exposes the generated production URL until custom domains are attached, and its documented domain flow treats apex and `www` as distinct entries.

**How to apply:** When making a domain canonical, use the production hostname in page metadata, attach both hostnames, and verify the `www` → apex redirect without changing the Replit development preview.