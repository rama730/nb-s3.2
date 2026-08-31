# Market Skill Catalog Operations

## Release workflow

1. Edit [catalog.ts](/Users/chrama/Downloads/nb-s3/src/lib/skills/catalog.ts). Preserve existing canonical keys.
2. Update the catalog version and pinned icon dependency only as an intentional release.
3. Run `npm run skills:generate`.
4. Review the generated current-state seed artifact, icon-manifest diff, brand colors, source URLs, and license metadata.
5. Run `npm run check:skills:catalog`, `npm run typecheck`, the unit tests, and database migration-source checks.
6. Apply catalog changes through the normal database rollout path. Future catalog migrations should be deltas or current-state seed refreshes, not another replay of every prior release.

Generation is deterministic for a given catalog and dependency version. Generated SVGs must be a single complete SVG document, use the approved safe-shape subset, pass the unsafe-content scanner, and match their manifest checksum. Reviewed raster exceptions must pass file-signature and checksum validation. Simple Icons is pinned at `16.24.1`, Devicon at `2.17.0`, Skill Icons at `1.2.4`, Logos at `1.2.11`, and Developer Icons at `7.0.1`. Every curated asset records its exact source and license metadata.

## Initial rollout

1. Apply `0103_market_skill_catalog`.
2. Deploy the generated client catalog and icon assets with the application release. Historical database catalog migrations remain unchanged.
3. Preview legacy assignment volume with `npm run skills:backfill`.
4. Apply in batches with `npm run skills:backfill -- --apply`.
5. Run `npm run check:skills:assignments` to compare JSON mirrors with normalized assignments for profiles, projects, roles, and contributions.
6. Watch skill-search latency, custom-skill proposal volume, resolver errors, missing-icon fallbacks, and assignment write failures.

The backfill is idempotent. Each owner is handled transactionally: the normalized assignments and its JSON compatibility mirror move together.

## Moderation

- New custom labels are private-to-normal-product behavior immediately but enter `skill_proposals` as `pending`.
- Reviewers either accept a distinct skill, merge it into a canonical skill, reject it, or hide it from new selection.
- A merge migrates assignments before marking the old skill `merged`; historical labels must remain resolvable through aliases.
- Never attach an uploaded or remote SVG to a proposal. Icon changes go through catalog generation and approval.

## Monitoring thresholds

- Catalog integrity or checksum failure: rollout blocker.
- Resolver or assignment write errors above 0.5% for five minutes: page engineering and stop rollout.
- Skill search p95 above 250 ms: inspect index use and API cache hit rate.
- Missing icon fallback above 10% for core-tier skill impressions: review manifest coverage.
- Repository imports returning the 24-skill ceiling unusually often: review signal ordering and suppress low-value package markers before raising the limit.
- Custom proposal duplication above 5%: expand aliases before adding more canonical entries.

## Release 1.3.7 checks

- Expected minimums: 1,100 skills, 25 categories, and 740 approved branded mappings. Current generated values are 1,170 skills, 25 categories, and 780 branded mappings backed by 745 unique local assets.
- Confirm Scientific Computing & Engineering contains COMSOL Multiphysics, ANSYS, LabVIEW, Wolfram Mathematica, GNU Octave, KiCad, LTspice, FreeCAD, Autodesk Revit, Rhinoceros, Siemens NX, and the supporting simulation, CAD/CAE/CAM, systems, and engineering-domain skills. The 13 branded tool marks must resolve locally; the remaining tools and concepts must use their deterministic semantic fallbacks.
- Confirm Figma, Docker, GitHub, GitHub Actions, Chrome Extension API, and MiniLM resolve to local branded assets.
- Confirm HTML and Bash resolve through Simple Icons; Java, PowerShell, and Azure through Devicon; AWS through Skill Icons; Amazon RDS and Lambda through compact Logos service marks; Amazon Bedrock, AutoGen, and Chroma through reviewed curated assets.
- Confirm the Adobe product family, Adobe Analytics, Fivetran, gRPC, GeoServer, PostGIS, Aurora, Redshift, Db2, Beam, Great Expectations, Vertex AI, Groq, and the AWS service rows resolve to local brand assets rather than category glyphs. WebSockets intentionally uses the semantic Network protocol glyph. Named products without a licensed reviewed mark render a deterministic identity badge; concepts such as AI Agents retain explicit semantic fallbacks.
- Open Edit Profile directly on Skills & Expertise and confirm results are visible before search focus. Repeat after changing category, clearing search, selecting a skill, and reaching the assignment cap.
- Confirm `VS Code`, `Vector Database`, `Drizzle`, and embedding-model phrases resolve to their preferred canonical identities.
- Confirm GitHub imports add GitHub as the source platform and package/folder analysis can return more than six, but no more than 24, canonical skills.
- In light and dark mode, confirm Simple Icons and all multicolor/native assets retain their original catalog colors. Confirm only the reviewed Apple, Anthropic, and OpenAI monochrome marks switch to their explicit white dark-theme treatment.
- Confirm Adobe After Effects, Amazon Bedrock, TestFlight, Codex, Google Antigravity, LangSmith, Langfuse, and Amazon Q Developer render from local reviewed assets.
- Confirm SolidJS, MATLAB, and PowerShell use Devicon's multicolor `original` assets; Codex remains blue and Google Antigravity remains a transparent multicolor mark in both themes.
- Confirm Mobile includes the Apple and Android distribution toolchain, AI includes agent protocols and current model platforms, Developer Tools includes agentic coding platforms, and Operating Systems includes Linux, Apple platforms, Windows Server, and major Linux distributions.
- Curated, Devicon, Skill Icons, Logos, and Developer Icons assets render at full size with transparent containers and no card, synthetic outline, border, or white backing. The generator removes explicit viewBox-sized canvas shapes, keeps child dimensions intact, and promotes a removed AWS canvas paint onto its white service glyph. Simple Icons remain monochrome masks tinted by catalog brand color.
- Confirm every exported SVG passes real renderer validation and the catalog gate rejects malformed markup or a surviving explicit canvas background.
- Confirm the picker request includes the catalog version so an older CDN response cannot survive a catalog deployment.
- Review [skill-icon-source-audit.md](/Users/chrama/Downloads/nb-s3/docs/operations/skill-icon-source-audit.md) before adding a source or changing its integration mode.

## Recovery

If the API cannot read the migrated tables, static core search and local icon rendering remain available. If writes fail, stop the rollout and use the JSON mirrors for reads while the additive schema is repaired. Do not drop catalog tables during recovery; preserve proposal and assignment history.
