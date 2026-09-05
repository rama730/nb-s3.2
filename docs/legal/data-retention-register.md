# NetworkBase data-retention register

| Record | Default period or trigger | Disposal | Owner / implementation |
|---|---|---|---|
| Active account, profile, projects and messages | While account/service is active | Account deletion workflow, subject to shared records and lawful exceptions | Product / account deletion jobs |
| Account deletion grace period | 30 days from request | Hard-delete profile, owned data, storage, recovery drafts, and auth identity | Account cleanup + hard-delete jobs |
| Minimal registration/deletion record | 180 days from cancellation request | Automatic anonymisation | Data lifecycle retention job |
| Legal acceptance evidence | Three years from acceptance | Automatic deletion | `legal_acceptances` + data lifecycle retention job |
| Profile-read audit | 30 days | Batch deletion | Data lifecycle retention job |
| Other profile/privacy audit | 365 days | Batch deletion | Data lifecycle retention job |
| Onboarding telemetry | 90 days | Batch deletion | Data lifecycle retention job |
| Extension session events | 180 days | Batch deletion | Data lifecycle retention job |
| Extension recovery drafts | Recent bounded copies; generally 24 hours after clean session and no more than 30 days | Storage/database cleanup | Extension lifecycle jobs |
| Read notifications | About 90 days | Lifecycle deletion | Notification lifecycle job |
| Dismissed notifications | About 30 days | Lifecycle deletion | Notification lifecycle job |
| Stale push subscriptions | About 60 days | Lifecycle deletion | Push lifecycle job |
| Temporary GitHub imports/snapshots | Completion or expiry unless referenced by an active durable operation | Job cleanup | GitHub lifecycle jobs |
| Complaints, removed-content evidence, security and legal holds | Case-specific legal period; preservation hold overrides ordinary deletion | Restricted deletion/anonymisation after hold release | Grievance/privacy lead |
| Account exports | Short-lived delivery period configured on the private export bucket | Storage lifecycle deletion | Infrastructure owner |

The engineering owner must verify each period against production jobs and storage lifecycle rules at every release. A legal hold must be documented, access-restricted, reviewed periodically, and released promptly when no longer required.
