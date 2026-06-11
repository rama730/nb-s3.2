import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    buildProjectReadmeExcerpt,
    buildProjectReadmePlainText,
    buildProjectReadmePublishMetadata,
    extractProjectReadmeHeadings,
    normalizeProjectReadmeSettings,
    resolveProjectReadmePermission,
} from "../../src/lib/projects/readme";
import { evaluateProjectReadmeQuality } from "../../src/lib/projects/readme-quality";
import {
    buildInlineReadmeReference,
    parseProjectReadmeInlineReferences,
    parseProjectReadmeSmartBlocks,
    replaceInlineReadmeReferencesWithMarkdown,
    splitMarkdownByInlineReferences,
    splitMarkdownBySmartBlocks,
} from "../../src/lib/projects/readme-blocks";
import {
    buildProjectReadmeCommandTargetMaps,
    buildProjectReadmeRailReport,
    extractProjectReadmeCommandShortcuts,
} from "../../src/lib/projects/readme-quick-console";
import {
    projectReadmeCommandBlockId,
    projectReadmeCommandLineTargetId,
    projectReadmeReferenceTargetId,
} from "../../src/lib/projects/readme-navigation";
import {
    buildProjectReadmeEditorSourceTargets,
    findProjectReadmeEditorSourceTarget,
    getReadmeLineStartOffset,
} from "../../src/lib/projects/readme-editor-source-map";
import {
    parseProjectReadmeGithubRepoUrl,
    parseReadmeHtmlDimension,
    buildProjectReadmeImageMarkdown,
    PROJECT_README_IMAGE_INTENTS,
    resolveProjectReadmeGithubSource,
    resolveProjectReadmeImage,
} from "../../src/lib/projects/readme-media";
import {
    buildProjectReadmeStylePresetMarkdown,
    PROJECT_README_STYLE_PRESETS,
} from "../../src/lib/projects/readme-style";
import { buildProjectReadmeViewModel } from "../../src/lib/projects/readme-view-model";

test("README permissions keep public, private, and editor access separated", () => {
    const publicPermission = resolveProjectReadmePermission({
        actorUserId: null,
        projectVisibility: "public",
        publicTabVisibility: { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false, analytics: false },
        hasPublishedReadme: true,
    });
    assert.equal(publicPermission.canReadPublished, true);
    assert.equal(publicPermission.canEdit, false);

    const privateOutsider = resolveProjectReadmePermission({
        actorUserId: "user-1",
        projectVisibility: "private",
        publicTabVisibility: { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false, analytics: false },
        hasPublishedReadme: true,
    });
    assert.equal(privateOutsider.canReadPublished, false);

    const coLeader = resolveProjectReadmePermission({
        actorUserId: "admin-1",
        projectVisibility: "private",
        membershipRole: "admin",
        isActiveMember: true,
        hasPublishedReadme: false,
    });
    assert.equal(coLeader.canEdit, true);
    assert.equal(coLeader.canPublish, true);

    const memberWithPolicy = resolveProjectReadmePermission({
        actorUserId: "member-1",
        membershipRole: "member",
        isActiveMember: true,
        settings: { editPolicy: "members" },
    });
    assert.equal(memberWithPolicy.canEdit, true);
    assert.equal(memberWithPolicy.canPublish, true);
});

test("README metadata extracts headings, excerpt, hash, and smart blocks", () => {
    const content = `# Project Overview

This project helps teams ship together.

## Getting Started

\`\`\`bash
pnpm install
\`\`\`

{% project.roles %}
`;
    const metadata = buildProjectReadmePublishMetadata(content);
    assert.equal(metadata.headings.length, 2);
    assert.equal(metadata.headings[0]!.id, "project-overview");
    assert.ok(metadata.excerpt?.includes("teams ship"));
    assert.equal(metadata.smartBlocks[0]!.kind, "roles");
    assert.equal(metadata.contentHash.length, 64);
});

test("README quality flags missing guidance and unsafe URLs", () => {
    const report = evaluateProjectReadmeQuality(`# Project

[bad](javascript:alert(1))
`);
    assert.ok(report.issues.some((issue) => issue.id === "unsafe-url"));
    assert.ok(report.issues.some((issue) => issue.id === "missing-setup"));
});

test("README quality flags visual media risks", () => {
    const report = evaluateProjectReadmeQuality(`# Project

## Install

\`\`\`bash
pnpm install
\`\`\`

<img src="https://example.com/huge.png" width="1800" />

| Before | After |
| --- | --- |
| ![](docs/before.png) | ![After](docs/after.png) |
`);
    assert.ok(report.issues.some((issue) => issue.id === "image-missing-alt"));
    assert.ok(report.issues.some((issue) => issue.id === "external-image"));
    assert.ok(report.issues.some((issue) => issue.id === "image-oversized"));
    assert.ok(report.issues.some((issue) => issue.id === "image-table-layout"));
});

test("README smart block parser keeps malformed blocks safe", () => {
    const blocks = parseProjectReadmeSmartBlocks(`Before
{% project.files ids="a,b" %}
{% project.not_real %}
After`);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.kind, "files");
    assert.deepEqual(blocks[0]!.ids, ["a", "b"]);
    assert.equal(blocks[1]!.kind, "unknown");

    const segments = splitMarkdownBySmartBlocks("A\n{% project.sprints %}\nB");
    assert.equal(segments.length, 3);
});

test("README smart block parser supports visual reference picker output", () => {
    const blocks = parseProjectReadmeSmartBlocks(`
{% project.tasks ids="task-1, task-2" %}
{% project.contributors ids="member-1" %}
{% project.roles %}
`);
    assert.deepEqual(blocks.map((block) => block.kind), ["tasks", "contributors", "roles"]);
    assert.deepEqual(blocks[0]!.ids, ["task-1", "task-2"]);
    assert.deepEqual(blocks[1]!.ids, ["member-1"]);
    assert.deepEqual(blocks[2]!.ids, []);
});

test("README inline references preserve ids internally and render readable labels", () => {
    const token = buildInlineReadmeReference({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "tasks",
        title: "Finish onboarding flow",
        status: "done",
    });
    const refs = parseProjectReadmeInlineReferences(`Completed ${token}.`);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.id, "11111111-1111-4111-8111-111111111111");
    assert.equal(refs[0]!.label, "Task: Finish onboarding flow");
    const markdown = replaceInlineReadmeReferencesWithMarkdown(`Completed ${token}.`);
    assert.ok(markdown.includes("[Task: Finish onboarding flow](/__readme-ref/tasks/11111111-1111-4111-8111-111111111111)"));
});

test("README inline references split from Markdown without URL protocol rendering", () => {
    const token = buildInlineReadmeReference({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "contributors",
        title: "Ramanayudu CH",
        status: "Owner",
        meta: "(Project Lead)",
    });
    const segments = splitMarkdownByInlineReferences(`Built by ${token} for launch.`);
    assert.equal(segments.length, 3);
    assert.equal(segments[0]!.kind, "markdown");
    const refSegment = segments[1];
    assert.equal(refSegment?.kind, "reference");
    if (refSegment?.kind === "reference") {
        assert.equal(refSegment.reference.id, "11111111-1111-4111-8111-111111111111");
        assert.equal(refSegment.reference.label, "Ramanayudu CH");
    }
    assert.equal(segments[2]!.kind, "markdown");
});

test("README inline reference fallback never exposes raw ids as labels", () => {
    const token = `{% ref.tasks id="11111111-1111-4111-8111-111111111111" %}`;
    const refs = parseProjectReadmeInlineReferences(token);
    assert.equal(refs[0]!.label, "task reference");

    const markdown = replaceInlineReadmeReferencesWithMarkdown(token);
    assert.ok(markdown.includes("[task reference](/__readme-ref/tasks/11111111-1111-4111-8111-111111111111)"));
    assert.ok(!markdown.includes("[11111111-1111-4111-8111-111111111111]"));
});

test("README settings normalize safe defaults", () => {
    const settings = normalizeProjectReadmeSettings({
        editPolicy: "members",
        externalImages: true,
        mediaUploads: false,
        projectBlocks: false,
        notifyOnPublish: true,
    });
    assert.equal(settings.editPolicy, "members");
    assert.equal(settings.externalImages, true);
    assert.equal(settings.mediaUploads, false);
});

test("README headings and excerpt are deterministic", () => {
    const headings = extractProjectReadmeHeadings("# Intro\n## Intro\n### Usage");
    assert.deepEqual(headings.map((heading) => heading.id), ["intro", "intro-2", "usage"]);
    assert.equal(buildProjectReadmeExcerpt("```bash\npnpm dev\n```\n# Title\nUseful docs."), "Title Useful docs.");
});

test("README headings ignore fenced code and clean inline HTML", () => {
    const headings = extractProjectReadmeHeadings(`# Before / After

\`\`\`bash
### <img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> not a heading
\`\`\`

## <img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> Install
`);
    assert.deepEqual(headings, [
        { id: "before-after", level: 1, text: "Before / After" },
        { id: "install", level: 2, text: "Install" },
    ]);
});

