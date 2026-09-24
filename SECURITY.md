# Security policy

CreatorJobs is pre-launch and **not approved for real-customer onboarding**.
There is no supported production release or guaranteed response SLA yet.
Known work is tracked in the [readiness ledger](docs/PRODUCTION_READINESS_EXECUTION.md).

## Reporting

Do not put credentials, customer data, or actionable exploit details in public
issues. Use GitHub private vulnerability reporting if enabled. Otherwise contact
the maintainer through their GitHub profile to request a private channel first.
Do not assume the application's support address is a monitored security inbox.

Include the affected commit, minimal reproduction on your local instance, expected
and actual behavior, and impact. Use synthetic accounts/redacted logs. Do not test
third-party providers or hosted instances without authorization.

## Publication checks

- Keep real environment files, private keys, provider credentials, and database
  files out of Git history. Templates contain placeholders only.
- Scan the tracked snapshot **and history**. Removing a secret later does not
  remove earlier copies.
- Exceptions must match a specific reviewed nonsecret value and location. Never
  exclude whole test directories, docs, or credential classes.
- If a real credential is found, stop publication and arrange revocation/rotation
  with its owner. Never silently rewrite history or assume a removed key is invalid.
- Public history includes author/committer metadata. Preserve genuine attribution.

The [publication checkpoint](docs/PORTFOLIO_PUBLICATION.md) records scope and
limitations. Scans cannot prove the absence of all sensitive material, and public
source is not a production-security certificate.
