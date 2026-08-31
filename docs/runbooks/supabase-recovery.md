# Supabase logical recovery runbook

This repository does not treat the Free-plan project as a backup. An approved operations owner must keep encrypted `pg_dump --format=custom` exports outside Supabase and outside this repository.

For every environment:

1. Export on the approved schedule with a read-only backup credential; never use the application runtime role.
2. Record environment, UTC start/end, PostgreSQL version, dump checksum, encrypted destination, retention expiry, and operator/job identity.
3. Restore into an isolated disposable project with the matching PostgreSQL major version.
4. Run `check:db:migration-journal`, `check:db:live-lineage`, `check:db-catalog-drift`, and the application smoke tests against the restored project.
5. Record restore duration, verification results, and deletion of the disposable project.

No production restore is authorized by this document. Production recovery requires explicit incident approval, a selected recovery point, and a second-person verification of the target project.