test("README plain text strips decorative HTML before truncating", () => {
    const htmlHeavy = `<p align="center"><img src="https://example.com/rock.png" width="120" /></p>
<h1 align="center">caveman</h1>
<p align="center"><strong>why use many token when few do trick</strong></p>

\`\`\`bash
npm install
\`\`\`
`;
    assert.equal(buildProjectReadmePlainText(htmlHeavy, { maxLength: 80 }), "caveman why use many token when few do trick");
    assert.equal(buildProjectReadmeExcerpt(htmlHeavy), "caveman why use many token when few do trick");
    assert.equal(buildProjectReadmePlainText(`<p align="center"><img src="https://example.com/rock.png"`), null);
});

test("README edit source map covers non-heading blocks and resolves cursor offsets", () => {
    const content = `# Intro

Purpose paragraph wraps
across two lines.

> Important note.

- One
- Two

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

![Demo](./demo.png)
{% project.files %}
`;
    const targets = buildProjectReadmeEditorSourceTargets(content);
    assert.ok(targets.some((target) => target.kind === "heading"));
    assert.ok(targets.some((target) => target.kind === "paragraph" && target.endLine > target.startLine));
    assert.ok(targets.some((target) => target.kind === "blockquote"));
    assert.ok(targets.some((target) => target.kind === "list"));
    assert.ok(targets.some((target) => target.kind === "command"));
    assert.ok(targets.some((target) => target.kind === "image"));
    assert.ok(targets.some((target) => target.kind === "smart-block"));

    const paragraphOffset = content.indexOf("across two lines");
    const paragraphTarget = findProjectReadmeEditorSourceTarget(targets, paragraphOffset);
    assert.equal(paragraphTarget?.kind, "paragraph");
    assert.equal(getReadmeLineStartOffset(content, 12), content.indexOf("pnpm install"));
});

test("README quick console extracts labeled copy commands", () => {
    const commands = extractProjectReadmeCommandShortcuts(`## Install

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Deploy

\`\`\`sh
vercel deploy
\`\`\`
`);
    assert.deepEqual(commands.map((command) => command.label), ["Install", "Run dev", "Deploy"]);
    assert.deepEqual(commands.map((command) => command.blockId), ["readme-command-0", "readme-command-0", "readme-command-1"]);
    assert.deepEqual(commands.map((command) => command.command), ["pnpm install", "pnpm dev", "vercel deploy"]);
});

test("README quick console ignores decorative shell block lines", () => {
    const commands = extractProjectReadmeCommandShortcuts(`## Like this trick? Now get whole agent — caveman-code

\`\`\`bash
<img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> Like this trick? Now get whole agent — caveman-code
npm install -g @juliusbrussee/caveman-code

curl -fsSL \\
  https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh \\
  | bash
\`\`\`
`);
    assert.deepEqual(commands.map((command) => command.command), [
        "npm install -g @juliusbrussee/caveman-code",
        "curl -fsSL \\\nhttps://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh \\\n| bash",
    ]);
    assert.equal(commands[0]!.detail, "Global package");
    assert.ok(commands[0]!.ecosystemTags.includes("Node"));
    assert.ok(commands[0]!.ecosystemTags.includes("Shell"));
    assert.equal(commands[0]!.confidence, "high");
    assert.equal(commands[0]!.confidenceLabel, "Direct match");
    assert.equal(commands[1]!.detail, "macOS, Linux, WSL");
    assert.equal(commands[1]!.riskLabel, "Remote install script");
    assert.deepEqual(commands[1]!.platforms, ["macOS", "Linux", "WSL"]);
    assert.ok(commands[1]!.ecosystemTags.includes("GitHub"));
    assert.ok(commands[1]!.ecosystemTags.includes("Shell"));
    assert.ok(commands.every((command) => !/<img|Like this trick/i.test(`${command.command} ${command.detail ?? ""}`)));
});

test("README command shortcuts share renderer command block ids", () => {
    const commands = extractProjectReadmeCommandShortcuts(`## Notes

\`\`\`
plain fenced content that the renderer leaves unpromoted
\`\`\`

\`\`\`ts
const value = 1;
\`\`\`

\`\`\`bash
pnpm dev
\`\`\`
`);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.blockId, projectReadmeCommandBlockId(1));
    assert.equal(commands[0]!.id, `${projectReadmeCommandBlockId(1)}-0`);
});

test("README command shortcuts expose line-level targets for multi-command blocks", () => {
    const content = `## Install

\`\`\`bash
curl -fsSL \\
  https://example.com/install.sh \\
  | bash
pnpm dev
\`\`\`
`;
    const commands = extractProjectReadmeCommandShortcuts(content);
    assert.equal(commands.length, 2);
    assert.equal(commands[0]!.targetId, projectReadmeCommandLineTargetId(0, 0));
    assert.equal(commands[0]!.codeLineStart, 0);
    assert.equal(commands[0]!.codeLineEnd, 2);
    assert.equal(commands[1]!.targetId, projectReadmeCommandLineTargetId(0, 1));
    assert.equal(commands[1]!.codeLineStart, 3);
    assert.equal(commands[1]!.codeLineEnd, 3);

    const model = buildProjectReadmeViewModel({ content });
    assert.ok(model.targetRegistry.has(projectReadmeCommandLineTargetId(0, 0)));
    assert.ok(model.targetRegistry.has(projectReadmeCommandLineTargetId(0, 1)));
    assert.equal(model.recommendedAction?.targetId, projectReadmeCommandLineTargetId(0, 0));
});

test("README command target maps preserve same-line inline command order", () => {
    const content = "Run `pnpm dev` and then `pnpm test`.";
    const maps = buildProjectReadmeCommandTargetMaps(content);
    assert.deepEqual(maps.inlineByLineQueue.get(1), [
        projectReadmeCommandBlockId(0),
        projectReadmeCommandBlockId(1),
    ]);
});

test("README report deduplicates repeated risky command warnings", () => {
    const content = `## Install

\`\`\`bash
curl -fsSL https://example.com/install.sh | bash
curl -fsSL https://example.com/other.sh | bash
\`\`\`
`;
    const commands = extractProjectReadmeCommandShortcuts(content);
    const report = buildProjectReadmeRailReport({
        content,
        commands,
        references: [],
        headings: extractProjectReadmeHeadings(content),
    });
    assert.deepEqual(report.warnings, ["Remote install script"]);
});

test("README command extraction skips decorative HTML and unpromoted fences", () => {
    const content = `<p align="center"><img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock" /></p>

\`\`\`
plain fenced \`npm run nope\` content that should not become a command
\`\`\`

## Quick Start

\`npm install -g @juliusbrussee/caveman-code\`
`;
    const commands = extractProjectReadmeCommandShortcuts(content);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.group, "recommended");
    assert.equal(commands[0]!.label, "Start here");
    assert.equal(commands[0]!.command, "npm install -g @juliusbrussee/caveman-code");
    assert.ok(commands.every((command) => !/<img|npm run nope/i.test(command.command)));
});

test("README quick console extracts Caveman-style install commands, config, and options", () => {
    const content = `# caveman

why use many token when few do trick.

## Install

Agent | Command
--- | ---
Claude Code | \`claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman\`
Gemini CLI | \`gemini extensions install https://github.com/JuliusBrussee/caveman\`
Codex | \`npx skills add JuliusBrussee/caveman -a codex\`

Flag | What
--- | ---
\`--minimal\` | Plugin only.
\`--dry-run\` | Preview.

## caveman-shrink

\`\`\`json
{
  "mcpServers": {
    "fs-shrunk": {
      "command": "npx",
      "args": ["caveman-shrink"]
    }
  }
}
\`\`\`

## Benchmarks

Average token savings: 65%.
`;
    const commands = extractProjectReadmeCommandShortcuts(content);
    assert.ok(commands.some((command) => command.command.includes("claude plugin marketplace add") && command.group === "claude"));
    assert.ok(commands.some((command) => command.command.includes("gemini extensions install") && command.group === "agents"));
    assert.ok(commands.some((command) => command.command === "--minimal" && command.group === "options"));
    assert.ok(commands.some((command) => command.command.includes('"mcpServers"') && command.group === "config"));
    assert.ok(commands.some((command) => command.command.includes("npx skills add") && command.label === "Codex skill"));
    assert.ok(commands.some((command) => command.ecosystemTags.includes("Claude")));
    assert.ok(commands.some((command) => command.ecosystemTags.includes("Codex")));
    assert.ok(commands.every((command) => command.confidenceLabel));

    const report = buildProjectReadmeRailReport({
        content,
        commands,
        references: [],
        headings: extractProjectReadmeHeadings(content),
    });
    assert.ok(report.signals.includes("Claude install"));
    assert.ok(report.signals.includes("Config"));
    assert.ok(report.signals.some((signal) => signal.includes("option")));
    assert.ok(report.signals.includes("Report data"));
    assert.ok(report.briefItems.some((item) => item.label === "Start here"));
    assert.ok(report.briefItems.some((item) => item.label === "Setup paths"));
});

