import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

// Mock next/cache before importing the action
import Module from "module";
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === "next/cache") {
        return {
            revalidatePath: (path: string) => {
                console.log(`[Mock] revalidatePath called for: ${path}`);
            },
            revalidateTag: (tag: string) => {
                console.log(`[Mock] revalidateTag called for: ${tag}`);
            },
        };
    }
    return originalRequire.apply(this, arguments as any);
};

// Mock user to be collaborator (Rama - 08650344-274a-4cc5-bd43-b55be0480df1)
process.env.MOCK_USER_ID = "08650344-274a-4cc5-bd43-b55be0480df1";

async function main() {
    const { readProjectReadmeDraftAction, saveProjectReadmeDraftAction, publishProjectReadmeAction } = await import("../src/app/actions/project/readme");

    const projectId = "0adb0049-a58e-44d3-bcb3-db2ee4abdfc6";

    console.log("1. Reading current draft...");
    const draftRes = await readProjectReadmeDraftAction(projectId);
    if (!draftRes.success) {
        console.error("Failed to read draft:", draftRes);
        process.exit(1);
    }
    console.log("Draft loaded successfully.");
    const content = draftRes.data.draftContent;
    const updatedAt = draftRes.data.draftUpdatedAt;

    // Simulate collaborator editing the README back to a longer content
    const newContent = `# Pre-commit hooks configuration

# Install: pip install pre-commit && pre-commit install: Ramanayudu form Safariii 
# Or use: npx pre-commit Install : ramanayudu form chrome 

repos:

- repo: https://github.com/pre-commit/pre-commit-hooks
  rev: v4.5.0
  hooks:
  - id: trailing-whitespace
  - id: end-of-file-fixer
  - id: check-yaml
  - id: check-json
  - id: check-added-large-files
    args: ['--maxkb=1000']
  - id: detect-private-key
  - id: detect-aws-credentials
  - id: detect-secrets
    args: ['--baseline', '.secrets.baseline']
    additional_dependencies: ['detect-secrets[gibberish]']

- repo: https://github.com/Yelp/detect-secrets
  rev: v1.4.0
  hooks:
  - id: detect-secrets
    args: ['--baseline', '.secrets.baseline']
    exclude: package-lock.json|pnpm-lock.yaml

- repo: local
  hooks:
  - id: check-env-files
    name: Check for committed .env files
    entry: bash -c 'if git diff --cached --name-only | grep -E "\\.env$|\\.env\\."; then echo \"ERROR: .env files should not be committed!\"; exit 1; fi'
    language: system
    pass_filenames: false

  - id: check-temp-files
    name: Check for temp files with secrets
    entry: bash -c 'if git diff --cached --name-only | grep -E \"\\.temp/|pooler-url|connection.\\*string\"; then echo \"ERROR: Temp files or connection strings should not be committed!\"; exit 1; fi'
    language: system\n    pass_filenames: false

# Collaborator Rama publish test content`;

    console.log("\n2. Saving draft...");
    const saveRes = await saveProjectReadmeDraftAction(projectId, {
        content: newContent,
        expectedDraftUpdatedAt: updatedAt,
    });
    console.log("Save Draft Result:", JSON.stringify(saveRes, null, 2));

    if (!saveRes.success) {
        console.error("Failed to save draft:", saveRes);
        process.exit(1);
    }

    console.log("\n3. Publishing draft...");
    const publishRes = await publishProjectReadmeAction(projectId, {
        content: newContent,
        expectedDraftUpdatedAt: saveRes.draftUpdatedAt,
        changeSummary: "Collaborator edit test",
        syncToFilesTab: true,
    });
    console.log("Publish Result:", JSON.stringify(publishRes, null, 2));

    process.exit(0);
}

main().catch(console.error);
