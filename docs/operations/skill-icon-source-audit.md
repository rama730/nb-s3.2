# Skill Icon Source Audit

## Scope

Catalog release `1.3.6` reconciles all nine supplied GitHub repositories. A repository inventory is not imported as a skill list. Only technologies, products, tools, platforms, and operating systems that represent user expertise become canonical skills. Generic UI glyphs, duplicate variants, decorative marks, and repository-owner avatars are provenance material, not skills.

## Source decisions

| Source | Audited commit | License | Use in NB |
| --- | --- | --- | --- |
| `simple-icons/simple-icons` | `99fbe6a82b31d49a37fee878d5fc4f37a53df155` | CC0-1.0 | Primary monochrome brand package, pinned at `16.24.1` |
| `devicons/devicon` | `7330accdbc47e2dc0c19789a48533c4a3c50fe58` | MIT | Primary development-technology package, pinned at `2.17.0` |
| `tandpfun/skill-icons` | `7f7e691e71aec64e8354bf697835e009d1ad80f8` | MIT | Multicolor technology fallback through `@iconify-json/skill-icons@1.2.4` |
| `YuheshPandian/ICONIC` | `dcb8107fd7f903b9f9922e09695c22452a8d360c` | MIT | Selected audited assets for product gaps such as Firefly, CapCut, and Affinity |
| `marwin1991/profile-technology-icons` | `767ebf36092606430fc527b132babacb060dec81` | Not declared | Name and alias discovery only; artwork is blocked |
| `gilbarbara/logos` | `42037415f0df19cd82b3853c18a967a81783f921` | CC0-1.0 | Broad multicolor product fallback through `@iconify-json/logos@1.2.11` |
| `get-icon/geticon` | `fc0f660daee147afb4a56c64e12bde6486b73e39` | CC0-1.0 | Selected audited assets for Assembly, Microsoft Excel, and Adobe Audition |
| `xandemon/developer-icons` | `ac6e9bcc5ad73692cd5637f3bd98c2fe83adadae` | MIT | Current developer and AI product logos through `developer-icons@7.0.1` |
| `glincker/thesvg` | `e25d9e9c43c40f353a5b1c109c9d288d8a4fa16b` | MIT | Selected current product marks are vendored; generic UI artwork remains excluded |

## Resolution rules

1. Match the canonical display name and every reviewed alias.
2. Prefer explicit mappings when a source name differs from the market name.
3. Keep Simple Icons and Devicon ahead of broad fallback collections. Prefer Devicon's multicolor `original` asset, falling back to `plain` only when an original is unavailable or unsafe.
4. Render multicolor Devicon, Skill Icons, Logos, Developer Icons, and curated assets as local background images with transparent containers. Never add a synthetic outline, rectangular backing, or border.
5. Render monochrome Simple Icons assets as masks with the catalog's original brand color in every theme. Never infer a different dark-mode color from luminance.
6. Preserve geometry on child shapes while removing root presentation dimensions, then remove explicit viewBox-sized canvas layers before export. Require one complete SVG root document, scan every generated SVG for executable elements, external references, event handlers, and external CSS URLs, reject surviving canvas backgrounds, and render every SVG through the release gate. Validate reviewed raster exceptions by signature and checksum.
7. Store source, pinned version or commit, checksum, license, and local path in the generated manifest and database migration.
8. Never fetch a skill logo from a third-party host in the browser.
9. Named products without an approved redistributable mark use a deterministic identity badge instead of a misleading category glyph; competencies and methodologies retain semantic icons.
10. Theme switching is opt-in. Only a reviewed official monochrome pair may switch between its light and dark mark; all other brand artwork remains byte-for-byte and color-for-color identical across themes. Protocols such as WebSockets may use a semantic current-color glyph when that is more legible and truthful than a low-contrast pseudo-brand file.

## Catalog inclusion boundary

Repository coverage does not mean copying every filename. Duplicate dark, light, wordmark, and framework variants resolve to one canonical identity. An author or repository-owner logo remains source attribution unless that organization is itself a market skill. Concepts such as AI Agents use semantic icons when no unique product logo exists. User-created long-tail skills use deterministic monograms until catalog review supplies a licensed identity.
