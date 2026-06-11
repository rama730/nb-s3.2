export type ProjectReadmeStylePresetId = "open_source" | "product_demo" | "technical_docs" | "internal_brief" | "portfolio_showcase";

export type ProjectReadmeStylePreset = {
    id: ProjectReadmeStylePresetId;
    label: string;
    description: string;
    sections: string[];
};

export const PROJECT_README_STYLE_PRESETS: ProjectReadmeStylePreset[] = [
    {
        id: "open_source",
        label: "Open-source GitHub",
        description: "Portable project README with install, usage, contributing, and license sections.",
        sections: ["Overview", "Install", "Usage", "Contributing", "License"],
    },
    {
        id: "product_demo",
        label: "Product demo",
        description: "Lead with value, screenshots, setup, and a short walkthrough.",
        sections: ["Overview", "Preview", "Start here", "Workflow", "Support"],
    },
    {
        id: "technical_docs",
        label: "Technical docs",
        description: "Explain architecture, configuration, commands, and operational notes.",
        sections: ["Overview", "Architecture", "Configuration", "Commands", "Operations"],
    },
    {
        id: "internal_brief",
        label: "Internal brief",
        description: "A compact project context page for owners, collaborators, tasks, and files.",
        sections: ["Summary", "Owner", "Current focus", "Key files", "Next steps"],
    },
    {
        id: "portfolio_showcase",
        label: "Portfolio showcase",
        description: "Show the outcome, visuals, build notes, and links clearly.",
        sections: ["Overview", "Highlights", "Preview", "Build notes", "Links"],
    },
];

function titleOrFallback(value: string | null | undefined) {
    const title = value?.trim();
    return title || "Project Name";
}

export function buildProjectReadmeStylePresetMarkdown(presetId: ProjectReadmeStylePresetId, projectTitle?: string | null) {
    const title = titleOrFallback(projectTitle);
    switch (presetId) {
        case "product_demo":
            return `# ${title}

## Overview

Describe the problem, the audience, and the result in two or three sentences.

## Preview

Add a screenshot, GIF, or short visual walkthrough.

## Start here

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Workflow

1. Open the project.
2. Complete the main setup step.
3. Verify the expected result.

## Support

Add docs, demo links, and contact information.
`;
        case "technical_docs":
            return `# ${title}

## Overview

Summarize what the system does and where it fits.

## Architecture

Describe the important services, data flow, and dependencies.

## Configuration

List required environment variables, feature flags, or setup files.

## Commands

\`\`\`bash
pnpm install
pnpm test
pnpm dev
\`\`\`

## Operations

Document deploy, monitoring, rollback, and known risks.
`;
        case "internal_brief":
            return `# ${title}

## Summary

Write the current state, goal, and context for collaborators.

## Owner

Mention the owner and the people who can help.

## Current focus

- Priority:
- Blocker:
- Next decision:

## Key files

- \`README.md\` - project overview

## Next steps

1. Confirm the next task.
2. Assign ownership.
3. Review the result.
`;
        case "portfolio_showcase":
            return `# ${title}

## Overview

Explain the outcome and why it is useful.

## Highlights

- Main feature:
- Technical choice:
- Result:

## Preview

Add the best screenshot, demo GIF, or product image.

## Build notes

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Links

- Demo:
- Repository:
- Notes:
`;
        case "open_source":
        default:
            return `# ${title}

## Overview

Explain what this project does, who it helps, and why it matters.

## Install

\`\`\`bash
pnpm install
\`\`\`

## Usage

\`\`\`bash
pnpm dev
\`\`\`

## Contributing

Describe how people should report issues, suggest changes, or contribute.

## License

Add the project license.
`;
    }
}
