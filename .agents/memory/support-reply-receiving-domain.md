---
name: Support reply receiving domain
description: Resend receiving-domain choice for customer replies to Pixl Sports support tickets.
---

Use a Resend-managed `*.resend.app` domain or a dedicated subdomain for ticket reply addresses. Do not point the root `pixlsports.com` MX records at Resend; the root domain already receives regular support mail.

**Why:** Receiving MX records at the root could interrupt normal mail delivery to `support@pixlsports.com`.

**How to apply:** Configure the selected inbound domain separately from the support sender domain, then register the `email.received` webhook to the production support-reply endpoint.