test("README view model centralizes tabs, targets, previews, and command metadata", () => {
    const content = `# Caveman

Use fewer tokens.

## Install

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash
\`\`\`

## Options

\`--minimal\` keeps plugin only.

{% ref.files id="11111111-1111-4111-8111-111111111111" label="README.md" %}
`;
    const model = buildProjectReadmeViewModel({ content, excerpt: "Use fewer tokens." });

    assert.deepEqual(model.railTabs, ["commands", "brief", "outline", "options", "links"]);
    assert.equal(model.headings[0]!.id, "caveman");
    assert.ok(model.targetRegistry.has("install"));
    assert.ok(model.targetRegistry.has("readme-command-0"));
    assert.ok(model.targetRegistry.has("readme-ref-files-11111111-1111-4111-8111-111111111111-0"));
    assert.ok(model.railActions.some((action) => action.kind === "command" && action.copyText?.includes("curl -fsSL")));
    assert.equal(model.recommendedAction?.kind, "command");
    assert.equal(model.recommendedAction?.targetId, "readme-command-0");
    assert.ok(model.previewBlocks.length > 0);
    assert.equal(model.referencePreviewBlocks.length, 1);
    assert.ok(model.targetSignature.includes("readme-command-0"));
    assert.equal(model.commands[0]!.riskLabel, "Remote install script");
    assert.deepEqual(model.commands[0]!.platforms, ["macOS", "Linux", "WSL"]);
    assert.ok(model.commands[0]!.ecosystemTags.includes("GitHub"));
    assert.equal(model.commands[0]!.confidence, "high");
    assert.equal(model.report.nextAction?.startsWith("Install:"), true);
    assert.equal(model.report.readiness, "actionable");
    assert.ok(model.report.platforms.includes("macOS"));
    assert.ok(model.report.summaryItems.some((item) => item.label === "Commands"));
    assert.ok(model.report.briefItems.some((item) => item.label === "Review"));
});

test("README view model cache keys prefer the persisted content hash", () => {
    const first = buildProjectReadmeViewModel({
        content: "# Same\n\n```bash\npnpm install\n```",
        contentHash: "hash-a",
    });
    const second = buildProjectReadmeViewModel({
        content: "# Same\n\n```bash\npnpm install\n```",
        contentHash: "hash-a",
    });
    const third = buildProjectReadmeViewModel({
        content: "# Same\n\n```bash\npnpm install\n```",
        contentHash: "hash-b",
    });

    assert.equal(first, second);
    assert.notEqual(first, third);
});

test("README view model reports weak and empty README states", () => {
    const weak = buildProjectReadmeViewModel({ content: "This project is described but has no setup path." });
    assert.equal(weak.report.readiness, "weak");
    assert.ok(weak.report.limitations.includes("No copyable setup commands detected"));
    assert.equal(weak.railTabs.includes("brief"), true);

    const empty = buildProjectReadmeViewModel({ content: "   " });
    assert.equal(empty.report.readiness, "empty");
    assert.ok(empty.report.limitations.includes("README is empty"));
    assert.deepEqual(empty.railTabs, []);
});

test("README reference target ids are stable and DOM-safe", () => {
    assert.equal(
        projectReadmeReferenceTargetId("tasks", "11111111-1111-4111-8111-111111111111", 2),
        "readme-ref-tasks-11111111-1111-4111-8111-111111111111-2",
    );
});

