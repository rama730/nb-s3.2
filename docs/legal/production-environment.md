# Production legal environment

Configure these server-only values in Railway. Do not prefix them with `NEXT_PUBLIC_`; pages render them on the server.

```dotenv
LEGAL_OPERATOR_NAME=Exact registered legal person or entity
LEGAL_OPERATOR_ADDRESS=Full service postal address
LEGAL_OPERATOR_COUNTRY=India
LEGAL_SUPPORT_EMAIL=support@networkbase.in
LEGAL_PRIVACY_EMAIL=privacy@networkbase.in
LEGAL_GRIEVANCE_OFFICER_NAME=Full name of appointed grievance officer
LEGAL_GRIEVANCE_EMAIL=privacy@networkbase.in
LEGAL_GOVERNING_LAW=the laws of [state] and India
LEGAL_DISPUTE_VENUE=the competent courts in [city], [state], India
```

`LEGAL_GRIEVANCE_EMAIL` is optional and falls back to `LEGAL_PRIVACY_EMAIL`. NetworkBase currently uses the monitored privacy mailbox for both privacy and grievance requests, so a third mailbox is not required. The support and privacy addresses must receive external mail and have a monitored owner and escalation backup. After configuring them, run `npm run check:legal-readiness` in an environment containing the production variables. The check reports missing variable names but never prints their values.
