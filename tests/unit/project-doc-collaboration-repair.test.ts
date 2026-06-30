import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    normalizeProjectDocContent,
    resolveProjectDocCollaborationContent,
} from "../../src/lib/projects/readme";

const longReadme = `# Antigravity Awesome Skills

> Installable GitHub library of agentic skills for Claude Code, Cursor, Codex CLI, Gemini CLI, and other assistants.

Antigravity Awesome Skills is an installable GitHub library and npm installer for reusable skill playbooks. It gives users a searchable catalog of skills, bundles, workflows, plugin-safe distributions, and practical docs that help agents perform recurring tasks.

## Star History

If Antigravity Awesome Skills has been useful, consider starring the repo.

## License

Original code and tooling are licensed under the MIT License.

Original documentation and other non-code written content are licensed under CC BY 4.0 unless a more specific upstream notice says otherwise.

---
`;

test("Doc collaboration repair collapses repeated canonical drafts", () => {
    const canonicalContent = `# Pre-commit hooks configuration

repos:
- repo: local
  hooks:
  - id: check-env-files
`;

    assert.deepEqual(
        resolveProjectDocCollaborationContent({
            canonicalContent,
            collaborativeContent: `${canonicalContent}${canonicalContent}`,
        }),
        {
            content: canonicalContent,
            repaired: true,
            reason: "repeated-canonical-draft",
            repeatCount: 2,
        },
    );
});

test("Doc collaboration repair preserves legitimate remote edits", () => {
    const canonicalContent = "# Project\n\nUse this project with care.\n";
    const collaborativeContent = "# Project\n\nUse this project with care.\n\n## Notes\n\nRemote edit.\n";

    assert.deepEqual(
        resolveProjectDocCollaborationContent({
            canonicalContent,
            collaborativeContent,
        }),
        {
            content: collaborativeContent,
            repaired: false,
            reason: null,
            repeatCount: 1,
        },
    );
});

test("Doc normalization removes a repeated document start appended at the bottom", () => {
    const corruptedContent = `${longReadme}\n\n${longReadme.slice(0, 360)}`;

    assert.equal(normalizeProjectDocContent(corruptedContent), longReadme.trimEnd());
});

test("Doc normalization keeps legitimate repeated headings", () => {
    const content = `${longReadme}\n## Antigravity Awesome Skills\n\nThis is a retrospective section, not a duplicated tail.\n`;

    assert.equal(normalizeProjectDocContent(content), content);
});

test("Doc collaboration repair removes repeated tail before syncing editor state", () => {
    const corruptedContent = `${longReadme}\n\n${longReadme.slice(0, 360)}`;

    assert.deepEqual(
        resolveProjectDocCollaborationContent({
            canonicalContent: longReadme,
            collaborativeContent: corruptedContent,
        }),
        {
            content: longReadme.trimEnd(),
            repaired: true,
            reason: "repeated-draft-tail",
            repeatCount: 2,
        },
    );
});

test("Doc editor writes repaired collaboration content back to Yjs", () => {
    const editor = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/readme/ProjectDocEditor.tsx"),
        "utf8",
    );

    assert.match(
        editor,
        /resolveProjectDocCollaborationContent/,
        "Doc collaboration sync should reconcile repeated persisted Yjs drafts before accepting remote text",
    );
    assert.match(
        editor,
        /local-collaboration-repair/,
        "Doc collaboration repairs should write the canonical draft back into the Yjs document",
    );
    assert.match(
        editor,
        /lastRepairRepeatCount/,
        "Doc collaboration repairs should leave repair metadata for future diagnosis",
    );
});

test("Doc draft editor normalizes stale local recovery content", () => {
    const draftHook = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/readme/useProjectDocDraftEditor.ts"),
        "utf8",
    );

    assert.match(
        draftHook,
        /normalizeProjectDocContent/,
        "Doc draft hook should normalize initial and recovered local content before showing it in WRITE mode",
    );
    assert.match(
        draftHook,
        /normalizedEmergencyDraft/,
        "Local emergency draft recovery should not rehydrate a previously duplicated Doc tail",
    );
});
