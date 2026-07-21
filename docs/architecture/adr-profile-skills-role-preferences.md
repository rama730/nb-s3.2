# ADR: Skills-first profiles and durable role preferences

## Status

Accepted

## Context

Profiles previously presented a volatile `available | busy | focusing | offline`
status together with a mixed list of employment and collaboration preferences.
That card hid durable professional information, duplicated preference chips in the
profile header, and could not be moved directly into the desktop rail because the
rail was not rendered on mobile or tablet.

## Decision

- Remove current availability from product contracts, persistence, discovery,
  onboarding, editing, public profile views, and telemetry.
- Keep weekly capacity as an optional durable work preference.
- Use `open_to`, `experience_level`, and `hours_per_week` as the persistence
  adapter for the canonical role-preference model.
- Render Skills first and Open to Roles second in the desktop rail.
- Use one DOM composition whose CSS order places About, Skills, Open to Roles,
  Project Contributions, and utility cards in that order on smaller screens.
- Preserve unrecognized legacy collaboration interests when role preferences are
  edited, but do not label those interests as employment roles.
- Keep project invitations and collaboration-summary data independent of the
  removed Collaboration presentation card.

## Consequences

### Positive

- Visitors see durable expertise and role intent before utility information.
- Mobile and desktop share one accessible content tree.
- Onboarding and Edit Profile consume one role taxonomy.
- Discovery no longer filters or ranks people by a manually maintained presence
  value.
- Restricted profiles do not expose role preferences or weekly capacity.

### Trade-offs

- The existing `open_to` column remains a compatibility-shaped string array.
  A shared adapter is required to distinguish roles from historical collaboration
  interests.
- Old clients may still submit `availabilityStatus`; validation strips this
  unknown field and it is no longer persisted.

## Verification

- Unit contracts cover role normalization, privacy, legacy compatibility, mobile
  ordering, removal of the Collaboration card, and physical schema removal.
- The migration drops `profiles.availability_status` and removes that dimension
  from onboarding telemetry views.
