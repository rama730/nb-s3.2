# Status Glossary

## Application (`role_applications.status`)
- `pending`
- `accepted`
- `rejected`

`cancelled` is **not** a first-class value in `role_applications.status`.

## Application Lifecycle (derived UI/API state)
- `none`
- `pending`
- `accepted`
- `rejected`
- `withdrawn`
- `role_filled`

Legacy `decisionReason='cancelled'` is normalized to lifecycle `rejected`.

Application lifecycle values are centralized in:
- `src/lib/applications/status.ts`

## Connection request history status
- `pending`
- `accepted`
- `rejected`
- `cancelled`
- `disconnected`

Connection history status values are centralized in:
- `src/lib/applications/status.ts`

## Naming guidance
- Keep action exports suffixed with `Action` for consistency.
- New actions must use the same suffix.
- Do not mix status vocabulary across domains:
  - application state (`pending/accepted/rejected`)
  - application lifecycle (derived timeline state)
  - connection history state (`cancelled` belongs here)
