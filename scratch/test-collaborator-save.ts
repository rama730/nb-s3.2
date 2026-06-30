import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

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

    const newContent = content + "\n\n# Test edit by collaborator Rama\n";

    console.log("\n2. Saving draft...");
    const saveRes = await saveProjectReadmeDraftAction(projectId, {
        content: newContent,
        expectedDraftUpdatedAt: updatedAt,
    });
    console.log("Save Draft Result:", JSON.stringify(saveRes, null, 2));

    if (!saveRes.success) {
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
