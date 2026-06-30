import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

// Mock user to be collaborator (Rama - 08650344-274a-4cc5-bd43-b55be0480df1)
process.env.MOCK_USER_ID = "08650344-274a-4cc5-bd43-b55be0480df1";

async function main() {
    const { POST } = await import("../src/app/api/v1/projects/[id]/readme-collaboration-token/route");
    const { NextRequest } = await import("next/server");

    const projectId = "0adb0049-a58e-44d3-bcb3-db2ee4abdfc6";
    const req = new NextRequest(`http://localhost:3000/api/v1/projects/${projectId}/readme-collaboration-token`, {
        method: "POST",
    });

    console.log("Simulating POST request to readme-collaboration-token API route...");
    const res = await POST(req, { params: Promise.resolve({ id: projectId }) });
    
    console.log("Status Code:", res.status);
    const body = await res.json();
    console.log("Body:", JSON.stringify(body, null, 2));

    process.exit(0);
}

main().catch(console.error);
