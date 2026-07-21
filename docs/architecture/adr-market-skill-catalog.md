# ADR: Canonical Market Skill Catalog

## Status

Accepted. Catalog release `1.3.6`.

## Decision

Skills are product entities, not presentation-only labels. A versioned canonical catalog owns identity, aliases, category, type, lifecycle, icon metadata, and relationships. Profile, project, open-role, and contribution assignments use normalized join tables while their existing JSON arrays remain temporary compatibility mirrors.

The browser renders only local, generated assets. Branded SVGs come from pinned Simple Icons, Devicon, Skill Icons, Logos, and Developer Icons packages or from a small reviewed curated-source registry. The current TestFlight app artwork is stored as a checksummed local JPEG because Apple distributes the current app icon as raster artwork. Every asset is validated and stored under `public/skill-icons/v1`; no skill card makes a third-party request. Skills without a licensed, unambiguous brand mark use a reviewed semantic Lucide icon or a deterministic monogram.

## Architecture

1. [catalog.ts](/Users/chrama/Downloads/nb-s3/src/lib/skills/catalog.ts) is the reviewed source definition for market coverage, aliases, categories, and in-memory relationship matching.
2. [generate-skill-catalog.ts](/Users/chrama/Downloads/nb-s3/scripts/generate-skill-catalog.ts) creates browser-safe lookup data, the icon manifest, local SVG assets, and the current-state seed migration.
3. [service.ts](/Users/chrama/Downloads/nb-s3/src/lib/skills/service.ts) is the sole write resolver and dual-write boundary.
4. [matching.ts](/Users/chrama/Downloads/nb-s3/src/lib/skills/matching.ts) is the canonical alias-aware matching boundary for discovery and recommendation logic.
5. [SkillPicker.tsx](/Users/chrama/Downloads/nb-s3/src/components/skills/SkillPicker.tsx), `SkillIcon`, `SkillChip`, and `SkillList` are the reusable presentation system.
6. [repository-detection.ts](/Users/chrama/Downloads/nb-s3/src/lib/skills/repository-detection.ts) is the shared, client-safe dependency and repository-marker detector used by GitHub and folder imports.
7. Migration `0103` owns the normalized schema; `0104` through `0117` are historical catalog seed releases. The current generator writes the latest seed state only; future catalog database changes should be deltas or current-state refreshes rather than another full release replay.

Release `1.3.4` preserves the 1,107 canonical skills, 24 categories, 753 branded mappings, and 708 local assets from `1.3.3`. The exporter now removes reviewed viewBox-sized canvas layers, preserves child geometry, transfers AWS tile paint to the service glyph, and validates every SVG with an actual renderer. Native assets no longer receive a synthetic dark-mode outline, border, or backing. Adobe product marks and AWS service marks therefore render as transparent identities in both themes.

Release `1.3.5` removes inferred dark-mode recoloring. Original brand colors are stable across themes, Devicon prefers multicolor originals, and only reviewed Apple, Anthropic, and OpenAI monochrome pairs may adapt. WebSockets uses a semantic protocol glyph, while Codex and Google Antigravity use fixed transparent color marks.

Release `1.3.6` adds a rasterized light/dark visibility gate for every branded skill render, fixes clipping-definition preservation, introduces upstream light/dark asset pairs such as Next.js, adds reviewed marks for Fivetran, Adobe Analytics, gRPC, GeoServer, and PostGIS, corrects Claude and Claude Code identities, and adds 29 AI and machine-learning skills.

The picker fetches and renders its core catalog as soon as the Skills & Expertise tab mounts. Focus is only an input interaction; it does not control catalog visibility or data loading.

## Identity and lifecycle rules

- `canonical_key` is immutable and is the cross-release identity.
- Display name, alias, icon, tier, and category may change without changing identity.
- Punctuation-sensitive technologies such as `C`, `C++`, `C#`, `F#`, and `.NET MAUI` have distinct identities.
- Unknown user entries are accepted as pending custom skills, rendered with a monogram, and placed in the proposal queue.
- Deprecated or merged skills keep historical assignments and point to a replacement rather than being destructively renamed.
- Branded icons require catalog approval and local asset integrity; remote icon URLs are never rendered.

## Rollout and rollback

The rollout is additive: apply migrations through the current journal; run `npm run skills:backfill -- --apply`; verify assignment counts; and retain JSON mirrors. A rollback disables the catalog-backed UI and reads mirrors; it does not drop assignment tables or delete assignments. Removal of JSON mirrors requires a later ADR after production parity evidence.

## Consequences

- Search and matching become alias-aware and stable across spelling variants.
- Catalog updates are explicit releases with reproducible assets and integrity gates.
- The catalog is broad but not frozen: custom proposals cover the long tail without allowing arbitrary remote assets.
- There is a modest build-time asset and migration cost in exchange for no runtime icon dependency or third-party request.
