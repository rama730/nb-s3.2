# NetworkBase legal launch checklist

The public documents are implementation templates, not a substitute for advice from counsel in the operator's jurisdictions. Complete this checklist before promoting the service publicly and after any material product change.

## Required identity and channels

- Set every `LEGAL_*` variable documented in `docs/legal/production-environment.md` in Railway.
- Use the operator's exact registered legal name and full service postal address.
- Name the individual grievance officer and obtain their approval to publish the role.
- Create and monitor `support@networkbase.in` and `privacy@networkbase.in`; route grievances to the privacy mailbox unless a dedicated address is later configured.
- Run `npm run check:legal-readiness` in the production environment.

## Product and policy verification

- Confirm `/privacy`, `/terms`, `/eula`, `/acceptable-use`, `/cookies`, `/subprocessors`, `/copyright`, `/grievances`, `/security-reporting`, `/dpa`, and `/open-source` return 200 without authentication.
- Confirm `/robots.txt`, `/sitemap.xml`, and `/.well-known/security.txt` return 200 and contain `networkbase.in` URLs.
- Test required acceptance for email signup and Google signup; verify a `legal_acceptances` row contains versions, time, context, and hashed evidence.
- Confirm Settings shows the current acceptance status and account export contains the acceptance history.
- Confirm every project exposes the final Privacy & terms tab to owners, members, and visitors.
- Compare the subprocessor list with production secrets, network traffic, storage providers, email/push services, monitoring, and AI configuration.
- Confirm Google OAuth branding, authorised domain, redirect URI, home page, Privacy Policy, and Terms links match `networkbase.in`.
- Confirm Cloudflare TLS mode is Full (strict), HTTPS redirects are enabled, DNS is correct, and Railway health checks pass.

## Governance

- Obtain counsel review for governing law, venue, liability cap, indemnity, intermediary duties, consumer law, and cross-border transfers.
- Record the approval date, approver, policy versions, and deployment commit.
- Re-run this checklist when data categories, providers, AI use, public visibility, billing, age eligibility, or countries served change.