test("README media resolver preserves GitHub-style image sizing and safety", () => {
    const publicGithubProject = {
        id: "project-1",
        visibility: "public",
        importSource: {
            type: "github",
            repoUrl: "https://github.com/JuliusBrussee/caveman",
            branch: "main",
        },
    };

    assert.deepEqual(parseProjectReadmeGithubRepoUrl("git@github.com:JuliusBrussee/caveman.git"), {
        owner: "JuliusBrussee",
        repo: "caveman",
    });
    assert.equal(resolveProjectReadmeGithubSource(publicGithubProject)?.branch, "main");
    assert.equal(parseReadmeHtmlDimension("120px"), 120);

    const logo = resolveProjectReadmeImage({
        src: "https://em-content.zobj.net/source/apple/391/rock_1faa8.png",
        width: "120",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(logo.src?.includes("rock_1faa8.png"), true);
    assert.equal(logo.kind, "logo");
    assert.equal(logo.width, 120);
    assert.equal(logo.trustedExternal, true);

    const badge = resolveProjectReadmeImage({
        src: "https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow",
        alt: "Stars",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(badge.kind, "badge");
    assert.equal(badge.blockedReason, null);

    const relativeIcon = resolveProjectReadmeImage({
        src: "docs/assets/dancing-rock.svg",
        width: "20",
        height: "20",
        alt: "rock",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(relativeIcon.kind, "icon");
    assert.equal(relativeIcon.src, "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/docs/assets/dancing-rock.svg");

    const protocolRelativeBadge = resolveProjectReadmeImage({
        src: "//img.shields.io/github/license/JuliusBrussee/caveman",
        alt: "License",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(protocolRelativeBadge.kind, "badge");
    assert.equal(protocolRelativeBadge.src, "https://img.shields.io/github/license/JuliusBrussee/caveman");

    const githubBlobImage = resolveProjectReadmeImage({
        src: "https://github.com/JuliusBrussee/caveman/blob/main/docs/preview.png?raw=true",
        alt: "Preview",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(githubBlobImage.src, "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/docs/preview.png?raw=true");
    assert.equal(githubBlobImage.trustedExternal, true);

    const metadataOnlyGithubSource = resolveProjectReadmeGithubSource({
        id: "project-2",
        visibility: "public",
        importSource: {
            type: "github",
            branch: "main",
            metadata: {
                githubOwner: "JuliusBrussee",
                githubName: "caveman",
            },
        },
    });
    assert.deepEqual(metadataOnlyGithubSource, {
        owner: "JuliusBrussee",
        repo: "caveman",
        branch: "main",
    });

    const privateExternal = resolveProjectReadmeImage({
        src: "https://example.com/private.png",
        allowExternalImages: false,
        project: { id: "private", visibility: "private" },
    });
    assert.equal(privateExternal.src, null);
    assert.equal(privateExternal.blockedReason, "external");
});

test("README external image policy is not contradicted by the static CSP", () => {
    const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    const middleware = fs.readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");

    assert.match(nextConfig, /"img-src 'self' data: blob: https:"/);
    assert.match(middleware, /"img-src 'self' data: blob: https:"/);
});

test("README image and style helpers produce portable authoring output", () => {
    assert.ok(PROJECT_README_IMAGE_INTENTS.some((intent) => intent.id === "before_after"));
    const logoMarkdown = buildProjectReadmeImageMarkdown({
        src: "docs/assets/logo.png",
        alt: "Caveman logo",
        intent: "logo",
    });
    assert.match(logoMarkdown, /<p align="center">/);
    assert.match(logoMarkdown, /width="120"/);
    assert.match(logoMarkdown, /alt="Caveman logo"/);

    const badgeMarkdown = buildProjectReadmeImageMarkdown({
        src: "https://img.shields.io/github/stars/JuliusBrussee/caveman",
        alt: "Stars",
        intent: "badge",
    });
    assert.equal(badgeMarkdown, "![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman)");

    assert.ok(PROJECT_README_STYLE_PRESETS.some((preset) => preset.id === "technical_docs"));
    const template = buildProjectReadmeStylePresetMarkdown("technical_docs", "Caveman");
    assert.match(template, /# Caveman/);
    assert.match(template, /## Architecture/);
    assert.match(template, /pnpm test/);
});

test("README edit view source implements the fourteen editor standards", () => {
    const repoRoot = process.cwd();
    const editor = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeEditor.tsx"), "utf8");
    const draftHook = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/useProjectReadmeDraftEditor.ts"), "utf8");
    const qualityPanel = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeQualityPanel.tsx"), "utf8");
    const conflictResolver = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeConflictResolver.tsx"), "utf8");
    const commandBuilder = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeCommandBuilder.tsx"), "utf8");
    const insertCommandCenter = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeInsertCommandCenter.tsx"), "utf8");
    const referencePicker = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeReferencePicker.tsx"), "utf8");
    const assetUploader = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeAssetUploader.tsx"), "utf8");
    const assetManager = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeAssetManager.tsx"), "utf8");
    const styleBuilder = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeStyleBuilder.tsx"), "utf8");
    const styleHelpers = fs.readFileSync(path.join(repoRoot, "src/lib/projects/readme-style.ts"), "utf8");
    const mediaHelpers = fs.readFileSync(path.join(repoRoot, "src/lib/projects/readme-media.ts"), "utf8");
    const history = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeHistory.tsx"), "utf8");
    const codeEditor = fs.readFileSync(path.join(repoRoot, "src/components/projects/v2/editor/CodeEditor.tsx"), "utf8");
    const quality = fs.readFileSync(path.join(repoRoot, "src/lib/projects/readme-quality.ts"), "utf8");
    const sourceMap = fs.readFileSync(path.join(repoRoot, "src/lib/projects/readme-editor-source-map.ts"), "utf8");
    const readmeTab = fs.readFileSync(path.join(repoRoot, "src/components/projects/tabs/ReadmeTab.tsx"), "utf8");
    const dashboardClient = fs.readFileSync(path.join(repoRoot, "src/components/projects/dashboard/ProjectDashboardClient.tsx"), "utf8");
    const projectLayout = fs.readFileSync(path.join(repoRoot, "src/components/projects/dashboard/ProjectLayout.tsx"), "utf8");
    const renderer = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeRenderer.tsx"), "utf8");
    const commandBlock = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeCommandBlock.tsx"), "utf8");

    assert.match(editor, /useProjectReadmeDraftEditor/, "editor should delegate draft state, autosave, and conflicts to a focused hook");
    assert.match(editor, /data-readme-split-editor="true"/, "write mode should be a split editor workspace");
    assert.match(editor, /data-readme-flat-edit-shell="true"/, "editor should use a flat workspace shell instead of a boxed card");
    assert.match(editor, /data-readme-fullscreen-edit="true"/, "README edit mode should occupy the full project workspace");
    assert.match(editor, /data-readme-layout-owned-workspace="true"/, "README edit fullscreen behavior should be owned by the project layout");
    assert.match(editor, /w-full/, "README edit shell should fill the layout-owned workspace width");
    assert.doesNotMatch(editor, /marginLeft: "calc\(50% - 50vw\)"/, "README edit shell should not escape centered gutters with viewport math");
    assert.match(readmeTab, /onEditingChange\?: \(editing: boolean\) => void/, "README tab should report edit-mode state to the project shell");
    assert.match(readmeTab, /onEditingChange\?\.\(editing\)/, "README tab should synchronize edit-mode state upward");
    assert.match(dashboardClient, /const \[isReadmeEditing, setIsReadmeEditing\] = useState\(false\)/, "dashboard should own README edit workspace state");
    assert.match(dashboardClient, /onEditingChange=\{setIsReadmeEditing\}/, "dashboard should receive README edit state from the tab");
    assert.match(dashboardClient, /isReadmeEditing=\{isReadmeEditing\}/, "dashboard should pass README edit workspace state to ProjectLayout");
    assert.match(projectLayout, /isReadmeEditWorkspaceTab = activeTab === "readme" && isReadmeEditing/, "ProjectLayout should treat README edit mode as a workspace tab");
    assert.match(projectLayout, /isFilesTab \|\| isReadmeEditWorkspaceTab/, "ProjectLayout should share the contained workspace contract between Files and README edit mode");
    assert.match(projectLayout, /data-project-content-root=\{isContainedWorkspaceTab \? "workspace" : "page"\}/, "ProjectLayout should expose whether content is a workspace or normal page");
    assert.match(projectLayout, /data-project-readme-edit-workspace=\{isReadmeEditWorkspaceTab \? "true" : undefined\}/, "ProjectLayout should expose README edit workspace state");
    assert.match(projectLayout, /--project-tabs-height/, "ProjectLayout should publish measured tab height as a CSS variable");
    assert.match(projectLayout, /--project-content-height/, "ProjectLayout should publish measured content height as a CSS variable");
    assert.match(editor, /data-readme-fixed-overlay-safe="true"/, "README edit shell should avoid transforms so fixed insert panels anchor to the viewport");
    assert.match(editor, /data-readme-edit-sticky-toolbar="true"/, "README edit toolbar should stay sticky while the route scrolls");
    assert.match(editor, /data-readme-toolbar-aligned-to-project-tabs="true"/, "README edit toolbar should align below the measured project tab header");
    assert.match(editor, /data-readme-toolbar-height-measured="true"/, "README edit toolbar height should be measured for exact pane sizing");
    assert.match(editor, /querySelector<HTMLElement>\("\[data-project-sticky-tabs='true'\]"\)/, "README edit toolbar should measure the project sticky tab row instead of guessing offsets");
    assert.match(editor, /top-\[var\(--readme-edit-toolbar-top\)\]/, "README edit toolbar should use the measured sticky tab offset");
    assert.match(editor, /--readme-edit-toolbar-height/, "README edit pane sizing should know the wrapped toolbar height");
    assert.match(editor, /--readme-edit-route-height/, "README edit shell should size from the actual route viewport, not a guessed document viewport");
    assert.match(editor, /querySelector<HTMLElement>\('\[data-project-content-root="workspace"\]'\)/, "README edit shell should prefer the layout-owned workspace root for height");
    assert.match(editor, /querySelector<HTMLElement>\('\[data-scroll-root="route"\]'\)/, "README edit shell should measure the project route scroll root");
    assert.match(editor, /visualViewport/, "README edit shell should react to visual viewport resize changes");
    assert.match(editor, /MutationObserver/, "README edit shell should recover when the workspace root appears after edit mode flips");
    assert.match(editor, /data-readme-bottom-cover-shell="true"/, "README edit shell should cover the remaining route viewport down to the bottom edge");
    assert.match(editor, /data-readme-route-height-measured="true"/, "README edit shell should expose the measured route-height bottom-cover contract");
    assert.match(editor, /min-h-\[calc\(var\(--readme-edit-route-height\)-var\(--readme-edit-toolbar-top\)\)\]/, "README edit shell should reserve the route viewport below the project tabs without subtracting top nav twice");
    assert.match(editor, /lg:h-\[calc\(var\(--readme-edit-route-height\)-var\(--readme-edit-toolbar-top\)\)\] lg:min-h-0/, "desktop README edit shell should use exact measured route height to avoid uncovered bottom strips");
    assert.doesNotMatch(editor, /100dvh-var\(--ui-topnav-height\)-var\(--readme-edit-toolbar-top\)/, "README edit shell should not subtract the global top nav after the route layout already did");
    assert.match(editor, /data-readme-split-fills-remaining-viewport="true"/, "README editor split should flex into the remaining viewport instead of using a brittle fixed height");
    assert.match(editor, /min-h-0 flex-1 overflow-hidden/, "editor code pane should fill remaining height without creating bottom gaps");
    assert.match(editor, /app-scroll app-scroll-y app-scroll-gutter min-h-0 flex-1/, "live review pane should fill remaining height while owning a standard app scroll container");
    assert.match(editor, /data-readme-bottom-gap-guard="true"/, "README edit panes should not create an artificial bottom scroll gap");
    assert.match(editor, /data-readme-equal-split="50-50"/, "editor and live review should use an explicit 50/50 split contract");
    assert.match(editor, /lg:grid-cols-2/, "desktop README edit view should split editor and live review equally");
    assert.match(editor, /data-readme-parallel-sync="scroll-and-cursor-heading"/, "editor and live review should keep interaction-driven source/preview sync");
    assert.match(editor, /data-readme-live-review-title="true">Live Review/, "right pane should be titled Live Review");
    assert.doesNotMatch(editor, /modeButtons/, "edit view should not show a separate Write/Preview toggle");
    assert.doesNotMatch(editor, /data-readme-edit-preview-mode/, "edit view should not keep a separate preview mode");
    assert.doesNotMatch(editor, /data-readme-quality-sidebar/, "quality should not be the default right pane");
    assert.doesNotMatch(editor, /Draft assistant/, "right pane should not be framed as a draft assistant");
    assert.doesNotMatch(editor, /Live preview/, "right pane copy should use Live Review, not Live preview");
    assert.match(editor, /QUICK_INSERT_PANELS/, "editor should expose convenient quick insert shortcuts");
    assert.match(editor, /data-readme-quick-insert-toolbar="true"/, "quick inserts should be available without repeatedly opening Insert");
    assert.match(editor, /ProjectReadmeStyleBuilder/, "editor should expose README style presets in the insert workflow");
    assert.match(editor, /data-readme-live-review-size-controls="true"/, "live review should include responsive size controls");
    assert.match(editor, /data-readme-live-review-size=\{liveReviewSize\}/, "live review should expose the selected review size");
    assert.match(editor, /fidelity=\{liveReviewSize === "github" \? "github" : "app"\}/, "GitHub live review size should switch the renderer into GitHub-fidelity mode");
    assert.match(renderer, /fidelity\?: "app" \| "github"/, "README renderer should expose an explicit app/GitHub fidelity contract");
    assert.match(renderer, /data-readme-preview-fidelity=\{fidelity\}/, "README renderer should mark the active preview fidelity in the DOM");
    assert.match(editor, /data-readme-editor-actions="true"/, "editor actions should be grouped separately from quick insert tools");
    assert.match(editor, /min-w-\[112px\]/, "Publish button should reserve enough width to avoid clipped text");
    assert.match(editor, />Publish</, "toolbar should show the full Publish label");
    assert.match(editor, /Cmd\/Ctrl\+K/, "toolbar should advertise add shortcuts");
    assert.match(editor, /const \[followCursor, setFollowCursor\] = useState\(true\)/, "editor should let writers toggle cursor-follow behavior");
    assert.match(editor, /aria-pressed=\{followCursor\}/, "cursor-follow control should expose pressed state");
    assert.match(editor, /data-readme-live-preview="true"/, "desktop edit view should include a live preview pane");
    assert.match(editor, /highlightedTargetId=\{activePreviewTargetId\}/, "live preview should track the active editor source target");
    assert.match(editor, /previewPaneRef/, "live preview should own its scroll container");
    assert.match(editor, /root\.scrollTo/, "preview sync should scroll the preview pane directly");
    assert.match(editor, /buildProjectReadmeEditorSourceTargets/, "editor should build a full source map for all meaningful README blocks");
    assert.match(editor, /findProjectReadmeEditorSourceTarget/, "editor cursor movement should resolve to the nearest source-mapped preview block");
    assert.match(editor, /handlePreviewSourcePosition/, "live review clicks should drive the editor cursor to the matching source position");
    assert.match(editor, /onRequestSourcePosition=\{handlePreviewSourcePosition\}/, "live review should report source-position interactions back to CodeMirror");
    assert.match(editor, /sourceHighlightRange=\{sourceHighlightTarget\}/, "preview clicks should highlight the matching source range in the editor");
    assert.match(editor, /highlightEditorRange\(target\.startOffset, target\.endOffset\)/, "source-range highlighting should use the mapped README block boundaries");
    assert.match(editor, /Selected image source/, "image preview clicks should select the source image markup for replacement");
    assert.match(codeEditor, /sourceHighlightRange\?:/, "shared editor should accept source-range highlights");
    assert.match(codeEditor, /cm-readme-source-highlight/, "shared editor should render README source highlight decorations");
    assert.match(renderer, /onClickCapture=\{handleEditorSourceClickCapture\}/, "live review should capture block clicks for source navigation in edit mode");
    assert.match(renderer, /event\.preventDefault\(\)/, "edit-mode preview clicks should navigate source instead of opening links");
    assert.match(renderer, /rehypeRaw/, "README preview should parse legitimate raw HTML instead of showing literal tags");
    assert.match(renderer, /rehypeSanitize/, "README raw HTML support should stay behind the sanitizer");
    assert.match(renderer, /README_HTML_SANITIZE_SCHEMA/, "README raw HTML should use the app-level safe schema");
    assert.match(renderer, /rehypePlugins=\{README_REHYPE_PLUGINS as any\}/, "React Markdown should receive the raw HTML and sanitizer plugins");
    assert.match(renderer, /resolveProjectReadmeImage/, "README media should resolve GitHub-relative assets and external image policy before render");
    assert.match(renderer, /data-readme-media-kind/, "README images should expose their detected media kind for sizing and table behavior");
    assert.match(renderer, /readmeMediaStyle/, "README images should preserve explicit HTML dimensions instead of using one hardcoded size");
    assert.doesNotMatch(renderer, /width=\{1200\}/, "README images should not force every image to screenshot dimensions");
    assert.match(renderer, /data-readme-copy-button='true'|data-readme-copy-button="true"/, "renderer should allow command copy buttons to opt out of source navigation");
    assert.match(commandBlock, /data-readme-copy-button="true"/, "command copy buttons should remain copy controls inside the editable preview");
    assert.doesNotMatch(editor, /onScrollActivity=\{handleEditorScrollActivity\}/, "independent panes should not continuously mirror editor scroll");
    assert.doesNotMatch(editor, /onScroll=\{handlePreviewScroll\}/, "independent panes should not continuously mirror preview scroll");
    assert.match(editor, /PreviewRevealTarget/, "selection-driven preview reveal should be tokenized separately from passive content rerenders");
    assert.match(editor, /selectionTokenRef/, "editor selection targets should use monotonic tokens instead of Date.now collisions");
    assert.doesNotMatch(editor, /token: Date\.now\(\)/, "editor selection tokens should not depend on wall-clock time");
    assert.match(editor, /initialCursorActivityHandledRef/, "initial CodeMirror cursor dispatch should not jump the preview to the top");
    assert.match(editor, /lastCursorSignatureRef/, "duplicate cursor events should not repeat preview reveal");
    assert.doesNotMatch(editor, /activePreviewTargetId, deferredContent/, "selection reveal should not rerun just because the live preview content rerendered");
    assert.match(editor, /readmeEditorSourceSelector/, "preview reveal should support source-map data targets in addition to public heading ids");
    assert.match(editor, /getReadmeLineStartOffset/, "preview line clicks should resolve to a precise editor line start when no offset is present");
    assert.match(editor, /window\.location\.hash\.slice\(1\)/, "editor should open directly to a README hash target");
    assert.match(editor, /Opened README at selected section/, "hash-target entry should tell the writer what happened");
    assert.match(editor, /useDeferredValue\(content\)/, "preview and quality evaluation should defer heavy README work");
    assert.match(editor, /README_LARGE_DOC_PREVIEW_DEBOUNCE_MS/, "large README preview rendering should be separately debounced");
    assert.match(editor, /data-readme-large-document-mode/, "large README mode should expose a measurable UI contract");
    assert.match(editor, /README_QUALITY_DEBOUNCE_MS/, "quality evaluation should be debounced separately from live preview rendering");
    assert.match(editor, /setQualityContent\(deferredContent\)/, "quality evaluation should use a delayed content snapshot");
    assert.match(editor, /ProjectReadmeQualityPanel/, "editor should expose quality guidance beside the draft");
    assert.match(editor, /evaluateProjectReadmeQuality\(qualityContent\)/, "quality report should update from the current draft without recomputing on every keystroke");
    assert.match(editor, /ProjectReadmeConflictResolver/, "edit view should provide section-level conflict resolution");
    assert.match(editor, /applyMergedContent/, "merged conflict output should become the active draft");
    assert.match(editor, /beforeunload/, "dirty drafts should warn before accidental navigation");
    assert.match(editor, /key === "k"/, "Cmd/Ctrl+K should open context-aware README tools");
    assert.match(editor, /data-readme-publish-readiness-gate="true"/, "publish should show a readiness review before risky README content goes live");
    assert.match(editor, /shouldGatePublish/, "publish gating should be based on explicit quality issue ids and severities");
    assert.match(editor, /selectionRange=\{selectionTarget\}/, "insert and quality actions should restore editor focus to a stable range");
    assert.match(editor, /ProjectReadmeInsertCommandCenter/, "insert tools should use the full command-center surface");
    assert.match(editor, /projectVisibility=\{project\.visibility\}/, "README media tools should receive project visibility context");
    assert.match(editor, /selectedMarkdown=\{selectedMarkdown\}/, "insert tools should receive the current selection for replacement flows");
    assert.match(editor, /draftContent=\{content\}/, "history comparison should use the current draft content");

    assert.match(draftHook, /saveSequenceRef/, "autosave should guard against out-of-order save responses");
    assert.match(draftHook, /autosaveDelayMs/, "autosave timing should be configurable and centralized");
    assert.match(draftHook, /localStorage\.setItem/, "draft hook should maintain local emergency backup");
    assert.match(draftHook, /lastSavedAt/, "draft hook should expose last saved time for clear save status");
    assert.match(draftHook, /Save failed; retrying/, "failed autosaves should show retry-oriented feedback");
    assert.match(draftHook, /clearLocalBackup/, "published and saved drafts should clean local backups");

    assert.match(qualityPanel, /data-readme-quality-panel="true"/, "quality report should be addressable in tests and UI");
    assert.match(qualityPanel, /SECTION_FIXES/, "quality issues should offer insertable fixes");
    assert.match(qualityPanel, /onJumpToSection\(issue\.id\)/, "quality issues should jump to likely draft locations");
    assert.match(conflictResolver, /data-readme-conflict-resolver="true"/, "conflict resolver should expose a source-level contract");
    assert.match(conflictResolver, /buildMergedContent/, "conflicts should merge by section choices");
    assert.match(conflictResolver, /Latest server/, "conflict UI should clearly separate local and server content");
    assert.match(conflictResolver, /data-readme-conflict-section-diff="true"/, "conflict resolver should expose per-section diff blocks");
    assert.match(conflictResolver, /localLineCount/, "conflict resolver should summarize local/server section line counts");

    assert.match(commandBuilder, /extractProjectReadmeCommandShortcuts/, "command builder should reuse README command intelligence");
    assert.match(commandBuilder, /data-readme-command-intelligence="true"/, "command builder should surface command classification");
    assert.match(commandBuilder, /confidenceLabel/, "command builder should show confidence metadata");
    assert.match(commandBuilder, /parseSelectedCommandBlock/, "command builder should load a selected fenced command for editing");
    assert.match(commandBuilder, /Edit selected command/, "command builder should label selected-command edit mode clearly");
    assert.match(commandBuilder, /Replace command/, "command builder should replace selected commands instead of duplicating them");
    assert.match(insertCommandCenter, /data-readme-insert-command-center="true"/, "insert command center should expose a source-level modal contract");
    assert.match(insertCommandCenter, /data-readme-insert-tools-grouped="true"/, "insert command center should group tools into professional categories");
    assert.match(insertCommandCenter, /INSERT_CATEGORY_LABELS/, "insert command center should have explicit category labels");
    assert.match(insertCommandCenter, /RECENT_INSERT_KEY/, "insert command center should remember recent tools");
    assert.match(insertCommandCenter, /recentPanels/, "insert command center should expose recent insert panels");
    assert.match(insertCommandCenter, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/, "insert command center should support arrow-key navigation");
    assert.match(insertCommandCenter, /event\.key === "Enter"/, "insert command center should open the focused tool from the keyboard");
    assert.match(insertCommandCenter, /event\.target === event\.currentTarget/, "insert command center should close cleanly from the backdrop");
    assert.match(insertCommandCenter, /fixed inset-0 z-\[80\] flex items-center justify-center overflow-hidden/, "insert command center should be viewport anchored and centered");
    assert.match(insertCommandCenter, /flex h-\[min\(900px,calc\(100dvh-1\.5rem\)\)\]/, "insert command center should fit inside the dynamic viewport");
    assert.match(insertCommandCenter, /shrink-0 items-start justify-between/, "insert command center header should stay visible while panel content scrolls");
    assert.match(insertCommandCenter, /grid min-h-0 flex-1/, "insert command center body should scroll within the modal instead of clipping");
    assert.match(referencePicker, /ALL_REFERENCE_KIND/, "reference picker should support all-record search");
    assert.match(referencePicker, /initialKind \?\? "all"/, "reference picker should default to global search");
    assert.match(referencePicker, /buildSmartBlocksFromSelection/, "mixed project mentions should insert grouped smart blocks");

    assert.match(assetManager, /projectVisibility/, "asset manager should explain visibility behavior");
    assert.match(assetManager, /data-readme-image-intent-picker="true"/, "asset manager should ask for image intent before insertion");
    assert.match(assetManager, /IMAGE_SOURCE_MODES/, "asset manager should support managed, project, GitHub, external, and replacement source modes");
    assert.match(assetManager, /selectedMarkdown\?: string/, "asset manager should accept selected Markdown for replacement flows");
    assert.match(assetManager, /parseSelectedImageMarkup/, "asset manager should parse selected Markdown or HTML image syntax");
    assert.match(assetManager, /Selected image source will be replaced/, "asset manager should explain selected-image replacement mode");
    assert.match(assetManager, /buildProjectReadmeImageMarkdown/, "asset manager should build portable image markup for non-upload sources");
    assert.match(assetUploader, /onDrop=\{handleDrop\}/, "asset uploader should support drag and drop");
    assert.match(assetUploader, /readImageDimensions/, "asset uploader should read image dimensions before finalization");
    assert.match(assetUploader, /uploadProgress/, "asset uploader should show phase progress");
    assert.match(assetUploader, /width: imageDimensions\?\.width/, "asset finalization should preserve image width");
    assert.match(assetUploader, /height: imageDimensions\?\.height/, "asset finalization should preserve image height");
    assert.match(assetUploader, /buildProjectReadmeImageMarkdown/, "asset uploader should apply the selected image intent after upload");
    assert.match(styleBuilder, /data-readme-style-builder="true"/, "style builder should expose a source-level contract");
    assert.match(styleBuilder, /PROJECT_README_STYLE_PRESETS/, "style builder should render all README style presets");
    assert.match(styleHelpers, /portfolio_showcase/, "style presets should include portfolio/showcase READMEs");
    assert.match(styleHelpers, /technical_docs/, "style presets should include technical documentation READMEs");
    assert.match(mediaHelpers, /PROJECT_README_IMAGE_INTENTS/, "media helpers should define reusable image intent presets");
    assert.match(mediaHelpers, /before_after/, "image intent presets should support before/after comparisons");

    assert.match(history, /data-readme-version-comparison="true"/, "history should include draft/version comparison");
    assert.match(history, /qualityReport\.score/, "history rows should show quality score");
    assert.match(history, /GitCompareArrows/, "history should provide an explicit compare action");
    assert.match(codeEditor, /selectionRange\?:/, "shared editor should accept a stable selection target");
    assert.match(codeEditor, /EditorSelection\.range/, "shared editor should focus and select requested ranges");
    assert.match(codeEditor, /onScrollActivity\?:/, "shared editor should expose scroll activity for synchronized panes");
    assert.match(codeEditor, /scrollRatioTarget\?:/, "shared editor should accept external scroll targets");
    assert.match(codeEditor, /scrollDOM\.addEventListener\("scroll"/, "shared editor should listen to CodeMirror scroll events");
    assert.match(codeEditor, /requestAnimationFrame\(emitScrollActivity\)/, "shared editor scroll events should be animation-frame throttled");
    assert.match(codeEditor, /scrollDOM\.scrollTo/, "shared editor should support controlled scroll syncing");
    assert.match(quality, /TextEncoder/, "quality evaluator should be safe in the browser bundle");
    assert.match(quality, /analyzeReadmeVisuals/, "quality evaluator should include visual README checks");
    assert.match(quality, /missingAltSources/, "quality evaluator should report which images need alt text");
    assert.match(quality, /externalImageSources/, "quality evaluator should report external image sources");
    assert.match(qualityPanel, /data-readme-visual-quality-panel="true"/, "quality panel should surface visual media issues separately");
    assert.match(sourceMap, /ProjectReadmeEditorSourceTarget/, "README edit sync should use typed source-map targets");
    assert.match(sourceMap, /blockquote/, "source map should cover blockquotes");
    assert.match(sourceMap, /paragraph/, "source map should cover paragraphs instead of only headings");
    assert.match(sourceMap, /smart-block/, "source map should cover project smart blocks");
    assert.match(sourceMap, /SOURCE_MAP_CACHE_LIMIT/, "source map should cache expensive target extraction for large READMEs");
    assert.match(sourceMap, /continuesSourceBlock/, "source map should keep multiline lists, quotes, tables, and HTML blocks together");
    assert.match(sourceMap, /findProjectReadmeEditorSourceTarget/, "source map should resolve arbitrary cursor offsets to preview targets");
});

test("README right rail source controls scroll, active state, and target highlighting", () => {
    const repoRoot = process.cwd();
    const viewer = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeViewer.tsx"), "utf8");
    const rail = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeQuickConsole.tsx"), "utf8");
    const renderer = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeRenderer.tsx"), "utf8");
    const commandBlock = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeCommandBlock.tsx"), "utf8");
    const quickConsole = fs.readFileSync(path.join(repoRoot, "src/lib/projects/readme-quick-console.ts"), "utf8");
    const viewModel = fs.readFileSync(path.join(repoRoot, "src/lib/projects/readme-view-model.ts"), "utf8");
    const dataHook = fs.readFileSync(path.join(repoRoot, "src/hooks/hub/useProjectReadmeData.ts"), "utf8");
    const readmeAction = fs.readFileSync(path.join(repoRoot, "src/app/actions/project/readme.ts"), "utf8");
    const projectLayout = fs.readFileSync(path.join(repoRoot, "src/components/projects/dashboard/ProjectLayout.tsx"), "utf8");

    assert.match(viewer, /buildProjectReadmeViewModel/, "viewer should build one shared README model");
    assert.match(viewer, /readmeViewModel\.targetIds/, "viewer should navigate through the shared target registry");
    assert.match(viewer, /useProjectReadmeSmartBlockPreviews/, "viewer should fetch README previews once");
    assert.match(viewer, /previewByKey/, "viewer should pass shared previews to rail and renderer");
    assert.match(viewer, /scrollToTarget/, "viewer should centralize README target scrolling");
    assert.match(viewer, /scrollReadmeTargetIntoView/, "README target reveal should use the route scroll root with a measured sticky offset");
    assert.match(viewer, /getStickyProjectOffset/, "README target reveal should account for the sticky project tab row");
    assert.match(viewer, /resolveReadmeRevealElement/, "line-level command hits should reveal their containing command block");
    assert.match(viewer, /closest<HTMLElement>\('\[data-readme-command-block="true"\]'\)/, "command line targets should scroll the full command block into view");
    assert.match(viewer, /getCenteredReadmeScrollTop/, "README target reveal should center normal targets instead of pinning them to the top");
    assert.match(viewer, /README_TARGET_CENTER_RATIO = 0\.5/, "commands and references should land near the middle of the readable viewport");
    assert.match(viewer, /README_HEADING_REVEAL_RATIO = 0\.38/, "headings should land upper-middle so the first section content stays visible");
    assert.match(viewer, /README_TALL_TARGET_RATIO/, "very tall targets should use a top-padded fallback instead of impossible centering");
    assert.match(viewer, /elementRect\.height >= metrics\.visibleHeight \* README_TALL_TARGET_RATIO/, "tall command blocks should not be centered past their useful start");
    assert.match(viewer, /metrics\.visibleStart \+ \(metrics\.visibleHeight \* ratio\) - \(elementRect\.height \/ 2\)/, "normal targets should use center-position scroll math");
    assert.match(viewer, /routeRoot\.scrollTo/, "README target reveal should scroll the route root directly");
    assert.doesNotMatch(viewer, /scrollIntoView/, "README target reveal should not rely on browser default scrollIntoView offsets");
    assert.match(viewer, /type ReadmeTargetFlash/, "viewer should keep body flash state tokenized");
    assert.match(viewer, /highlightTokenRef/, "repeated clicks should get a fresh highlight token");
    assert.match(viewer, /handleRailAction/, "viewer should execute normalized rail actions");
    assert.match(viewer, /railActions=\{railActions\}/, "viewer should pass preview-enriched normalized rail actions to the rail");
    assert.match(viewer, /recommendedAction=\{recommendedAction\}/, "viewer should pass the enriched model-owned recommended action");
    assert.match(viewer, /const \[railState, setRailState\] = useState<ReadmeRailUiState>\(\{ openTab: null, selectedActionId: null \}\)/, "viewer should keep right-rail tabs closed by default");
    assert.match(viewer, /actionByTargetId/, "viewer should map URL hash targets back to the rail action");
    assert.match(viewer, /setRailState\(\{ openTab: action\.railTab, selectedActionId: action\.id \}\)/, "deep links should open the matching rail tab and row");
    assert.match(viewer, /previewLoading: readmePreviewsQuery\.isLoading/, "reference actions should expose preview loading state");
    assert.match(viewer, /previewError: readmePreviewsQuery\.isError/, "reference actions should expose preview error state");
    assert.match(viewer, /README_RAIL_MEMORY_VERSION/, "README rail reveal memory should be versioned");
    assert.match(viewer, /window\.sessionStorage\.getItem\(readmeRailMemoryKey\)/, "README rail should restore same-session reveal context");
    assert.match(viewer, /window\.sessionStorage\.setItem\(readmeRailMemoryKey/, "README rail should remember the last selected tab and row for the README version");
    assert.match(viewer, /targetSignature/, "README rail memory should be invalidated when the README target registry changes");
    assert.match(viewer, /handleReadmeMediaLoad/, "README media loads should correct the selected target position after layout shifts");
    assert.match(viewer, /mediaCorrectionFrameRef/, "README media correction should be animation-frame throttled");
    assert.match(viewer, /lastRevealTargetIdRef/, "README media correction should reuse the last manually revealed target");
    assert.match(viewer, /onMediaLoad=\{handleReadmeMediaLoad\}/, "renderer image loads should feed back into centered target reveal");
    assert.match(viewer, /targetRetryTimerRef/, "target reveal should retry when markdown targets are still rendering");
    assert.match(viewer, /revealTarget\(options\?\.retries \?\? 20\)/, "controlled outline and command clicks should retry target lookup");
    assert.match(viewer, /defer\?: boolean/, "rail-triggered target reveal should be deferrable until layout has settled");
    assert.match(viewer, /requestAnimationFrame\(\(\) =>/, "rail-triggered target reveal should wait for animation-frame layout stabilization");
    assert.match(viewer, /defer: true/, "right rail clicks should use deferred centered reveal");
    assert.match(viewer, /cancelAnimationFrame\(scrollFrameRef\.current\)/, "pending deferred reveals should be cancelable");
    assert.match(viewer, /retry:\s*false/, "hash retry loop should avoid scheduling duplicate target retries");
    assert.match(viewer, /decodeReadmeHashTarget\(window\.location\.hash\)/, "viewer should resolve hash targets after async render");
    assert.doesNotMatch(viewer, /IntersectionObserver/, "passive README scroll should not mutate highlight or rail state");
    assert.doesNotMatch(viewer, /manualTargetLockUntilRef/, "manual click locks are unnecessary when scroll state cannot highlight content");
    assert.match(rail, /executeRailAction/, "rail rows should use one normalized action executor");
    assert.match(rail, /onRailAction\?\.\(action\)/, "rail actions should route through controlled reveal logic");
    assert.match(rail, /briefStartAction/, "README brief should promote the model-owned start action when one is available");
    assert.match(rail, /Start here/, "README brief should label the promoted command");
    assert.match(rail, /briefFactItems/, "README brief should separate informational facts from the actionable start command");
    assert.match(rail, /item\.label\.toLowerCase\(\) !== "start here"/, "README brief should not render the start command as a plain text fact");
    assert.match(rail, /onExecuteAction=\{executeRailAction\}/, "brief command should reuse the same action path as install commands");
    assert.match(rail, /report\.warnings\.map\(\(warning, index\)/, "warning rows should include indexes for stable duplicate-safe keys");
    assert.match(rail, /key=\{`\$\{warning\}-\$\{index\}`\}/, "warning rows should not key by duplicate README-derived labels");
    assert.match(rail, /useReducer\(readmeRailReducer/, "rail should keep open-tab and selected-target state in a reducer");
    assert.match(rail, /useId\(\)/, "rail should generate unique tab-panel ids per compact and desktop instance");
    assert.match(rail, /openTab !== undefined \? openTab : localRailState\.openTab/, "controlled null should keep every rail tab closed instead of falling back to stale local state");
    assert.match(rail, /selectedActionId !== undefined \? selectedActionId : localRailState\.selectedActionId/, "controlled null should clear the selected rail row");
    assert.match(rail, /openTab:\s*null/, "rail tabs should be closed by default");
    assert.match(rail, /state\.openTab === action\.id \? null : action\.id/, "clicking the active tab should close it");
    assert.match(rail, /availableTabIds/, "rail should build tabs dynamically from available README data");
    assert.doesNotMatch(rail, /README Tools/, "rail should be button-first without a visible README Tools heading");
    assert.match(rail, /AnimatePresence/, "rail content should animate open and closed");
    assert.match(rail, /motion\.div/, "rail buttons and content should use smooth motion states");
    assert.match(rail, /selectedActionId/, "rail active rows should be owned by right-rail actions, not passive README scrolling");
    assert.doesNotMatch(rail, /activeTargetId\s*===/, "passive README scroll state should not drive rail row active state");
    assert.doesNotMatch(rail, /useProjectReadmeSmartBlockPreviews/, "rail should not fetch smart-block previews separately");
    assert.match(rail, /onKeyDown/, "outline rows should support keyboard activation");
    assert.match(rail, /event\.key !== " "/, "outline rows should treat Space like a click");
    assert.match(rail, /onExecuteAction\(action\)/, "outline rows should use the same controlled action path as commands");
    assert.match(rail, /role="tablist"/, "rail buttons should expose tab-list keyboard semantics");
    assert.match(rail, /role="tabpanel"/, "rail panels should expose tab-panel semantics");
    assert.match(rail, /ArrowRight/, "rail tabs should support arrow-key navigation");
    assert.match(rail, /Escape/, "rail tabs should close with Escape");
    assert.match(rail, /activeTab\.content\(\)/, "rail panel content should be materialized lazily only when open");
    assert.doesNotMatch(rail, /hasActiveTarget/, "rail buttons should not show scroll-driven active dots");
    assert.doesNotMatch(rail, /-right-1 -top-1/, "rail buttons should not render active indicator dots");
    assert.doesNotMatch(rail, /\by:\s*\d/, "rail should not translate buttons or panels vertically and clip at the top");
    assert.match(rail, /overflow-y-auto/, "right rail panels should scroll independently when content is tall");
    assert.match(rail, /h-\[calc\(100dvh-var\(--ui-topnav-height\)-7rem\)\]/, "desktop rail height should subtract the app top nav before scrolling panel content");
    assert.match(rail, /min-h-0 flex-1 overflow-hidden/, "rail panel should fill the remaining rail height instead of sizing from content");
    assert.match(rail, /h-full min-h-0 overflow-y-auto/, "desktop rail panel body should own the scroll range");
    assert.match(rail, /pb-24/, "desktop rail panel should leave enough bottom scroll padding for floating UI");
    assert.match(rail, /max-h-\[min\(70dvh,28rem\)\]/, "compact mobile rail should cap tall panels with dynamic viewport units");
    assert.match(rail, /cleanRailBriefText/, "README brief and report text should be cleaned before display");
    assert.match(rail, /buildProjectReadmePlainText/, "rail brief text should use the shared README plain-text cleaner");
    assert.match(rail, /\[overflow-wrap:anywhere\]/, "rail command text should wrap very long words and URLs");
    assert.match(rail, /riskLabel/, "rail command rows should surface risky command cues");
    assert.match(rail, /platforms\.map/, "rail command rows should surface platform cues");
    assert.match(rail, /railAnnouncement/, "copy and reveal results should be announced through a live region");
    assert.match(rail, /Moved to \$\{action\.label\}/, "non-copy rail actions should announce movement to the README target");
    assert.match(rail, /Copied \$\{action\.label\} and moved to README target/, "copy rail actions should announce both copy and reveal");
    assert.match(rail, /copyTextWithFallback/, "rail copy actions should keep working without navigator.clipboard");
    assert.match(rail, /Virtuoso/, "large README rail lists should be virtualized");
    assert.match(rail, /LARGE_RAIL_LIST_THRESHOLD/, "rail virtualization should only activate for genuinely large lists");
    assert.match(rail, /previewLoading/, "project links should expose loading state while route previews resolve");
    assert.match(rail, /previewError/, "project links should expose preview errors instead of silently losing open links");
    assert.match(rail, /data-readme-preview-state/, "project links should expose loading, missing, and error preview states");
    assert.match(rail, /animate-pulse/, "project-link loading should render a lightweight skeleton state");
    assert.match(rail, /Private or missing project link/, "project links should explain private or missing route targets");
    assert.match(rail, /Copy and show/, "quick command cards should copy and highlight from the main press target");
    assert.match(rail, /briefItems/, "README brief should render structured model-owned brief facts");
    assert.match(rail, /README Report/, "rail should show a compact README report");
    assert.match(rail, /commandGroups/, "rail should group commands by inferred intent");
    assert.match(rail, /ecosystemTags\.map/, "rail command rows should surface agent and ecosystem tags");
    assert.match(rail, /confidenceLabel/, "rail command rows should surface command confidence");
    assert.match(rail, /tabOrder/, "rail buttons should honor the smart-prioritized model tab order");
    assert.match(rail, /data-readme-rail-variant/, "rail should expose its desktop or compact variant for responsive behavior");
    assert.match(rail, /data-readme-compact-panel/, "compact rail panels should be identifiable as drawer-style panels");
    assert.doesNotMatch(rail, /Rail Search|data-readme-rail-search/, "Rail Search should not be implemented in the README rail");
    assert.match(rail, /aria-current=\{active \? "location" : undefined\}/, "active rail rows should be exposed semantically");
    assert.doesNotMatch(rail, /\.slice\(0,\s*(?:5|6|8)\)/, "rail should not hide extra headings, commands, or references");
    assert.match(renderer, /data-readme-target="true"/, "renderer should expose scroll targets");
    assert.match(renderer, /headingTargetQueues/, "renderer heading ids should be resolved from the same extracted heading queue as the outline");
    assert.match(renderer, /buildProjectReadmeViewModel\(\{ content \}\)/, "renderer fallback should use the shared README model instead of inventing outline ids");
    assert.match(renderer, /projectReadmeReferenceTargetId/, "inline references should be targetable from the rail");
    assert.match(renderer, /inlineReferenceEntriesByHref/, "inline reference target ids should use global occurrence indexes");
    assert.match(renderer, /onRequestTarget\(targetId\)/, "inline project references should highlight through the controlled README target handler");
    assert.match(renderer, /onRequestSourcePosition/, "editor-mode preview should report clicked source positions back to the editor");
    assert.match(renderer, /data-readme-editor-source-targets/, "editor-mode renderer should expose source-position click handling");
    assert.match(renderer, /data-readme-editor-target-id/, "rendered README blocks should expose source-map target ids");
    assert.match(renderer, /data-readme-source-offset/, "rendered README blocks should expose source offsets");
    assert.match(renderer, /data-readme-source-line/, "rendered README blocks should expose source lines");
    assert.match(renderer, /sourceTargetProps/, "renderer should centralize source metadata for headings, paragraphs, commands, lists, tables, and images");
    assert.match(renderer, /inlineByOffset/, "inline command snippets should be targetable from the rail");
    assert.match(renderer, /inlineByLineQueue/, "same-line inline command snippets should resolve by occurrence, not just by line");
    assert.match(renderer, /byLineQueue/, "same-line code blocks should resolve by occurrence, not just by line");
    assert.match(renderer, /lineTargets/, "multi-command code blocks should expose individual command targets");
    assert.match(renderer, /lineTargetHighlighted/, "line-level command highlights should receive the same flash token as block highlights");
    assert.match(renderer, /viewModel\?: ProjectReadmeViewModel/, "renderer should accept the shared README model");
    assert.match(renderer, /previewByKey\?: Map/, "renderer should accept shared preview data");
    assert.match(renderer, /React\.memo\(function ProjectReadmeRenderer/, "renderer should be memoized so rail-only state changes do not rerender heavy markdown");
    assert.match(renderer, /onMediaLoad\?: \(\) => void/, "renderer should expose media-load callbacks for scroll correction");
    assert.match(renderer, /onLoad=\{onMediaLoad\}/, "README images should notify the viewer after they load");
    assert.match(renderer, /data-readme-highlighted/, "clicked README targets should expose transient highlight state in the rendered content");
    assert.match(renderer, /data-readme-highlight-token/, "clicked README targets should expose tokenized highlight state");
    assert.match(renderer, /highlightedTargetId === commandId/, "command blocks should receive only click-owned flash highlights");
    assert.doesNotMatch(renderer, /data-readme-active/, "README body targets should not render scroll-driven active state");
    assert.doesNotMatch(renderer, /activeTargetId ===/, "passive README scroll state should not paint headings, references, or commands");
    assert.match(renderer, /readme-headings/, "renderer and rail should share the same heading id generator");
    assert.match(commandBlock, /data-readme-target-kind=\{id \? "command" : undefined\}/, "command blocks should be targetable");
    assert.match(commandBlock, /ProjectReadmeCommandLineTarget/, "command blocks should support line-level command targets");
    assert.match(commandBlock, /data-readme-command-block="true"/, "command line targets should have a full-block reveal anchor");
    assert.match(commandBlock, /data-readme-editor-target-id=\{rootEditorTargetId\}/, "command blocks should expose editor source-map targets");
    assert.match(commandBlock, /data-readme-source-line=\{sourceLineForCode/, "command line clicks should carry source line metadata back to the editor");
    assert.match(commandBlock, /lineEditorTargetId/, "command lines should be individually highlightable from editor source-map selections");
    assert.match(commandBlock, /lineTargetByStartLine/, "line-level target lookups should be precomputed");
    assert.match(commandBlock, /highlightedLineTarget/, "multi-line command highlighting should cover the full command range");
    assert.match(commandBlock, /scroll-mt-32/, "line targets should keep a safe scroll margin for direct hash fallback");
    assert.match(commandBlock, /data-readme-highlighted/, "command blocks should expose transient highlight state");
    assert.doesNotMatch(commandBlock, /data-readme-active/, "command blocks should not stay highlighted from scroll-driven active state");
    assert.doesNotMatch(commandBlock, /active\?: boolean/, "command blocks should not support persistent body highlighting");
    assert.match(commandBlock, /whitespace-pre-wrap/, "README command blocks should wrap instead of requiring horizontal scroll");
    assert.match(commandBlock, /\[overflow-wrap:anywhere\]/, "README command blocks should fit long unbroken commands inside the box");
    assert.doesNotMatch(commandBlock, /overflow-x-auto/, "README command blocks should not horizontally scroll commands");
    assert.doesNotMatch(viewer, /max-h-\[calc\(100vh-7rem\)\] overflow-y-auto/, "desktop README rail wrapper should not scroll independently");
    assert.doesNotMatch(rail, /max-h-\[calc\(100vh-13rem\)\]/, "right rail panel should not use stale viewport math that ignores the app top nav");
    assert.match(viewModel, /targetRegistry/, "README model should own target registry construction");
    assert.match(viewModel, /railActions/, "README model should own normalized rail action construction");
    assert.match(viewModel, /recommendedAction/, "README model should choose the recommended rail action");
    assert.match(viewModel, /viewModelCache/, "README model should cache parsed output for repeated renders");
    assert.match(viewModel, /contentHash/, "README model cache should prefer persisted content hashes when available");
    assert.match(viewModel, /targetSignature/, "README model should expose a stable navigation signature");
    assert.match(viewModel, /previewBlocks/, "README model should own preview block planning");
    assert.match(viewModel, /referencePreviewBlocks/, "README model should preserve inline project links independent of smart blocks");
    assert.match(viewModel, /PROJECT_README_PRIMARY_COMMAND_GROUPS/, "README model should share command grouping with the rail");
    assert.match(viewModel, /setupCommands/, "README model should prioritize rail tabs based on actionable setup commands");
    assert.match(viewModel, /\.sort\(\(a, b\) => b\.score - a\.score/, "README model should smart-prioritize rail tabs instead of using one fixed order");
    assert.doesNotMatch(viewModel, /\.slice\(0,\s*20\)/, "README model should not drop project link previews after the first page");
    assert.match(quickConsole, /buildUniqueRiskWarnings/, "README report should dedupe repeated risk labels before rendering");
    assert.match(quickConsole, /ProjectReadmeCommandConfidence/, "README command extraction should classify command confidence");
    assert.match(quickConsole, /inferCommandConfidence/, "README command extraction should infer confidence from language, heading, and command shape");
    assert.match(quickConsole, /inferCommandEcosystemTags/, "README command extraction should classify agent and ecosystem tags");
    assert.match(quickConsole, /buildReadmeBriefItems/, "README report should expose structured brief facts");
    assert.match(quickConsole, /projectReadmeCommandLineTargetId/, "README command extraction should create command-line targets inside multi-command blocks");
    assert.match(quickConsole, /codeLineStart/, "README command extraction should preserve command source-line start metadata");
    assert.match(quickConsole, /codeLineEnd/, "README command extraction should preserve command source-line end metadata");
    assert.match(quickConsole, /inlineByLineQueue/, "README command target maps should keep same-line inline command queues");
    assert.match(quickConsole, /Global install/, "README command risk labels should include global installs");
    assert.match(quickConsole, /Credential environment/, "README command risk labels should include credential environment writes");
    assert.match(quickConsole, /Account login/, "README command risk labels should include login flows");
    assert.match(quickConsole, /Shell profile update/, "README command risk labels should include shell profile edits");
    assert.match(dataHook, /(blocks|uniqueBlocksList|missingBlocks)\.slice\(index,\s*index \+ 20\)/, "README preview hook should chunk server preview requests");
    assert.match(dataHook, /Promise\.all\(chunks\.map/, "README preview hook should fetch all preview chunks");
    assert.match(readmeAction, /projectTaskHref/, "README task links should open a specific task route");
    assert.match(readmeAction, /projectFileHref/, "README file links should open a specific file route");
    assert.match(readmeAction, /projectSprintHref/, "README sprint links should open a specific sprint route");
    assert.match(projectLayout, /data-project-sticky-tabs/, "project layout should mark the sticky tab row for README scroll-offset measurement");
});

test("Files tab Linked README Ecosystem synchronization", () => {
    const repoRoot = process.cwd();
    const fileActions = fs.readFileSync(path.join(repoRoot, "src/components/projects/v2/files-tab/file/FileActionsBar.tsx"), "utf8");
    const readmeAction = fs.readFileSync(path.join(repoRoot, "src/app/actions/project/readme.ts"), "utf8");
    const readmeEditor = fs.readFileSync(path.join(repoRoot, "src/components/projects/readme/ProjectReadmeEditor.tsx"), "utf8");

    assert.match(readmeAction, /linkProjectReadmeAction/, "readme actions should define linkProjectReadmeAction");
    assert.match(readmeAction, /unlinkProjectReadmeAction/, "readme actions should define unlinkProjectReadmeAction");
    assert.match(readmeAction, /linkedNodeId:\s*nodeId/, "link action should set linkedNodeId in the database");

    assert.match(fileActions, /linkProjectReadmeAction\(/, "Files tab Use as README should invoke linkProjectReadmeAction");
    assert.match(fileActions, /unlinkProjectReadmeAction\(/, "Files tab Use as README should invoke unlinkProjectReadmeAction");
    assert.match(fileActions, /Using as README/, "Files tab should support dynamic linked state badge");

    assert.match(readmeEditor, /Powered by \{draft\.linkedNode\.name\}/, "README editor should render Powered by badge");
});
