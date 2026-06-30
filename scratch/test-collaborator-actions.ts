import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

// Mock the user to be collaborator (Rama - 08650344-274a-4cc5-bd43-b55be0480df1)
process.env.MOCK_USER_ID = "08650344-274a-4cc5-bd43-b55be0480df1";

async function main() {
    const { readProjectReadmeAction, readProjectReadmeDraftAction, saveProjectReadmeDraftAction, publishProjectReadmeAction } = await import("../src/app/actions/project/readme");

    const projectId = "0adb0049-a58e-44d3-bcb3-db2ee4abdfc6";

    console.log("1. Simulating readProjectReadmeAction...");
    const readResult = await readProjectReadmeAction(projectId);
    console.log("Read Result:", JSON.stringify(readResult, null, 2));

    console.log("\n2. Simulating readProjectReadmeDraftAction...");
    const draftResult = await readProjectReadmeDraftAction(projectId);
    console.log("Draft Result:", JSON.stringify(draftResult, null, 2));

    process.exit(0);
}

main().catch(console.error);
